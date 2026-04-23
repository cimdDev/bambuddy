from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


class TestPrinterFileImport:
    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_import_printer_file_to_library(self, async_client: AsyncClient, printer_factory):
        printer = await printer_factory()

        with (
            patch("backend.app.api.routes.printers.download_file_bytes_async", new=AsyncMock(return_value=b"3mf-bytes")),
            patch(
                "backend.app.api.routes.printers.save_file_bytes_to_library",
                new=AsyncMock(return_value=(SimpleNamespace(id=42, filename="benchy.gcode.3mf"), False)),
            ) as mock_save,
        ):
            response = await async_client.post(
                f"/api/v1/printers/{printer.id}/files/import",
                json={"paths": ["/sdcard/benchy.gcode.3mf"], "delete_source": False},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["failed"] == []
        assert payload["delete_failed"] == []
        assert payload["imported"] == [
            {
                "path": "/sdcard/benchy.gcode.3mf",
                "filename": "benchy.gcode.3mf",
                "library_file_id": 42,
            }
        ]
        assert mock_save.await_count == 1

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_move_keeps_import_when_delete_fails(self, async_client: AsyncClient, printer_factory):
        printer = await printer_factory()

        with (
            patch("backend.app.api.routes.printers.download_file_bytes_async", new=AsyncMock(return_value=b"gcode-bytes")),
            patch(
                "backend.app.api.routes.printers.save_file_bytes_to_library",
                new=AsyncMock(return_value=(SimpleNamespace(id=7, filename="print_job.gcode"), False)),
            ),
            patch("backend.app.api.routes.printers.delete_file_async", new=AsyncMock(return_value=False)),
        ):
            response = await async_client.post(
                f"/api/v1/printers/{printer.id}/files/import",
                json={"paths": ["/cache/print_job.gcode"], "delete_source": True},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["failed"] == []
        assert payload["imported"] == [
            {
                "path": "/cache/print_job.gcode",
                "filename": "print_job.gcode",
                "library_file_id": 7,
            }
        ]
        assert payload["delete_failed"] == [
            {
                "path": "/cache/print_job.gcode",
                "error": "Imported, but failed to delete source file from printer",
            }
        ]
