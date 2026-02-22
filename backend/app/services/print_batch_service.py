"""Order/Batch planning service (MVP).

This service creates planning-only batch orders from a LibraryFile 3MF artifact,
stores per-plate snapshots, lets the user define plate-level configurations with
slot mappings, and dispatches remaining demand into the existing print queue.
"""

import hashlib
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import defusedxml.ElementTree as ET
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.config import settings
from backend.app.models.library import LibraryFile
from backend.app.models.print_batch import PrintBatch, PrintBatchPlate, PrintBatchPlateConfig, PrintBatchPlateConfigSlot
from backend.app.models.print_queue import PrintQueueItem
from backend.app.models.user import User
from backend.app.schemas.print_batch import (
    PrintBatchConfigProgress,
    PrintBatchDispatchResponse,
    PrintBatchOrderCreate,
    PrintBatchOrderDetailResponse,
    PrintBatchOrderListItem,
    PrintBatchOrderUpdate,
    PrintBatchPlateConfigCreate,
    PrintBatchPlateConfigResponse,
    PrintBatchPlateConfigSlotInput,
    PrintBatchPlateConfigSlotResponse,
    PrintBatchPlateConfigUpdate,
    PrintBatchPlateResponse,
)
from backend.app.utils.printer_models import normalize_printer_model, normalize_printer_model_id
from backend.app.utils.threemf_tools import extract_nozzle_mapping_from_3mf


class BatchServiceError(ValueError):
    """Validation error for batch/order operations."""


def _json_dumps(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _canonical_hash(data: Any) -> str:
    return hashlib.sha256(_json_dumps(data).encode("utf-8")).hexdigest()


def _normalize_material_type(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    upper = raw.upper()
    if upper.startswith("PLA"):
        return "PLA"
    if upper.startswith("PETG"):
        return "PETG"
    if upper.startswith("ABS"):
        return "ABS"
    if upper.startswith("ASA"):
        return "ASA"
    if upper.startswith("TPU"):
        return "TPU"
    if upper.startswith("PA"):
        return "PA"
    return raw


def _hex_to_rgb(color_hex: str | None) -> tuple[int, int, int] | None:
    if not color_hex:
        return None
    s = color_hex.strip()
    if not re.fullmatch(r"#?[0-9A-Fa-f]{6}", s):
        return None
    s = s.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def _normalize_color_hex(value: str | None) -> str | None:
    rgb = _hex_to_rgb(value)
    if not rgb:
        return None
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def _color_family_from_hex(color_hex: str | None) -> str | None:
    rgb = _hex_to_rgb(color_hex)
    if not rgb:
        return None
    r, g, b = rgb

    if max(r, g, b) < 32:
        return "black"
    if min(r, g, b) > 224:
        return "white"
    if abs(r - g) < 18 and abs(g - b) < 18:
        return "gray"

    # HSV-like cheap bucketing
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    delta = max_c - min_c
    if delta == 0:
        return "gray"

    if max_c == r:
        hue = (60 * ((g - b) / delta)) % 360
    elif max_c == g:
        hue = 60 * ((b - r) / delta + 2)
    else:
        hue = 60 * ((r - g) / delta + 4)

    if 15 <= hue < 45:
        return "orange"
    if 45 <= hue < 75:
        return "yellow"
    if 75 <= hue < 165:
        return "green"
    if 165 <= hue < 200:
        return "cyan"
    if 200 <= hue < 255:
        return "blue"
    if 255 <= hue < 315:
        return "purple"
    if 315 <= hue < 345:
        return "magenta"
    return "red"


def _next_config_code(existing_codes: set[str]) -> str:
    index = 0
    while True:
        n = index
        chars: list[str] = []
        while True:
            chars.append(chr(ord("A") + (n % 26)))
            n = n // 26 - 1
            if n < 0:
                break
        code = "".join(reversed(chars))
        if code not in existing_codes:
            return code
        index += 1


def _make_plate_fingerprint(plate_snapshot: dict) -> str:
    payload = {
        "plate_index": plate_snapshot.get("plate_index"),
        "objects": plate_snapshot.get("objects", []),
        "filament_map": [
            {
                "slot_id": f.get("slot_id"),
                "material_type": _normalize_material_type(f.get("material_type") or f.get("type")),
                "color_hex": _normalize_color_hex(f.get("color_hex") or f.get("color")),
                "nozzle_assignment": f.get("nozzle_assignment") or f.get("nozzle_id"),
            }
            for f in plate_snapshot.get("filament_map", [])
        ],
        "estimates": {
            "estimated_duration_sec": plate_snapshot.get("estimated_duration_sec"),
            "estimated_filament_grams": plate_snapshot.get("estimated_filament_grams"),
        },
        "gcode_ref": plate_snapshot.get("gcode_ref"),
        "slicer": plate_snapshot.get("slicer"),
        "nozzle": plate_snapshot.get("nozzle"),
    }
    return _canonical_hash(payload)


def _library_file_disk_path(lib_file: LibraryFile) -> Path:
    p = Path(lib_file.file_path)
    return p if p.is_absolute() else settings.base_dir / lib_file.file_path


def _extract_plates_from_3mf(file_path: Path) -> list[dict]:
    """Extract plate snapshots from a Bambu-style 3MF archive.

    Reuses the same source files as the existing library/archive "plates" endpoints,
    but produces a richer snapshot shape for batch planning.
    """
    plates: list[dict] = []
    if not file_path.exists():
        return plates

    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            namelist = zf.namelist()

            # Determine plate indices (prefer per-plate gcode presence)
            plate_indices: list[int] = []
            for name in namelist:
                m = re.match(r"^Metadata/plate_(\d+)\.gcode$", name)
                if not m:
                    continue
                try:
                    plate_indices.append(int(m.group(1)))
                except ValueError:
                    continue

            if not plate_indices:
                for name in namelist:
                    m = re.match(r"^Metadata/plate_(\d+)\.(json|png)$", name)
                    if not m:
                        continue
                    try:
                        plate_indices.append(int(m.group(1)))
                    except ValueError:
                        continue

            plate_indices = sorted(set(plate_indices))
            if not plate_indices:
                return plates

            # Parse model_settings.config for names and plate->object ids and gcode refs
            plate_names: dict[int, str] = {}
            plate_object_ids: dict[int, list[str]] = {}
            object_names_by_id: dict[str, str] = {}
            plate_gcode_refs: dict[int, dict[str, Any]] = {}

            if "Metadata/model_settings.config" in namelist:
                try:
                    root = ET.fromstring(zf.read("Metadata/model_settings.config").decode())
                    for obj_elem in root.findall(".//object"):
                        obj_id = obj_elem.get("id")
                        if not obj_id:
                            continue
                        name_meta = obj_elem.find("metadata[@key='name']")
                        if name_meta is not None and name_meta.get("value"):
                            object_names_by_id[obj_id] = name_meta.get("value") or ""

                    for plate_elem in root.findall(".//plate"):
                        plater_id: int | None = None
                        plater_name: str | None = None
                        gcode_path: str | None = None
                        for meta in plate_elem.findall("metadata"):
                            key = meta.get("key")
                            value = meta.get("value")
                            if key == "plater_id" and value:
                                try:
                                    plater_id = int(value)
                                except ValueError:
                                    pass
                            elif key == "plater_name" and value:
                                plater_name = value.strip()
                            elif key in {"gcode_file", "gcode"} and value:
                                gcode_path = value

                        # plate_N.gcode md5 files are predictable even without rel parsing
                        if plater_id is not None and gcode_path:
                            plate_gcode_refs[plater_id] = {"path": gcode_path}

                        if plater_id is not None and plater_name:
                            plate_names[plater_id] = plater_name

                        if plater_id is not None:
                            for instance_elem in plate_elem.findall("model_instance"):
                                for inst_meta in instance_elem.findall("metadata"):
                                    if inst_meta.get("key") != "object_id":
                                        continue
                                    obj_id = inst_meta.get("value")
                                    if not obj_id:
                                        continue
                                    plate_object_ids.setdefault(plater_id, [])
                                    if obj_id not in plate_object_ids[plater_id]:
                                        plate_object_ids[plater_id].append(obj_id)
                except Exception:
                    pass

            # Parse slice_info.config for per-plate estimates, objects, and filament usage
            plate_meta: dict[int, dict[str, Any]] = {}
            if "Metadata/slice_info.config" in namelist:
                try:
                    root = ET.fromstring(zf.read("Metadata/slice_info.config").decode())
                    nozzle_mapping = extract_nozzle_mapping_from_3mf(zf) or {}

                    for plate_elem in root.findall(".//plate"):
                        idx: int | None = None
                        info: dict[str, Any] = {
                            "estimated_duration_sec": None,
                            "estimated_filament_grams": None,
                            "objects": [],
                            "filament_map": [],
                        }
                        for meta in plate_elem.findall("metadata"):
                            key = meta.get("key")
                            value = meta.get("value")
                            if key == "index" and value:
                                try:
                                    idx = int(value)
                                except ValueError:
                                    pass
                            elif key == "prediction" and value:
                                try:
                                    info["estimated_duration_sec"] = int(value)
                                except ValueError:
                                    pass
                            elif key == "weight" and value:
                                try:
                                    info["estimated_filament_grams"] = float(value)
                                except ValueError:
                                    pass

                        for obj_elem in plate_elem.findall("object"):
                            name = obj_elem.get("name")
                            if name and name not in info["objects"]:
                                info["objects"].append(name)

                        for filament_elem in plate_elem.findall("filament"):
                            filament_id = filament_elem.get("id")
                            if not filament_id:
                                continue
                            try:
                                slot_id = int(filament_id)
                            except ValueError:
                                continue
                            try:
                                used_g = float(filament_elem.get("used_g", "0") or 0)
                            except (TypeError, ValueError):
                                used_g = 0.0
                            entry = {
                                "slot_id": slot_id,
                                "material_type": _normalize_material_type(filament_elem.get("type")),
                                "color_hex": _normalize_color_hex(filament_elem.get("color")),
                                "used_g": round(used_g, 2),
                                "used_m": filament_elem.get("used_m"),
                                "group_id": filament_elem.get("group_id"),
                                "nozzle_assignment": nozzle_mapping.get(slot_id),
                            }
                            if used_g > 0:
                                info["filament_map"].append(entry)

                        info["filament_map"].sort(key=lambda x: x["slot_id"])
                        if idx is not None:
                            plate_meta[idx] = info
                except Exception:
                    pass

            # Parse plate JSON as object fallback
            plate_json_objects: dict[int, list[str]] = {}
            for name in namelist:
                m = re.match(r"^Metadata/plate_(\d+)\.json$", name)
                if not m:
                    continue
                try:
                    idx = int(m.group(1))
                except ValueError:
                    continue
                try:
                    payload = json.loads(zf.read(name).decode())
                    names: list[str] = []
                    for obj in payload.get("bbox_objects", []):
                        if not isinstance(obj, dict):
                            continue
                        obj_name = obj.get("name")
                        if obj_name and obj_name not in names:
                            names.append(obj_name)
                    if names:
                        plate_json_objects[idx] = names
                except Exception:
                    continue

            # md5 refs
            plate_md5: dict[int, str] = {}
            for name in namelist:
                m = re.match(r"^Metadata/plate_(\d+)\.gcode\.md5$", name)
                if not m:
                    continue
                try:
                    idx = int(m.group(1))
                except ValueError:
                    continue
                try:
                    plate_md5[idx] = zf.read(name).decode().strip()
                except Exception:
                    continue

            # Build final plate snapshots
            for idx in plate_indices:
                meta = plate_meta.get(idx, {})
                objects = list(meta.get("objects") or [])
                if not objects and idx in plate_json_objects:
                    objects = plate_json_objects[idx]
                if not objects and idx in plate_object_ids:
                    objects = [object_names_by_id.get(obj_id, f"Object {obj_id}") for obj_id in plate_object_ids[idx]]

                gcode_ref = plate_gcode_refs.get(idx, {}).copy()
                if not gcode_ref.get("path") and f"Metadata/plate_{idx}.gcode" in namelist:
                    gcode_ref["path"] = f"Metadata/plate_{idx}.gcode"
                if idx in plate_md5:
                    gcode_ref["md5"] = plate_md5[idx]

                plate_snapshot = {
                    "plate_index": idx,
                    "name": plate_names.get(idx) or (objects[0] if objects else None),
                    "objects": objects,
                    "object_count": len(objects),
                    "estimated_duration_sec": meta.get("estimated_duration_sec"),
                    "estimated_filament_grams": meta.get("estimated_filament_grams"),
                    "filament_map": meta.get("filament_map", []),
                    "gcode_ref": gcode_ref or None,
                    "thumbnail_ref": f"Metadata/plate_{idx}.png" if f"Metadata/plate_{idx}.png" in namelist else None,
                }
                plate_snapshot["plate_fingerprint"] = _make_plate_fingerprint(plate_snapshot)
                plates.append(plate_snapshot)
    except Exception:
        return []

    return plates


class PrintBatchService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_orders(self) -> list[PrintBatchOrderListItem]:
        result = await self.db.execute(
            select(PrintBatch)
            .options(selectinload(PrintBatch.plates).selectinload(PrintBatchPlate.configs))
            .order_by(desc(PrintBatch.created_at), desc(PrintBatch.id))
        )
        batches = list(result.scalars().all())
        progress_by_config = await self._progress_by_config_for_batches([b.id for b in batches])

        items: list[PrintBatchOrderListItem] = []
        for batch in batches:
            plate_count = len(batch.plates)
            configs = [cfg for plate in batch.plates for cfg in plate.configs]
            config_count = len(configs)
            total_qty = sum(cfg.quantity_target for cfg in configs)
            total_remaining_dispatch = 0
            total_completed = 0
            for cfg in configs:
                prog = progress_by_config.get(cfg.id, PrintBatchConfigProgress())
                total_remaining_dispatch += prog.remaining_to_dispatch
                total_completed += prog.completed_runs
            items.append(
                PrintBatchOrderListItem(
                    id=batch.id,
                    name=batch.name,
                    source_library_file_id=batch.source_library_file_id,
                    source_file_name=batch.source_file_name,
                    status=batch.status,
                    priority=batch.priority,
                    due_date=batch.due_date,
                    project_id=batch.project_id,
                    customer_label=batch.customer_label,
                    created_at=batch.created_at,
                    updated_at=batch.updated_at,
                    plate_count=plate_count,
                    config_count=config_count,
                    total_quantity_target=total_qty,
                    total_remaining_to_dispatch=total_remaining_dispatch,
                    total_completed_runs=total_completed,
                )
            )
        return items

    async def get_order_detail(self, order_id: int) -> PrintBatchOrderDetailResponse:
        batch = await self._get_batch(order_id)
        progress_by_config = await self._progress_by_config([cfg.id for p in batch.plates for cfg in p.configs])
        return self._build_order_detail_response(batch, progress_by_config)

    async def create_order(
        self, data: PrintBatchOrderCreate, current_user: User | None = None
    ) -> PrintBatchOrderDetailResponse:
        lib_file = await self._get_library_file(data.library_file_id)
        if not self._is_3mf_library_file(lib_file):
            raise BatchServiceError("Order source must be a .3mf library file")

        batch_name = (data.name or "").strip()
        if not batch_name:
            raise BatchServiceError("Order name cannot be empty")

        source_snapshot = await self._build_source_snapshot(lib_file)
        plates = source_snapshot.get("plates", [])
        if not plates:
            raise BatchServiceError("No plates found in source 3MF metadata")

        batch = PrintBatch(
            name=batch_name,
            source_library_file_id=lib_file.id,
            source_file_name=lib_file.filename,
            source_file_hash=lib_file.file_hash,
            source_metadata_snapshot=source_snapshot,
            project_id=data.project_id,
            customer_label=data.customer_label,
            due_date=data.due_date,
            notes=(data.notes.strip() if isinstance(data.notes, str) else data.notes),
            priority=data.priority,
            status="draft",
            dispatch_mode="manual",
            owner_user_id=current_user.id if current_user else None,
            created_by_id=current_user.id if current_user else None,
        )
        self.db.add(batch)
        await self.db.flush()

        seen_plate_indices: set[int] = set()
        for plate in plates:
            snapshot = dict(plate)
            if "plate_fingerprint" not in snapshot:
                snapshot["plate_fingerprint"] = _make_plate_fingerprint(snapshot)
            plate_index = snapshot.get("plate_index") or snapshot.get("index")
            try:
                plate_index = int(plate_index)
            except (TypeError, ValueError):
                raise BatchServiceError("Invalid plate metadata: missing numeric plate_index")
            if plate_index < 1:
                raise BatchServiceError(f"Invalid plate metadata: plate_index must be >= 1 (got {plate_index})")
            if plate_index in seen_plate_indices:
                raise BatchServiceError(f"Duplicate plate_index {plate_index} in source metadata")
            seen_plate_indices.add(plate_index)
            row = PrintBatchPlate(
                batch_id=batch.id,
                plate_index=plate_index,
                plate_name=snapshot.get("name"),
                plate_fingerprint=snapshot.get("plate_fingerprint"),
                object_count=int(snapshot.get("object_count") or len(snapshot.get("objects", []))),
                estimated_duration_sec=snapshot.get("estimated_duration_sec") or snapshot.get("print_time_seconds"),
                estimated_filament_grams=snapshot.get("estimated_filament_grams")
                or snapshot.get("filament_used_grams"),
                plate_metadata_snapshot=snapshot,
            )
            self.db.add(row)

        await self.db.commit()
        return await self.get_order_detail(batch.id)

    async def update_order(
        self, order_id: int, data: PrintBatchOrderUpdate, current_user: User | None = None
    ) -> PrintBatchOrderDetailResponse:
        batch = await self._get_batch(order_id)
        changes = data.model_dump(exclude_unset=True)
        for field, value in changes.items():
            if field == "name" and isinstance(value, str):
                value = value.strip()
                if not value:
                    raise BatchServiceError("Order name cannot be empty")
            if field in {"notes", "customer_label"} and isinstance(value, str):
                value = value.strip() or None
            if field == "status" and isinstance(value, str):
                self._validate_order_status_transition(batch.status, value)
                self._apply_order_status_side_effects(batch, value)
            setattr(batch, field, value)
        if current_user and batch.owner_user_id is None:
            batch.owner_user_id = current_user.id
        await self.db.commit()
        return await self.get_order_detail(order_id)

    async def delete_order(self, order_id: int) -> None:
        batch = await self._get_batch(order_id)

        linked_q = await self.db.execute(
            select(
                func.sum(case((PrintQueueItem.status == "pending", 1), else_=0)).label("pending_count"),
                func.sum(case((PrintQueueItem.status == "printing", 1), else_=0)).label("printing_count"),
            ).where(PrintQueueItem.batch_id == batch.id)
        )
        row = linked_q.one()
        pending_count = int(row.pending_count or 0)
        printing_count = int(row.printing_count or 0)

        if printing_count > 0:
            raise BatchServiceError("Cannot delete order while linked queue items are printing")

        if pending_count > 0:
            raise BatchServiceError(
                "Cannot delete order while linked queue items are pending; halt/close and clear queue first"
            )

        await self.db.delete(batch)
        await self.db.commit()

    async def create_or_update_config(
        self,
        batch_id: int,
        data: PrintBatchPlateConfigCreate,
        current_user: User | None = None,
    ) -> PrintBatchPlateConfigResponse:
        batch = await self._get_batch(batch_id)
        batch_plate = next((p for p in batch.plates if p.plate_index == data.plate_index), None)
        if not batch_plate:
            raise BatchServiceError(f"Plate {data.plate_index} not found in order")

        existing_codes = {cfg.config_code for cfg in batch_plate.configs}
        code = (data.config_code or "").strip().upper() or _next_config_code(existing_codes)
        if code in existing_codes:
            raise BatchServiceError(f"Config code '{code}' already exists for plate {data.plate_index}")
        if not re.fullmatch(r"[A-Z0-9_-]{1,16}", code):
            raise BatchServiceError("Config code must be 1-16 chars using letters, numbers, underscore or dash")

        cfg = PrintBatchPlateConfig(
            batch_plate_id=batch_plate.id,
            config_code=code,
            name=data.name.strip() if isinstance(data.name, str) else data.name,
            quantity_target=data.quantity_target,
            priority=data.priority,
            status="active",
            required_printer_type=data.required_printer_type,
            required_printer_model=self._normalize_target_model(data.required_printer_model),
            required_nozzle_diameter_mm=data.required_nozzle_diameter_mm,
            required_tool_position=data.required_tool_position,
            required_nozzle_count=data.required_nozzle_count,
            notes=data.notes.strip() if isinstance(data.notes, str) else data.notes,
            created_by_id=current_user.id if current_user else None,
            updated_by_id=current_user.id if current_user else None,
        )
        self.db.add(cfg)
        await self.db.flush()

        if data.seed_slots_from_plate:
            for slot in self._seed_slots_from_plate_snapshot(batch_plate.plate_metadata_snapshot):
                self.db.add(
                    PrintBatchPlateConfigSlot(
                        batch_plate_config_id=cfg.id,
                        slot_index=slot["slot_index"],
                        material_type=slot.get("material_type"),
                        color_hex=slot.get("color_hex"),
                        color_family=slot.get("color_family"),
                        brand_name=slot.get("brand_name"),
                        filament_name=slot.get("filament_name"),
                        nozzle_assignment=slot.get("nozzle_assignment"),
                        metadata_json=slot.get("metadata_json"),
                    )
                )

        await self.db.commit()
        return await self.get_config_response(cfg.id)

    async def update_config(
        self,
        config_id: int,
        data: PrintBatchPlateConfigUpdate,
        current_user: User | None = None,
    ) -> PrintBatchPlateConfigResponse:
        cfg = await self._get_config(config_id)
        old_target = cfg.quantity_target
        changes = data.model_dump(exclude_unset=True)
        for field, value in changes.items():
            if field == "required_printer_model":
                value = self._normalize_target_model(value)
            if field == "name" and isinstance(value, str):
                value = value.strip()
                if not value:
                    raise BatchServiceError("Config name cannot be empty")
            if field == "notes" and isinstance(value, str):
                value = value.strip() or None
            setattr(cfg, field, value)
        if current_user:
            cfg.updated_by_id = current_user.id

        if "status" in changes and cfg.status == "cancelled":
            await self._cancel_all_pending_for_config(cfg)

        # Quantity reduction only cancels not-started queue items
        if "quantity_target" in changes and cfg.quantity_target < old_target:
            await self._cancel_pending_excess_for_config(cfg)

        await self._sync_pending_queue_items_for_config(cfg)
        await self.db.commit()
        return await self.get_config_response(config_id)

    async def replace_config_slots(
        self,
        config_id: int,
        slot_inputs: list[PrintBatchPlateConfigSlotInput],
        current_user: User | None = None,
    ) -> PrintBatchPlateConfigResponse:
        cfg = await self._get_config(config_id)
        if current_user:
            cfg.updated_by_id = current_user.id

        # Replace all slots deterministically
        for existing in list(cfg.slots):
            await self.db.delete(existing)
        await self.db.flush()

        seen_slots: set[int] = set()
        for slot in sorted(slot_inputs, key=lambda s: s.slot_index):
            if slot.slot_index in seen_slots:
                raise BatchServiceError(f"Duplicate slot_index {slot.slot_index}")
            seen_slots.add(slot.slot_index)
            color_hex = _normalize_color_hex(slot.color_hex)
            color_family = slot.color_family or _color_family_from_hex(color_hex)
            self.db.add(
                PrintBatchPlateConfigSlot(
                    batch_plate_config_id=cfg.id,
                    slot_index=slot.slot_index,
                    material_type=_normalize_material_type(slot.material_type),
                    color_hex=color_hex,
                    color_family=color_family,
                    brand_name=slot.brand_name,
                    filament_name=slot.filament_name,
                    nozzle_assignment=slot.nozzle_assignment,
                    metadata_json=slot.metadata_json,
                )
            )

        await self.db.flush()
        cfg = await self._get_config(config_id)
        await self._sync_pending_queue_items_for_config(cfg)
        await self.db.commit()
        return await self.get_config_response(config_id)

    async def dispatch_remaining(
        self, config_id: int, limit: int | None = None, current_user: User | None = None
    ) -> PrintBatchDispatchResponse:
        cfg = await self._get_config(config_id)
        if cfg.status != "active":
            raise BatchServiceError("Config is not active")

        batch = cfg.batch_plate.batch
        if not batch.source_library_file_id:
            raise BatchServiceError("Order source library file is missing")
        if batch.status in {"paused", "completed", "cancelled"}:
            raise BatchServiceError(f"Order is {batch.status}; dispatch is not allowed")
        source_lib = await self._get_library_file(batch.source_library_file_id)
        if not self._is_3mf_library_file(source_lib):
            raise BatchServiceError("Order source must reference a .3mf library file")
        source_path = _library_file_disk_path(source_lib)
        if not source_path.exists():
            raise BatchServiceError("Source library file is missing on disk")
        source_filaments = (cfg.batch_plate.plate_metadata_snapshot or {}).get("filament_map", [])
        if isinstance(source_filaments, list) and source_filaments and not cfg.slots:
            raise BatchServiceError("Config has no slot mappings; add slot mappings before dispatch")

        progress = await self._progress_by_config([cfg.id])
        prog = progress.get(cfg.id, PrintBatchConfigProgress())
        to_dispatch = prog.remaining_to_dispatch
        if limit is not None:
            to_dispatch = min(to_dispatch, limit)

        if to_dispatch <= 0:
            return PrintBatchDispatchResponse(created_queue_item_ids=[], created_count=0, remaining_to_dispatch=0)

        result = await self.db.execute(
            select(func.max(PrintQueueItem.position))
            .where(PrintQueueItem.printer_id.is_(None))
            .where(PrintQueueItem.status == "pending")
        )
        max_pos = result.scalar() or 0

        created_ids: list[int] = []
        required_filament_types = self._required_filament_types_json(cfg)
        matching_requirements_json = _json_dumps(self._matching_requirements_payload(cfg))
        execution_mapping_json = _json_dumps(self._execution_mapping_payload(cfg))
        override_material_map_json = self._override_material_map_json(cfg)
        next_dispatch_seq = await self._next_dispatch_seq(batch.id)

        for offset in range(to_dispatch):
            target_model = cfg.required_printer_model
            dispatch_seq = next_dispatch_seq + offset
            item = PrintQueueItem(
                printer_id=None,
                target_model=target_model,
                target_location=None,
                required_filament_types=required_filament_types,
                archive_id=None,
                library_file_id=batch.source_library_file_id,
                project_id=batch.project_id,
                position=max_pos + offset + 1,
                scheduled_time=None,
                require_previous_success=False,
                auto_off_after=False,
                manual_start=False,
                ams_mapping=None,
                plate_id=cfg.batch_plate.plate_index,
                bed_levelling=True,
                flow_cali=False,
                vibration_cali=True,
                layer_inspect=False,
                timelapse=False,
                use_ams=True,
                status="pending",
                created_by_id=current_user.id if current_user else None,
                batch_id=batch.id,
                batch_plate_id=cfg.batch_plate.id,
                batch_plate_config_id=cfg.id,
                batch_plan_revision=batch.plan_revision,
                batch_dispatch_seq=dispatch_seq,
                matching_requirements_json=matching_requirements_json,
                execution_mapping_json=execution_mapping_json,
                override_material_map=override_material_map_json,
                batch_reconcile_state="normal",
            )
            self.db.add(item)
            await self.db.flush()
            created_ids.append(item.id)

        if batch.started_at is None:
            batch.started_at = datetime.utcnow()
        if batch.status == "draft":
            batch.status = "active"

        await self.db.commit()

        updated_prog = (await self._progress_by_config([cfg.id])).get(cfg.id, PrintBatchConfigProgress())
        return PrintBatchDispatchResponse(
            created_queue_item_ids=created_ids,
            created_count=len(created_ids),
            remaining_to_dispatch=updated_prog.remaining_to_dispatch,
        )

    async def dispatch_order_remaining(
        self, order_id: int, limit: int | None = None, current_user: User | None = None
    ) -> PrintBatchDispatchResponse:
        batch = await self._get_batch(order_id)
        ordered_configs = [
            cfg
            for plate in sorted(batch.plates, key=lambda p: p.plate_index)
            for cfg in sorted(plate.configs, key=lambda c: (c.priority, c.config_code))
            if cfg.status == "active"
        ]

        created_ids: list[int] = []
        remaining_limit = limit
        for cfg in ordered_configs:
            if remaining_limit is not None and remaining_limit <= 0:
                break
            res = await self.dispatch_remaining(cfg.id, limit=remaining_limit, current_user=current_user)
            created_ids.extend(res.created_queue_item_ids)
            if remaining_limit is not None:
                remaining_limit -= res.created_count

        detail = await self.get_order_detail(order_id)
        return PrintBatchDispatchResponse(
            created_queue_item_ids=created_ids,
            created_count=len(created_ids),
            remaining_to_dispatch=int(detail.progress_summary.get("remaining_to_dispatch", 0)),
        )

    async def dispatch_plate_remaining(
        self,
        order_id: int,
        plate_index: int,
        limit: int | None = None,
        current_user: User | None = None,
    ) -> PrintBatchDispatchResponse:
        batch = await self._get_batch(order_id)
        if batch.status in {"paused", "completed", "cancelled"}:
            raise BatchServiceError(f"Order is {batch.status}; dispatch is not allowed")

        plate = next((p for p in batch.plates if p.plate_index == plate_index), None)
        if not plate:
            raise BatchServiceError(f"Plate {plate_index} not found in order")

        ordered_configs = [
            cfg for cfg in sorted(plate.configs, key=lambda c: (c.priority, c.config_code)) if cfg.status == "active"
        ]

        created_ids: list[int] = []
        remaining_limit = limit
        for cfg in ordered_configs:
            if remaining_limit is not None and remaining_limit <= 0:
                break
            res = await self.dispatch_remaining(cfg.id, limit=remaining_limit, current_user=current_user)
            created_ids.extend(res.created_queue_item_ids)
            if remaining_limit is not None:
                remaining_limit -= res.created_count

        detail = await self.get_order_detail(order_id)
        plate_detail = next((p for p in detail.plates if p.plate_index == plate_index), None)
        remaining_to_dispatch = 0
        if plate_detail:
            remaining_to_dispatch = sum((cfg.progress.remaining_to_dispatch for cfg in plate_detail.configs), start=0)

        return PrintBatchDispatchResponse(
            created_queue_item_ids=created_ids,
            created_count=len(created_ids),
            remaining_to_dispatch=remaining_to_dispatch,
        )

    async def get_config_response(self, config_id: int) -> PrintBatchPlateConfigResponse:
        cfg = await self._get_config(config_id)
        progress = await self._progress_by_config([cfg.id])
        return self._build_config_response(cfg, progress)

    # ---------- internal loaders ----------

    async def _get_library_file(self, library_file_id: int) -> LibraryFile:
        result = await self.db.execute(select(LibraryFile).where(LibraryFile.id == library_file_id))
        lib_file = result.scalar_one_or_none()
        if not lib_file:
            raise BatchServiceError("Library file not found")
        return lib_file

    async def _get_batch(self, batch_id: int) -> PrintBatch:
        result = await self.db.execute(
            select(PrintBatch)
            .options(
                selectinload(PrintBatch.plates)
                .selectinload(PrintBatchPlate.configs)
                .selectinload(PrintBatchPlateConfig.slots)
            )
            .where(PrintBatch.id == batch_id)
        )
        batch = result.scalar_one_or_none()
        if not batch:
            raise BatchServiceError("Order not found")
        return batch

    async def _get_config(self, config_id: int) -> PrintBatchPlateConfig:
        result = await self.db.execute(
            select(PrintBatchPlateConfig)
            .options(
                selectinload(PrintBatchPlateConfig.slots),
                selectinload(PrintBatchPlateConfig.batch_plate).selectinload(PrintBatchPlate.batch),
            )
            .where(PrintBatchPlateConfig.id == config_id)
        )
        cfg = result.scalar_one_or_none()
        if not cfg:
            raise BatchServiceError("Config not found")
        return cfg

    # ---------- source snapshot / plate extraction ----------

    async def _build_source_snapshot(self, lib_file: LibraryFile) -> dict:
        source = dict(lib_file.file_metadata or {})
        file_path = _library_file_disk_path(lib_file)

        plates = source.get("plates")
        if not isinstance(plates, list) or not plates:
            if not file_path.exists():
                raise BatchServiceError(
                    "Library file has no embedded plate metadata and the source .3mf is missing on disk"
                )
            plates = _extract_plates_from_3mf(file_path)

        # Add normalized plate snapshots for batch planning
        normalized_plates: list[dict] = []
        for raw_plate in plates or []:
            plate_index = raw_plate.get("plate_index", raw_plate.get("index"))
            if plate_index is None:
                continue
            try:
                plate_index = int(plate_index)
            except (ValueError, TypeError):
                continue

            filament_map = raw_plate.get("filament_map")
            if not isinstance(filament_map, list):
                raw_filaments = raw_plate.get("filaments", [])
                filament_map = []
                for f in raw_filaments if isinstance(raw_filaments, list) else []:
                    if not isinstance(f, dict):
                        continue
                    filament_map.append(
                        {
                            "slot_id": f.get("slot_id"),
                            "material_type": _normalize_material_type(f.get("material_type") or f.get("type")),
                            "color_hex": _normalize_color_hex(f.get("color_hex") or f.get("color")),
                            "used_g": f.get("used_g", f.get("used_grams")),
                            "nozzle_assignment": f.get("nozzle_assignment"),
                            "metadata_json": {
                                k: v
                                for k, v in f.items()
                                if k
                                not in {
                                    "slot_id",
                                    "material_type",
                                    "type",
                                    "color",
                                    "color_hex",
                                    "used_g",
                                    "used_grams",
                                    "nozzle_assignment",
                                }
                            },
                        }
                    )

            plate_snapshot = {
                "plate_index": plate_index,
                "name": raw_plate.get("name"),
                "objects": raw_plate.get("objects") if isinstance(raw_plate.get("objects"), list) else [],
                "object_count": raw_plate.get("object_count")
                if raw_plate.get("object_count") is not None
                else len(raw_plate.get("objects", []) if isinstance(raw_plate.get("objects"), list) else []),
                "estimated_duration_sec": raw_plate.get("estimated_duration_sec", raw_plate.get("print_time_seconds")),
                "estimated_filament_grams": raw_plate.get(
                    "estimated_filament_grams", raw_plate.get("filament_used_grams")
                ),
                "filament_map": [
                    {
                        "slot_id": int(f["slot_id"]) if f.get("slot_id") is not None else None,
                        "material_type": _normalize_material_type(f.get("material_type") or f.get("type")),
                        "color_hex": _normalize_color_hex(f.get("color_hex") or f.get("color")),
                        "color_family": f.get("color_family")
                        or _color_family_from_hex(f.get("color_hex") or f.get("color")),
                        "used_g": f.get("used_g", f.get("used_grams")),
                        "nozzle_assignment": f.get("nozzle_assignment"),
                        "brand_name": f.get("brand_name"),
                        "filament_name": f.get("filament_name"),
                        "metadata_json": f.get("metadata_json"),
                    }
                    for f in filament_map
                    if isinstance(f, dict)
                ],
                "gcode_ref": raw_plate.get("gcode_ref"),
                "thumbnail_ref": raw_plate.get("thumbnail_ref"),
            }
            plate_snapshot["plate_fingerprint"] = raw_plate.get("plate_fingerprint") or _make_plate_fingerprint(
                plate_snapshot
            )
            normalized_plates.append(plate_snapshot)

        normalized_plates.sort(key=lambda p: p["plate_index"])
        source["plates"] = normalized_plates
        source.setdefault("batch_source", {})
        source["batch_source"].update(
            {
                "library_file_id": lib_file.id,
                "filename": lib_file.filename,
                "file_hash": lib_file.file_hash,
                "extracted_at": datetime.utcnow().isoformat() + "Z",
            }
        )
        return source

    def _seed_slots_from_plate_snapshot(self, plate_snapshot: dict) -> list[dict]:
        slots: list[dict] = []
        raw_filament_map = plate_snapshot.get("filament_map", [])
        if not isinstance(raw_filament_map, list):
            return slots

        seen: set[int] = set()
        for f in sorted(
            (x for x in raw_filament_map if isinstance(x, dict) and x.get("slot_id") is not None),
            key=lambda x: int(x.get("slot_id", 0)),
        ):
            try:
                slot_index = int(f["slot_id"])
            except (TypeError, ValueError):
                continue
            if slot_index in seen:
                continue
            seen.add(slot_index)
            color_hex = _normalize_color_hex(f.get("color_hex") or f.get("color"))
            slots.append(
                {
                    "slot_index": slot_index,
                    "material_type": _normalize_material_type(f.get("material_type") or f.get("type")),
                    "color_hex": color_hex,
                    "color_family": _color_family_from_hex(color_hex),
                    "brand_name": f.get("brand_name"),
                    "filament_name": f.get("filament_name"),
                    "nozzle_assignment": str(f.get("nozzle_assignment"))
                    if f.get("nozzle_assignment") is not None
                    else None,
                    "metadata_json": {
                        "source_slot": {
                            k: v
                            for k, v in f.items()
                            if k not in {"material_type", "type", "color", "color_hex", "slot_id"}
                        }
                    },
                }
            )
        return slots

    # ---------- queue dispatch helpers ----------

    async def _next_dispatch_seq(self, batch_id: int) -> int:
        result = await self.db.execute(
            select(func.max(PrintQueueItem.batch_dispatch_seq)).where(PrintQueueItem.batch_id == batch_id)
        )
        return int(result.scalar() or 0) + 1

    def _required_filament_types_json(self, cfg: PrintBatchPlateConfig) -> str | None:
        types = sorted({t for t in (_normalize_material_type(slot.material_type) for slot in cfg.slots) if t})
        return json.dumps(types) if types else None

    def _matching_requirements_payload(self, cfg: PrintBatchPlateConfig) -> dict:
        plate = cfg.batch_plate
        batch = plate.batch
        requirements = []
        for order, slot in enumerate(sorted(cfg.slots, key=lambda s: s.slot_index), start=1):
            requirements.append(
                {
                    "requirement_order": order,
                    "slot_index": slot.slot_index,
                    "material_type": _normalize_material_type(slot.material_type),
                    "color_hex": _normalize_color_hex(slot.color_hex),
                    "color_family": slot.color_family or _color_family_from_hex(slot.color_hex),
                    "nozzle_assignment": slot.nozzle_assignment,
                    "metadata_json": slot.metadata_json,
                }
            )

        return {
            "source": "print_batch",
            "batch_id": batch.id,
            "batch_plate_id": plate.id,
            "batch_plate_config_id": cfg.id,
            "plate_index": plate.plate_index,
            "plate_fingerprint": plate.plate_fingerprint,
            "required_printer_model": cfg.required_printer_model,
            "required_nozzle_diameter_mm": cfg.required_nozzle_diameter_mm,
            "required_tool_position": cfg.required_tool_position,
            "required_nozzle_count": cfg.required_nozzle_count,
            "requirements": requirements,
        }

    def _execution_mapping_payload(self, cfg: PrintBatchPlateConfig) -> dict:
        plate = cfg.batch_plate
        batch = plate.batch
        return {
            "source": "print_batch_dispatch_snapshot",
            "batch_id": batch.id,
            "batch_plate_id": plate.id,
            "batch_plate_config_id": cfg.id,
            "batch_plan_revision": batch.plan_revision,
            "plate_index": plate.plate_index,
            "plate_name": plate.plate_name,
            "plate_fingerprint": plate.plate_fingerprint,
            "config_code": cfg.config_code,
            "config_name": cfg.name,
            "slot_mappings": [
                {
                    "slot_index": slot.slot_index,
                    "material_type": _normalize_material_type(slot.material_type),
                    "color_hex": _normalize_color_hex(slot.color_hex),
                    "color_family": slot.color_family or _color_family_from_hex(slot.color_hex),
                    "nozzle_assignment": slot.nozzle_assignment,
                    "metadata_json": slot.metadata_json,
                }
                for slot in sorted(cfg.slots, key=lambda s: s.slot_index)
            ],
        }

    def _base_slot_snapshot_map(self, cfg: PrintBatchPlateConfig) -> dict[int, dict[str, Any]]:
        plate_snapshot = cfg.batch_plate.plate_metadata_snapshot or {}
        raw_filament_map = plate_snapshot.get("filament_map", [])
        if not isinstance(raw_filament_map, list):
            return {}

        out: dict[int, dict[str, Any]] = {}
        for raw in raw_filament_map:
            if not isinstance(raw, dict):
                continue
            try:
                slot_index = int(raw.get("slot_id"))
            except (TypeError, ValueError):
                continue
            color_hex = _normalize_color_hex(raw.get("color_hex") or raw.get("color"))
            out[slot_index] = {
                "material_type": _normalize_material_type(raw.get("material_type") or raw.get("type")),
                "color_hex": color_hex,
                "color_family": raw.get("color_family") or _color_family_from_hex(color_hex),
                "nozzle_assignment": str(raw.get("nozzle_assignment"))
                if raw.get("nozzle_assignment") is not None
                else None,
            }
        return out

    def _override_material_map_payload(self, cfg: PrintBatchPlateConfig) -> dict[str, dict[str, Any]]:
        """Queue-facing override payload keyed by source slot/material index.

        This is intentionally additive and forward-compatible: `filament_id` is optional
        because the queue/scheduler still owns AMS/spool matching for this MVP.
        """
        base_by_slot = self._base_slot_snapshot_map(cfg)
        overrides: dict[str, dict[str, Any]] = {}

        for slot in sorted(cfg.slots, key=lambda s: s.slot_index):
            slot_index = int(slot.slot_index)
            material_type = _normalize_material_type(slot.material_type)
            color_hex = _normalize_color_hex(slot.color_hex)
            color_family = slot.color_family or _color_family_from_hex(color_hex)
            nozzle_assignment = slot.nozzle_assignment
            base = base_by_slot.get(slot_index) or {}

            slot_meta = slot.metadata_json if isinstance(slot.metadata_json, dict) else {}
            selected_spool_id = slot_meta.get("inventory_spool_id")
            color_catalog_id = slot_meta.get("color_catalog_id")
            filament_catalog_id = slot_meta.get("filament_catalog_id")
            slicer_filament_id = slot_meta.get("slicer_filament_id") or slot_meta.get("slicer_filament")
            selected_spool_snapshot = slot_meta.get("selected_spool_snapshot")
            selected_filament_snapshot = slot_meta.get("selected_filament_snapshot")
            selected_color_catalog_snapshot = slot_meta.get("selected_color_catalog_snapshot")
            base_source = slot_meta.get("source_slot") if isinstance(slot_meta.get("source_slot"), dict) else {}
            base_selected_spool_id = base_source.get("inventory_spool_id")
            base_color_catalog_id = base_source.get("color_catalog_id")
            base_filament_catalog_id = base_source.get("filament_catalog_id")
            base_slicer_filament_id = base_source.get("slicer_filament_id") or base_source.get("slicer_filament")

            changed = (
                material_type != base.get("material_type")
                or color_hex != base.get("color_hex")
                or (nozzle_assignment or None) != (base.get("nozzle_assignment") or None)
                or selected_spool_id is not None
                or color_catalog_id is not None
                or filament_catalog_id is not None
                or slicer_filament_id is not None
            )
            if not changed:
                continue

            filament_id = slot_meta.get("filament_id")
            if filament_id is None:
                # Common nested shape when seeded from source snapshot and later enriched
                if base_source:
                    filament_id = base_source.get("filament_id")
            # Prefer explicit selected slicer filament id for Bambu / slicer mapping semantics
            if slicer_filament_id is not None:
                filament_id = slicer_filament_id

            overrides[str(slot_index)] = {
                "slot_index": slot_index,
                "filament_id": filament_id,
                "inventory_spool_id": selected_spool_id,  # legacy/optional; UI no longer targets spool IDs
                "color_catalog_id": color_catalog_id,
                "filament_catalog_id": filament_catalog_id,
                "slicer_filament_id": slicer_filament_id,
                "material_type": material_type,
                "color_hex": color_hex,
                "color_family": color_family,
                "nozzle_assignment": nozzle_assignment,
                "base_material_type": base.get("material_type"),
                "base_color_hex": base.get("color_hex"),
                "base_color_family": base.get("color_family"),
                "base_inventory_spool_id": base_selected_spool_id,
                "base_color_catalog_id": base_color_catalog_id,
                "base_filament_catalog_id": base_filament_catalog_id,
                "base_slicer_filament_id": base_slicer_filament_id,
                "source": "order_plate_config",
                "batch_plate_config_id": cfg.id,
                "selected_spool_snapshot": selected_spool_snapshot,
                "selected_filament_snapshot": selected_filament_snapshot,
                "selected_color_catalog_snapshot": selected_color_catalog_snapshot,
            }

        return overrides

    def _override_material_map_json(self, cfg: PrintBatchPlateConfig) -> str | None:
        payload = self._override_material_map_payload(cfg)
        if not payload:
            return None
        return _json_dumps(payload)

    async def _sync_pending_queue_items_for_config(self, cfg: PrintBatchPlateConfig) -> None:
        target_model = cfg.required_printer_model
        req_types = self._required_filament_types_json(cfg)
        matching_json = _json_dumps(self._matching_requirements_payload(cfg))
        exec_json = _json_dumps(self._execution_mapping_payload(cfg))
        override_json = self._override_material_map_json(cfg)

        result = await self.db.execute(
            select(PrintQueueItem)
            .where(PrintQueueItem.batch_plate_config_id == cfg.id)
            .where(PrintQueueItem.status == "pending")
            .order_by(PrintQueueItem.id)
        )
        for item in result.scalars().all():
            item.target_model = target_model
            item.required_filament_types = req_types
            item.matching_requirements_json = matching_json
            item.execution_mapping_json = exec_json
            item.override_material_map = override_json

    async def _cancel_pending_excess_for_config(self, cfg: PrintBatchPlateConfig) -> None:
        progress = (await self._progress_by_config([cfg.id])).get(cfg.id, PrintBatchConfigProgress())
        excess = max(progress.dispatched_non_cancelled - cfg.quantity_target, 0)
        if excess <= 0:
            return

        result = await self.db.execute(
            select(PrintQueueItem)
            .where(PrintQueueItem.batch_plate_config_id == cfg.id)
            .where(PrintQueueItem.status == "pending")
            .order_by(desc(PrintQueueItem.batch_dispatch_seq), desc(PrintQueueItem.created_at), desc(PrintQueueItem.id))
        )
        pending_items = result.scalars().all()
        for item in pending_items[:excess]:
            item.status = "cancelled"
            item.error_message = "Cancelled due to order config quantity reduction"
            item.completed_at = datetime.utcnow()
            item.batch_reconcile_state = "cancelled_by_reconcile"

    async def _cancel_all_pending_for_config(self, cfg: PrintBatchPlateConfig) -> None:
        result = await self.db.execute(
            select(PrintQueueItem)
            .where(PrintQueueItem.batch_plate_config_id == cfg.id)
            .where(PrintQueueItem.status == "pending")
            .order_by(desc(PrintQueueItem.batch_dispatch_seq), desc(PrintQueueItem.id))
        )
        for item in result.scalars().all():
            item.status = "cancelled"
            item.error_message = "Cancelled because order config was cancelled"
            item.completed_at = datetime.utcnow()
            item.batch_reconcile_state = "cancelled_by_reconcile"

    # ---------- progress / serialization ----------

    async def _progress_by_config_for_batches(self, batch_ids: list[int]) -> dict[int, PrintBatchConfigProgress]:
        if not batch_ids:
            return {}
        result = await self.db.execute(
            select(
                PrintQueueItem.batch_plate_config_id.label("config_id"),
                func.sum(case((PrintQueueItem.status == "pending", 1), else_=0)).label("queued_runs"),
                func.sum(case((PrintQueueItem.status == "printing", 1), else_=0)).label("printing_runs"),
                func.sum(case((PrintQueueItem.status == "completed", 1), else_=0)).label("completed_runs"),
                func.sum(case((PrintQueueItem.status == "failed", 1), else_=0)).label("failed_runs"),
                func.sum(case((PrintQueueItem.status == "cancelled", 1), else_=0)).label("cancelled_runs"),
                func.sum(case((PrintQueueItem.status != "cancelled", 1), else_=0)).label("dispatched_non_cancelled"),
            )
            .where(PrintQueueItem.batch_id.in_(batch_ids))
            .where(PrintQueueItem.batch_plate_config_id.is_not(None))
            .group_by(PrintQueueItem.batch_plate_config_id)
        )
        raw = {int(row.config_id): row for row in result.all() if row.config_id is not None}

        # Fill quantity-aware remaining fields by loading configs
        cfg_result = await self.db.execute(
            select(PrintBatchPlateConfig.id, PrintBatchPlateConfig.quantity_target)
            .join(PrintBatchPlate, PrintBatchPlate.id == PrintBatchPlateConfig.batch_plate_id)
            .where(PrintBatchPlate.batch_id.in_(batch_ids))
        )
        out: dict[int, PrintBatchConfigProgress] = {}
        for cfg_id, qty in cfg_result.all():
            row = raw.get(int(cfg_id))
            queued = int(getattr(row, "queued_runs", 0) or 0) if row else 0
            printing = int(getattr(row, "printing_runs", 0) or 0) if row else 0
            completed = int(getattr(row, "completed_runs", 0) or 0) if row else 0
            failed = int(getattr(row, "failed_runs", 0) or 0) if row else 0
            cancelled = int(getattr(row, "cancelled_runs", 0) or 0) if row else 0
            dispatched_non_cancelled = int(getattr(row, "dispatched_non_cancelled", 0) or 0) if row else 0
            out[int(cfg_id)] = PrintBatchConfigProgress(
                queued_runs=queued,
                printing_runs=printing,
                completed_runs=completed,
                failed_runs=failed,
                cancelled_runs=cancelled,
                dispatched_non_cancelled=dispatched_non_cancelled,
                remaining_to_dispatch=max(int(qty) - dispatched_non_cancelled, 0),
                remaining_to_complete=max(int(qty) - completed, 0),
            )
        return out

    async def _progress_by_config(self, config_ids: list[int]) -> dict[int, PrintBatchConfigProgress]:
        if not config_ids:
            return {}
        result = await self.db.execute(
            select(
                PrintQueueItem.batch_plate_config_id.label("config_id"),
                func.sum(case((PrintQueueItem.status == "pending", 1), else_=0)).label("queued_runs"),
                func.sum(case((PrintQueueItem.status == "printing", 1), else_=0)).label("printing_runs"),
                func.sum(case((PrintQueueItem.status == "completed", 1), else_=0)).label("completed_runs"),
                func.sum(case((PrintQueueItem.status == "failed", 1), else_=0)).label("failed_runs"),
                func.sum(case((PrintQueueItem.status == "cancelled", 1), else_=0)).label("cancelled_runs"),
                func.sum(case((PrintQueueItem.status != "cancelled", 1), else_=0)).label("dispatched_non_cancelled"),
            )
            .where(PrintQueueItem.batch_plate_config_id.in_(config_ids))
            .group_by(PrintQueueItem.batch_plate_config_id)
        )
        raw = {int(row.config_id): row for row in result.all() if row.config_id is not None}

        qty_result = await self.db.execute(
            select(PrintBatchPlateConfig.id, PrintBatchPlateConfig.quantity_target).where(
                PrintBatchPlateConfig.id.in_(config_ids)
            )
        )
        out: dict[int, PrintBatchConfigProgress] = {}
        for cfg_id, qty in qty_result.all():
            row = raw.get(int(cfg_id))
            queued = int(getattr(row, "queued_runs", 0) or 0) if row else 0
            printing = int(getattr(row, "printing_runs", 0) or 0) if row else 0
            completed = int(getattr(row, "completed_runs", 0) or 0) if row else 0
            failed = int(getattr(row, "failed_runs", 0) or 0) if row else 0
            cancelled = int(getattr(row, "cancelled_runs", 0) or 0) if row else 0
            dispatched_non_cancelled = int(getattr(row, "dispatched_non_cancelled", 0) or 0) if row else 0
            out[int(cfg_id)] = PrintBatchConfigProgress(
                queued_runs=queued,
                printing_runs=printing,
                completed_runs=completed,
                failed_runs=failed,
                cancelled_runs=cancelled,
                dispatched_non_cancelled=dispatched_non_cancelled,
                remaining_to_dispatch=max(int(qty) - dispatched_non_cancelled, 0),
                remaining_to_complete=max(int(qty) - completed, 0),
            )
        return out

    def _build_config_response(
        self,
        cfg: PrintBatchPlateConfig,
        progress_by_config: dict[int, PrintBatchConfigProgress],
    ) -> PrintBatchPlateConfigResponse:
        return PrintBatchPlateConfigResponse(
            id=cfg.id,
            batch_plate_id=cfg.batch_plate_id,
            config_code=cfg.config_code,
            name=cfg.name,
            quantity_target=cfg.quantity_target,
            priority=cfg.priority,
            status=cfg.status,
            notes=cfg.notes,
            required_printer_type=cfg.required_printer_type,
            required_printer_model=cfg.required_printer_model,
            required_nozzle_diameter_mm=cfg.required_nozzle_diameter_mm,
            required_tool_position=cfg.required_tool_position,
            required_nozzle_count=cfg.required_nozzle_count,
            slots=[
                PrintBatchPlateConfigSlotResponse.model_validate(slot)
                for slot in sorted(cfg.slots, key=lambda s: s.slot_index)
            ],
            progress=progress_by_config.get(cfg.id, PrintBatchConfigProgress()),
            created_at=cfg.created_at,
            updated_at=cfg.updated_at,
        )

    def _build_order_detail_response(
        self,
        batch: PrintBatch,
        progress_by_config: dict[int, PrintBatchConfigProgress],
    ) -> PrintBatchOrderDetailResponse:
        plate_responses: list[PrintBatchPlateResponse] = []
        summary = {
            "quantity_target": 0,
            "queued_runs": 0,
            "printing_runs": 0,
            "completed_runs": 0,
            "failed_runs": 0,
            "cancelled_runs": 0,
            "remaining_to_dispatch": 0,
            "remaining_to_complete": 0,
        }

        for plate in sorted(batch.plates, key=lambda p: p.plate_index):
            config_responses = []
            for cfg in sorted(plate.configs, key=lambda c: (c.priority, c.config_code)):
                config_res = self._build_config_response(cfg, progress_by_config)
                config_responses.append(config_res)
                summary["quantity_target"] += cfg.quantity_target
                summary["queued_runs"] += config_res.progress.queued_runs
                summary["printing_runs"] += config_res.progress.printing_runs
                summary["completed_runs"] += config_res.progress.completed_runs
                summary["failed_runs"] += config_res.progress.failed_runs
                summary["cancelled_runs"] += config_res.progress.cancelled_runs
                summary["remaining_to_dispatch"] += config_res.progress.remaining_to_dispatch
                summary["remaining_to_complete"] += config_res.progress.remaining_to_complete

            plate_responses.append(
                PrintBatchPlateResponse(
                    id=plate.id,
                    plate_index=plate.plate_index,
                    plate_name=plate.plate_name,
                    plate_fingerprint=plate.plate_fingerprint,
                    object_count=plate.object_count,
                    estimated_duration_sec=plate.estimated_duration_sec,
                    estimated_filament_grams=plate.estimated_filament_grams,
                    plate_metadata_snapshot=plate.plate_metadata_snapshot,
                    configs=config_responses,
                )
            )

        return PrintBatchOrderDetailResponse(
            id=batch.id,
            name=batch.name,
            source_library_file_id=batch.source_library_file_id,
            source_file_name=batch.source_file_name,
            source_file_hash=batch.source_file_hash,
            source_metadata_snapshot=batch.source_metadata_snapshot,
            status=batch.status,
            dispatch_mode=batch.dispatch_mode,
            priority=batch.priority,
            plan_revision=batch.plan_revision,
            due_date=batch.due_date,
            notes=batch.notes,
            project_id=batch.project_id,
            customer_label=batch.customer_label,
            created_at=batch.created_at,
            updated_at=batch.updated_at,
            plates=plate_responses,
            progress_summary=summary,
        )

    def _normalize_target_model(self, value: str | None) -> str | None:
        if not value:
            return None
        value = value.strip()
        if not value:
            return None
        return normalize_printer_model(value) or normalize_printer_model_id(value) or value

    def _validate_order_status_transition(self, current: str | None, new: str) -> None:
        current_status = (current or "draft").strip().lower()
        new_status = new.strip().lower()
        if current_status == new_status:
            return

        allowed: dict[str, set[str]] = {
            "draft": {"active", "running", "paused", "cancelled"},
            "active": {"running", "paused", "completed", "cancelled"},
            "running": {"active", "paused", "completed", "cancelled"},
            "paused": {"active", "running", "completed", "cancelled"},
            "completed": set(),  # final by default (reopen can be added later)
            "cancelled": set(),
        }
        if new_status not in allowed.get(current_status, set()):
            raise BatchServiceError(f"Invalid order status transition: {current_status} -> {new_status}")

    def _apply_order_status_side_effects(self, batch: PrintBatch, new_status: str) -> None:
        status = new_status.strip().lower()
        now = datetime.utcnow()
        if status in {"active", "running"}:
            if batch.started_at is None:
                batch.started_at = now
        if status == "completed":
            batch.completed_at = now
        elif batch.completed_at and status != "completed":
            # Keep completed timestamp immutable once set
            pass
        if status == "cancelled":
            batch.cancelled_at = now

    def _is_3mf_library_file(self, lib_file: LibraryFile) -> bool:
        if (lib_file.file_type or "").lower() == "3mf":
            return True
        return lib_file.filename.lower().endswith(".3mf")
