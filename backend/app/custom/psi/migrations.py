"""PSI schema and data migrations. All idempotent; all run on every startup.

Schema: add every column in :data:`~backend.app.custom.psi.tables.PSI_COLUMNS`.

Data: carry over what earlier PSI builds stored in their own columns, then
classify runs that have no class yet. Every backfill only fills ``NULL``s and
reads sources that nothing writes any more, so running it again is a no-op.

Legacy sources, present only in databases that ran an earlier PSI build:

* ``private_job`` / ``private_material`` / ``private_material_partial`` on
  archives and queue items, ``private_job`` on library files  → ``psi_class``
* ``print_queue.comment`` (the old queue comments)  → ``print_queue.psi_notes``
* ``library_files.file_metadata['slicer_user' | 'slicer_user_email']``
  → the ``slicer_user`` columns

The legacy columns are left in place, unused. That keeps a rollback to the
previous image working; nothing new is written to them.
"""

import logging

from sqlalchemy import Boolean, Text, case, column, func, inspect, or_, select, table, update

from backend.app.custom.migrations import custom_migration, safe_execute
from backend.app.custom.psi import printer_notes
from backend.app.custom.psi.runs import run_class_expr
from backend.app.custom.psi.tables import PSI_COLUMNS, archives, library, runs

logger = logging.getLogger(__name__)


@custom_migration
async def psi_add_columns(conn) -> None:
    for table_name, columns in PSI_COLUMNS.items():
        for name, ddl in columns:
            await safe_execute(conn, f"ALTER TABLE {table_name} ADD COLUMN {name} {ddl}")


@custom_migration
async def psi_carry_over_legacy_data(conn) -> None:
    async with conn.begin_nested():
        for table_name in ("print_archives", "print_queue"):
            if await _has_columns(conn, table_name, "private_job", "private_material", "private_material_partial"):
                await conn.execute(_legacy_class_update(table_name))
        if await _has_columns(conn, "library_files", "private_job"):
            legacy = table("library_files", column("private_job", Boolean), column("psi_class"))
            await conn.execute(
                update(legacy)
                .where(legacy.c.psi_class.is_(None), legacy.c.private_job.is_(True))
                .values(psi_class="private")
            )
        if await _has_columns(conn, "print_queue", "comment"):
            legacy = table("print_queue", column("comment", Text), column("psi_notes", Text))
            await conn.execute(
                update(legacy)
                .where(legacy.c.psi_notes.is_(None), func.trim(legacy.c.comment) != "")
                .values(psi_notes=func.trim(legacy.c.comment))
            )
        await _carry_over_library_users(conn)
        await _freeze_existing_archive_users(conn)


@custom_migration
async def psi_classify_unclassified_runs(conn) -> None:
    """Give every run without a class the one it resolves to now.

    Covers the runs recorded before the PSI layer existed and any run the
    insert hook could not classify. New runs are classified by the hook.
    """
    async with conn.begin_nested():
        result = await conn.execute(
            update(runs)
            .where(runs.c.psi_class.is_(None))
            .values(psi_class=run_class_expr(runs.c.queue_item_id, runs.c.archive_id))
        )
        if result.rowcount:
            logger.info("PSI: classified %s print runs", result.rowcount)


def _legacy_class_update(table_name: str):
    legacy = table(
        table_name,
        column("private_job", Boolean),
        column("private_material", Boolean),
        column("private_material_partial", Boolean),
        column("psi_class"),
    )
    # Mirrors classification.from_legacy_flags: fully private wins over partial.
    return (
        update(legacy)
        .where(legacy.c.psi_class.is_(None), legacy.c.private_job.is_(True))
        .values(
            psi_class=case(
                (legacy.c.private_material.is_(True), "private_own"),
                (legacy.c.private_material_partial.is_(True), "private_partial"),
                else_="private",
            )
        )
    )


async def _carry_over_library_users(conn) -> None:
    """Move users an earlier build kept in ``file_metadata`` into the columns."""
    rows = (
        await conn.execute(
            select(library.c.id, library.c.file_metadata, library.c.file_path, library.c.file_size).where(
                library.c.slicer_user.is_(None),
                library.c.slicer_user_email.is_(None),
                library.c.psi_user_checked.is_(None),
                library.c.file_metadata.is_not(None),
            )
        )
    ).all()
    moved = 0
    for row in rows:
        meta = row.file_metadata if isinstance(row.file_metadata, dict) else {}
        user = _clean(meta.get("slicer_user"), 100)
        email = _clean(meta.get("slicer_user_email"), 255)
        if not (user or email):
            continue
        await conn.execute(
            update(library)
            .where(library.c.id == row.id)
            .values(
                slicer_user=user,
                slicer_user_email=email,
                # Keep what the earlier build stored — it may be a human repair —
                # instead of re-reading the file over it.
                psi_user_checked=printer_notes.fingerprint(row.file_path, row.file_size),
            )
        )
        moved += 1
    if moved:
        logger.info("PSI: carried over %s library file users from file_metadata", moved)


async def _freeze_existing_archive_users(conn) -> None:
    """Mark archive users an earlier build stored as already resolved.

    They may be human repairs, which a re-read of the file would overwrite. The
    fingerprint comes from the same function the resolver uses, so the two can
    never disagree about whether a row still needs reading.
    """
    rows = (
        await conn.execute(
            select(archives.c.id, archives.c.file_path, archives.c.file_size).where(
                archives.c.psi_user_checked.is_(None),
                or_(archives.c.slicer_user.is_not(None), archives.c.slicer_user_email.is_not(None)),
            )
        )
    ).all()
    for row in rows:
        await conn.execute(
            update(archives)
            .where(archives.c.id == row.id)
            .values(psi_user_checked=printer_notes.fingerprint(row.file_path, row.file_size))
        )


async def _has_columns(conn, table_name: str, *names: str) -> bool:
    def _columns(sync_conn) -> set[str]:
        return {c["name"] for c in inspect(sync_conn).get_columns(table_name)}

    present = await conn.run_sync(_columns)
    return all(name in present for name in names)


def _clean(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] or None
