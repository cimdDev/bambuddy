# Queue Comments

## Status
Spec v2.

This document defines the custom delta only. It must be implemented on top of clean upstream `dev` without pulling in unrelated queue, printer, or archive changes.

## Summary
Allow each queue item to carry a short free-text operator comment that can be viewed inline and edited directly from queue management surfaces.

## Goal
Give operators a lightweight place to note handling instructions or context for a queued or active print without introducing a broader notes system.

## Data Model
- `comment: string | null`

The comment belongs to the queue item only.

## Canonical Semantics
- A queue item comment is optional.
- Comment input is trimmed before being saved.
- Empty or whitespace-only input clears the stored comment and becomes `null`.
- Comments are queue-scoped operational notes, not archive metadata.

## In Scope
- Add nullable queue-item comment storage to the queue model and API schemas.
- Accept comment on queue item creation and queue item update.
- Show existing comments in:
  - queue page item cards / history rows
  - printer queue widget surfaces where the next/current queue item is displayed
- Support inline comment editing from the queue page.
- Include the locale strings required for comment display/editing.
- Allow comment-only updates on non-pending queue items where queue update permission already exists.

## Permission Model
- Queue comments use the existing queue update permission model.
- Users without queue update permission may still read existing comments but cannot edit or clear them.
- Printer queue surfaces do not introduce a separate comment editor.

## Edit Semantics
- Queue page editing is inline, without leaving the page.
- Saving behavior:
  - blur saves the trimmed value
  - `Ctrl+Enter` or `Cmd+Enter` commits by blurring
  - `Escape` restores the current saved value and closes the empty draft state
- Clearing the field removes the comment rather than storing an empty string.
- Comment editing is allowed for queue items in non-pending states as long as the patch only changes comment/accounting-owned fields under the existing queue API rules.

## Display Rules
- If a queue item has a saved comment, display it inline.
- If the user can edit the queue item, they can expand/add/edit/remove the comment from the queue page.
- Printer queue surfaces display existing comments read-only for the currently relevant queue item.
- This feature does not require comments to be shown on archive pages.

## Propagation Rules
- Comments do not become archive metadata when a queue item is archived after printing.
- Comments are not copied into library files or archive notes.
- This feature must not reuse or overload any existing archive `notes` field.

## Explicit Exclusions
- No accounting or PSI/private stats behavior.
- No SD-card behavior.
- No user-owner / slicer-user behavior.
- No archive comments or general-purpose note system.
- No unrelated queue UI redesign or printer-widget refactor.

## Interfaces
- Queue item payloads expose a nullable `comment`.
- Queue create and queue update operations persist trimmed comment edits.

## Acceptance Criteria
- An operator can add, edit, and clear a queue comment without leaving the queue page.
- Whitespace-only input clears the comment.
- Existing comments remain visible on queue items and in printer queue summary surfaces.
- Read-only users can see comments but cannot edit them.
- Archiving a print does not copy the queue comment into archive metadata.
