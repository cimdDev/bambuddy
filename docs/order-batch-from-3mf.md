# Order Batch From 3MF (Feature Documentation)

## Feature Overview

- Adds an Order/Batch planning layer for `.gcode.3mf` library files.
- Lets users create an order from a library 3MF and plan production by source plate.
- Supports multiple plate configurations per plate (quantity + color-focused overrides).
- Dispatches work into the existing queue as normal queue items.
- Preserves queue/scheduler/archive architecture; only extends metadata/linkage and UI.

## Problem Statement

- The existing queue can execute prints, but it does not provide a planning layer for multi-plate 3MF production orders.
- Operators need a way to define target quantities and color variants per plate before dispatch.
- The prior MVP flow was functional but less efficient for comparing multiple configurations and did not make override intent consistently visible across queue/AMS views.
- The system needed a way to pass configuration overrides into queue items without redesigning queue matching.

## Implementation Details

### Backend

- Added batch planning models and relationships:
  - `PrintBatch`
  - `PrintBatchPlate`
  - `PrintBatchPlateConfig`
  - `PrintBatchPlateConfigSlot`
- Added `orders` API routes for:
  - create/update/delete order
  - config create/update/slot replacement
  - dispatch remaining (order / plate / config)
- Added queue linkage + override propagation:
  - `print_queue.override_material_map` (nullable JSON serialized as `TEXT`)
  - override delta is computed from source plate mapping vs config slot mapping
- Reused existing execution/archive path:
  - batch lineage and override snapshot are included in archive extra metadata

### Frontend

- Added Orders pages:
  - `OrdersPage`
  - `OrderDetailPage`
- Added File Manager entry flow to create a batch order directly from a 3MF library file.
- Reworked order detail into a plate-centric matrix UI:
  - shared plate header (always visible)
  - collapsed summary vs expanded editor
  - per-plate configuration columns
- Added order lifecycle controls:
  - editable status
  - halt / resume / close / delete with confirmations
- Added color catalog-based override selector:
  - source of truth = color catalog
  - inventory used as availability filter

### Data Flow (override path)

```text
3MF plate filament_map
  -> batch plate snapshot
  -> config slots (user edits color overrides)
  -> override delta computation in batch service
  -> print_queue.override_material_map
  -> existing queue matching / scheduler / execution flow
```

## Usage

1. Create a batch order from a `.gcode.3mf` file (preferred via File Manager action).
2. Edit order header fields (name, customer, due date, notes, status).
3. Expand a plate and add one or more configurations.
4. Set quantities and override colors (catalog-based selection, optionally filtered by inventory availability).
5. Dispatch remaining work at one of three levels:
   - order
   - plate
   - configuration
6. Monitor progress in order/plate summaries and existing queue/history views.

## Limitations

- Primary workflow is color override; material-type swaps are not the main UI path.
- Queue override payload is flexible JSON (`TEXT`) rather than strongly typed relational rows.
- Order-level dispatch does not autosave every unsaved matrix edit across all plates before dispatch.
- Some UI flows still depend on a large `OrderDetailPage` component and would benefit from decomposition.

## Edge Cases

- If source 3MF metadata is incomplete (especially plate `filament_map`), matrix rows may be degraded or incomplete.
- Concurrent edits to the same order/config can result in last-write-wins behavior.
- Reducing quantities only cancels pending queue items; started/completed items remain historical by design.
- Inventory may contain colors not cleanly mapped to the color catalog; UI falls back to closest match or unmapped indicators.
- Delete order is blocked when linked queue items are still pending/printing.

## Future Improvements

- Atomic config+slot update endpoint to reduce multi-request save races.
- Split `OrderDetailPage` into smaller components (header card, plate header, matrix, selector modal).
- Add normalized requirement rows (e.g. `print_batch_config_requirements`) for reporting and future matching UX.
- Add stricter policy validation for material-type changes.
- Add typed-delete confirmation for order deletion and optional reopen-from-closed flow.
- Improve inventory-to-catalog matching heuristics and expose conflict resolution UI.
