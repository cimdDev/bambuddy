"""PSI API, mounted at ``/api/v1/psi``.

Permissions are upstream's own; the PSI layer adds none:

* reading card data needs read access to the record (``*:read_all`` or
  ``*:read_own`` for records the caller created), like upstream's lists;
* editing a record's class or note needs that record's update permission,
  with upstream's ownership rules (``*:update_all`` / ``*:update_own``);
* repairing a user needs update permission on the record that holds it;
* the accounting totals need ``stats:read``; the per-person part (the user
  rows, the run list, the CSV export) needs PSI's own ``psi_accounting:read``
  (see :mod:`.permissions`). Filtering by Bambuddy user needs
  ``stats:filter_by_user`` as it does on upstream's stats page;
* the chart runs (``/stats/runs``) need what upstream's ``/archives/slim``
  needs, including its pin to the caller's own runs;
* the material prices are inventory data: ``inventory:read`` to see them,
  ``inventory:update`` to change them (they re-price spools).
"""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import (
    RequireAnyPermissionIfAuthEnabled,
    RequirePermissionIfAuthEnabled,
    probe_permissions_if_auth_enabled,
    require_ownership_permission,
)
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.custom.psi import accounting, classification, material_prices, service
from backend.app.custom.psi.permissions import ACCOUNTING_READ
from backend.app.custom.psi.service import Caller, NotFound

router = APIRouter(prefix="/psi", tags=["psi"])

_READ_ANY = RequireAnyPermissionIfAuthEnabled(
    Permission.ARCHIVES_READ_ALL,
    Permission.ARCHIVES_READ_OWN,
    Permission.QUEUE_READ_ALL,
    Permission.QUEUE_READ_OWN,
    Permission.LIBRARY_READ_ALL,
    Permission.LIBRARY_READ_OWN,
)

_UPDATE = {
    "archive": require_ownership_permission(Permission.ARCHIVES_UPDATE_ALL, Permission.ARCHIVES_UPDATE_OWN),
    "queue": require_ownership_permission(Permission.QUEUE_UPDATE_ALL, Permission.QUEUE_UPDATE_OWN),
    "library": require_ownership_permission(Permission.LIBRARY_UPDATE_ALL, Permission.LIBRARY_UPDATE_OWN),
}

PsiClass = Literal["psi", "private", "private_partial", "private_own"]


class PsiUpdate(BaseModel):
    """Only the fields present are changed. ``null`` resets the class to "inherit"."""

    psi_class: PsiClass | None = None
    note: str | None = Field(default=None, max_length=service.NOTE_MAX_LENGTH + 500)


class UserRepair(BaseModel):
    value: str = Field(min_length=1, max_length=255)


def _ids(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        values = [int(part) for part in raw.split(",") if part.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="ids must be comma-separated integers") from exc
    if len(values) > 500:
        raise HTTPException(status_code=422, detail="at most 500 ids per entity")
    return values


def _check_owner(auth: tuple, created_by_id: int | None) -> None:
    user, can_modify_all = auth
    if user is None or can_modify_all:
        return
    if created_by_id is None or created_by_id != user.id:
        raise HTTPException(status_code=403, detail="You can only modify your own items")


@router.get("/meta")
async def get_meta(
    archive: str | None = Query(None, description="Comma-separated archive ids"),
    queue: str | None = Query(None, description="Comma-separated queue item ids"),
    library: str | None = Query(None, description="Comma-separated library file ids"),
    db: AsyncSession = Depends(get_db),
    user=_READ_ANY,
):
    """User, class and note for the given records, as the cards show them."""
    meta = await service.load_meta(
        db, Caller(user), {"archive": _ids(archive), "queue": _ids(queue), "library": _ids(library)}
    )
    await db.commit()  # users resolved lazily from files are persisted
    return {entity: {str(k): v for k, v in rows.items()} for entity, rows in meta.items()}


async def _update(entity: service.Entity, record_id: int, body: PsiUpdate, db: AsyncSession, auth: tuple) -> dict:
    try:
        _check_owner(auth, await service.record_owner(db, entity, record_id))
        fields = {name: getattr(body, name) for name in body.model_fields_set}
        await service.update_record(db, entity, record_id, **fields)
        await db.commit()
        return await service.load_one(db, Caller(auth[0]), entity, record_id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/archives/{archive_id}")
async def update_archive(
    archive_id: int, body: PsiUpdate, db: AsyncSession = Depends(get_db), auth: tuple = Depends(_UPDATE["archive"])
):
    return await _update("archive", archive_id, body, db, auth)


@router.patch("/queue/{item_id}")
async def update_queue_item(
    item_id: int, body: PsiUpdate, db: AsyncSession = Depends(get_db), auth: tuple = Depends(_UPDATE["queue"])
):
    """Works at any queue status: a note or class is never frozen.

    Deliberately not part of upstream's ``PATCH /queue/{id}``, whose status and
    ``dispatching_at`` guards stop an edit from splitting a queue row from an
    in-flight print (#2615). PSI fields cannot affect dispatch, so they get
    their own route and upstream's stays untouched.
    """
    return await _update("queue", item_id, body, db, auth)


@router.patch("/library/{file_id}")
async def update_library_file(
    file_id: int, body: PsiUpdate, db: AsyncSession = Depends(get_db), auth: tuple = Depends(_UPDATE["library"])
):
    return await _update("library", file_id, body, db, auth)


async def _repair_user(
    entity: Literal["archive", "library"], record_id: int, body: UserRepair, db: AsyncSession, auth: tuple
) -> dict:
    try:
        _check_owner(auth, await service.record_owner(db, entity, record_id))
        await service.set_user(db, entity, record_id, body.value)
        await db.commit()
        return await service.load_one(db, Caller(auth[0]), entity, record_id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/archives/{archive_id}/user")
async def repair_archive_user(
    archive_id: int, body: UserRepair, db: AsyncSession = Depends(get_db), auth: tuple = Depends(_UPDATE["archive"])
):
    return await _repair_user("archive", archive_id, body, db, auth)


@router.put("/library/{file_id}/user")
async def repair_library_user(
    file_id: int, body: UserRepair, db: AsyncSession = Depends(get_db), auth: tuple = Depends(_UPDATE["library"])
):
    return await _repair_user("library", file_id, body, db, auth)


@router.get("/users")
async def get_known_users(db: AsyncSession = Depends(get_db), user=_READ_ANY):  # noqa: ARG001
    """Users seen on archives and files, most frequent first. Feeds suggestions."""
    return await service.known_users(db)


def _validate_user_filter(user, created_by_id: int | None) -> None:
    """Same rule as upstream's stats page: filtering by user needs its own right."""
    if created_by_id is None or user is None or user.is_admin:
        return
    if not user.has_permission(Permission.STATS_FILTER_BY_USER.value):
        raise HTTPException(status_code=403, detail="Permission stats:filter_by_user required")


_STATS = RequirePermissionIfAuthEnabled(Permission.STATS_READ)
_PERSONAL = RequirePermissionIfAuthEnabled(ACCOUNTING_READ)
DateFrom = Annotated[date | None, Query(description="Start date (inclusive), YYYY-MM-DD")]
DateTo = Annotated[date | None, Query(description="End date (inclusive), YYYY-MM-DD")]
CreatedBy = Annotated[int | None, Query(description="Bambuddy user who started the print (-1 for none)")]


@router.get("/accounting")
async def get_accounting(
    date_from: DateFrom = None,
    date_to: DateTo = None,
    created_by_id: CreatedBy = None,
    db: AsyncSession = Depends(get_db),
    user=_STATS,
    personal: bool = Depends(probe_permissions_if_auth_enabled(ACCOUNTING_READ)),
):
    """Totals for everyone with ``stats:read``; the per-person rows only with ``psi_accounting:read``."""
    _validate_user_filter(user, created_by_id)
    rows = await accounting.load_runs(db, accounting.run_filters(date_from, date_to, created_by_id))
    await db.commit()
    summary = accounting.summarize(rows)
    if not personal:
        summary["users"] = []
    return summary


@router.get("/stats/runs")
async def get_chart_runs(
    date_from: DateFrom = None,
    date_to: DateTo = None,
    created_by_id: CreatedBy = None,
    limit: int = Query(default=10000, le=50000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    auth: tuple = Depends(require_ownership_permission(Permission.ARCHIVES_READ_ALL, Permission.ARCHIVES_READ_OWN)),
):
    """Upstream's ``/archives/slim`` plus ``job`` (psi / private) on every run.

    Feeds the PSI copies of the stats page's activity and printer charts.
    Permissions and the own-runs pin are upstream's, verbatim.
    """
    user, can_read_all = auth
    _validate_user_filter(user, created_by_id)
    if user is not None and not can_read_all:
        created_by_id = user.id
    conditions = accounting.run_filters(date_from, date_to, created_by_id)
    return await accounting.chart_runs(db, conditions, limit=limit, offset=offset)


def _classes(raw: str | None) -> set[str] | None:
    if not raw:
        return None
    values = {part.strip() for part in raw.split(",") if part.strip()}
    unknown = values - set(classification.CLASSES)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown psi_class: {', '.join(sorted(unknown))}")
    return values


@router.get("/accounting/runs")
async def get_accounting_runs(
    date_from: DateFrom = None,
    date_to: DateTo = None,
    created_by_id: CreatedBy = None,
    user_key: str | None = Query(None, description=f"User key from /accounting, or {accounting.NO_USER}"),
    classes: str | None = Query(None, description="Comma-separated psi_class filter"),
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    user=_PERSONAL,
):
    _validate_user_filter(user, created_by_id)
    rows = await accounting.load_runs(db, accounting.run_filters(date_from, date_to, created_by_id))
    await db.commit()
    return accounting.run_rows(rows, user_key=user_key, classes=_classes(classes))[:limit]


@router.get("/accounting/export")
async def export_accounting_runs(
    date_from: DateFrom = None,
    date_to: DateTo = None,
    created_by_id: CreatedBy = None,
    user_key: str | None = None,
    classes: str | None = None,
    db: AsyncSession = Depends(get_db),
    user=_PERSONAL,
):
    _validate_user_filter(user, created_by_id)
    rows = await accounting.load_runs(db, accounting.run_filters(date_from, date_to, created_by_id))
    await db.commit()
    body = accounting.to_csv(accounting.run_rows(rows, user_key=user_key, classes=_classes(classes)))
    period = f"{date_from or 'start'}_{date_to or 'today'}"
    return Response(
        content="﻿" + body,  # BOM, so Excel opens umlauts correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="psi-accounting_{period}.csv"'},
    )


class MaterialPrices(BaseModel):
    """The complete price list, material → price per kg. Materials left out lose their price."""

    prices: dict[str, float | None] = Field(max_length=200)


@router.get("/material-prices")
async def get_material_prices(
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.INVENTORY_READ),
):
    """Priced materials and the materials in the inventory, with how their spools are priced."""
    return await material_prices.load_prices(db)


@router.put("/material-prices")
async def save_material_prices(
    body: MaterialPrices,
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.INVENTORY_UPDATE),
):
    from backend.app.core.websocket import ws_manager

    try:
        changed = await material_prices.save_prices(db, body.prices)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    if changed:
        await ws_manager.broadcast({"type": "inventory_changed"})
    return {"repriced": changed, "materials": await material_prices.load_prices(db)}
