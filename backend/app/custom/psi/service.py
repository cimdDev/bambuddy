"""Read and write the PSI fields of archives, queue items and library files.

What every card shows, and where it comes from:

* **User** (who sliced it): stored on archives and library files, read lazily
  from the file's printer notes (:mod:`.printer_notes`) or typed by a human.
  An archive without one falls back to its source library file. A queue item
  stores none; it shows its archive's user, or its library file's before it
  has an archive. Repairing a user always writes the record that holds it.
* **Class** (PSI / private / material): stored on all three; ``NULL`` inherits.
  A queue item inherits from its library file, then its archive. An archive
  inherits from a queue item that is printing it right now, then from its
  library file. Everything else falls back to ``psi``.
* **Note**: one free-text field per record, never a live link between records.
  Archives and library files use upstream's own ``notes`` column; queue items
  use ``psi_notes``. While a queue item prints, its archive shows the item's
  note if the archive has none; the run hook then copies it over for good.

How an edit spreads (so that stats and cards never disagree):

* Archive: the archive, every run of it, and every queue item that already
  printed it. Editing an archive classifies the whole job.
* Queue item: the item and its own runs. Its archive follows when the item is
  printing or produced the archive's latest run.
* Library file: only the file. It is the default for jobs made from it later.
"""

import asyncio
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.custom.psi import classification, printer_notes
from backend.app.custom.psi.runs import run_class_expr
from backend.app.custom.psi.tables import archives, library, queue, runs

logger = logging.getLogger(__name__)

Entity = Literal["archive", "queue", "library"]
ENTITIES: tuple[Entity, ...] = ("archive", "queue", "library")
_RESOURCE = {"archive": "archives", "queue": "queue", "library": "library"}

#: Longest note accepted. Notes are one short text, not a document.
NOTE_MAX_LENGTH = 2000
#: Files read per request when resolving users lazily; the rest follow later.
USER_RESOLVE_BATCH = 200

#: Library file types that are print jobs (and so have a user and a class).
PRINTABLE_FILE_TYPES = {"3mf", "gcode"}

_UNSET: Any = object()


class NotFound(LookupError):
    pass


def normalize_note(value: str | None) -> str | None:
    """Trim a note; whitespace-only clears it to ``None``, never ``""``."""
    if value is None:
        return None
    value = value.strip()
    if len(value) > NOTE_MAX_LENGTH:
        raise ValueError(f"note is longer than {NOTE_MAX_LENGTH} characters")
    return value or None


@dataclass(frozen=True)
class Caller:
    """Who is asking, for per-record read and edit decisions.

    ``user`` is ``None`` when auth is disabled, or for an API key the route's
    dependency has already vetted; both get full access, as upstream does.
    """

    user: Any = None

    def can_read(self, entity: Entity, created_by_id: int | None) -> bool:
        return self._allowed(entity, "read", created_by_id)

    def can_modify(self, entity: Entity, created_by_id: int | None) -> bool:
        return self._allowed(entity, "update", created_by_id)

    def _allowed(self, entity: Entity, action: str, created_by_id: int | None) -> bool:
        user = self.user
        if user is None or user.is_admin:
            return True
        resource = _RESOURCE[entity]
        if user.has_permission(f"{resource}:{action}_all"):
            return True
        if user.has_permission(f"{resource}:{action}_own"):
            # Ownerless records need the *_all permission, as upstream rules.
            return created_by_id is not None and created_by_id == user.id
        return False


# --------------------------------------------------------------------- reading


async def load_meta(db: AsyncSession, caller: Caller, ids: dict[str, list[int]]) -> dict[str, dict[int, dict]]:
    """Everything the cards show for the requested records, keyed by entity and id.

    Records that do not exist, are soft-deleted, or are not visible to the
    caller are simply absent from the result.
    """
    archive_ids = set(ids.get("archive", []))
    queue_ids = set(ids.get("queue", []))
    library_ids = set(ids.get("library", []))

    queue_rows = await _rows(db, queue, queue_ids)
    archive_ids_needed = archive_ids | {r.archive_id for r in queue_rows.values() if r.archive_id}

    printing = await _printing_queue_items(db, archive_ids)
    archive_ids_needed |= {r.archive_id for r in printing.values() if r.archive_id}
    await ensure_users(db, archive_ids=archive_ids_needed, library_ids=())
    archive_rows = await _rows(db, archives, archive_ids_needed, live_only=True)

    library_ids_needed = (
        library_ids
        | {r.library_file_id for r in queue_rows.values() if r.library_file_id}
        | {r.library_file_id for r in archive_rows.values() if r.library_file_id}
        | {r.library_file_id for r in printing.values() if r.library_file_id}
    )
    await ensure_users(db, archive_ids=(), library_ids=library_ids_needed)
    library_rows = await _rows(db, library, library_ids_needed, live_only=True)

    mixed = await _archives_with_mixed_runs(db, archive_ids)
    view = _View(archive_rows, library_rows, queue_rows)

    result: dict[str, dict[int, dict]] = {"archive": {}, "queue": {}, "library": {}}
    for archive_id in archive_ids:
        row = archive_rows.get(archive_id)
        if row is not None and caller.can_read("archive", row.created_by_id):
            result["archive"][archive_id] = view.archive_meta(
                caller, row, printing.get(archive_id), archive_id in mixed
            )
    for queue_id in queue_ids:
        row = queue_rows.get(queue_id)
        if row is not None and caller.can_read("queue", row.created_by_id):
            result["queue"][queue_id] = view.queue_meta(caller, row)
    for library_id in library_ids:
        row = library_rows.get(library_id)
        if row is not None and caller.can_read("library", row.created_by_id):
            result["library"][library_id] = view.library_meta(caller, row)
    return result


async def load_one(db: AsyncSession, caller: Caller, entity: Entity, record_id: int) -> dict:
    meta = await load_meta(db, caller, {entity: [record_id]})
    if record_id not in meta[entity]:
        raise NotFound(f"{entity} {record_id} not found")
    return meta[entity][record_id]


class _View:
    """Builds the per-record payload from rows already loaded in bulk."""

    def __init__(self, archive_rows: dict, library_rows: dict, queue_rows: dict):
        self.archives = archive_rows
        self.library = library_rows
        self.queue = queue_rows

    def archive_meta(self, caller: Caller, row, printing_item, runs_mixed: bool) -> dict:
        lib = self.library.get(row.library_file_id)
        cls, source = classification.resolve(
            ("own", row.psi_class),
            ("queue", self.queue_class(printing_item)[0] if printing_item is not None else None),
            ("library", lib.psi_class if lib is not None else None),
        )
        note, note_source = row.notes, "own" if row.notes else None
        if not note and printing_item is not None and printing_item.psi_notes:
            note, note_source = printing_item.psi_notes, "queue"
        return {
            "entity": "archive",
            "id": row.id,
            "printable": True,
            "user": self.archive_user(row),
            "can_edit_user": caller.can_modify("archive", row.created_by_id),
            "psi_class": cls,
            "psi_class_own": row.psi_class,
            "psi_class_source": source,
            "runs_mixed": runs_mixed,
            "note": note,
            "note_source": note_source,
            "can_edit": caller.can_modify("archive", row.created_by_id),
        }

    def queue_meta(self, caller: Caller, row) -> dict:
        cls, source = self.queue_class(row)
        arc = self.archives.get(row.archive_id)
        lib = self.library.get(row.library_file_id)
        if arc is not None:
            user, owner = self.archive_user(arc), ("archive", arc.created_by_id)
        elif lib is not None:
            user, owner = self.library_user(lib), ("library", lib.created_by_id)
        else:
            user, owner = _user(None, None, None, None), None
        return {
            "entity": "queue",
            "id": row.id,
            "printable": True,
            "user": user,
            "can_edit_user": owner is not None and caller.can_modify(*owner),
            "psi_class": cls,
            "psi_class_own": row.psi_class,
            "psi_class_source": source,
            "runs_mixed": False,
            "note": row.psi_notes,
            "note_source": "own" if row.psi_notes else None,
            "can_edit": caller.can_modify("queue", row.created_by_id),
        }

    def library_meta(self, caller: Caller, row) -> dict:
        cls, source = classification.resolve(("own", row.psi_class))
        return {
            "entity": "library",
            "id": row.id,
            # Only sliceable/printable files carry printer notes or become jobs;
            # an STL or STEP file gets the note and nothing else.
            "printable": (row.file_type or "").lower() in PRINTABLE_FILE_TYPES,
            "user": self.library_user(row),
            "can_edit_user": caller.can_modify("library", row.created_by_id),
            "psi_class": cls,
            "psi_class_own": row.psi_class,
            "psi_class_source": source,
            "runs_mixed": False,
            "note": row.notes,
            "note_source": "own" if row.notes else None,
            "can_edit": caller.can_modify("library", row.created_by_id),
        }

    def queue_class(self, row) -> tuple[str, str | None]:
        """A queue item's class. Must match :func:`runs.run_class_expr`."""
        lib = self.library.get(row.library_file_id)
        arc = self.archives.get(row.archive_id)
        arc_lib = self.library.get(arc.library_file_id) if arc is not None else None
        return classification.resolve(
            ("own", row.psi_class),
            ("library", lib.psi_class if lib is not None else None),
            ("archive", arc.psi_class if arc is not None else None),
            ("library", arc_lib.psi_class if arc_lib is not None else None),
        )

    def archive_user(self, row) -> dict:
        if row.slicer_user or row.slicer_user_email:
            return _user(row.slicer_user, row.slicer_user_email, row.psi_user_checked, ("archive", row.id))
        lib = self.library.get(row.library_file_id)
        if lib is not None and (lib.slicer_user or lib.slicer_user_email):
            # Inherited from the source file, but a repair writes the archive.
            inherited = _user(lib.slicer_user, lib.slicer_user_email, lib.psi_user_checked, ("archive", row.id))
            return inherited | {"source": "library"}
        return _user(None, None, None, ("archive", row.id))

    def library_user(self, row) -> dict:
        return _user(row.slicer_user, row.slicer_user_email, row.psi_user_checked, ("library", row.id))


def _user(name, email, checked, record) -> dict:
    source = None
    if name or email:
        source = "manual" if checked == printer_notes.MANUAL else "file"
    return {
        "name": name,
        "email": email,
        "source": source,
        "record": {"entity": record[0], "id": record[1]} if record else None,
    }


async def _rows(db: AsyncSession, table, ids: Iterable[int], *, live_only: bool = False) -> dict:
    ids = [i for i in ids if i is not None]
    if not ids:
        return {}
    stmt = select(table).where(table.c.id.in_(ids))
    if live_only and "deleted_at" in table.c:
        stmt = stmt.where(table.c.deleted_at.is_(None))
    return {row.id: row for row in (await db.execute(stmt)).all()}


async def _printing_queue_items(db: AsyncSession, archive_ids: Iterable[int]) -> dict:
    """The queue item currently printing each archive, if any."""
    archive_ids = list(archive_ids)
    if not archive_ids:
        return {}
    stmt = select(queue).where(queue.c.archive_id.in_(archive_ids), queue.c.status == "printing").order_by(queue.c.id)
    return {row.archive_id: row for row in (await db.execute(stmt)).all()}


async def _archives_with_mixed_runs(db: AsyncSession, archive_ids: Iterable[int]) -> set[int]:
    """Archives whose runs were not all classified alike (reprints on other terms)."""
    archive_ids = list(archive_ids)
    if not archive_ids:
        return set()
    stmt = (
        select(runs.c.archive_id)
        .where(runs.c.archive_id.in_(archive_ids), runs.c.psi_class.is_not(None))
        .group_by(runs.c.archive_id)
        .having(func.count(func.distinct(runs.c.psi_class)) > 1)
    )
    return {row[0] for row in (await db.execute(stmt)).all()}


# --------------------------------------------------------------------- writing


async def update_record(
    db: AsyncSession,
    entity: Entity,
    record_id: int,
    *,
    psi_class: str | None = _UNSET,
    note: str | None = _UNSET,
) -> None:
    """Set a record's class and/or note and spread the class as documented above.

    The caller checks permissions and commits.
    """
    table = {"archive": archives, "queue": queue, "library": library}[entity]
    row = (await _rows(db, table, [record_id], live_only=True)).get(record_id)
    if row is None:
        raise NotFound(f"{entity} {record_id} not found")

    if note is not _UNSET:
        column = "psi_notes" if entity == "queue" else "notes"
        await db.execute(update(table).where(table.c.id == record_id).values({column: normalize_note(note)}))

    if psi_class is not _UNSET:
        value = classification.validate(psi_class)
        await db.execute(update(table).where(table.c.id == record_id).values(psi_class=value))
        if entity == "archive":
            await _spread_archive_class(db, row, value)
        elif entity == "queue":
            await _spread_queue_class(db, row)


async def _spread_archive_class(db: AsyncSession, row, value: str | None) -> None:
    if value is None:
        lib = (await _rows(db, library, [row.library_file_id])).get(row.library_file_id)
        run_value = classification.effective(lib.psi_class if lib is not None else None)
    else:
        run_value = value
    await db.execute(update(runs).where(runs.c.archive_id == row.id).values(psi_class=run_value))
    await db.execute(
        update(queue).where(queue.c.archive_id == row.id, queue.c.status != "pending").values(psi_class=value)
    )


async def _spread_queue_class(db: AsyncSession, row) -> None:
    await db.execute(
        update(runs)
        .where(runs.c.queue_item_id == row.id)
        .values(psi_class=run_class_expr(runs.c.queue_item_id, runs.c.archive_id))
    )
    if row.archive_id is None or row.status == "pending":
        return
    latest_run_queue_id = (
        await db.execute(
            select(runs.c.queue_item_id).where(runs.c.archive_id == row.archive_id).order_by(runs.c.id.desc()).limit(1)
        )
    ).scalar_one_or_none()
    if row.status == "printing" or latest_run_queue_id == row.id:
        resolved = (await db.execute(select(run_class_expr(row.id, None)))).scalar_one()
        await db.execute(update(archives).where(archives.c.id == row.archive_id).values(psi_class=resolved))


async def set_user(db: AsyncSession, entity: Literal["archive", "library"], record_id: int, value: str) -> None:
    """Repair who sliced a record. Set-or-replace; the caller checks and commits."""
    table = archives if entity == "archive" else library
    name, email = printer_notes.split_user_input(value)
    result = await db.execute(
        update(table)
        .where(table.c.id == record_id, table.c.deleted_at.is_(None))
        .values(slicer_user=name, slicer_user_email=email, psi_user_checked=printer_notes.MANUAL)
    )
    if not result.rowcount:
        raise NotFound(f"{entity} {record_id} not found")


async def record_owner(db: AsyncSession, entity: Entity, record_id: int) -> int | None:
    """``created_by_id`` of a live record, for ownership checks. Raises NotFound."""
    table = {"archive": archives, "queue": queue, "library": library}[entity]
    row = (await _rows(db, table, [record_id], live_only=True)).get(record_id)
    if row is None:
        raise NotFound(f"{entity} {record_id} not found")
    return row.created_by_id


# ----------------------------------------------------------------------- users


async def ensure_users(
    db: AsyncSession,
    *,
    archive_ids: Iterable[int] | None,
    library_ids: Iterable[int] | None,
    limit: int = USER_RESOLVE_BATCH,
) -> int:
    """Read the user out of files not read yet (or changed since). Returns rows read.

    ``None`` for an id set means "any unresolved record" (background backfill).
    Human repairs are never overwritten.
    """
    done = 0
    for table, ids in ((archives, archive_ids), (library, library_ids)):
        if ids is not None:
            ids = [i for i in ids if i is not None]
            if not ids:
                continue
        stmt = select(table.c.id, table.c.file_path, table.c.file_size, table.c.psi_user_checked).where(
            table.c.deleted_at.is_(None),
            func.coalesce(table.c.psi_user_checked, "") != printer_notes.MANUAL,
        )
        if ids is not None:
            stmt = stmt.where(table.c.id.in_(ids))
        pending = [
            row
            for row in (await db.execute(stmt)).all()
            if row.psi_user_checked != printer_notes.fingerprint(row.file_path, row.file_size)
        ][: max(limit - done, 0)]
        for row in pending:
            name, email = await asyncio.to_thread(_read_user_from, row.file_path)
            await db.execute(
                update(table)
                .where(table.c.id == row.id, func.coalesce(table.c.psi_user_checked, "") != printer_notes.MANUAL)
                .values(
                    slicer_user=name,
                    slicer_user_email=email,
                    psi_user_checked=printer_notes.fingerprint(row.file_path, row.file_size),
                )
            )
            done += 1
    return done


def _read_user_from(file_path: str | None) -> tuple[str | None, str | None]:
    if not file_path:
        return None, None
    path = Path(file_path)
    if not path.is_absolute():
        path = settings.base_dir / path  # SEC-PATH-OK: DB-stored, internally generated
    if not path.is_file():
        return None, None
    return printer_notes.read_user(path)


async def known_users(db: AsyncSession, limit: int = 200) -> list[dict]:
    """Users seen on archives and library files, most frequent first (suggestions)."""
    counts: dict[tuple[str | None, str | None], int] = {}
    for table in (archives, library):
        stmt = (
            select(table.c.slicer_user, table.c.slicer_user_email, func.count())
            .where((table.c.slicer_user.is_not(None)) | (table.c.slicer_user_email.is_not(None)))
            .group_by(table.c.slicer_user, table.c.slicer_user_email)
        )
        for name, email, count in (await db.execute(stmt)).all():
            counts[(name, email)] = counts.get((name, email), 0) + count
    ranked = sorted(counts.items(), key=lambda item: (-item[1], (item[0][0] or item[0][1] or "").lower()))
    return [{"name": name, "email": email, "count": count} for (name, email), count in ranked[:limit]]
