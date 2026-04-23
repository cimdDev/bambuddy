# Private Job Accounting

## Status
Spec v2.

This document defines the custom delta only. It must be implemented on top of clean upstream `dev` without dragging in unrelated queue, archive, printer, or stats changes.

## Summary
Add a small three-flag accounting model to classify whether a print is private and how its material cost should be categorized, then surface that state consistently across queue, archive, and printer workflows.

## Goal
Mark private prints explicitly and distinguish between:
- PSI/company-funded material
- fully private material
- partially private material

The feature is intentionally lightweight. It classifies existing print cost data; it does not introduce a full billing engine.

## Data Model
- `private_job: boolean`
- `private_material: boolean`
- `private_material_partial: boolean`

## Canonical Semantics
- `private_job = false`
  - The print is treated as a normal productive PSI/company job.
  - `private_material` and `private_material_partial` must both be `false`.
- `private_job = true` and `private_material = false` and `private_material_partial = false`
  - The print is a private job using PSI/company material.
  - This is the default private-job state shown in the UI as "company material".
  - The employee owes reimbursement for the print, but reimbursement handling itself stays outside this app.
- `private_job = true` and `private_material = false` and `private_material_partial = true`
  - The print is a private job using partially private material.
  - This is a category flag only. It does not encode a percentage split.
- `private_job = true` and `private_material = true`
  - The print is a private job using fully private material.
  - `private_material_partial` must be `false`.

## Important Non-Goal
There is no separate stored `company_job` field or reimbursement-percentage field.

Productive/company work is represented solely by `private_job = false`.

## Invariants
- `private_material` and `private_material_partial` are mutually exclusive.
- If `private_job` becomes `false`, both material flags must be cleared.
- If `private_material` becomes `true`, `private_material_partial` must be cleared.
- Queue updates, archive updates, and scheduler/archive handoff must preserve those invariants.

## In Scope
- Add the three accounting fields to queue and archive models and API schemas.
- Accept these fields in queue and archive update payloads.
- Preserve the flags when:
  - queue items are created
  - queue items are updated
  - a queued job becomes an archive
  - an archive is edited directly
- Show accounting state on:
  - queue cards/history rows
  - printer current/next queue surfaces
  - archive list/detail surfaces
  - archive edit modal
- Show total material cost using existing cost data/helpers already present in upstream/custom base.
- Preserve the final `private_material_partial` model and do not revive the earlier `material_cost_paid` behavior.

## Cost Semantics
- This feature does not create a new cost formula.
- Queue/printer surfaces may continue using existing estimated print-cost helpers.
- Archive/stat surfaces may continue using the existing archive `cost` field.
- The accounting flags classify that cost into buckets:
  - PSI/company material
  - partial private material
  - fully private material
- For a private job with company material, the displayed print/material cost is the amount the employee is expected to reimburse outside the app.
- Fully private material must not count toward PSI/company spend totals.
- Partial private material remains a separate category; this feature does not calculate a proportional split.
- Reimbursement tracking, payment state, and settlement workflow remain outside Bambuddy and are handled bilaterally on a trust basis.

## Edit Semantics
- Queue UI:
  - users with queue update permission can toggle `private_job`
  - when `private_job` is enabled, they can cycle material usage between:
    - company material
    - private material partial
    - private material full
- Archive UI:
  - users with archive update permission can edit the same state from the archive edit flow
- Printer UI:
  - printer views display current/next job accounting state
  - this feature does not require adding a separate printer-only accounting editor

## Permission Model
- Queue accounting edits use the existing queue update permission model.
- Archive accounting edits use the existing archive update permission model.
- Read-only users still see the accounting badges/cost state but cannot change it.

## API / Propagation Rules
- Queue responses expose all three flags.
- Archive responses expose all three flags.
- When a queue item is archived after printing, its accounting flags must copy to the resulting archive.
- The scheduler handoff must normalize invalid flag combinations to the canonical invariants above.

## Explicit Exclusions
- No stats widgets or charts in this feature branch.
- No queue comments.
- No SD-card behavior.
- No user-owner / slicer-user metadata.
- No billing ledger, invoice generation, reimbursement workflow, or percentage-based cost split engine.
- No unrelated upstream queue/printer/archive refactors.

## Acceptance Criteria
- A queue item can be marked as a private job and retain that state after later edits.
- A private queue item can be categorized as company material, partial private material, or fully private material.
- A non-private queue item is treated as a productive/company job and cannot retain material flags.
- Invalid flag combinations are normalized automatically by the API.
- When a queue item prints and becomes an archive, the archive preserves the same accounting classification.
- Queue, printer, and archive surfaces show the correct private-job and material-state badges.
- A private job with both material flags unset is understood as a reimbursable private print using company material.
- Archive editing reflects the final three-state model built around `private_material_partial`.
