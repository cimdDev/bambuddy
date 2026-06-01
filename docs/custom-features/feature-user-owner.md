# User Owner

## Status
Spec v2.

This document defines the custom delta only. It must be implemented on top of clean upstream `dev` without re-importing unrelated upstream UI, auth, printer, or archive behavior.

## Summary
Capture slicer-user metadata from print files, preserve it on archives and library files, surface it as a small badge in the main print workflows, and allow in-place repair where the user already has permission to update the underlying archive or library file.

## Goal
Make it easy to see who a print belongs to, and fix missing or wrong slicer-user metadata without leaving the page where the issue is discovered.

## Data Model
- `slicer_user: string | null`
- `slicer_user_email: string | null`

These fields are optional metadata fields.

There is no separate queue-owned slicer-user field. Queue responses only expose slicer-user data copied from the linked archive or linked library file.

## Canonical Display Rule
- When both fields are available, display `slicer_user`.
- Otherwise display `slicer_user_email`.
- If neither field is present, show the missing-user warning state instead of a badge.

## In Scope
- Parse `slicer_user` and `slicer_user_email` from uploaded 3MF metadata during archive/library ingestion.
- Persist slicer-user fields on archive records.
- Persist slicer-user fields in library file metadata.
- Expose these fields through archive, queue, and library API responses.
- Include these fields in archive search and file-manager search surfaces.
- Show a shared slicer-user badge on:
  - archives
  - queue items
  - printer current/next queue surfaces
  - file manager rows/cards
  - upload review/repair flow
- Show a missing-user warning badge where the above surfaces have no slicer-user value.
- Allow in-place repair from archive, queue, printer, file-manager, and upload flows through one shared modal.
- Remember recent manually entered slicer-user values locally in the browser and use the top local value as a suggestion in the upload repair flow.

## Permission Model
- Archive slicer-user repair uses the existing archive update permission model:
  - update all archives, or
  - update own archives
- Library-file slicer-user repair uses the existing library update permission model:
  - update all files, or
  - update own files
- Queue and printer pages do not introduce their own edit permission. They are only entry points to edit the linked archive or linked library file.
- Users without edit permission still see the badge or warning, but they do not get an interactive edit affordance.

## Edit Semantics
- The repair flow is set-or-replace only. It is not intended as a dedicated clear/remove feature.
- Manual input is trimmed before saving.
- If the trimmed value looks like a single email address token, save it to `slicer_user_email` and clear `slicer_user`.
- Otherwise save it to `slicer_user` and clear `slicer_user_email`.
- Empty input is rejected by the modal.
- The shared editor component is `SlicerUserEditModal`.

## UI Behavior
- Existing value:
  - show the badge
  - if editable, the badge itself can open the repair modal
- Missing value:
  - show the warning badge
  - if editable, the warning badge can open the repair modal
- Upload flow:
  - newly created archives without slicer-user metadata may immediately prompt for repair
  - the form may prefill from the locally remembered top suggestion
- File manager:
  - this feature adds slicer-user visibility and repair only
  - it must not redefine unrelated file-manager columns, sorting, or upstream layout behavior

## Search Behavior
- Archive search must match `slicer_user` and `slicer_user_email`.
- File-manager search/filter surfaces must include slicer-user metadata where custom search support already exists.
- This feature does not redefine the upstream search system beyond adding these fields as searchable metadata.

## Explicit Exclusions
- No linkage between slicer-user metadata and Bambuddy auth users.
- No automatic retrospective backfill across all old records beyond manual repair.
- No queue-only persistence layer for slicer-user edits.
- No cost accounting, comments, stats, or SD-card behavior.
- No upstream UI cleanup or route refactors outside the minimum custom delta needed to carry this feature.

## Acceptance Criteria
- A 3MF upload containing slicer-user metadata produces an archive or library file that exposes the correct badge.
- Archive search can find records by slicer-user text and by slicer-user email text.
- Queue and printer views show slicer-user badges or missing-user warnings using the linked archive/library metadata.
- An authorized user can repair a missing or wrong slicer-user value from archive, queue, printer, file-manager, and upload entry points.
- A user without update permission can still see slicer-user state but cannot edit it.
- Manual repair updates the underlying archive or library file and the new badge is visible after refresh.
