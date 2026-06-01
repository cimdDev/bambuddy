# SD Card Operations

## Status
Spec v2.

This document defines the custom delta only. It must be implemented on top of clean upstream `dev` without pulling in unrelated printer, library, or file-manager changes.

## Summary
Expose printer-resident SD-card files through the printer file browser modal so operators can inspect them, import them into Bambuddy library storage, move them into Bambuddy, or use them as the starting point for the normal print and queue flows.

## Goal
Let operators work with files already stored on a printer without leaving Bambuddy or manually downloading and re-uploading those files.

## Canonical UI Scope
- The primary UI surface is the printer file browser modal opened from the printers page.
- This feature is not a redesign of the main Bambuddy library file manager.
- Existing library print and queue dialogs remain the canonical print/schedule workflow after import.

## In Scope
- List files on a printer through printer file browser endpoints.
- Show printer storage information in the printer file browser modal.
- Allow selecting printer-resident files and:
  - downloading them
  - deleting them from the printer
  - importing them into Bambuddy library storage
  - moving them into Bambuddy, meaning import plus delete source from printer
  - starting a print workflow by importing first, then opening the existing library-file print flow
  - starting a queue workflow by importing first, then opening the existing library-file queue flow
- Support printer-file preview helpers already needed by this modal:
  - 3D model preview
  - G-code preview
  - plate metadata / plate thumbnails for printer-stored 3MF files
- Default the printer file browser sort order to newest file first.
- Keep the reusable `patches/custom-sdcard-library/` patch bundle in-repo as maintenance collateral if you still want to preserve that patch export.

## Data and Storage Rules
- Printer-resident files are not treated as Bambuddy library files until imported.
- Import creates a normal Bambuddy library file entry with the same content and parsed metadata where available.
- Import should preserve:
  - original filename
  - parsed 3MF metadata when available
  - generated thumbnail where supported
- Duplicate detection may still report an existing matching library file, but import remains an explicit operator action.

## Action Semantics
- `Import to Bambuddy`
  - copy selected printer files into Bambuddy library storage
  - source files remain on the printer
- `Move to Bambuddy`
  - import selected printer files into Bambuddy library storage
  - then attempt to delete the original file from the printer
  - if import succeeds but delete fails, report partial success rather than rolling back the import
- `Print`
  - available only for printer files that are considered sliced/printable
  - import the selected file into Bambuddy first
  - then open the existing print modal against the imported library file
- `Schedule Print`
  - available only for printer files that are considered sliced/printable
  - import the selected file into Bambuddy first
  - then open the existing add-to-queue flow against the imported library file

## Permission Model
- Listing/downloading/deleting/importing printer files uses the existing printer-files permission model.
- Importing into Bambuddy also requires the existing library upload permission.
- Starting a print after import uses the existing printer-control permission model.
- Starting a queue flow after import uses the existing queue-create permission model.
- The feature must not invent a separate SD-card-specific permission system.

## Sorting and Navigation
- Default sort in the printer file browser is `date-desc` / newest first.
- Directory navigation remains inside the printer file browser modal.
- Directories still sort before files; newest-first applies to files within the chosen sort mode.

## Error Handling
- Missing or unreadable printer files should surface a user-visible error.
- Import failures should not create half-finished library records.
- Move failures after a successful import should keep the imported Bambuddy file and report that source deletion failed.
- Unsupported preview types may fall back to no preview without blocking download/import actions.

## Explicit Exclusions
- No SD-card-specific queue model or archive model.
- No direct printing from the printer-resident file without first importing into Bambuddy.
- No accounting, queue comments, or slicer-user behavior in this feature.
- No main library file-manager redesign.
- No unrelated printer status or FTP subsystem refactor beyond the minimum needed to support this workflow.

## Interfaces
- Printer APIs expose file listing, download, delete, preview-support, storage, and import-to-library endpoints.
- Frontend client exposes printer file browser actions for import, move, print-after-import, and queue-after-import.
- The primary frontend component is the printer file browser modal opened from printers.

## Acceptance Criteria
- Operators can browse printer-resident files from the printers page.
- The printer file browser defaults to newest-first sorting.
- An operator can import selected printer files into Bambuddy library storage.
- An operator can move selected printer files into Bambuddy, with import succeeding even if source deletion later fails.
- A single sliced printer file can be used to open the normal print flow after import.
- A single sliced printer file can be used to open the normal queue flow after import.
- Preview-capable printer files can be inspected in the modal without first importing them.
