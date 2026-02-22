# 3MF Function Breakdown For Batch/Order

## Goal
Define an ordered, function-level extraction flow from a `.gcode.3mf` artifact to:
- `print_batch_plates` (`Plate` model)
- `print_batch_plate_configs` (`Config` model)
- `print_batch_config_requirements` (`Requirements` model)

This is written against:
- `docs/batch_order_layer_findings/h2d-color-test-print/H2D Pro color test print.gcode.3mf`

## Ordered Function Steps

1. `open_3mf_container(artifact_path) -> ZipFile`
- Collect from: `.gcode.3mf` zip container.
- Information: archive readability, entry list, entry sizes.
- Source paths: all archive entries.

2. `extract_global_context(zf) -> GlobalContext`
- Collect from:
  - `3D/3dmodel.model`
  - `Metadata/slice_info.config` (`header`)
  - `Metadata/project_settings.config`
- Information:
  - slicer app/version (`Application`, `X-BBL-Client-Version`)
  - printer target/profile (`printer_model`, `printer_settings_id`, `print_settings_id`)
  - bed/profile/nozzle defaults (`curr_bed_type`, `nozzle_diameter`, `physical_extruder_map`)

3. `extract_plate_registry(zf) -> PlateRegistry[]`
- Collect from:
  - `Metadata/model_settings.config`
  - `Metadata/_rels/model_settings.config.rels`
- Information:
  - `plater_id`
  - plate asset links: `gcode_file`, `thumbnail_file`, `pattern_bbox_file`
  - plate mapping mode/settings: `filament_map_mode`, `filament_maps`

4. `extract_plate_slice_data(zf) -> PlateSlice[]`
- Collect from: `Metadata/slice_info.config` (each `<plate>`).
- Information per plate:
  - `index` (plate index)
  - `prediction` (estimated seconds)
  - `weight` (estimated grams)
  - `object[]` (`identify_id`, `name`, `skipped`)
  - `filament[]` (`id`, `type`, `color`, `used_g`, `used_m`, `tray_info_idx`, `group_id`)
  - `layer_filament_lists` (which slots are active per layer ranges)

5. `extract_plate_geometry_data(zf, plate_index) -> PlateGeometry`
- Collect from: `Metadata/plate_{index}.json`.
- Information:
  - `bbox_all`, `bbox_objects`
  - `first_layer_time`
  - `first_extruder`
  - optional duplicated filament ids/colors

6. `extract_plate_gcode_refs(zf, plate_index) -> GcodeRef`
- Collect from:
  - `Metadata/plate_{index}.gcode`
  - `Metadata/plate_{index}.gcode.md5`
- Information:
  - gcode path and md5 checksum
  - gcode header values (optional fallback): model/estimated time/total layers

7. `extract_nozzle_mapping(zf) -> slot_id -> nozzle_id`
- Collect from:
  - `Metadata/slice_info.config` filament `group_id`
  - `Metadata/project_settings.config` `physical_extruder_map`
- Information:
  - actual per-slot nozzle assignment for dual-nozzle slicing.

8. `normalize_filaments(global_ctx, plate_slices, nozzle_map) -> FilamentCatalog`
- Collect from:
  - plate filament usage (step 4)
  - project arrays (`filament_vendor`, `filament_settings_id`, `filament_ids`)
- Information per slot:
  - `material_type`
  - `color_hex` + derived `color_family`
  - `brand/preset`
  - `tray_info_idx` (preset token, not live AMS tray)
  - `nozzle_id`
  - cross-plate usage totals

9. `build_plate_snapshot(plate_registry, plate_slice, geometry, gcode_ref, nozzle_map, global_ctx) -> PlateSnapshot`
- Information:
  - stable, display-ready plate JSON for planning.
- Required output fields:
  - `plate_index`, `name`, `estimated_duration_sec`, `estimated_filament_grams`, `object_count`
  - `objects[]`, `filament_map[]`, `gcode_ref`, `layer_filament_lists`, `plate_assets`

10. `build_plate_fingerprint(plate_snapshot) -> sha256`
- Hash canonicalized inputs:
  - `plate_index`
  - non-skipped object list
  - filament map (slot/material/color/used/tray_info_idx/group_id)
  - key settings (`printer_model`, profile ids, nozzle settings, bed type, plate filament map mode)
  - plate gcode md5

11. `build_default_plate_config(plate_snapshot, global_ctx) -> PlateConfig`
- Create initial config `A` (planner can later clone/branch to `B`, `C`, ...).
- Information:
  - constraints implied by source slice: required printer model/nozzle diameter/nozzle count.
  - estimate defaults from slicer metadata.

12. `build_config_requirements(plate_snapshot) -> Requirement[]`
- For each required filament in `plate_snapshot.filament_map` (ordered by `slot_id`):
  - `material_type`
  - `color_hex`
  - derived `color_family`
  - `metadata_json` with `slot_id`, `tray_info_idx`, `nozzle_id`, `used_g`, `used_m`
- Do not assign physical AMS tray at planning layer.

13. `persist_batch_snapshots(batch, plates, configs, requirements)`
- Persist:
  - batch-level source snapshot
  - plate-level snapshot + fingerprint
  - config rows + requirements rows

## Field Mapping To Batch Models

### `print_batch_plates` (Plate model)
- `plate_index`: from `slice_info.config` plate metadata `index`.
- `plate_name`: `model_settings.plater_name`, else first non-skipped object name.
- `object_count`: count of non-skipped objects in plate.
- `estimated_duration_sec`: `slice_info.metadata[prediction]`.
- `estimated_filament_grams`: `slice_info.metadata[weight]`.
- `plate_fingerprint`: step 10 hash.
- `plate_metadata_snapshot`: full `PlateSnapshot` JSON.

### `print_batch_plate_configs` (Config model)
- Default one config per plate (`config_code = "A"`).
- `required_printer_model`: normalized `project_settings.printer_model`.
- `required_nozzle_diameter_mm`: from global nozzle context (for this artifact: `0.4`).
- `required_nozzle_count`: from nozzle count (for this artifact: `2`).
- `estimate_strategy`: `slicer_metadata`.
- `estimate overrides`: null unless planner edits.
- Config identity should be derived from:
  - `plate_fingerprint`
  - config-level constraint fields
  - config-level requirement set fingerprint.

### `print_batch_config_requirements`
- One row per filament requirement in sorted `slot_id` order.
- `material_type`: plate filament `type`.
- `color_hex`: plate filament `color`.
- `color_family`: deterministic normalization from `color_hex`.
- `match_tolerance`: default `exact` (or planner default).
- `metadata_json`: include `slot_id`, `tray_info_idx`, `nozzle_id`, `used_g`, `used_m`.

## What Is Not In The Artifact
- Live AMS tray assignment (`tray index -> filament`) at print time.
- Direct explicit object-to-material mapping table.
- Vendor color name strings (only hex and preset/vendor tokens; names require catalog inference).

## Artifact-Specific Result (H2D Color Test Print)
- Plate count: `3`
- Plate 1 filament slots: `1,2,3,4`
- Plate 2 filament slots: `5,6`
- Plate 3 filament slots: `7,8,9`
- All plates have `filament_map`; if missing in a view, it is an output truncation issue, not extraction absence.

