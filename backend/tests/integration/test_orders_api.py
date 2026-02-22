"""Integration tests for OrderBatch / orders API (MVP)."""

from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select


class TestOrdersAPI:
    @pytest.fixture
    async def library_file_factory(self, db_session):
        """Create library files with embedded plate metadata snapshots (no disk parse needed)."""
        _counter = [0]

        async def _create_library_file(**kwargs):
            from backend.app.models.library import LibraryFile

            _counter[0] += 1
            counter = _counter[0]
            defaults = {
                "filename": f"test_{counter}.gcode.3mf",
                "file_path": f"/tmp/test_{counter}.gcode.3mf",
                "file_type": "3mf",
                "file_size": 1234,
                "file_hash": f"hash-{counter:04d}",
                "file_metadata": {
                    "print_name": f"Test Print {counter}",
                    "sliced_for_model": "H2D Pro",
                    "plates": [
                        {
                            "plate_index": 1,
                            "name": "Plate 1",
                            "objects": ["Part A"],
                            "object_count": 1,
                            "estimated_duration_sec": 1200,
                            "estimated_filament_grams": 10.5,
                            "filament_map": [
                                {"slot_id": 1, "material_type": "PLA", "color_hex": "#FF0000", "used_g": 3.0},
                                {"slot_id": 2, "material_type": "PLA", "color_hex": "#0000FF", "used_g": 7.5},
                            ],
                            "gcode_ref": {"path": "Metadata/plate_1.gcode", "md5": "ABC123"},
                            "plate_fingerprint": "fp-plate-1",
                        }
                    ],
                },
            }
            defaults.update(kwargs)
            # Create a dummy source file so dispatch validation can confirm the file exists.
            Path(defaults["file_path"]).write_bytes(b"dummy 3mf placeholder")
            row = LibraryFile(**defaults)
            db_session.add(row)
            await db_session.commit()
            await db_session.refresh(row)
            return row

        return _create_library_file

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_dispatch_remaining_creates_correct_count(
        self, async_client: AsyncClient, library_file_factory, db_session
    ):
        """remaining_to_dispatch uses target - dispatched_non_cancelled and supports partial dispatch."""
        from backend.app.models.print_queue import PrintQueueItem

        lib = await library_file_factory()

        create_resp = await async_client.post(
            "/api/v1/orders/",
            json={"library_file_id": lib.id, "name": "Order A", "priority": 100},
        )
        assert create_resp.status_code == 201, create_resp.text
        order = create_resp.json()
        order_id = order["id"]
        assert len(order["plates"]) == 1

        cfg_resp = await async_client.post(
            f"/api/v1/orders/{order_id}/configs",
            json={"plate_index": 1, "quantity_target": 3, "seed_slots_from_plate": True},
        )
        assert cfg_resp.status_code == 201, cfg_resp.text
        cfg = cfg_resp.json()
        assert cfg["quantity_target"] == 3
        assert len(cfg["slots"]) == 2

        dispatch_resp = await async_client.post(f"/api/v1/orders/configs/{cfg['id']}/dispatch", json={"limit": 2})
        assert dispatch_resp.status_code == 200, dispatch_resp.text
        dispatch = dispatch_resp.json()
        assert dispatch["created_count"] == 2
        assert len(dispatch["created_queue_item_ids"]) == 2
        assert dispatch["remaining_to_dispatch"] == 1

        queue_items = (
            (
                await db_session.execute(
                    select(PrintQueueItem)
                    .where(PrintQueueItem.id.in_(dispatch["created_queue_item_ids"]))
                    .order_by(PrintQueueItem.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(queue_items) == 2
        # Default seeded config matches source colors, so there should be no queue-level overrides.
        assert all(item.override_material_map is None for item in queue_items)

        detail_resp = await async_client.get(f"/api/v1/orders/{order_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        plate = detail["plates"][0]
        cfg_detail = plate["configs"][0]
        assert cfg_detail["progress"]["queued_runs"] == 2
        assert cfg_detail["progress"]["remaining_to_dispatch"] == 1

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_quantity_reduction_cancels_only_pending(
        self, async_client: AsyncClient, library_file_factory, db_session
    ):
        """Reducing quantity cancels excess queued items but preserves started/completed history."""
        from backend.app.models.print_queue import PrintQueueItem

        lib = await library_file_factory(filename="reduce_test.gcode.3mf", file_hash="hash-reduce")

        create_resp = await async_client.post(
            "/api/v1/orders/",
            json={"library_file_id": lib.id, "name": "Order Reduce", "priority": 100},
        )
        order_id = create_resp.json()["id"]

        cfg_resp = await async_client.post(
            f"/api/v1/orders/{order_id}/configs",
            json={"plate_index": 1, "quantity_target": 3, "seed_slots_from_plate": True},
        )
        cfg = cfg_resp.json()
        cfg_id = cfg["id"]

        dispatch_resp = await async_client.post(f"/api/v1/orders/configs/{cfg_id}/dispatch", json={"limit": None})
        assert dispatch_resp.status_code == 200
        created_ids = dispatch_resp.json()["created_queue_item_ids"]
        assert len(created_ids) == 3

        # Simulate one started and one completed queue item; third remains pending.
        items = (
            (
                await db_session.execute(
                    select(PrintQueueItem).where(PrintQueueItem.id.in_(created_ids)).order_by(PrintQueueItem.id)
                )
            )
            .scalars()
            .all()
        )
        items[0].status = "printing"
        items[1].status = "completed"
        await db_session.commit()

        update_resp = await async_client.put(f"/api/v1/orders/configs/{cfg_id}", json={"quantity_target": 1})
        assert update_resp.status_code == 200, update_resp.text

        items_after = (
            (
                await db_session.execute(
                    select(PrintQueueItem).where(PrintQueueItem.id.in_(created_ids)).order_by(PrintQueueItem.id)
                )
            )
            .scalars()
            .all()
        )
        statuses = [i.status for i in items_after]
        assert statuses[0] == "printing"
        assert statuses[1] == "completed"
        assert statuses[2] == "cancelled"

        detail_resp = await async_client.get(f"/api/v1/orders/{order_id}")
        detail = detail_resp.json()
        cfg_detail = detail["plates"][0]["configs"][0]
        assert cfg_detail["quantity_target"] == 1
        assert cfg_detail["progress"]["cancelled_runs"] >= 1

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_dispatch_persists_queue_override_material_map(
        self, async_client: AsyncClient, library_file_factory, db_session
    ):
        from backend.app.models.print_queue import PrintQueueItem

        lib = await library_file_factory(filename="override_test.gcode.3mf", file_hash="hash-override")

        create_resp = await async_client.post(
            "/api/v1/orders/",
            json={"library_file_id": lib.id, "name": "Order Override"},
        )
        assert create_resp.status_code == 201, create_resp.text
        order_id = create_resp.json()["id"]

        cfg_resp = await async_client.post(
            f"/api/v1/orders/{order_id}/configs",
            json={"plate_index": 1, "quantity_target": 1, "seed_slots_from_plate": True},
        )
        assert cfg_resp.status_code == 201, cfg_resp.text
        cfg = cfg_resp.json()

        slots_payload = []
        for slot in cfg["slots"]:
            slots_payload.append(
                {
                    "slot_index": slot["slot_index"],
                    "material_type": slot["material_type"],
                    "color_hex": "#00FF00" if slot["slot_index"] == 1 else slot["color_hex"],
                    "color_family": slot["color_family"],
                    "brand_name": slot.get("brand_name"),
                    "filament_name": slot.get("filament_name"),
                    "nozzle_assignment": slot.get("nozzle_assignment"),
                    "metadata_json": slot.get("metadata_json"),
                }
            )

        slots_resp = await async_client.put(f"/api/v1/orders/configs/{cfg['id']}/slots", json={"slots": slots_payload})
        assert slots_resp.status_code == 200, slots_resp.text

        dispatch_resp = await async_client.post(f"/api/v1/orders/configs/{cfg['id']}/dispatch", json={"limit": 1})
        assert dispatch_resp.status_code == 200, dispatch_resp.text
        queue_id = dispatch_resp.json()["created_queue_item_ids"][0]

        item = (await db_session.execute(select(PrintQueueItem).where(PrintQueueItem.id == queue_id))).scalar_one()
        assert item.override_material_map is not None
        assert '"1"' in item.override_material_map
