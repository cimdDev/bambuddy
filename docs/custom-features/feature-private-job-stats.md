# Private Job Stats

## Status
Spec v2.

This document defines the reporting delta only. It depends on the private-job accounting feature and must be implemented on top of clean upstream `dev` without reintroducing unrelated dashboard or archive behavior.

## Summary
Build lightweight PSI/private reporting on top of archived accounting data so users can see how many productive versus private jobs were printed, how filament usage splits across material ownership categories, and how much PSI/company material cost was consumed by private work.

## Goal
Answer these questions from the stats/dashboard view:
- How many prints were productive/company work versus private work?
- How much print time was productive/company versus private?
- How much filament weight was:
  - PSI/company material
  - fully private material
  - partially private material
- How much archived print cost is attributable to:
  - PSI/company material
  - partially private material

This feature is for reporting only. It does not add any new accounting workflow.

## Data Source
- The reporting source is archived print data only.
- Queue state is not a reporting source for this feature.
- Date-range filters apply to the archive-based stats query as defined by upstream stats behavior.
- This feature assumes accounting flags have already been copied from queue items into archives by the accounting feature.

## Canonical Reporting Semantics
- Job counts:
  - `private_job = false` counts as productive/company
  - `private_job = true` counts as private
- Print time:
  - split by `private_job`
  - use actual print time when available, otherwise the existing estimated/fallback time used by upstream stats
- Material weight:
  - `private_material = true` -> fully private material bucket
  - `private_material_partial = true` -> partially private material bucket
  - otherwise -> PSI/company material bucket
- Material cost:
  - fully private material does not count toward PSI/company spend totals
  - partial private material is tracked as its own separate bucket
  - private jobs using company material contribute to the PSI/company material-cost bucket because that is company spend, even if reimbursement happens outside the app

## In Scope
- Extend archive stats responses with accounting breakdown fields derived from archive accounting flags.
- Expose, at minimum:
  - productive/company job count and percent
  - private job count and percent
  - material weight totals and percents for PSI/company, full private, and partial private buckets
  - material cost totals and percents for PSI/company, full private, and partial private buckets, with fully private material remaining zero for company spend totals
- Add frontend helpers that aggregate archive lists into the same PSI/private/partial buckets for dashboard widgets and printer breakdown views.
- Update stats/dashboard widgets and charts that intentionally use these accounting breakdowns.
- Add the locale strings required for the PSI/private stats UI.
- Cover the stats API and stats helper bucket logic with focused tests.

## UI Scope
- Dashboard/stats surfaces may show:
  - productive/company vs private print counts
  - productive/company vs private print time
  - filament/material breakdown with a distinct partial-material bucket
  - company-spend cost breakdown that excludes fully private material from company totals
- Per-printer breakdowns may split:
  - print counts by productive/company vs private
  - print time by productive/company vs private
  - filament weight by PSI/company vs full private vs partial private

## Interfaces
- Archive stats API returns an `accounting` block derived from archive accounting flags.
- Stats page helpers aggregate `ArchiveSlim` rows into productive/company, private, and partial-material buckets.
- This feature may add frontend-only helper functions where needed, but it must not redefine unrelated upstream stats contracts.

## Explicit Exclusions
- No changes to how accounting flags are edited or normalized.
- No queue-based reporting source.
- No reimbursement tracking, payment status, or settlement workflow.
- No queue comments or SD-card workflows.
- No unrelated dashboard redesign or upstream stats refactor.

## Acceptance Criteria
- Stats responses include an accounting breakdown derived only from archived data.
- Productive/company and private job counts are split according to `private_job`.
- Filament weight is split into PSI/company, full private, and partial private buckets according to the material flags.
- Material cost reporting excludes fully private material from PSI/company spend totals.
- Dashboard widgets using these helpers show consistent numbers for counts, time, weight, and cost.
- Tests cover the bucket rules for productive/company jobs, private jobs, full private material, and partial private material.
