# H2D Color Test Print Findings

## Scope
- Artifact moved here: `docs/batch_order_layer_findings/h2d-color-test-print/H2D Pro color test print.gcode.3mf`
- Branch: `custom/feature-batch-order-layer`
- Library file hash: `8279e2607ae08f4cc9166a8c5537905e3d0d629f5922c1391aeb17fc3483e187`

## Ingestion Path (Current)
- `LibraryFile` upload parser path: `backend/app/api/routes/library.py:746`
- ZIP extract upload parser path: `backend/app/api/routes/library.py:990`
- Parser used: `backend/app/services/archive.py:22` (`ThreeMFParser`)
- Stored metadata column: `backend/app/models/library.py:76` (`library_files.file_metadata`)

## DB Comparison
- Matched DB row by hash: `37`
- `file_metadata.print_name`: `H2D color Test Print`
- Parser output and DB metadata are effectively aligned.
- Serialization caveat: `printable_objects` keys are stringified in DB JSON.

## Plate Findings
- Plate 1: objects=1, duration=6036s, filament=22.99g, filament_map_entries=4, gcode=Metadata/plate_1.gcode
- Plate 2: objects=2, duration=2588s, filament=5.78g, filament_map_entries=2, gcode=Metadata/plate_2.gcode
- Plate 3: objects=3, duration=18597s, filament=77.43g, filament_map_entries=3, gcode=Metadata/plate_3.gcode

## Filament Map Question
- Plate 2 is **not missing** `filament_map`.
- The earlier output looked like only plate 1 had it because the displayed JSON excerpt was truncated in the message.
- In this saved JSON report, all plates include `filament_map`.

## Outputs
- Machine-readable report: `docs/batch_order_layer_findings/h2d-color-test-print/h2d-color-test-print.findings.json`
- This summary: `docs/batch_order_layer_findings/h2d-color-test-print/H2D_COLOR_TEST_PRINT_FINDINGS.md`
