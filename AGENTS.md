# Agents Notes

## Custom Clean Patch Stack Workflow

When working on the maintained custom patch stack, use:

- [`docs/upstream-patch-stack-workflow.md`](docs/upstream-patch-stack-workflow.md)

This is the canonical runbook for:

- branch roles and canonical feature ownership
- conflict precheck (dry-run rebase)
- replay flow for `upstream-track` -> `dev` -> `custom-clean/*` -> `custom/clean-patch-stack`
- safe push behavior for rebased branches (`--force-with-lease`)

