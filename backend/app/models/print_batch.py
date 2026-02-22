from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base


class PrintBatch(Base):
    """Planning-first batch/order header linked to a single library file."""

    __tablename__ = "print_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','active','running','paused','completed','cancelled')", name="ck_print_batches_status"
        ),
        Index("idx_print_batches_status_due", "status", "due_date"),
        Index("idx_print_batches_source_file", "source_library_file_id"),
        Index("idx_print_batches_project", "project_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))

    source_library_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_files.id", ondelete="SET NULL"), nullable=True
    )
    source_file_name: Mapped[str] = mapped_column(String(255))
    source_file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_metadata_snapshot: Mapped[dict] = mapped_column(JSON)

    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    customer_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="draft")
    dispatch_mode: Mapped[str] = mapped_column(String(20), default="manual")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    plan_revision: Mapped[int] = mapped_column(Integer, default=1)

    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    source_library_file: Mapped["LibraryFile | None"] = relationship()
    project: Mapped["Project | None"] = relationship()
    owner_user: Mapped["User | None"] = relationship(foreign_keys=[owner_user_id])
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])
    plates: Mapped[list["PrintBatchPlate"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="PrintBatchPlate.plate_index",
    )


class PrintBatchPlate(Base):
    """Per-plate snapshot extracted from the source 3MF metadata."""

    __tablename__ = "print_batch_plates"
    __table_args__ = (
        UniqueConstraint("batch_id", "plate_index", name="uq_print_batch_plates_batch_plate_index"),
        CheckConstraint("plate_index >= 0", name="ck_print_batch_plates_plate_index"),
        CheckConstraint("object_count >= 0", name="ck_print_batch_plates_object_count"),
        Index("idx_print_batch_plates_batch", "batch_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("print_batches.id", ondelete="CASCADE"))

    plate_index: Mapped[int] = mapped_column(Integer)
    plate_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    plate_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    object_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_filament_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    plate_metadata_snapshot: Mapped[dict] = mapped_column(JSON)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    batch: Mapped["PrintBatch"] = relationship(back_populates="plates")
    configs: Mapped[list["PrintBatchPlateConfig"]] = relationship(
        back_populates="batch_plate",
        cascade="all, delete-orphan",
        order_by="PrintBatchPlateConfig.config_code",
    )


class PrintBatchPlateConfig(Base):
    """Configurable outcome target for a specific source plate."""

    __tablename__ = "print_batch_plate_configs"
    __table_args__ = (
        UniqueConstraint("batch_plate_id", "config_code", name="uq_print_batch_plate_configs_plate_code"),
        CheckConstraint("quantity_target >= 0", name="ck_print_batch_plate_configs_quantity_target"),
        CheckConstraint("priority >= 1 AND priority <= 1000", name="ck_print_batch_plate_configs_priority"),
        CheckConstraint(
            "status IN ('active','paused','completed','cancelled')", name="ck_print_batch_plate_configs_status"
        ),
        Index("idx_batch_configs_plate", "batch_plate_id"),
        Index("idx_batch_configs_status_priority", "status", "priority"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_plate_id: Mapped[int] = mapped_column(ForeignKey("print_batch_plates.id", ondelete="CASCADE"))

    config_code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity_target: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    status: Mapped[str] = mapped_column(String(20), default="active")

    required_printer_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_printer_model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_nozzle_diameter_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_tool_position: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_nozzle_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    batch_plate: Mapped["PrintBatchPlate"] = relationship(back_populates="configs")
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped["User | None"] = relationship(foreign_keys=[updated_by_id])
    slots: Mapped[list["PrintBatchPlateConfigSlot"]] = relationship(
        back_populates="config",
        cascade="all, delete-orphan",
        order_by="PrintBatchPlateConfigSlot.slot_index",
    )


class PrintBatchPlateConfigSlot(Base):
    """Explicit per-slot material/color mapping for a plate config (MVP)."""

    __tablename__ = "print_batch_plate_config_slots"
    __table_args__ = (
        UniqueConstraint("batch_plate_config_id", "slot_index", name="uq_print_batch_config_slots_slot"),
        CheckConstraint("slot_index >= 1", name="ck_print_batch_config_slots_slot_index"),
        Index("idx_print_batch_config_slots_config", "batch_plate_config_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_plate_config_id: Mapped[int] = mapped_column(ForeignKey("print_batch_plate_configs.id", ondelete="CASCADE"))
    slot_index: Mapped[int] = mapped_column(Integer)

    material_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_hex: Mapped[str | None] = mapped_column(String(16), nullable=True)
    color_family: Mapped[str | None] = mapped_column(String(32), nullable=True)
    brand_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    filament_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nozzle_assignment: Mapped[str | None] = mapped_column(String(50), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    config: Mapped["PrintBatchPlateConfig"] = relationship(back_populates="slots")


from backend.app.models.library import LibraryFile  # noqa: E402,F401
from backend.app.models.project import Project  # noqa: E402,F401
from backend.app.models.user import User  # noqa: E402,F401
