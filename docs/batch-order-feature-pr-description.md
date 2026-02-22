# PR Description — Batch Order from 3MF + Plate Configuration Matrix + Queue Override Support

## Summary

This PR improves the Order/Batch planning workflow for `.gcode.3mf` library files by introducing a plate-centric configuration matrix UI and queue-level override propagation, while keeping the existing queue/scheduler architecture unchanged.

## What This PR Does

### Backend

- Adds `override_material_map` to `print_queue` (JSON stored as `TEXT`)
- Computes override deltas from:
  - source plate mapping (`plate_metadata_snapshot.filament_map`)
  - config slot mappings (`print_batch_plate_config_slots`)
- Persists overrides onto queue items during batch dispatch and pending resync
- Adds plate-level dispatch endpoint:
  - `POST /orders/{order_id}/plates/{plate_index}/dispatch`
- Preserves override snapshot in execution archive lineage (`archive.extra_data["batch_order"]`)

### Frontend

- Adds **Create Batch Order** action in File Manager for 3MF files
- Reworks Order Detail page into a **Plate Configuration Matrix**
  - base/original column
  - editable config columns
  - quantity + color overrides + dispatch/save controls
- Adds plate-level dispatch UI
- Adds order header editor (customer, due date, notes)
- Uses translation system for new UI labels/messages

## Why

The previous MVP supported batch planning but was config-card based and did not explicitly store queue item override mappings. This change makes multi-config plate planning easier to use and makes queue dispatch payloads clearer/traceable without changing queue matching behavior.

## Key Design Constraints Respected

- Queue/scheduler architecture unchanged
- AMS matching logic unchanged
- Additive schema changes only (SQLite-safe)
- Started/completed queue history is not mutated by config edits

## Data Flow (Override)

```text
3MF plate filament_map
  -> batch plate snapshot
  -> config slot rows (seeded + user color edits)
  -> override delta computation
  -> print_queue.override_material_map
  -> existing queue/scheduler execution
```

## API Additions / Changes

- New endpoint:
  - `POST /orders/{order_id}/plates/{plate_index}/dispatch`
- Queue item API now supports:
  - `override_material_map` in create/update/response payloads (optional)

## Testing / Verification

- Python syntax checks (`py_compile`) passed for changed backend files
- Frontend TypeScript compile (`npx tsc --noEmit`) passed
- Added integration test coverage for queue override persistence in batch dispatch

## Notes / Limitations

- Primary override workflow is color-first; inventory filament selection is not part of this PR
- `filament_id` may be null in override payloads until inventory-backed selection is implemented
- Config removal in UI is implemented as cancel/hide to preserve history

## Documentation

- `docs/batch-order-feature.md`
- `docs/batch-order-feature-feature-request-comment.md`
- `docs/batch-order-feature-pr-description.md`

