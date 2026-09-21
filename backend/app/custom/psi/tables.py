"""Shadow tables: how the PSI layer reads and writes its columns.

Upstream's ORM models are never edited. The columns PSI adds to upstream tables
are declared here instead, on a *separate* ``MetaData``, next to the handful of
upstream columns PSI needs to read. All PSI access goes through SQLAlchemy Core
against these ``Table`` objects.

That keeps the two worlds apart in both directions:

* Upstream code never sees a PSI column, so an upstream refactor of a model, a
  schema or a route cannot conflict with PSI, and upstream's tests run against
  tables that do not have the PSI columns at all.
* PSI code never depends on an upstream model attribute that could be renamed
  silently. Every upstream column named here is checked against upstream's own
  model by ``backend/tests/psi/test_shadow_tables.py``, so a rename upstream
  fails a PSI test instead of failing in production.

``psi_metadata`` is never used for ``create_all``. The PSI columns are added by
:mod:`backend.app.custom.psi.migrations` from :data:`PSI_COLUMNS`, the single
list of DDL this layer owns.
"""

from sqlalchemy import JSON, Column, DateTime, Float, Integer, MetaData, String, Table, Text

psi_metadata = MetaData()

#: Every column the PSI layer adds, per upstream table, with its DDL type.
#: New PSI columns are prefixed ``psi_``; ``slicer_user``/``slicer_user_email``
#: keep their historical names because production data already lives in them.
PSI_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "print_archives": [
        ("slicer_user", "VARCHAR(100)"),
        ("slicer_user_email", "VARCHAR(255)"),
        ("psi_user_checked", "VARCHAR(600)"),
        ("psi_class", "VARCHAR(20)"),
    ],
    "library_files": [
        ("slicer_user", "VARCHAR(100)"),
        ("slicer_user_email", "VARCHAR(255)"),
        ("psi_user_checked", "VARCHAR(600)"),
        ("psi_class", "VARCHAR(20)"),
    ],
    "print_queue": [
        ("psi_class", "VARCHAR(20)"),
        ("psi_notes", "TEXT"),
    ],
    "print_log_entries": [
        ("psi_class", "VARCHAR(20)"),
    ],
}


def _psi_columns(table: str) -> list[Column]:
    types = {"VARCHAR(100)": String(100), "VARCHAR(255)": String(255), "VARCHAR(600)": String(600)}
    types |= {"VARCHAR(20)": String(20), "TEXT": Text()}
    return [Column(name, types[ddl]) for name, ddl in PSI_COLUMNS[table]]


# Upstream columns first (read-only for PSI unless noted), PSI columns last.

archives = Table(
    "print_archives",
    psi_metadata,
    Column("id", Integer, primary_key=True),
    Column("printer_id", Integer),
    Column("library_file_id", Integer),
    Column("created_by_id", Integer),
    Column("file_path", String(500)),
    Column("file_size", Integer),
    Column("filename", String(255)),
    Column("print_name", String(255)),
    Column("status", String(20)),
    Column("deleted_at", DateTime),
    Column("notes", Text),  # upstream column; PSI writes it for print notes
    *_psi_columns("print_archives"),
)

library = Table(
    "library_files",
    psi_metadata,
    Column("id", Integer, primary_key=True),
    Column("created_by_id", Integer),
    Column("file_path", String(500)),
    Column("file_size", Integer),
    Column("filename", String(255)),
    Column("file_type", String(10)),
    Column("file_metadata", JSON),
    Column("deleted_at", DateTime),
    Column("notes", Text),  # upstream column; PSI writes it for print notes
    *_psi_columns("library_files"),
)

queue = Table(
    "print_queue",
    psi_metadata,
    Column("id", Integer, primary_key=True),
    Column("status", String(20)),
    Column("printer_id", Integer),
    Column("archive_id", Integer),
    Column("library_file_id", Integer),
    Column("created_by_id", Integer),
    *_psi_columns("print_queue"),
)

runs = Table(
    "print_log_entries",
    psi_metadata,
    Column("id", Integer, primary_key=True),
    Column("archive_id", Integer),
    Column("queue_item_id", Integer),
    Column("printer_id", Integer),
    Column("printer_name", String(255)),
    Column("print_name", String(255)),
    Column("status", String(20)),
    Column("created_at", DateTime),
    Column("started_at", DateTime),
    Column("completed_at", DateTime),
    Column("duration_seconds", Integer),
    Column("filament_used_grams", Float),
    Column("cost", Float),
    Column("created_by_id", Integer),
    *_psi_columns("print_log_entries"),
)

#: Shadow table per upstream table name, for the migration and the drift test.
SHADOW_TABLES = {t.name: t for t in (archives, library, queue, runs)}
