"""PSI accounting: company vs. private print work, per period, user and printer.

The source is print runs (``print_log_entries``), with the same rows, filters
and duration rule as upstream's ``GET /archives/stats``. The PSI breakdown must
add up to upstream's totals on the same stats page; two halves of one page that
disagree are worse than either alone, so ``test_accounting_reconciles_with_
upstream_stats`` pins it.

Buckets, from the run's frozen ``psi_class`` (see :mod:`.classification`):

* job type (counts, print time): PSI vs. private;
* material owner (weight, cost): PSI material (PSI jobs *and* private jobs on
  PSI material), partly own, own;
* per user, ``to_reimburse`` = cost of private jobs on PSI material. Partly own
  material is reported beside it, never split: the app does not know the split.

Runs recorded without a cost count as zero, as upstream counts them, and are
reported in ``runs_without_cost`` so a low total can be explained.
"""

import csv
import io
from collections.abc import Iterable
from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.custom.psi import classification
from backend.app.custom.psi.service import ensure_users
from backend.app.custom.psi.tables import archives, library, runs

#: Key used for runs whose user is unknown.
NO_USER = "__none__"


def run_filters(date_from: date | None, date_to: date | None, created_by_id: int | None) -> list:
    """The exact filters upstream's stats endpoint applies to runs."""
    conditions = []
    if date_from:
        conditions.append(runs.c.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        conditions.append(runs.c.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    if created_by_id is not None:
        if created_by_id == -1:
            conditions.append(runs.c.created_by_id.is_(None))
        else:
            conditions.append(runs.c.created_by_id == created_by_id)
    return conditions


def run_seconds(duration_seconds: int | None, started_at: datetime | None, completed_at: datetime | None) -> int:
    """Upstream's duration rule, verbatim: a stored duration wins, including 0 (#2592)."""
    if duration_seconds is not None:
        return duration_seconds
    if started_at and completed_at:
        elapsed = (completed_at - started_at).total_seconds()
        if elapsed > 0:
            return int(elapsed)
    return 0


async def load_runs(db: AsyncSession, conditions: list) -> list:
    """Runs in scope with their class and user. Resolves missing users first."""
    unresolved = (
        await db.execute(select(runs.c.archive_id).where(*conditions, runs.c.archive_id.is_not(None)).distinct())
    ).scalars()
    # Bounded: the startup backfill resolves the rest in the background.
    await ensure_users(db, archive_ids=list(unresolved), library_ids=(), limit=100)
    source_lib = library.alias("psi_source_lib")
    stmt = (
        select(
            runs.c.id,
            runs.c.archive_id,
            runs.c.printer_id,
            runs.c.printer_name,
            runs.c.print_name,
            runs.c.status,
            runs.c.created_at,
            runs.c.started_at,
            runs.c.completed_at,
            runs.c.duration_seconds,
            runs.c.filament_used_grams,
            runs.c.cost,
            runs.c.psi_class,
            archives.c.slicer_user,
            archives.c.slicer_user_email,
            source_lib.c.slicer_user.label("lib_user"),
            source_lib.c.slicer_user_email.label("lib_email"),
        )
        .select_from(
            runs.outerjoin(archives, archives.c.id == runs.c.archive_id).outerjoin(
                source_lib, source_lib.c.id == archives.c.library_file_id
            )
        )
        .where(*conditions)
        .order_by(runs.c.created_at.desc(), runs.c.id.desc())
    )
    return list((await db.execute(stmt)).all())


def run_user(row) -> tuple[str, str | None]:
    """``(key, label)`` of the user a run is attributed to. Same fallback as the cards."""
    label = row.slicer_user or row.slicer_user_email or row.lib_user or row.lib_email
    if not label:
        return NO_USER, None
    return label.strip().lower(), label


def _bucket() -> dict:
    return {"prints": 0, "hours": 0.0, "grams": 0.0, "cost": 0.0}


def _add(bucket: dict, seconds: int, grams: float, cost: float) -> None:
    bucket["prints"] += 1
    bucket["hours"] += seconds / 3600
    bucket["grams"] += grams
    bucket["cost"] += cost


def _rounded(bucket: dict) -> dict:
    return {
        "prints": bucket["prints"],
        "hours": round(bucket["hours"], 1),
        "grams": round(bucket["grams"], 1),
        "cost": round(bucket["cost"], 2),
    }


def summarize(rows: Iterable) -> dict:
    """Aggregate runs into the accounting payload."""
    totals = _bucket()
    by_class = {cls: _bucket() for cls in classification.CLASSES}
    users: dict[str, dict] = {}
    printers: dict[str, dict] = {}
    runs_without_cost = 0

    for row in rows:
        cls = classification.effective(row.psi_class)
        seconds = run_seconds(row.duration_seconds, row.started_at, row.completed_at)
        grams = float(row.filament_used_grams or 0)
        cost = float(row.cost or 0)
        if row.cost is None:
            runs_without_cost += 1
        _add(totals, seconds, grams, cost)
        _add(by_class[cls], seconds, grams, cost)

        key, label = run_user(row)
        user = users.setdefault(
            key, {"key": key, "labels": {}, "by_class": {c: _bucket() for c in classification.CLASSES}}
        )
        if label:
            user["labels"][label] = user["labels"].get(label, 0) + 1
        _add(user["by_class"][cls], seconds, grams, cost)

        printer_key = str(row.printer_id) if row.printer_id is not None else "unknown"
        printer = printers.setdefault(
            printer_key,
            {
                "printer_id": row.printer_id,
                "printer_name": None,
                "by_class": {c: _bucket() for c in classification.CLASSES},
            },
        )
        # Rows arrive newest first, so the first name seen is the latest one.
        printer["printer_name"] = printer["printer_name"] or row.printer_name
        _add(printer["by_class"][cls], seconds, grams, cost)

    return {
        "totals": _rounded(totals),
        "by_class": {cls: _rounded(b) for cls, b in by_class.items()},
        "job": _job_split(by_class),
        "material": _material_split(by_class),
        "users": sorted((_user_row(u) for u in users.values()), key=_user_sort_key),
        "printers": sorted(
            (
                {
                    "printer_id": p["printer_id"],
                    "printer_name": p["printer_name"],
                    "by_class": {cls: _rounded(b) for cls, b in p["by_class"].items()},
                }
                for p in printers.values()
            ),
            key=lambda p: -sum(b["prints"] for b in p["by_class"].values()),
        ),
        "runs_without_cost": runs_without_cost,
    }


def _job_split(by_class: dict) -> dict:
    split = {"psi": _bucket(), "private": _bucket()}
    for cls, bucket in by_class.items():
        target = split[classification.job_type(cls)]
        for field in ("prints", "hours", "grams", "cost"):
            target[field] += bucket[field]
    return {k: {"prints": v["prints"], "hours": round(v["hours"], 1)} for k, v in split.items()}


def _material_split(by_class: dict) -> dict:
    split = {"psi": _bucket(), "partial": _bucket(), "own": _bucket()}
    for cls, bucket in by_class.items():
        target = split[classification.material_owner(cls)]
        for field in ("prints", "hours", "grams", "cost"):
            target[field] += bucket[field]
    return {k: {"grams": round(v["grams"], 1), "cost": round(v["cost"], 2)} for k, v in split.items()}


def _user_row(user: dict) -> dict:
    by_class = {cls: _rounded(b) for cls, b in user["by_class"].items()}
    label = max(user["labels"].items(), key=lambda item: item[1])[0] if user["labels"] else None
    return {
        "key": user["key"],
        "label": label,
        "prints": sum(b["prints"] for b in by_class.values()),
        "by_class": by_class,
        "to_reimburse": by_class[classification.PRIVATE]["cost"],
        "partial_cost": by_class[classification.PRIVATE_PARTIAL]["cost"],
    }


def _user_sort_key(user: dict):
    return (user["key"] == NO_USER, -user["to_reimburse"], -user["partial_cost"], -user["prints"], user["key"])


def run_rows(rows: Iterable, *, user_key: str | None = None, classes: set[str] | None = None) -> list[dict]:
    """Individual runs for the drill-down list and the CSV export."""
    out = []
    for row in rows:
        key, label = run_user(row)
        cls = classification.effective(row.psi_class)
        if user_key is not None and key != user_key:
            continue
        if classes and cls not in classes:
            continue
        out.append(
            {
                "run_id": row.id,
                "archive_id": row.archive_id,
                "date": (row.completed_at or row.created_at).isoformat()
                if (row.completed_at or row.created_at)
                else None,
                "user": label,
                "psi_class": cls,
                "print_name": row.print_name,
                "printer_name": row.printer_name,
                "status": row.status,
                "grams": round(float(row.filament_used_grams or 0), 1),
                "cost": round(float(row.cost), 2) if row.cost is not None else None,
                "hours": round(run_seconds(row.duration_seconds, row.started_at, row.completed_at) / 3600, 2),
            }
        )
    return out


CSV_COLUMNS = (
    "date",
    "user",
    "psi_class",
    "print_name",
    "printer_name",
    "status",
    "hours",
    "grams",
    "cost",
    "archive_id",
    "run_id",
)


def to_csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore", delimiter=";")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in CSV_COLUMNS})
    return buffer.getvalue()
