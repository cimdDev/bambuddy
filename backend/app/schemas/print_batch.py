import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

HEX_COLOR_RE = re.compile(r"^#?[0-9A-Fa-f]{6}$")
CONFIG_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")


def _strip_optional(value):
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    value = value.strip()
    return value or None


class PrintBatchOrderCreate(BaseModel):
    library_file_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=255)
    due_date: datetime | None = None
    notes: str | None = None
    project_id: int | None = Field(default=None, ge=1)
    customer_label: str | None = None
    priority: int = Field(default=100, ge=1, le=1000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Order name cannot be empty")
        return value

    @field_validator("notes", "customer_label", mode="before")
    @classmethod
    def strip_optional_text(cls, value: str | None):
        return _strip_optional(value)


class PrintBatchOrderUpdate(BaseModel):
    name: str | None = None
    due_date: datetime | None = None
    notes: str | None = None
    project_id: int | None = Field(default=None, ge=1)
    customer_label: str | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)
    status: Literal["draft", "active", "running", "paused", "completed", "cancelled"] | None = None

    @field_validator("name")
    @classmethod
    def validate_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Order name cannot be empty")
        return value

    @field_validator("notes", "customer_label", mode="before")
    @classmethod
    def strip_optional_update_text(cls, value: str | None):
        return _strip_optional(value)


class PrintBatchDispatchRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)


class PrintBatchConfigDispatchRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)


class PrintBatchDispatchResponse(BaseModel):
    created_queue_item_ids: list[int]
    created_count: int
    remaining_to_dispatch: int


class PrintBatchPlateConfigCreate(BaseModel):
    plate_index: int = Field(ge=1)
    config_code: str | None = None
    name: str | None = None
    quantity_target: int = Field(default=0, ge=0)
    priority: int = Field(default=100, ge=1, le=1000)
    notes: str | None = None
    required_printer_type: str | None = None
    required_printer_model: str | None = None
    required_nozzle_diameter_mm: float | None = Field(default=None, ge=0)
    required_tool_position: str | None = None
    required_nozzle_count: int | None = Field(default=None, ge=1)
    seed_slots_from_plate: bool = True

    @field_validator(
        "config_code",
        "name",
        "notes",
        "required_printer_type",
        "required_printer_model",
        "required_tool_position",
        mode="before",
    )
    @classmethod
    def strip_optional_config_fields(cls, value: str | None):
        return _strip_optional(value)

    @field_validator("config_code")
    @classmethod
    def validate_config_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not CONFIG_CODE_RE.fullmatch(value):
            raise ValueError("config_code must be 1-16 chars [A-Za-z0-9_-]")
        return value


class PrintBatchPlateConfigUpdate(BaseModel):
    name: str | None = None
    quantity_target: int | None = Field(default=None, ge=0)
    priority: int | None = Field(default=None, ge=1, le=1000)
    notes: str | None = None
    status: Literal["active", "paused", "completed", "cancelled"] | None = None
    required_printer_type: str | None = None
    required_printer_model: str | None = None
    required_nozzle_diameter_mm: float | None = Field(default=None, ge=0)
    required_tool_position: str | None = None
    required_nozzle_count: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def validate_optional_config_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Config name cannot be empty")
        return value

    @field_validator(
        "notes",
        "required_printer_type",
        "required_printer_model",
        "required_tool_position",
        mode="before",
    )
    @classmethod
    def strip_optional_config_update_fields(cls, value: str | None):
        return _strip_optional(value)


class PrintBatchPlateConfigSlotInput(BaseModel):
    slot_index: int = Field(ge=1)
    material_type: str | None = None
    color_hex: str | None = None
    color_family: str | None = None
    brand_name: str | None = None
    filament_name: str | None = None
    nozzle_assignment: str | None = None
    metadata_json: dict | None = None

    @field_validator(
        "material_type",
        "color_hex",
        "color_family",
        "brand_name",
        "filament_name",
        "nozzle_assignment",
        mode="before",
    )
    @classmethod
    def strip_optional_slot_fields(cls, value: str | None):
        return _strip_optional(value)

    @field_validator("color_hex")
    @classmethod
    def validate_color_hex(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not HEX_COLOR_RE.fullmatch(value):
            raise ValueError("color_hex must be a 6-digit hex color (#RRGGBB)")
        return value


class PrintBatchPlateConfigSlotsReplace(BaseModel):
    slots: list[PrintBatchPlateConfigSlotInput]

    @model_validator(mode="after")
    def validate_unique_slots(self):
        seen: set[int] = set()
        for slot in self.slots:
            if slot.slot_index in seen:
                raise ValueError(f"Duplicate slot_index {slot.slot_index}")
            seen.add(slot.slot_index)
        return self


class PrintBatchPlateConfigSlotResponse(BaseModel):
    id: int
    slot_index: int
    material_type: str | None = None
    color_hex: str | None = None
    color_family: str | None = None
    brand_name: str | None = None
    filament_name: str | None = None
    nozzle_assignment: str | None = None
    metadata_json: dict | None = None

    class Config:
        from_attributes = True


class PrintBatchConfigProgress(BaseModel):
    queued_runs: int = 0
    printing_runs: int = 0
    completed_runs: int = 0
    failed_runs: int = 0
    cancelled_runs: int = 0
    dispatched_non_cancelled: int = 0
    remaining_to_dispatch: int = 0
    remaining_to_complete: int = 0


class PrintBatchPlateConfigResponse(BaseModel):
    id: int
    batch_plate_id: int
    config_code: str
    name: str | None = None
    quantity_target: int
    priority: int
    status: str
    notes: str | None = None
    required_printer_type: str | None = None
    required_printer_model: str | None = None
    required_nozzle_diameter_mm: float | None = None
    required_tool_position: str | None = None
    required_nozzle_count: int | None = None
    slots: list[PrintBatchPlateConfigSlotResponse] = []
    progress: PrintBatchConfigProgress = Field(default_factory=PrintBatchConfigProgress)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PrintBatchPlateResponse(BaseModel):
    id: int
    plate_index: int
    plate_name: str | None = None
    plate_fingerprint: str | None = None
    object_count: int
    estimated_duration_sec: int | None = None
    estimated_filament_grams: float | None = None
    plate_metadata_snapshot: dict
    configs: list[PrintBatchPlateConfigResponse] = []

    class Config:
        from_attributes = True


class PrintBatchOrderListItem(BaseModel):
    id: int
    name: str
    source_library_file_id: int | None = None
    source_file_name: str
    status: str
    priority: int
    due_date: datetime | None = None
    project_id: int | None = None
    customer_label: str | None = None
    created_at: datetime
    updated_at: datetime
    plate_count: int = 0
    config_count: int = 0
    total_quantity_target: int = 0
    total_remaining_to_dispatch: int = 0
    total_completed_runs: int = 0


class PrintBatchOrderDetailResponse(BaseModel):
    id: int
    name: str
    source_library_file_id: int | None = None
    source_file_name: str
    source_file_hash: str | None = None
    source_metadata_snapshot: dict
    status: str
    dispatch_mode: str
    priority: int
    plan_revision: int
    due_date: datetime | None = None
    notes: str | None = None
    project_id: int | None = None
    customer_label: str | None = None
    created_at: datetime
    updated_at: datetime
    plates: list[PrintBatchPlateResponse]
    progress_summary: dict


class PrintBatchQueuePreview(BaseModel):
    id: int
    status: str
    plate_id: int | None = None
    batch_plate_config_id: int | None = None
    position: int
    created_at: datetime
