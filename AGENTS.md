# Agents Notes

## Upstream + Patch Stack Workflow

When syncing latest `upstream/dev` into local branches while preserving custom commits, use:

- [`docs/upstream-patch-stack-workflow.md`](docs/upstream-patch-stack-workflow.md)

This is the canonical runbook for:

- conflict precheck (dry-run rebase)
- real rebase flow for `upstream-track` -> `dev` -> `custom/patch-stack`
- safe push behavior for rebased branches (`--force-with-lease`)

