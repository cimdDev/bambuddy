
# Batch Order From 3MF + Plate Configuration Matrix (Technical Documentation)

## 1. Feature Overview

### What the Batch Order feature does

The Batch Order feature adds a planning layer above the existing queue so users can define **what must be produced** from a `.gcode.3mf` file before dispatching individual prints.

It allows users to:

- Create an Order from a Library 3MF file
- See all plates extracted from the 3MF metadata
- Define multiple per-plate configurations (variants)
- Set target quantities per configuration
- Override colors per material/slot while keeping the original plate geometry/toolpath
- Dispatch remaining work into the existing queue (full or partial)

### Purpose of creating orders from 3MF files

A Library `.gcode.3mf` file already contains:

- plate definitions
- per-plate filament/material usage
- estimated time/weight
- color/material metadata

Creating an Order from the 3MF uses that metadata as the **source of truth** for plate planning.

### Plate Configurations

A Plate Configuration represents:

> “Print this specific source plate with this color setup, this many times.”

Each configuration is tied to one source plate and contains:

- `quantity_target`
- optional name/label
- per-slot material/color values (seeded from the original 3MF plate mapping)

### Color Overrides

Overrides are primarily **color changes** (material type remains unchanged).

Example:

- Base: `PLA #FF0000`
- Override: `PLA #0000FF`

The UI and backend preserve the source mapping and compute a queue-level override payload describing only the differences.

### Integration with the existing Queue system

The queue architecture is reused as-is.

- No new queue system was introduced.
- Batch dispatch creates normal `PrintQueueItem` rows.
- Queue matching / AMS slot resolution remains in the existing queue/scheduler logic.
- Queue items now optionally carry `override_material_map` to represent batch configuration overrides.

---

## 2. Workflow Description

### 1. Create a Batch Order from a .gcode.3mf file

User flow:

- From File Manager, user selects **Create Batch Order** on a .gcode.3mf file.
- System calls `POST /orders`.

Internal behavior:

- Backend validates the source is a `.gcode.3mf` library file.
- Source metadata is loaded from `LibraryFile.file_metadata`.
- If normalized `plates[]` is missing, backend extracts plate snapshots directly from the 3MF archive.
- A `PrintBatch` row is created and per-plate `PrintBatchPlate` rows are snapshotted.

### 2. Edit header information

User can edit:

- order name
- customer label
- due date
- notes
- ...

Internal behavior:

- `PUT /orders/{id}` updates `print_batches`
- planning metadata changes do not mutate historical queue/archive rows

### 3. Define plate configurations

User creates one or more configurations per plate.

Internal behavior:

- `POST /orders/{id}/configs`
- Config rows are created in `print_batch_plate_configs`
- Slot mappings are seeded from the plate’s `plate_metadata_snapshot.filament_map`
- Seeded slots are stored in `print_batch_plate_config_slots`

### 4. Override colors

User edits colors in the matrix per slot row / config column.

Internal behavior:

- UI updates config draft state
- Save action performs:
  - config update (`PUT /orders/configs/{config_id}`)
  - slot replacement (`PUT /orders/configs/{config_id}/slots`)
- Backend recalculates queue-facing snapshots for pending items linked to that config

### 5. Generate QueueItems

When user dispatches a config / plate / order:

- Backend computes `remaining_to_dispatch`
- Creates one `PrintQueueItem` per physical print
- Each queue item includes batch linkage + configuration snapshots

Queue item payload includes:

- `batch_id`, `batch_plate_id`, `batch_plate_config_id`
- `matching_requirements_json`
- `execution_mapping_json`
- `override_material_map` (if effective overrides exist)

### 6. Dispatch prints

Dispatch entry points:

- Order-level dispatch
- Plate-level dispatch
- Config-level dispatch
- Optional partial `limit`

Internal behavior:

- Batch service inserts queue items only to "Any _of type x_ printer"
- Existing scheduler/queue picks them up normally
- On execution archive creation, batch lineage and overrides are snapshotted into `archive.extra_data["batch_order"]`

---

## 3. Data Model and Architecture Changes

### New planning tables

- `print_batches` (order header)
- `print_batch_plates` (source plate snapshot)
- `print_batch_plate_configs` (plate variants + quantity)
- `print_batch_plate_config_slots` (per-slot material/color mapping for a config)

### Schema change (new for this feature refinement)

`print_queue` gained:

- `override_material_map` (`TEXT`, JSON-serialized, nullable)

Purpose:

- Stores per-queue-item configuration overrides derived from a plate config
- Keeps queue matching architecture unchanged while making override intent explicit

### Relationships

- `PrintBatch` 1..N `PrintBatchPlate`
- `PrintBatchPlate` 1..N `PrintBatchPlateConfig`
- `PrintBatchPlateConfig` 1..N `PrintBatchPlateConfigSlot`
- `PrintBatchPlateConfig` 1..N `PrintQueueItem` (via `batch_plate_config_id`)

### Override data flow

```text
3MF (plate filament map)
  -> PrintBatchPlate.plate_metadata_snapshot
  -> seeded PrintBatchPlateConfigSlot rows
  -> user edits color overrides in matrix
  -> PrintBatchService computes effective override delta
  -> PrintQueueItem.override_material_map (dispatch time / pending sync)
  -> existing queue + scheduler consume same queue item model
```

---

## 4. Override Logic

### Base material mapping from 3MF

Base mapping is read from:

- `plate.plate_metadata_snapshot.filament_map`

Each row typically includes:

- `slot_id`
- `material_type`
- `color_hex`
- optional `nozzle_assignment`

### Configuration overrides

Each config stores slot mappings in `print_batch_plate_config_slots`.

The matrix UI edits those rows, usually changing:

- `color_hex`

Material type can still be stored, but UI/feature expectation is “color-first”.

### Effective mapping determination

At dispatch/sync time, backend compares:

- base slot mapping (from plate snapshot)
- config slot mapping (from config slots)

If values differ, an entry is added to `override_material_map`.

No difference => no override entry for that slot.

### Example override payload

```json
{
  "1": {
    "slot_index": 1,
    "filament_id": null,
    "material_type": "PLA",
    "color_hex": "#0000FF",
    "color_family": "blue",
    "nozzle_assignment": "0",
    "base_material_type": "PLA",
    "base_color_hex": "#FF0000",
    "base_color_family": "red",
    "source": "order_plate_config",
    "batch_plate_config_id": 12
  }
}
```

### Queue matching / AMS mapping is not modified

This feature does **not** change:

- scheduler matching logic
- AMS tray selection logic
- printer assignment logic

It only passes override intent forward via queue item metadata.

---

## 5. UI Structure

### Order creation screen

Two entry paths exist:

- File Manager action: **Create Batch Order** for 3MF files (preferred flow)
- Orders page (manual create by Library File ID flow)

### Order detail layout

Order detail page now contains:

- Header section (order metadata editor)
- Progress summary card
- Plate cards (one per source plate)

### Plate card layout

Left side:

- plate preview image
- plate metadata / object list / gcode ref
- plate progress summary
- plate dispatch control
- add config control

Right side:

- configuration matrix (horizontal scroll)

### Configuration matrix behavior

Rows:

- base material/color rows from source plate (`filament_map`)

Columns:

- `Original` (read-only source mapping)
- one column per active config (editable)

Per config column:

- config name
- quantity
- per-row color override inputs:
  - based on Color Catalog
  - filtered by material
  - optionally filtered by "available in inventory"
- dispatch action
- save action
- remove (implemented as cancel/hide)

### Dispatch controls

Available dispatch levels:

- Order: dispatch remaining (optional limit)
- Plate: dispatch remaining (optional limit)
- Config: dispatch remaining (optional limit)

### Progress indicators

Displayed at:

- Order level: aggregated summary
- Plate level: totals + progress bar + queue/printing/completed/remaining
- Config level: compact counts in matrix header

### Diagram (UI composition)

```text
Order Detail
├─ Header Card (name/customer/due date/notes)
├─ Progress Summary Card
└─ Plate Card (repeated)
   ├─ Left Panel
   │  ├─ Preview
   │  ├─ Plate stats + progress bar
   │  ├─ Dispatch plate
   │  └─ Add config
   └─ Right Panel
      └─ Config Matrix
         ├─ Row labels = base slot/materials
         ├─ Original column (read-only)
         └─ Config columns (editable overrides + qty + dispatch/save)
```

---

## 6. Queue Integration Verification

### How QueueItems now receive overrides

During batch dispatch (and pending item sync after config edits):

- backend compares base plate slots vs config slots
- backend builds a delta payload (`override_material_map`)
- payload is saved on `PrintQueueItem.override_material_map`

### Where override is stored

- Database column: `print_queue.override_material_map`
- Type: JSON serialized into `TEXT`
- Response/API schema now parses/returns it as a JSON object

### Confirmation that existing queue logic was reused

Reused unchanged:

- queue item lifecycle/status model
- scheduler assignment flow
- AMS matching/resolution logic
- archive creation flow

Extended only:

- queue item metadata payload (override field)
- archive lineage snapshot to include overrides

### Compatibility considerations

- `override_material_map` is nullable; legacy queue items remain valid
- Existing queue create/update APIs continue to work without the new field
- Matching logic does not depend on this field yet, so behavior remains backward-compatible

---

## 7. Limitations and Future Extensions

### Current limitations

- Primary override expectation is **color**; material-type changes are not supported
- No automatic compensation/planning logic
- Config removal is implemented as cancel/hide for history safety (not hard delete)

### Future extensions

- Inventory-backed color override selection (`filament_id`)
- Constraint-aware validation (e.g. forbid PLA→ABS if config policy disallows)
- Color tolerance policies (`exact`, `family`, distance)
- Bulk config operations across plates
- Better conflict detection for concurrent editor sessions
- Richer normalized requirements table (`print_batch_config_requirements`) fully wired to UI

---

## 8. Developer Notes

### Key design decisions

- Keep queue/scheduler architecture unchanged; add metadata only
- Store override payload on queue items for traceability and future matching integration
- Compute overrides as a delta from source plate snapshot, not as a full replacement contract
- Matrix UI is plate-centric to match how multi-plate 3MF production is planned

### Tradeoffs

- `override_material_map` in queue is flexible and additive, but not strongly typed at DB level
- Config “remove” as cancel/hide preserves history but may require UI explanation
- Matrix save currently performs config update + slot replacement (2 API calls) for simplicity

### Things to watch out for

- Pending queue items are resynced on config changes; started/completed items remain historical by design
- Base rows come from `plate_metadata_snapshot.filament_map`; malformed source metadata can degrade matrix fidelity
- Concurrent edits can cause last-write-wins behavior on config/slot saves

### Potential refactoring areas

- Split matrix column editor into reusable subcomponents
- Add batch API endpoint for atomic config+slots update (single transaction over one request)
- Introduce normalized requirement rows for future matching UI and reporting
- Add stronger typing for `override_material_map` in frontend API types
