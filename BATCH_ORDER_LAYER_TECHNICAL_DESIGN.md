# Batch / Order Plan Layer Technical Design (Bambuddy) - Refined Draft

This document defines the missing `Plan` layer above `PrintQueueItem` for production scheduling of multi-plate files.

Scope intentionally covers:
- Mid-level implementation (production feature)
- High-end implementation (farm automation + advanced accounting)

Core principle:
- `Batch` is planning state, not execution ownership.
- Batch describes "what is needed" (quantities and requirements).
- Queue and scheduler decide "how/when/where" execution happens.

---

## A - Current Architecture Mapping

### Confirmed models and responsibilities

| Concept | Current model(s) | Current responsibility |
|---|---|---|
| Asset | `LibraryFile` | Stores file and metadata (`file_metadata`) plus project linkage |
| Dispatch | `PrintQueueItem` + scheduler | Queue authority for dispatch timing and printer assignment |
| Run | `PrintArchive` | Run result, cost/energy, completion status, runtime data |
| Project context | `Project` | Optional business grouping and due/status context |
| Printer/material state | `Printer`, `Spool`, `SpoolAssignment`, `Filament` | Available hardware/material state for matching |

### 3MF metadata location and normalization

Current state:
- Canonical asset metadata is closest to `library_files.file_metadata`.
- Queue stores execution references (`library_file_id`, `archive_id`, `plate_id`, mappings) but is not canonical metadata storage.
- Archive stores run-time result snapshots (`extra_data`, parsed plate/filament output).

Assessment:
- Current structure is usable for MID without invasive refactor.
- There is no strict canonical artifact identity across file revisions and re-slices.

Pragmatic recommendation:
- MID: store `source_file_hash` + metadata snapshot on batch and plate rows.
- HIGH (optional): introduce `SlicerArtifact` (`artifact_id`, `artifact_hash`, normalized plates/objects), with `LibraryFile` as storage/reference.

### Mapping to conceptual layers

- `Asset` = `LibraryFile` (+ optional future `SlicerArtifact`)
- `Plan` = new `PrintBatch*` entities
- `Dispatch` = existing queue/scheduler authority
- `Run` = archive/logs/event callbacks

### Constraints and extension points

- Additive architecture only; no rewrite of queue scheduler.
- Printer matching logic must live in queue/scheduler and be reusable by batch and non-batch jobs.
- Batch captures declarative requirements, not slot-level hardware mapping.
- Keep migrations SQLite-safe and additive.

---

## B - Domain Model Design

### Core entities (refined)

- `PrintBatch` (order header and planning controls)
- `PrintBatchPlate` (plate snapshot from source metadata)
- `PrintBatchPlateConfig` (quantity + compatibility requirement profile)
- `PrintBatchConfigRequirements` (declarative material/color requirements, no physical slot binding)
- `PrintBatchRunLinks` (manual/external mapping of completed runs to configs)

Removed from MID:
- Complex multi-user assignment table
- Batch-level slot mapping table
- Pool ownership inside batch module

### Required capabilities

- Multiple configurations per plate with independent quantity/progress/cost
- Editable while running (safe reconcile on pending items only)
- Queue-owned printer assignment with generic matching inputs:
  - printer type/model
  - material and color requirements
  - nozzle configuration, tool position, nozzle diameter
- Ownership + visibility:
  - owner/creator only
  - visibility model (`private` vs `shared`)
- External and manual correction path:
  - attach completed jobs to batch configs after the fact

### Batch lifecycle states

- `draft`
- `active`
- `running`
- `paused`
- `completed`
- `cancelled`

### Conceptual ER

- `LibraryFile 1..N PrintBatch`
- `PrintBatch 1..N PrintBatchPlate`
- `PrintBatchPlate 1..N PrintBatchPlateConfig`
- `PrintBatchPlateConfig 1..N PrintBatchConfigRequirements`
- `PrintBatchPlateConfig 1..N PrintQueueItem`
- `PrintQueueItem 0..1 PrintArchive`
- `PrintArchive N..M PrintBatchPlateConfig` through `PrintBatchRunLinks` (manual/external attach)

---

## C - Database Schema (Core Deliverable)

All changes are additive. Schema is intentionally split between MID core and HIGH optional extensions.

### MID core tables

### 1) `print_batches`

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto | Primary key |
| `name` | TEXT | No |  | Batch name |
| `source_library_file_id` | INTEGER | Yes | NULL | FK -> `library_files.id` ON DELETE SET NULL |
| `source_file_name` | TEXT | No |  | Immutable display snapshot |
| `source_file_hash` | TEXT | Yes | NULL | Identity aid for change detection |
| `source_metadata_snapshot` | TEXT (JSON) | No |  | Original metadata snapshot |
| `source_artifact_key` | TEXT | Yes | NULL | Optional forward-compatible canonical artifact id/hash |
| `project_id` | INTEGER | Yes | NULL | FK -> `projects.id` ON DELETE SET NULL |
| `customer_label` | TEXT | Yes | NULL | Optional business label |
| `status` | TEXT | No | `draft` | CHECK: `draft/active/running/paused/completed/cancelled` |
| `dispatch_mode` | TEXT | No | `manual` | CHECK: `manual/auto` |
| `visibility_scope` | TEXT | No | `private` | CHECK: `private/shared` |
| `owner_user_id` | INTEGER | No |  | FK -> `users.id` ON DELETE RESTRICT |
| `created_by_id` | INTEGER | No |  | FK -> `users.id` ON DELETE RESTRICT |
| `due_date` | DATETIME | Yes | NULL | SLA target |
| `notes` | TEXT | Yes | NULL | Editable while running |
| `plan_revision` | INTEGER | No | `1` | CHECK >= 1 (pragmatic optimistic check) |
| `rebase_policy` | TEXT | No | `locked` | CHECK: `locked/manual_rebase` |
| `external_mapping_policy` | TEXT | No | `suggest_only` | CHECK: `disabled/suggest_only/auto_high_confidence` |
| `unplanned_run_policy` | TEXT | No | `manual_review` | CHECK: `manual_review/auto_create_config/ignore` |
| `started_at` | DATETIME | Yes | NULL | First queue dispatch |
| `completed_at` | DATETIME | Yes | NULL | Completion marker |
| `cancelled_at` | DATETIME | Yes | NULL | Cancellation marker |
| `deleted_at` | DATETIME | Yes | NULL | Soft-delete marker |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Indexes:
- `idx_print_batches_status_due (status, due_date)`
- `idx_print_batches_owner_status (owner_user_id, status)`
- `idx_print_batches_visibility_status (visibility_scope, status)`
- `idx_print_batches_project (project_id)`
- `idx_print_batches_source_file (source_library_file_id)`
- `idx_print_batches_deleted (deleted_at)`

### 2) `print_batch_plates`

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_id` | INTEGER | No |  | FK -> `print_batches.id` ON DELETE CASCADE |
| `plate_index` | INTEGER | No |  | CHECK >= 0 |
| `plate_name` | TEXT | Yes | NULL | Display name |
| `plate_fingerprint` | TEXT | Yes | NULL | Optional hash of plate composition for drift detection |
| `object_count` | INTEGER | No | `0` | CHECK >= 0 |
| `estimated_duration_sec` | INTEGER | Yes | NULL | CHECK >= 0 |
| `estimated_filament_grams` | REAL | Yes | NULL | CHECK >= 0 |
| `plate_metadata_snapshot` | TEXT (JSON) | No |  | Per-plate snapshot |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/indexes:
- UNIQUE `(batch_id, plate_index)`
- `idx_print_batch_plates_batch (batch_id)`

### 3) `print_batch_plate_configs`

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_plate_id` | INTEGER | No |  | FK -> `print_batch_plates.id` ON DELETE CASCADE |
| `config_code` | TEXT | No |  | Stable code per plate (`A`, `B`, ...) |
| `name` | TEXT | Yes | NULL | Friendly name |
| `quantity_target` | INTEGER | No | `0` | CHECK >= 0 |
| `priority` | INTEGER | No | `100` | CHECK between 1 and 1000 |
| `status` | TEXT | No | `active` | CHECK: `active/paused/completed/cancelled` |
| `required_printer_type` | TEXT | Yes | NULL | Declarative requirement |
| `required_printer_model` | TEXT | Yes | NULL | Optional exact model |
| `required_nozzle_diameter_mm` | REAL | Yes | NULL | Optional nozzle diameter |
| `required_tool_position` | TEXT | Yes | NULL | Optional tool/side identifier |
| `required_nozzle_count` | INTEGER | Yes | NULL | Optional minimum nozzle count |
| `default_color_match_tolerance` | TEXT | No | `exact` | CHECK: `exact/family/close` |
| `default_color_distance_threshold` | REAL | Yes | NULL | Optional fuzzy threshold for future color distance logic |
| `estimate_strategy` | TEXT | No | `slicer_metadata` | CHECK: `slicer_metadata/historical_avg/manual_override` |
| `estimate_unit_cost_override` | REAL | Yes | NULL | CHECK >= 0 |
| `estimate_unit_duration_sec_override` | INTEGER | Yes | NULL | CHECK >= 0 |
| `failure_policy` | TEXT | No | `manual` | CHECK: `manual/auto_requeue_once/auto_requeue_until_target` |
| `max_auto_requeues` | INTEGER | Yes | NULL | CHECK >= 0 |
| `notes` | TEXT | Yes | NULL | Planner note |
| `created_by_id` | INTEGER | No |  | FK -> `users.id` ON DELETE RESTRICT |
| `updated_by_id` | INTEGER | Yes | NULL | FK -> `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/indexes:
- UNIQUE `(batch_plate_id, config_code)`
- `idx_batch_configs_plate (batch_plate_id)`
- `idx_batch_configs_status_priority (status, priority)`
- `idx_batch_configs_printer_req (required_printer_type, required_printer_model)`
- `idx_batch_configs_nozzle_req (required_nozzle_diameter_mm, required_tool_position)`

### 4) `print_batch_config_requirements` (renamed; declarative)

This replaces slot-based mapping at the Batch level.

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_plate_config_id` | INTEGER | No |  | FK -> `print_batch_plate_configs.id` ON DELETE CASCADE |
| `requirement_order` | INTEGER | No | `1` | CHECK >= 1 |
| `material_type` | TEXT | Yes | NULL | PLA/PETG/etc |
| `filament_id` | INTEGER | Yes | NULL | Optional FK -> `filaments.id` ON DELETE SET NULL |
| `color_hex` | TEXT | Yes | NULL | Optional exact color token (`#RRGGBB`) |
| `color_family` | TEXT | Yes | NULL | Optional normalized bucket (`red/blue/black/...`) |
| `color_ref_id` | INTEGER | Yes | NULL | Optional FK -> `color_catalog.id` ON DELETE SET NULL |
| `match_tolerance` | TEXT | No | `exact` | CHECK: `exact/family/close` |
| `color_distance_threshold` | REAL | Yes | NULL | Optional future numeric threshold for fuzzy color distance |
| `is_required` | INTEGER | No | `1` | bool (0/1) |
| `metadata_json` | TEXT (JSON) | Yes | NULL | Future extensibility |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/indexes:
- UNIQUE `(batch_plate_config_id, requirement_order)`
- `idx_batch_requirements_config (batch_plate_config_id)`
- `idx_batch_requirements_material_color (material_type, color_family)`
- `idx_batch_requirements_color_ref (color_ref_id, match_tolerance)`

### 5) `print_batch_run_links` (manual/external corrections)

Used for:
- external printer starts not originating from queue
- manual corrections when mapping is wrong or missing

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `id` | INTEGER PK | No | auto |  |
| `batch_id` | INTEGER | No |  | FK -> `print_batches.id` ON DELETE CASCADE |
| `batch_plate_config_id` | INTEGER | No |  | FK -> `print_batch_plate_configs.id` ON DELETE CASCADE |
| `queue_item_id` | INTEGER | Yes | NULL | FK -> `print_queue_items.id` ON DELETE SET NULL |
| `archive_id` | INTEGER | No |  | FK -> `print_archives.id` ON DELETE CASCADE |
| `mapping_source` | TEXT | No | `manual` | CHECK: `queue_direct/manual/auto_external/suggested_confirmed` |
| `confidence_score` | REAL | Yes | NULL | CHECK between 0 and 1 |
| `mapped_by_user_id` | INTEGER | Yes | NULL | FK -> `users.id` ON DELETE SET NULL |
| `mapping_notes` | TEXT | Yes | NULL | Operator note |
| `created_at` | DATETIME | No | CURRENT_TIMESTAMP |  |
| `updated_at` | DATETIME | No | CURRENT_TIMESTAMP |  |

Constraints/indexes:
- UNIQUE `(archive_id, batch_plate_config_id)`
- `idx_batch_run_links_config (batch_plate_config_id)`
- `idx_batch_run_links_archive (archive_id)`
- `idx_batch_run_links_source (mapping_source, confidence_score)`

### 6) `print_queue_items` additions (batch + generic matching hooks)

| Field | Type | Null | Default | Constraints / Notes |
|---|---|---:|---|---|
| `batch_id` | INTEGER | Yes | NULL | FK -> `print_batches.id` ON DELETE SET NULL |
| `batch_plate_id` | INTEGER | Yes | NULL | FK -> `print_batch_plates.id` ON DELETE SET NULL |
| `batch_plate_config_id` | INTEGER | Yes | NULL | FK -> `print_batch_plate_configs.id` ON DELETE SET NULL |
| `batch_plan_revision` | INTEGER | Yes | NULL | Revision at queue generation |
| `batch_dispatch_seq` | INTEGER | Yes | NULL | Dispatch ordering |
| `matching_requirements_json` | TEXT (JSON) | Yes | NULL | Generic queue matcher input for batch and non-batch jobs |
| `execution_mapping_json` | TEXT (JSON) | Yes | NULL | Dispatch-time resolved mapping (tool/nozzle/slot/tray) produced by queue matcher |
| `matching_diagnostics_json` | TEXT (JSON) | Yes | NULL | Why matched / why pending |
| `batch_reconcile_state` | TEXT | Yes | NULL | CHECK: `normal/cancelled_by_reconcile/manual_override` |

Indexes:
- `idx_queue_batch_status_created (batch_id, status, created_at)`
- `idx_queue_batch_config_status_created (batch_plate_config_id, status, created_at)`
- `idx_queue_matching_pending (status, target_model, scheduled_time)`

### Optional performance table (planned early, can be deferred)

`print_batch_config_stats`
- `batch_plate_config_id` PK/FK
- `completed_runs`, `failed_runs`, `running_runs`, `queued_runs`, `remaining_runs`
- `completed_cost`, `failure_cost`, `remaining_estimate`
- `last_recalc_at`, `updated_at`

This supports farm-scale dashboards without repeated heavy joins.

### Migration impact from previous draft

Added:
- `visibility_scope`, `external_mapping_policy`, `unplanned_run_policy` on `print_batches`
- `print_batch_run_links`
- queue matcher hooks (`matching_requirements_json`, `execution_mapping_json`, diagnostics)

Modified:
- `print_batch_config_material_maps` -> `print_batch_config_requirements` (no slot columns)
- `print_batch_plate_configs` extended for nozzle/tool/failure/cost strategy controls
- color matching fields changed to support future fuzzy matching (`color_family`, tolerance, optional `color_ref_id`)

Removed from MID:
- `print_batch_assignments`
- `assigned_operator_user_id` queue extension
- batch-owned slot mapping semantics

---

## D - Progress and Cost Aggregation Model

### Progress computation

Primary source is queue status for linked config jobs.
Secondary source is `print_batch_run_links` for external/manual attachments.

For each config:
- `completed_runs = completed_queue_runs + completed_external_links`
- `failed_runs = failed_queue_runs + failed_external_links`
- `running_runs = queue(status='printing')`
- `queued_runs = queue(status='pending')`
- `remaining_runs = max(quantity_target - completed_runs, 0)`
- `dispatch_gap = max(remaining_runs - running_runs - queued_runs, 0)`
- `percent_complete = 100 * completed_runs / quantity_target` (or `100` if target `0`)

### Failure recovery behavior

Driven per config by `failure_policy`:
- `manual`: mark failure; operator chooses reprint
- `auto_requeue_once`: one replacement per failed run
- `auto_requeue_until_target`: keep queue filled until target achieved (bounded by `max_auto_requeues` if set)

### Cost model

Stored inputs:
- runtime actuals in `PrintArchive` (`cost`, `energy_cost`)
- config estimate strategy:
  - `slicer_metadata`
  - `historical_avg`
  - `manual_override`

Derived:
- `completed_cost = sum(actual cost for completed runs)`
- `failure_cost = sum(actual cost for failed/aborted runs)`
- `remaining_estimate = remaining_runs * estimate_unit_cost(strategy)`
- `total_estimate = completed_cost + failure_cost + remaining_estimate`

### Performance considerations

Farm scale can produce expensive multi-table aggregation.

Plan:
- MID: indexed live queries
- HIGH: event-updated `print_batch_config_stats` rollups

### Per-object accounting

Unchanged recommendation:
- MID: per-plate/config accounting only
- HIGH: optional per-object allocation after canonical object identity is stable

---

## E - Dispatch & Reconciliation Engine

### Authority split (explicit)

- Batch module: creates/updates declarative demand and generates queue items.
- Queue/scheduler: selects printer and maps actual slots/tools at execution time.

### Auto mode

1. Trigger reconcile on batch/config edits and relevant queue/archive events.
2. Recompute `dispatch_gap` per active config.
3. Create pending queue items with `matching_requirements_json`.
4. Do not pick printer in batch reconcile.

### Manual mode

1. User dispatches quantity from planner/execution UI.
2. Queue items created without fixed slot mapping.
3. Scheduler assigns printer/mapping later.

### Quantity reconciliation strategy

When target decreases:
- Soft-cancel pending excess queue items (status `cancelled`, keep audit).
- Never hard-delete by default.
- Running items are untouched.

Hard delete:
- Admin-only maintenance operation for unstarted draft artifacts, not default reconcile behavior.

If queue item already has a reserved printer:
- release reservation on soft-cancel
- keep run immutable if already printing

### Priority ownership (plan vs dispatch)

- `print_batch_plate_configs.priority` is planning priority (demand ordering during reconcile).
- Queue remains dispatch authority via queue ordering (`position`) and scheduler rules.
- At dispatch generation time, config priority seeds insertion order; later queue reordering does not mutate batch plan priority.

### File revision handling

- Batch remains tied to original snapshot by default (`rebase_policy=locked`).
- Manual "Rebase to latest file revision" workflow computes drift and requires confirmation.
- Plate fingerprint mismatch creates warning and blocks silent rebases.

Rebase UX flow:
1. User clicks `Rebase File Revision`.
2. System shows diff: added/removed/reordered/changed plates and estimated impact on configs.
3. User chooses `keep old snapshot` or `migrate to new revision`.
4. If migrating, system creates a new plan revision and marks unmatched configs for manual review.

### External / unplanned run handling

External starts:
- Default: suggestion-only matching with confidence score.
- Auto-link only when policy allows and confidence is high.
- All unmatched external runs go into an `Unmapped Runs` bucket for operator review.

Unplanned runs (plate/config not in plan):
- Default: manual review + suggested actions.
- Optional policy: auto-create config stub.
- Optional policy: ignore.

### Manual correction

Users can:
- attach archive to config
- detach wrong mapping
- remap and trigger progress recompute

All actions recorded in `print_batch_run_links`.

---

## F - Queue Matching / Auto-assignment Engine (High-End)

### Design principle

Printer matching is a generic queue capability, not batch-specific logic.
Batch never assigns printers. Batch only contributes requirements.

### Matcher interface (queue-level)

Input:
- queue item requirements (from batch config requirements or direct single-job metadata)
- printer capability snapshot (model/type/nozzle/tool availability)
- current loaded filament state (spools/slots/tools)
- policy toggles (strictness, substitution, color tolerance behavior)
- optional pool constraint (HIGH only)

Output:
- assignment proposal (`printer_id`, execution mapping)
- explainability bundle (`matched_on`, `rejected_by`, `waiting_reason`)
- reservation token (to prevent race conditions before start)

### Matching dimensions

- printer model/type
- material compatibility
- color compatibility (exact/category/tolerance)
- nozzle count/configuration
- tool position (`left/right/tool0/tool1`)
- nozzle diameter
- printer availability/state

### Phased automation model

Level 1:
- Manual printer selection with ranked suggestions and diagnostics.

Level 2:
- Auto-match during dispatch for pending queue items.

Level 3:
- Continuous farm optimizer with reservations, fairness, and optional pools.

### Optional advanced structures (HIGH)

- `printer_pools`
- `printer_pool_members`
- `print_queue_dispatch_reservations`
- `print_queue_match_audit`

### Diagnostics requirement

System must expose explainability:
- why a printer was selected
- why none were eligible
- which requirement blocked dispatch

This is mandatory for operator trust.

---

## G - UI / UX Workflow Design

### Workflow mode model

Batch is treated as workflow mode with three focused surfaces:
- `Batch Dashboard` (monitoring and KPIs)
- `Batch Planner` (plate/config editing and quantity planning)
- `Batch Execution` (dispatch, queue state, exception handling)

Batch detail layout should visibly separate:
- `Plan` panel (configs, quantities, requirements, estimates)
- `Dispatch/Queue` panel (filtered queue view, assignment state, waiting reasons, matcher diagnostics)

### Visual flow (explicit)

`Planning -> Dispatch -> Queue -> Printer -> Archive -> Batch Progress Update`

### 1) Batch List Page

Cards/rows show:
- name, due date, lifecycle status
- owner, visibility (`private/shared`)
- progress bar (completed/running/remaining)
- warnings (file drift, unresolved external mappings)

Primary actions:
- create, open dashboard, pause/resume, cancel

### 2) Batch Planner Page

Hierarchy:
- header (batch metadata and policies)
- plate cards
- config cards under each plate

Config card fields:
- quantity target, priority, failure policy
- printer requirement summary
- material/color requirement chips
- estimated unit cost/time source

Interactions:
- add/clone/remove config
- edit quantity while running with impact preview

### 3) Batch Execution Page

Shows:
- dispatch controls (`manual`/`auto`)
- queue integration view (all batch queue items)
- pending reasons + matcher diagnostics
- quick actions: dispatch now, cancel pending excess, retry failed

Dispatch/Queue panel specifics:
- default filtered queue table for current batch
- columns: queue status, printer assignment state, waiting reason, matcher score/diagnostics summary
- action drawer: manual printer override (if allowed), cancel pending, open archive link

### 4) Batch Dashboard Page

Shows:
- overall KPI tiles (completed, failed, remaining, cost)
- per-plate and per-config progress bars
- trend chart over time (optional)
- external/manual mapping queue

### 5) Queue Integration View

Each queue row shows:
- batch badge, plate/config identity
- matcher summary
- status timeline
- deep links to archive and batch config

### 6) Manual Mapping / Corrections UI

Dedicated panel:
- `Unmapped Runs` bucket with confidence-ranked suggestions
- attach/detach/remap actions
- recompute preview before confirm

### 7) Permissions UX (simplified)

- Owner: full edit rights for batch plan.
- Operators: view/start/stop/monitor queue/run state, no config edits.

Implementation note:
- permission checks should be extensible for future sharing/role expansion.

---

## H - MID vs HIGH Implementation Tiers

## MID IMPLEMENTATION

Scope:
- Planning-first batch entities
- Declarative requirements (no slot map)
- Manual + auto reconcile dispatch
- Queue-owned matching hooks
- Owner + visibility model (no assignment matrix)
- Manual attach/correction for external/unplanned runs

Data model:
- `print_batches`
- `print_batch_plates`
- `print_batch_plate_configs`
- `print_batch_config_requirements`
- `print_batch_run_links`
- queue FK + matching JSON additions

API:
- batch CRUD + planner operations
- dispatch/reconcile endpoints
- manual attach/detach/remap endpoints
- diagnostics endpoint for pending/mismatch reasons

UI complexity: medium-high (because of workflow mode + corrections)

Risks:
- matching diagnostics quality
- metadata drift across file revisions

Migration difficulty: medium (table rename/replacement and queue column additions)

Estimated effort: 8-12 weeks (2 engineers)

## HIGH IMPLEMENTATION

Scope:
- farm optimizer (reservations/fairness/pools)
- fuzzy color intelligence and similarity models
- cached rollups by event streams
- optional canonical `SlicerArtifact` layer
- optional per-object accounting

Data model additions:
- queue matcher pool/reservation/audit tables
- `print_batch_config_stats`
- optional artifact/object tables

API:
- optimizer controls and simulation
- pool management
- webhook/events for ERP integrations

UI complexity: high

Risks:
- optimizer starvation/oscillation
- explainability and trust failures
- cross-system integration reliability

Migration difficulty: high

Estimated effort: 16-28 weeks (2-3 engineers)

---

## I - Implementation Roadmap

### Phase 1 - Planning Core + Manual Dispatch

- Add core batch schema (simplified ownership, declarative requirements)
- Build Planner + Execution pages
- Create queue items from batch demand (no printer assignment in batch code)
- Add manual attach/remap for completed runs

### Phase 2 - Auto Reconcile + Matching Suggestions

- Enable background reconcile for auto mode
- Add quantity down-reconcile soft-cancel flow
- Add matcher diagnostics and suggestion ranking
- Add optional stats rollup table if query cost rises

### Phase 3 - Controlled Automation Expansion

- Level 2 auto-match on dispatch
- Level 3 optimizer with reservations and optional pools
- Add webhook/API automation hooks for external systems
- Evaluate canonical artifact model and optional object accounting

---

## J - Risks and Edge Cases

- Concurrency: low operational risk; use pragmatic optimistic revision checks for destructive updates.
- Multi-user edits: prefer last-write-wins with revision warning, not heavyweight locking.
- Partial failures: use `failure_policy` and bounded auto-requeue.
- External starts: auto-link only at high confidence; otherwise require confirmation.
- Unplanned runs: default to manual review to prevent silent plan corruption.
- Metadata drift: use file hash + plate fingerprint warnings, explicit rebase flow.
- Color matching: exact hex is brittle across vendors; keep fuzzy categories/tolerance extensible.
- Farm-scale performance: pre-plan indexes; introduce rollups when needed.
- Explainability: pending reasons and matcher diagnostics are required, not optional.

---

## Recommended Default Implementation Path

Implement MID as planning-first and queue-authoritative:
- batch defines required outcomes
- queue/scheduler decide hardware assignment
- manual correction path ensures operational robustness

Then grow automation in controlled levels (suggestions -> auto-match -> optimizer) to avoid fragile jumps in complexity.
