"""Default price per kg per material (PLA, PETG, ABS, TPU, …).

Upstream has one global fallback, the ``default_filament_cost`` setting, which
every cost path (usage tracking, print estimates, archive costs) reads on its
own whenever a spool has no ``cost_per_kg``. Making that fallback depend on the
material would mean a hunk in each of those paths. Instead PSI writes the
material price *onto the spool*, where every one of them already looks first:

* a spool saved without a price gets its material's price;
* a price filled in this way is marked (``spool.psi_cost_auto``), so changing
  or removing a material price later follows on those spools, while a price
  someone typed stays untouched;
* typing a price makes it the spool's own; clearing it hands the spool back to
  its material's price;
* changing a spool's material re-prices it if its price was filled in.

The hook is a pair of ORM listeners on upstream's ``Spool``, like the run hook
on ``PrintLogEntry``: every path that saves a spool goes through them, and no
upstream code changes. Costs already recorded for past prints are not touched;
a price change applies from the next print on, as upstream's own does.

Grams printed without any spool assigned still use upstream's global default.
"""

import logging

from sqlalchemy import delete, event, func, insert, inspect, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.custom.psi.runs import schema_ready
from backend.app.custom.psi.tables import material_prices, spools
from backend.app.models.spool import Spool

logger = logging.getLogger(__name__)

MATERIAL_MAX_LENGTH = 50
_AUTO = "psi_cost_auto"  # key in the instance state's info: flag to write after the flush


def normalize(material: str | None) -> str:
    """The key a material is priced under: trimmed, upper-case ("pla " → "PLA")."""
    return (material or "").strip().upper()[:MATERIAL_MAX_LENGTH]


def _material_key(column):
    return func.upper(func.trim(column))


# --- ORM hook -------------------------------------------------------------


def _price(connection, material: str | None) -> float | None:
    key = normalize(material)
    if not key:
        return None
    return connection.execute(
        select(material_prices.c.cost_per_kg).where(material_prices.c.material == key)
    ).scalar_one_or_none()


def _is_auto(connection, spool_id: int) -> bool:
    return bool(connection.execute(select(spools.c.psi_cost_auto).where(spools.c.id == spool_id)).scalar_one_or_none())


def _changed(history) -> bool:
    """True if the attribute got a value other than the one it had.

    Upstream's spool form sends every field on save; re-sending the same price
    must not turn a filled-in price into a typed one.
    """
    if not history.added:
        return False
    if not history.deleted:
        return True
    return history.added[0] != history.deleted[0]


def _fill(connection, target) -> bool | None:
    """Give a spool without a price its material's price. Returns the flag to store."""
    price = _price(connection, target.material)
    target.cost_per_kg = price
    return True if price is not None else None


def _decide_insert(connection, target) -> None:
    if target.cost_per_kg is None and _price(connection, target.material) is not None:
        inspect(target).info[_AUTO] = _fill(connection, target)


def _decide_update(connection, target) -> None:
    state = inspect(target)
    if _changed(state.attrs.cost_per_kg.history):
        # Someone set the price: a value is theirs, an empty one means "the material's".
        state.info[_AUTO] = _fill(connection, target) if target.cost_per_kg is None else None
    elif _changed(state.attrs.material.history):
        if target.cost_per_kg is None or _is_auto(connection, target.id):
            state.info[_AUTO] = _fill(connection, target)
    elif target.cost_per_kg is None and _price(connection, target.material) is not None:
        state.info[_AUTO] = _fill(connection, target)


def _guarded(decide):
    def listener(mapper, connection, target) -> None:  # noqa: ARG001 — SQLAlchemy signature
        if not schema_ready():
            return
        try:
            # A savepoint, so a failing read can never poison upstream's
            # transaction (PostgreSQL would abort it and fail the spool save).
            with connection.begin_nested():
                decide(connection, target)
        except Exception:
            inspect(target).info.pop(_AUTO, None)
            logger.exception("PSI: could not apply the material price to spool %s", getattr(target, "id", None))

    return listener


def _store_flag(mapper, connection, target) -> None:  # noqa: ARG001 — SQLAlchemy signature
    info = inspect(target).info
    if _AUTO not in info:
        return
    flag = info.pop(_AUTO)
    try:
        with connection.begin_nested():
            connection.execute(update(spools).where(spools.c.id == target.id).values(psi_cost_auto=flag))
    except Exception:
        logger.exception("PSI: could not mark the price of spool %s", target.id)


event.listen(Spool, "before_insert", _guarded(_decide_insert))
event.listen(Spool, "before_update", _guarded(_decide_update))
event.listen(Spool, "after_insert", _store_flag)
event.listen(Spool, "after_update", _store_flag)


# --- Price list -----------------------------------------------------------


async def load_prices(db: AsyncSession) -> list[dict]:
    """Every priced material and every material in the inventory, with spool counts.

    Counts cover spools that are not archived: ``auto`` carry the material
    price, ``own`` a price someone typed, ``unpriced`` none (they fall back to
    upstream's global default).
    """
    prices = {row.material: row.cost_per_kg for row in (await db.execute(select(material_prices))).all()}
    key = _material_key(spools.c.material)
    auto = spools.c.psi_cost_auto.is_(True)
    counts = (
        await db.execute(
            select(
                key.label("material"),
                func.count().label("spools"),
                func.count().filter(auto).label("auto"),
                func.count().filter(spools.c.cost_per_kg.is_not(None), or_(auto.is_(None), ~auto)).label("own"),
                func.count().filter(spools.c.cost_per_kg.is_(None)).label("unpriced"),
            )
            .where(spools.c.archived_at.is_(None), key != "")
            .group_by(key)
        )
    ).all()
    by_material = {row.material: row for row in counts}
    rows = []
    for material in sorted(set(prices) | set(by_material)):
        row = by_material.get(material)
        rows.append(
            {
                "material": material,
                "cost_per_kg": prices.get(material),
                "spools": row.spools if row else 0,
                "auto": row.auto if row else 0,
                "own": row.own if row else 0,
                "unpriced": row.unpriced if row else 0,
            }
        )
    return rows


async def save_prices(db: AsyncSession, new: dict[str, float | None]) -> int:
    """Replace the price list and re-price the spools that follow it.

    A material missing from ``new`` (or set to ``None``) loses its price; its
    filled-in spools go back to "no price", i.e. to upstream's global default.
    Returns the number of spools whose price changed. Does not commit.
    """
    wanted: dict[str, float] = {}
    for material, price in new.items():
        key = normalize(material)
        if not key:
            raise ValueError("material must not be empty")
        if price is not None:
            if price < 0:
                raise ValueError(f"{key}: price must not be negative")
            wanted[key] = round(float(price), 2)

    old = set((await db.execute(select(material_prices.c.material))).scalars())
    await db.execute(delete(material_prices))
    if wanted:
        await db.execute(insert(material_prices), [{"material": m, "cost_per_kg": p} for m, p in wanted.items()])

    key = _material_key(spools.c.material)
    auto = spools.c.psi_cost_auto.is_(True)
    changed = 0
    for material, price in wanted.items():
        result = await db.execute(
            update(spools)
            .where(
                key == material,
                or_(auto, spools.c.cost_per_kg.is_(None)),
                or_(spools.c.cost_per_kg.is_(None), spools.c.cost_per_kg != price, spools.c.psi_cost_auto.is_(None)),
            )
            .values(cost_per_kg=price, psi_cost_auto=True)
        )
        changed += result.rowcount or 0
    dropped = old - set(wanted)
    if dropped:
        result = await db.execute(
            update(spools).where(key.in_(dropped), auto).values(cost_per_kg=None, psi_cost_auto=None)
        )
        changed += result.rowcount or 0
    if changed:
        logger.info("PSI: material prices saved, %s spools re-priced", changed)
    return changed
