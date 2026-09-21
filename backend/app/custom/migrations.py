"""Schema migrations owned by the PSI custom layer.

Upstream's :func:`backend.app.core.database.run_migrations` is one very long
linear function that upstream rewrites freely. Editing it is how an earlier
rebuild lost a thousand lines of upstream's schema work to a bad merge, so the
custom layer keeps its DDL here instead and never touches ``database.py``.

These statements run in their own transaction, *after* ``init_db()`` has
created tables and applied upstream's migrations. Upstream never knows about
the custom columns, so nothing upstream needs them during its own pass.

Every migration must be idempotent: this runs on every startup, against fresh
databases and against upgraded ones alike. Register with ``@custom_migration``;
registration order is execution order.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

logger = logging.getLogger(__name__)

# PostgreSQL SQLSTATEs meaning "this DDL was already applied".
_PG_DUPLICATE_COLUMN = "42701"
_PG_DUPLICATE_TABLE = "42P07"
_PG_DUPLICATE_OBJECT = "42710"
_PG_ALREADY_APPLIED = {_PG_DUPLICATE_COLUMN, _PG_DUPLICATE_TABLE, _PG_DUPLICATE_OBJECT}


def _is_already_applied(exc: Exception) -> bool:
    """Return True if a failed DDL statement had simply already been applied.

    Mirrors the dialect handling in ``database._safe_execute`` — SQLSTATE on
    PostgreSQL, message text on SQLite, which never localises its errors — but
    is kept self-contained so a rename of that private helper upstream cannot
    break the custom stack.
    """
    orig = getattr(exc, "orig", None)
    for attr in ("sqlstate", "pgcode"):
        code = getattr(orig, attr, None)
        if code:
            return str(code) in _PG_ALREADY_APPLIED

    msg = str(exc).lower()
    return any(k in msg for k in ("already exists", "duplicate column name", "duplicate key"))


async def safe_execute(conn, sql: str) -> None:
    """Run one DDL statement, swallowing only "already applied" failures.

    Uses a savepoint so a swallowed failure cannot poison the surrounding
    transaction, which PostgreSQL requires. Anything else is logged and
    re-raised: a custom migration that fails for a real reason must be loud, not
    silently skipped.

    DDL only. Data backfills belong in an explicit ``conn.begin_nested()`` block
    so their failures are never swallowed.
    """
    try:
        async with conn.begin_nested():
            await conn.execute(text(sql))
    except (OperationalError, ProgrammingError) as exc:
        if not _is_already_applied(exc):
            logger.error("Custom migration failed: %s | SQL: %.200s", exc, sql)
            raise


_MIGRATIONS: list[Callable[[Any], Awaitable[None]]] = []


def custom_migration(fn: Callable[[Any], Awaitable[None]]) -> Callable[[Any], Awaitable[None]]:
    """Register a coroutine to run at startup, in decoration order.

    A decorator rather than a shared list literal, so each custom module owns
    its migrations next to the code that needs them.
    """
    _MIGRATIONS.append(fn)
    return fn


async def run_custom_migrations(engine=None) -> bool:
    """Apply every registered custom-stack migration.

    Called once at startup, after ``init_db()`` has created tables and run
    upstream's migrations.

    Never raises and returns whether every migration succeeded. The custom
    layer degrades to "the PSI fields are absent" rather than to a broken app,
    so a failing migration is worth a loud log line but not worth refusing to
    boot over. One failing migration does not stop the others.
    """
    if engine is None:
        from backend.app.core.database import engine

    ok = True
    try:
        async with engine.begin() as conn:
            for migrate in _MIGRATIONS:
                try:
                    await migrate(conn)
                except Exception as exc:
                    ok = False
                    logger.error("Custom migration %s failed: %s", getattr(migrate, "__name__", migrate), exc)
    except Exception as exc:
        logger.error("Custom migrations skipped — could not open a connection: %s", exc)
        return False
    return ok
