"""Classify every print run the moment upstream records it.

Upstream's statistics count runs (``print_log_entries``), not archives: a
reprint reuses its archive row and adds a run (#1378). Classifying archives
alone would therefore mis-account a reprint made on different terms, and would
reclassify every earlier run of an archive whenever its flag changed. So each
run gets its own ``psi_class``, frozen when the run is written, and the PSI
accounting sums runs exactly the way upstream's totals do.

The hook is an ORM ``after_insert`` listener on ``PrintLogEntry`` rather than a
call inside upstream's completion code: every current and future code path that
records a run goes through that insert, and upstream's code stays untouched.

At that moment it also hands the job over to its archive (queue runs only):

* the archive takes the run's class, so an archive always shows how its latest
  run was classified;
* the queue item's note is copied onto the archive if the archive has none
  (copy-on-create; an archive's own note is never overwritten).
"""

import logging

from sqlalchemy import Integer, event, func, literal, or_, select, update

from backend.app.custom.psi.classification import DEFAULT
from backend.app.custom.psi.tables import archives, library, queue, runs
from backend.app.models.print_log import PrintLogEntry

logger = logging.getLogger(__name__)

_state = {"ready": False}


def mark_schema_ready(ready: bool = True) -> None:
    """Enable the hook once the PSI columns are known to exist.

    Until then the hook is a no-op. That covers a failed custom migration and,
    more commonly, upstream's own test suite, whose databases never get the PSI
    columns: without this guard every upstream test that records a run would
    trip over them.
    """
    _state["ready"] = ready


def schema_ready() -> bool:
    return _state["ready"]


def run_class_expr(queue_id, archive_id):
    """SQL for the class a run counts as. The one implementation of that rule.

    First set value of: the queue item's own class, its library file's, its
    archive's, then (for runs without a queue item) the run's archive and that
    archive's library file, and finally ``psi``. ``queue_id``/``archive_id`` may
    be columns of an outer statement (backfill) or literals (the hook).
    """
    q = queue.alias("psi_q")
    q_lib = library.alias("psi_q_lib")
    q_arc = archives.alias("psi_q_arc")
    q_arc_lib = library.alias("psi_q_arc_lib")
    arc = archives.alias("psi_arc")
    arc_lib = library.alias("psi_arc_lib")
    return func.coalesce(
        select(q.c.psi_class).where(q.c.id == queue_id).scalar_subquery(),
        select(q_lib.c.psi_class)
        .select_from(q.join(q_lib, q_lib.c.id == q.c.library_file_id))
        .where(q.c.id == queue_id)
        .scalar_subquery(),
        select(q_arc.c.psi_class)
        .select_from(q.join(q_arc, q_arc.c.id == q.c.archive_id))
        .where(q.c.id == queue_id)
        .scalar_subquery(),
        select(q_arc_lib.c.psi_class)
        .select_from(
            q.join(q_arc, q_arc.c.id == q.c.archive_id).join(q_arc_lib, q_arc_lib.c.id == q_arc.c.library_file_id)
        )
        .where(q.c.id == queue_id)
        .scalar_subquery(),
        select(arc.c.psi_class).where(arc.c.id == archive_id).scalar_subquery(),
        select(arc_lib.c.psi_class)
        .select_from(arc.join(arc_lib, arc_lib.c.id == arc.c.library_file_id))
        .where(arc.c.id == archive_id)
        .scalar_subquery(),
        literal(DEFAULT),
    )


def classify_run_statements(run_id: int, queue_id: int | None, archive_id: int | None) -> list:
    """The statements that classify one new run and hand its job to the archive."""
    q_id = literal(queue_id, Integer)
    a_id = literal(archive_id, Integer)
    statements = [update(runs).where(runs.c.id == run_id).values(psi_class=run_class_expr(q_id, a_id))]
    if queue_id is not None and archive_id is not None:
        run_class = select(runs.c.psi_class).where(runs.c.id == run_id).scalar_subquery()
        statements.append(update(archives).where(archives.c.id == archive_id).values(psi_class=run_class))
        queue_note = select(queue.c.psi_notes).where(queue.c.id == queue_id).scalar_subquery()
        statements.append(
            update(archives)
            .where(
                archives.c.id == archive_id,
                or_(archives.c.notes.is_(None), func.trim(archives.c.notes) == ""),
                queue_note.is_not(None),
            )
            .values(notes=queue_note)
        )
    return statements


@event.listens_for(PrintLogEntry, "after_insert")
def _classify_new_run(mapper, connection, target) -> None:  # noqa: ARG001 — SQLAlchemy signature
    if not _state["ready"]:
        return
    try:
        # A savepoint, so a failure here can never poison upstream's
        # transaction — on PostgreSQL an error would otherwise abort it and take
        # the print-completion handling down with it.
        with connection.begin_nested():
            for statement in classify_run_statements(target.id, target.queue_item_id, target.archive_id):
                connection.execute(statement)
    except Exception:
        logger.exception("PSI: could not classify print run %s", target.id)
