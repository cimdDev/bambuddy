"""PSI job tracking: who sliced a print, PSI or private, whose material, a note.

See ``docs/custom-features/psi-spec.md`` for the behaviour and
``docs/custom-features/SOP.md`` for how this layer is kept on top of upstream.

Modules:

* :mod:`.tables`          shadow tables: the PSI columns, reached via Core
* :mod:`.classification`  the four-state PSI/private/material class
* :mod:`.printer_notes`   the ``User=`` convention read from stored files
* :mod:`.runs`            per-run classification hook and its SQL rule
* :mod:`.service`         card data, edits and how they spread
* :mod:`.accounting`      stats and per-user settlement over print runs
* :mod:`.migrations`      PSI columns and carry-over of earlier builds' data
* :mod:`.routes`          the ``/api/v1/psi`` API
"""

import asyncio
import logging

from fastapi import FastAPI

logger = logging.getLogger(__name__)

_background: set[asyncio.Task] = set()


def install(app: FastAPI) -> None:
    from backend.app.core.config import settings
    from backend.app.custom.psi import migrations, runs  # noqa: F401 — registers migrations and the run hook
    from backend.app.custom.psi.routes import router

    app.include_router(router, prefix=settings.api_prefix)


async def startup(*, schema_ok: bool) -> None:
    from backend.app.custom.psi import runs

    if not schema_ok:
        logger.error("PSI: custom migrations failed; run classification stays off until the next start")
        return
    runs.mark_schema_ready(True)
    task = asyncio.create_task(_backfill_users(), name="psi-user-backfill")
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _backfill_users(batch: int = 50, pause: float = 0.2) -> None:
    """Read the user from every file not read yet, a little at a time.

    Catches up on files ingested while no PSI build was deployed, so the
    accounting can attribute them without waiting for someone to open a card.
    """
    from backend.app.core.database import async_session
    from backend.app.custom.psi.service import ensure_users

    total = 0
    try:
        while True:
            async with async_session() as db:
                done = await ensure_users(db, archive_ids=None, library_ids=None, limit=batch)
                await db.commit()
            total += done
            if done < batch:
                break
            await asyncio.sleep(pause)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("PSI: user backfill stopped after %s files", total)
        return
    if total:
        logger.info("PSI: read the user from %s files", total)
