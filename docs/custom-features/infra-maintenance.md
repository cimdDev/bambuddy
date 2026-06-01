# Infra Maintenance

## Status
Spec v2.

This document defines maintenance-only repo changes. It must stay separate from product behavior and should not pull in unrelated upstream file churn.

## Summary
Keep the custom branch workflow documentation, canonical branch reorganization, feature catalog, and `docker compose` image-tagging setup in a dedicated maintenance patch so operators and contributors can work with custom builds without editing tracked files or guessing the rebase procedure.

## Goal
- Make the upstream-rebase workflow explicit and repeatable.
- Make the clean branch layout explicit and repeatable.
- Make feature ownership explicit so future fixes land on the correct branch first.
- Make local/custom image selection explicit and repeatable.
- Keep these repo-maintenance concerns out of user-facing feature branches.

## In Scope
- Define the canonical branch model for the clean patch stack.
- Document the canonical feature list and feature-branch ownership.
- Document the rule that future patches and bug fixes must be made on the owning feature branch first, then replayed onto the integration branch.
- Document the canonical upstream patch-stack workflow in-repo.
- Link that workflow from contributor-facing docs already tracked in the repo.
- Keep `docker-compose.yml` configurable for:
  - image name override
  - image tag override
  - local custom build tagging
  - published upstream image selection
- Keep short usage examples that show safe tagging and rollback-friendly image naming.

## Canonical Interfaces
- `docs/upstream-patch-stack-workflow.md` is the canonical runbook for custom branch replay/rebase work.
- `AGENTS.md` or equivalent contributor-facing repo docs may link to that workflow doc.
- `docker-compose.yml` supports:
  - `BAMBUDDY_IMAGE_NAME`
  - `BAMBUDDY_IMAGE_TAG`

## Canonical Branch Model
- `upstream-track`
  - exact local mirror of `upstream/dev`
- `dev`
  - clean local integration base, normally kept equal to `upstream-track`
- `custom-clean/infra-maintenance`
  - first patch in the clean stack
  - owns maintenance-only repo concerns and the stack organization docs
- `custom-clean/feature-user-owner`
- `custom-clean/feature-private-job-accounting`
- `custom-clean/feature-private-job-stats`
- `custom-clean/feature-queue-comments`
- `custom-clean/feature-sdcard`
- `custom/clean-patch-stack`
  - linear assembled integration branch built from the clean feature branches in canonical order

## Canonical Feature Order
1. `custom-clean/infra-maintenance`
2. `custom-clean/feature-user-owner`
3. `custom-clean/feature-private-job-accounting`
4. `custom-clean/feature-private-job-stats`
5. `custom-clean/feature-queue-comments`
6. `custom-clean/feature-sdcard`

## Canonical Feature Catalog
- `infra-maintenance`
  - branch/workflow documentation
  - feature catalog / ownership guidance
  - `docker compose` image name/tag override behavior
- `feature-user-owner`
  - slicer-user extraction, display, search, and repair flows
- `feature-private-job-accounting`
  - productive/private classification and material ownership flags
- `feature-private-job-stats`
  - archive-based reporting built on accounting flags
- `feature-queue-comments`
  - queue-item-only operator comments
- `feature-sdcard`
  - printer file browser import/move/print/queue workflow

## Ownership Rules
- The clean feature branches are the canonical source of truth for custom behavior.
- `custom/clean-patch-stack` is an assembled integration branch, not the place where feature work should start.
- Future patches and bug fixes must be applied to the owning feature branch first.
- After a fix lands on the owning feature branch, it should be replayed onto `custom/clean-patch-stack`.
- Do not place unrelated fixes on `custom/clean-patch-stack` only.
- Do not mix multiple features into one feature branch just because they touch the same file.
- If a fix spans multiple features, split it by ownership where practical and document any unavoidable dependency clearly.

## Docker Compose Semantics
- Operators should be able to point `docker compose` at:
  - an upstream published image, or
  - a locally built custom image
- They should not need to edit tracked compose files to switch between those cases.
- The examples should encourage versioned, rollback-friendly tags rather than `latest`.
- The compose file may still keep a local build configuration, but the image naming must remain externally overrideable through environment variables.

## Workflow Doc Semantics
- The workflow doc should describe:
  - branch roles in the patch stack
  - canonical feature branches and their order
  - conflict precheck / dry-run rebase
  - real rebase flow
  - safe push behavior after rebasing
- The workflow doc is operational guidance only. It does not itself define product behavior.

## Explicit Exclusions
- No product UI or API behavior changes.
- No printer, archive, queue, stats, or auth behavior changes.
- No generated static asset updates.
- No local-only Codex, IDE, or editor configuration files.
- No incidental upstream housekeeping unless it is strictly required to support the workflow-doc or compose-tagging goals.

## Acceptance Criteria
- Contributors can follow one in-repo runbook to dry-run and perform an upstream rebase of the custom patch stack.
- Contributors can see the canonical clean branch layout and the feature list in repo docs.
- Contributors can determine which branch owns a future patch or bug fix before editing code.
- The first branch in the clean stack establishes the organization rules that keep future work from becoming mixed and messy again.
- Contributor-facing repo docs point to that runbook instead of duplicating conflicting instructions.
- Operators can select upstream or custom images in `docker compose` via environment variables without editing tracked files.
- The compose examples make safe image tagging and rollback usage clear.
