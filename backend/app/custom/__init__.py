"""The PSI custom layer on top of upstream Bambuddy.

Everything the PSI fork adds to the backend lives under this package. Upstream
code reaches it through exactly two call sites in ``backend/app/main.py``, both
marked ``PSI-SEAM``:

* :func:`install` at module level, right after upstream's routers are included
  and before the SPA catch-all, registers the custom API routes and ORM hooks.
* :func:`startup` in the lifespan, right after ``init_db()``, applies the custom
  schema and starts background work.

Nothing else in upstream's backend is edited. See
``docs/custom-features/SOP.md`` for why, and for the list of seams.
"""

from fastapi import FastAPI


def install(app: FastAPI) -> None:
    """Register custom routes and ORM hooks. Called once at import of main."""
    from backend.app.custom import psi

    psi.install(app)


async def startup() -> None:
    """Apply custom migrations, then start custom background work. Never raises."""
    import logging

    from backend.app.custom import psi
    from backend.app.custom.migrations import run_custom_migrations
    from backend.app.custom.psi import migrations as _psi_migrations  # noqa: F401 — registers them

    try:
        ok = await run_custom_migrations()
        await psi.startup(schema_ok=ok)
    except Exception:  # the custom layer must never keep upstream from booting
        logging.getLogger(__name__).exception("PSI custom startup failed")
