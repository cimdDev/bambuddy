"""The shadow tables must keep matching upstream's models.

PSI reads a few upstream columns through its own Core ``Table`` objects. If
upstream renames or drops one, this fails at test time instead of in
production. It also fails if upstream ever adds a column with a PSI column's
name, which would make the two layers share a column by accident.
"""

import pytest

from backend.app.custom.psi.tables import PSI_COLUMNS, SHADOW_TABLES
from backend.app.models.archive import PrintArchive
from backend.app.models.library import LibraryFile
from backend.app.models.print_log import PrintLogEntry
from backend.app.models.print_queue import PrintQueueItem

UPSTREAM = {
    "print_archives": PrintArchive.__table__,
    "library_files": LibraryFile.__table__,
    "print_queue": PrintQueueItem.__table__,
    "print_log_entries": PrintLogEntry.__table__,
}


@pytest.mark.parametrize("name", sorted(SHADOW_TABLES))
def test_upstream_columns_psi_reads_still_exist(name):
    psi_owned = {column for column, _ in PSI_COLUMNS[name]}
    upstream_columns = set(UPSTREAM[name].c.keys())
    read = {c.name for c in SHADOW_TABLES[name].c} - psi_owned
    assert read <= upstream_columns, f"upstream dropped or renamed: {sorted(read - upstream_columns)}"


@pytest.mark.parametrize("name", sorted(PSI_COLUMNS))
def test_psi_columns_do_not_collide_with_upstream(name):
    collisions = {column for column, _ in PSI_COLUMNS[name]} & set(UPSTREAM[name].c.keys())
    assert not collisions, f"upstream now has PSI column(s) {sorted(collisions)} — see SOP 'Column collision'"
