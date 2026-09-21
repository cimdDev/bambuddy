"""Fixtures for the PSI custom layer's tests.

Upstream's ``test_engine`` builds tables from upstream's models only, exactly as
production does before the custom migrations run. ``psi_schema`` then applies
the PSI migrations to that database and switches the run hook on, so every PSI
test exercises the real migration path rather than a hand-made schema.
"""

import json
import zipfile
from pathlib import Path

import pytest


@pytest.fixture
async def psi_schema(test_engine):
    from backend.app.custom.migrations import run_custom_migrations
    from backend.app.custom.psi import (
        migrations,  # noqa: F401 — registers the PSI migrations
        runs,
    )

    assert await run_custom_migrations(engine=test_engine)
    runs.mark_schema_ready(True)
    yield test_engine
    runs.mark_schema_ready(False)


@pytest.fixture
def psi_files(tmp_path, monkeypatch):
    """Point upstream's base_dir at a temp dir and write 3MFs into it."""
    from backend.app.core.config import settings

    monkeypatch.setattr(settings, "base_dir", tmp_path)

    def _write(relative: str, printer_notes: object = None, *, settings_json: dict | None = None) -> str:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        data = settings_json if settings_json is not None else {"printer_notes": printer_notes}
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("Metadata/project_settings.config", json.dumps(data))
        return relative

    return _write


def write_3mf(path: Path, printer_notes: object) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Metadata/project_settings.config", json.dumps({"printer_notes": printer_notes}))
    return path
