# Feature Request Comment — Batch Order from 3MF + Plate Configuration Matrix

Implemented a batch-order workflow for `.gcode.3mf` files that reuses the existing queue system and adds plate-level color override planning.

## Delivered

- Create Batch Order directly from **File Manager** on 3MF files
- Plate-centric **configuration matrix** UI
  - Original (read-only) source mapping column
  - Multiple config columns per plate
  - Quantity per config
  - Color overrides per slot/material row
- Dispatch controls at:
  - Order level
  - Plate level
  - Config level
  - Optional partial limit
- Queue integration preserved (no scheduler redesign)
- Queue items now support `override_material_map` for configuration-derived overrides

## Integration Notes

- Overrides are generated from config slot differences vs source 3MF plate mapping
- Queue matching / AMS logic remains unchanged
- Started/completed jobs remain historical; pending items are the only ones resynced on config edits

## Documentation

Technical documentation added:

- `docs/batch-order-feature.md`
- `docs/batch-order-feature-pr-description.md`

