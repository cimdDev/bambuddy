# Batch / Order Plan Layer Technical Design (Bambuddy)

This document defines the missing `Plan` layer above `PrintQueueItem` for production scheduling of multi-plate files.

Scope intentionally covers:
- Mid-level implementation (production feature)
- High-end implementation (farm automation + advanced accounting)

---

## A - Current Architecture Mapping

### Confirmed models and responsibilities

| Concept | Current model(s) | Current responsibility |
|---|---|---|
| Asset | `LibraryFile` | Stores 3MF/G-code file info, metadata snapshot, project link, creator, notes |
| Dispatch | `PrintQueueItem` | Queue intent: printer targeting, mapping fields, lifecycle state, scheduling |
| Run | `PrintArchive` | Immutable-ish run result storage: status, timing, cost, energy, extra data |
| Project context | `Project` | High-level grouping and due/status metadata |
| Printer/material state | `Printer`, `Spool`, `SpoolAssignment`, `Filament` | Live capability + loaded filament state |

### Plate metadata representation

Plate data is already extractable from library/archive routes (`/plates`, `/filament-requirements`) and includes:
- `plate index`, `name`, object metadata
- `print_time_seconds`
- `filament_used_grams`
- filament entries with slot-level hints (`slot_id`, `tray_info_idx`, material/color attributes)

This is sufficient to seed plan-layer plate/config rows.

### Cost storage and lifecycle facts

- Primary stored runtime cost is on `PrintArchive` (`cost`, plus energy fields).
- Queue item lifecycle currently drives dispatch and completion updates.
- Status values in runtime include failure-like outcomes (`failed`, `aborted`) that should be normalized in batch aggregation.

### Mapping to conceptual layers

- `Asset` = `LibraryFile`
- `Plan` = **missing** (to be introduced as `PrintBatch*` tables)
- `Dispatch` = existing queue + scheduler
- `Run` = archive + logs

### Constraints and extension points

- Keep queue engine additive; do not replace current scheduling core.
- Introduce batch foreign keys on queue items.
- Derive plan progress from queue/archive; do not duplicate run truth.
- Use additive schema migration style compatible with existing SQLite migration approach.

---

## B - Domain Model Design

### Core entities

- `PrintBatch` (Order header)
- `PrintBatchPlate` (plate entry extracted from file metadata)
- `PrintBatchPlateConfig` (one-or-more configurations per plate)
- `PrintBatchConfigMaterialMap` (slot -> material/color mapping)
- `PrintBatchAssignment` (user assignment, batch-level and optional config-level)

### Required capabilities

- Multiple configurations per plate
- Independent quantity/progress/cost per configuration
- Editable targets while running
- Safe reconcile for not-started queue rows only
- Optional printer model/type constraints per configuration
- Assignment of owner/operators/planners

### Conceptual ER

- `LibraryFile 1..N PrintBatch`
- `PrintBatch 1..N PrintBatchPlate`
- `PrintBatchPlate 1..N PrintBatchPlateConfig`
- `PrintBatchPlateConfig 1..N PrintBatchConfigMaterialMap`
- `PrintBatchPlateConfig 1..N PrintQueueItem`
- `PrintBatch N..M User` through `PrintBatchAssignment`

---

## C - Database Schema (Core Deliverable)

All changes are additive.

### 1) `print_batches`

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto | Primary key |
| `name` | TEXT | No |  | Batch/order name |
| `library_file_id` | INTEGER | Yes | NULL | FK -> `library_files.id` ON DELETE SET NULL |
| `source_file_name` | TEXT | No |  | Immutable source reference |
| `source_file_hash` | TEXT | Yes | NULL | Detect source drift |
| `source_file_metadata_snapshot` | TEXT (JSON) | No |  | Plate metadata at creation |
| `project_id` | INTEGER | Yes | NULL | FK -> `projects.id` ON DELETE SET NULL |
| `customer_label` | TEXT | Yes | NULL | Optional customer |
| `status` | TEXT | No | `draft` | `draft/planned/active/paused/completed/cancelled/deleted` |
| `dispatch_mode` | TEXT | No | `auto` | `auto/manual` |
| `auto_reconcile` | INTEGER | No | `1` | bool (0/1) |
| `due_date` | DATETIME | Yes | NULL | Optional due date |
| `notes` | TEXT | Yes | NULL | Editable during execution |
| `plan_revision` | INTEGER | No | `1` | Optimistic concurrency token |
| `owner_user_id` | INTEGER | No |  | FK -> `users.id`, primary owner assignment |
| `created_by_id` | INTEGER | No |  | FK -> `users.id` |
| `updated_by_id` | INTEGER | Yes | NULL | FK -> `users.id` ON DELETE SET NULL |
| `started_at` | DATETIME | Yes | NULL | First dispatch/start |
| `completed_at` | DATETIME | Yes | NULL | Completion marker |
| `cancelled_at` | DATETIME | Yes | NULL | Cancellation marker |
| `deleted_at` | DATETIME | Yes | NULL | Soft delete |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Indexes:
- `(status, due_date)`
- `(owner_user_id, status)`
- `(project_id)`
- `(library_file_id)`
- `(deleted_at)`

### 2) `print_batch_assignments` (user assignment)

Supports both batch-level and configuration-level assignment.

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_id` | INTEGER | No |  | FK -> `print_batches.id` ON DELETE CASCADE |
| `batch_plate_config_id` | INTEGER | Yes | NULL | FK -> `print_batch_plate_configs.id` ON DELETE CASCADE |
| `user_id` | INTEGER | No |  | FK -> `users.id` ON DELETE RESTRICT |
| `role` | TEXT | No | `operator` | `owner/planner/operator/viewer/accounting` |
| `is_primary` | INTEGER | No | `0` | bool (0/1) |
| `assigned_by_id` | INTEGER | Yes | NULL | FK -> `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/Indexes:
- Unique batch-level: `(batch_id, user_id, role)` when `batch_plate_config_id IS NULL`
- Unique config-level: `(batch_plate_config_id, user_id, role)` when `batch_plate_config_id IS NOT NULL`
- Index `(batch_id, role)`
- Index `(user_id, role)`

### 3) `print_batch_plates`

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_id` | INTEGER | No |  | FK -> `print_batches.id` ON DELETE CASCADE |
| `plate_index` | INTEGER | No |  | Stable index from source metadata |
| `plate_name` | TEXT | Yes | NULL | Display name |
| `is_required` | INTEGER | No | `1` | bool (supports explicit non-required plates) |
| `object_count` | INTEGER | No | `0` | For planning/UI |
| `estimated_duration_sec` | INTEGER | Yes | NULL | Optional baseline |
| `estimated_filament_grams` | REAL | Yes | NULL | Optional baseline |
| `plate_metadata_snapshot` | TEXT (JSON) | No |  | Immutable per-plate snapshot |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/Indexes:
- Unique `(batch_id, plate_index)`
- Index `(batch_id)`

### 4) `print_batch_plate_configs`

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_plate_id` | INTEGER | No |  | FK -> `print_batch_plates.id` ON DELETE CASCADE |
| `config_code` | TEXT | No |  | Stable code (`A`, `B`, etc.) |
| `name` | TEXT | Yes | NULL | Friendly name |
| `quantity_target` | INTEGER | No | `0` | Required successful run count |
| `priority` | INTEGER | No | `100` | Dispatch priority |
| `status` | TEXT | No | `active` | `active/paused/completed/cancelled` |
| `printer_model_target` | TEXT | Yes | NULL | Optional exact model target |
| `printer_type_constraint` | TEXT | Yes | NULL | Optional family/type |
| `allow_color_substitution` | INTEGER | No | `0` | bool |
| `estimate_unit_cost` | REAL | Yes | NULL | Per-run estimate |
| `estimate_unit_duration_sec` | INTEGER | Yes | NULL | Per-run estimate |
| `notes` | TEXT | Yes | NULL | Planner note |
| `created_by_id` | INTEGER | No |  | FK -> `users.id` |
| `updated_by_id` | INTEGER | Yes | NULL | FK -> `users.id` |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/Indexes:
- Unique `(batch_plate_id, config_code)`
- Index `(batch_plate_id)`
- Index `(status, priority)`
- Index `(printer_model_target, printer_type_constraint)`

### 5) `print_batch_config_material_maps`

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_plate_config_id` | INTEGER | No |  | FK -> `print_batch_plate_configs.id` ON DELETE CASCADE |
| `slot_no` | INTEGER | No |  | Slot number |
| `nozzle_id` | INTEGER | Yes | NULL | For multi-nozzle devices |
| `material_type` | TEXT | Yes | NULL | Material requirement |
| `filament_id` | INTEGER | Yes | NULL | FK -> `filaments.id` ON DELETE SET NULL |
| `color_hex` | TEXT | Yes | NULL | Color requirement |
| `color_name` | TEXT | Yes | NULL | UI label |
| `tray_info_idx` | INTEGER | Yes | NULL | Bambu tray hint |
| `match_mode` | TEXT | No | `exact` | `exact/type_only/color_family` |
| `is_required` | INTEGER | No | `1` | bool |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/Indexes:
- Unique `(batch_plate_config_id, slot_no, nozzle_id)`
- Index `(batch_plate_config_id)`
- Index `(material_type, color_hex)`

### 6) `print_queue_items` additions

| Field | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `batch_id` | INTEGER | Yes | NULL | FK -> `print_batches.id` ON DELETE SET NULL |
| `batch_plate_id` | INTEGER | Yes | NULL | FK -> `print_batch_plates.id` ON DELETE SET NULL |
| `batch_plate_config_id` | INTEGER | Yes | NULL | FK -> `print_batch_plate_configs.id` ON DELETE SET NULL |
| `batch_plan_revision` | INTEGER | Yes | NULL | Revision used at queue generation time |
| `batch_dispatch_seq` | INTEGER | Yes | NULL | Order inside batch dispatch |
| `assigned_operator_user_id` | INTEGER | Yes | NULL | FK -> `users.id` ON DELETE SET NULL |
| `batch_reconcile_state` | TEXT | Yes | NULL | `normal/cancelled_by_reconcile/manual_override` |

Indexes:
- `(batch_id, status, created_at)`
- `(batch_plate_config_id, status, created_at)`
- `(assigned_operator_user_id, status)`

### Example records

```json
{
  "print_batches": {
    "id": 101,
    "name": "Order-ACME-221",
    "library_file_id": 55,
    "source_file_name": "widget.gcode.3mf",
    "status": "active",
    "dispatch_mode": "auto",
    "owner_user_id": 7,
    "plan_revision": 3
  },
  "print_batch_assignments": [
    { "batch_id": 101, "user_id": 7, "role": "owner", "is_primary": 1 },
    { "batch_id": 101, "user_id": 9, "role": "operator", "is_primary": 1 }
  ],
  "print_batch_plates": [
    { "id": 201, "batch_id": 101, "plate_index": 1, "plate_name": "Plate 1" }
  ],
  "print_batch_plate_configs": [
    { "id": 301, "batch_plate_id": 201, "config_code": "A", "quantity_target": 5 },
    { "id": 302, "batch_plate_id": 201, "config_code": "B", "quantity_target": 2 }
  ],
  "print_batch_config_material_maps": [
    { "batch_plate_config_id": 301, "slot_no": 1, "material_type": "PLA", "color_hex": "#FF0000" },
    { "batch_plate_config_id": 301, "slot_no": 2, "material_type": "PLA", "color_hex": "#0000FF" }
  ]
}
```

---

## D - Progress and Cost Aggregation Model

### Progress computation

For each config:

- `completed_runs = count(queue where status='completed')`
- `failed_runs = count(queue where status in ('failed','aborted'))`
- `running_runs = count(queue where status='printing')`
- `queued_runs = count(queue where status='pending')`
- `remaining_runs = max(quantity_target - completed_runs, 0)`
- `dispatch_gap = max(remaining_runs - running_runs - queued_runs, 0)`
- `percent_complete = (completed_runs / quantity_target) * 100` (or 100 when target is 0)

Plate and batch metrics are sums of config metrics.

### Cost computation

Stored:
- `estimate_unit_cost` on config
- actual cost fields in `PrintArchive` (`cost`, optional `energy_cost`)

Derived:
- `completed_cost = sum(archive.cost + coalesce(archive.energy_cost,0))` for completed runs
- `failure_cost = sum(archive.cost + coalesce(archive.energy_cost,0))` for failed/aborted runs
- `remaining_estimate = remaining_runs * estimate_unit_cost`
- `total_estimate = completed_cost + failure_cost + remaining_estimate`

### Store vs derive guidance

- Store plan inputs + immutable snapshots.
- Derive progress/cost rollups from queue/archive for correctness.
- If performance degrades, add a summary/materialized rollup table updated by queue/archive events.

### Per-object accounting (advanced)

Feasibility:
- Only feasible when object-level material/time attribution is available and stable.

Complexity:
- Requires additional object entity mapping and allocation strategy.
- Increases reconciliation and reporting complexity significantly.

Recommended approach:
- MID: plate-level accounting only.
- HIGH: optional object allocation model with explicit policy (`equal`, `volume_ratio`, `slicer_weight`).

---

## E - Dispatch & Reconciliation Engine

### Auto mode (`dispatch_mode=auto`)

1. Trigger reconcile on batch/config edits, queue status changes, or run completion.
2. Compute `dispatch_gap` per active config.
3. Create pending queue rows for gap count, with batch references and revision.
4. Do not alter running/completed rows.

### Manual/staged mode (`dispatch_mode=manual`)

1. User selects configs and dispatch quantity from batch UI.
2. API validates requested counts.
3. Creates only requested pending queue items.

### Quantity edits while running

1. Increment `plan_revision`.
2. Recompute config demand.
3. If target increased: add pending rows (auto mode) or wait (manual mode).
4. If target decreased: cancel oldest pending rows first.
5. Never touch `printing` or completed history.

### Cancel/delete/file-change handling

- Cancel remaining: set config/batch status to cancelled and cancel pending rows.
- Delete batch: soft-delete preferred; pending queue rows cancelled; historical runs preserved.
- Source file change: detect via `source_file_hash`; flag batch for explicit rebase action, never silent mutation.

---

## F - Printer Compatibility & Farm Automation (High-End)

### Matching inputs

- Printer capability: model/type/nozzle/AMS capacity
- Current loaded materials/colors from slot assignments
- Config material map constraints and policy
- Optional printer pool constraints

### Matching algorithm

1. Build idle/available candidate printer set.
2. Hard filter by model/type/pool/required slots.
3. Score candidates:
   - exact material+color slot match
   - exact material type match
   - substitution rules if enabled
   - load balancing / fairness
4. Reserve selected printer briefly to avoid races.
5. Assign and dispatch queue row.
6. If no fit, leave pending with clear waiting reason.

### Additional high-end structures

- `printer_pools`
- `printer_pool_members`
- `print_batch_config_printer_pools`
- `print_batch_dispatch_reservations`

---

## G - UI / UX Workflow Design

### 1) Batch List Page
- Columns: Name, Due, Status, Owner, Assignees, Mode, Progress, Remaining, Cost
- Filters: status, owner/assignee, project, customer, due range

### 2) Create Batch Dialog
- Select library file
- Auto-load plate metadata
- Set name/due/customer/project/owner/assignees/mode

### 3) Batch Detail Page
- Editable header while active
- Global progress/cost summary
- Tabs: Plates, Queue, Cost, Activity, Assignments

### 4) Plate Configuration Editor
- Per-plate cards
- Add/clone/remove configurations
- Quantity, constraints, slot mapping editor
- Assignment per config (optional)

### 5) Dispatch Controls
- Auto reconcile toggle
- Manual dispatch action with per-config quantity input

### 6) Progress Visualization
- Config bars: completed/failed/running/queued/remaining
- Plate and batch rollups

### 7) Queue Integration
- Batch badge on queue rows
- Deep link to batch detail
- Show operator assignment and plan revision

### 8) Editing While Running UX
- Diff/impact preview before save (added pending / cancelled pending)
- Explicit confirmation for reduction-induced cancellations
- Conflict warning on stale revision

### 9) High-End Farm Controls
- Printer pool selector
- Match strictness policies
- Live candidate/mismatch diagnostics

---

## H - MID vs HIGH Implementation Tiers

## MID IMPLEMENTATION

Scope:
- Core batch tables + user assignment
- Multi-config per plate
- Auto/manual dispatch + safe reconciliation
- Progress/cost rollups from queue/archive

Data model:
- `print_batches`
- `print_batch_assignments`
- `print_batch_plates`
- `print_batch_plate_configs`
- `print_batch_config_material_maps`
- queue FK additions

API:
- CRUD for batches/plates/configs
- dispatch/reconcile endpoints
- assignment endpoints
- progress/cost endpoints

UI complexity: medium

Risks:
- race conditions without strict transaction handling
- lifecycle status normalization (`aborted`)

Migration difficulty: low-medium

Estimated effort: 6-10 weeks (2 engineers)

## HIGH IMPLEMENTATION

Scope:
- Farm-scale matching and auto-assignment
- Pool-aware dispatch
- Reservation and conflict controls
- Optional per-object accounting

Data model additions:
- pool + reservation tables
- optional object-accounting tables

API:
- pool/policy management
- auto-map simulation and diagnostics
- reservation introspection

UI complexity: high

Risks:
- mapping correctness and explainability
- increased operational complexity

Migration difficulty: medium-high

Estimated effort: 14-24 weeks (2-3 engineers)

---

## I - Implementation Roadmap

### Phase 1
- Add schema for core plan layer and user assignments
- Implement batch CRUD + config editor APIs
- Implement manual dispatch
- Add basic batch UI pages

### Phase 2
- Implement auto reconcile engine
- Add safe quantity-change behavior while running
- Add full progress/cost rollups and assignment UX
- Add concurrency guards (`plan_revision`)

### Phase 3
- Implement high-end printer pool matching + reservations
- Add automation controls and diagnostics
- Add optional per-object accounting

---

## J - Risks and Edge Cases

- Concurrency: protect reconcile with transactions and revision checks.
- Multi-user edits: optimistic locking + conflict handling.
- Partial failures: rollback partial queue generation/cancellation.
- Printer offline: preserve pending queue items with waiting reason.
- Quantity reduction while jobs run: allow overrun only from already-running jobs.
- Source metadata changes: explicit rebase flow, never implicit destructive changes.
- Migration safety: additive migration only; backfill nullable fields carefully.
- Assignment integrity: avoid hard-deleting users referenced by historical batches/runs.
- Status mismatch: normalize `failed` + `aborted` together in batch failure metrics.

---

## Recommended Default Implementation Path

Start with MID implementation including user assignment and slot-based configuration mapping. Keep queue and archive as operational truth. Add high-end automation incrementally behind explicit policy toggles after core reconciliation and accounting are stable.
