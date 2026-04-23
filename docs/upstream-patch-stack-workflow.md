# Upstream `dev` + Custom Clean Patch Stack Workflow

This repo uses a clean custom stack on top of `upstream/dev`.

## Canonical Branch Model

- `upstream-track`
  - exact local mirror of `upstream/dev`
- `dev`
  - clean local integration base, normally kept equal to `upstream-track`
- `custom-clean/infra-maintenance`
  - maintenance root for the custom stack
- `custom-clean/feature-user-owner`
- `custom-clean/feature-private-job-accounting`
- `custom-clean/feature-private-job-stats`
- `custom-clean/feature-queue-comments`
- `custom-clean/feature-sdcard`
- `custom/clean-patch-stack`
  - linear assembled integration branch used for validation and release

## Canonical Feature Order

1. `custom-clean/infra-maintenance`
2. `custom-clean/feature-user-owner`
3. `custom-clean/feature-private-job-accounting`
4. `custom-clean/feature-private-job-stats`
5. `custom-clean/feature-queue-comments`
6. `custom-clean/feature-sdcard`

## Ownership Rules

- The `custom-clean/feature-*` branches are the canonical source of truth for custom behavior.
- `custom/clean-patch-stack` is an assembled branch, not the place where feature work should begin.
- New patches and bug fixes go onto the owning feature branch first.
- After a fix lands on the owning feature branch, replay it onto `custom/clean-patch-stack`.
- Do not place unrelated fixes only on `custom/clean-patch-stack`.
- If a change touches multiple features, split it by ownership where practical.

## What Happens To `origin/*` Branches?

Nothing changes on `origin/*` until you push.

After a local rebase:

- `origin/dev` stays where it was
- `origin/custom/clean-patch-stack` stays where it was
- local branches move, remote branches do not

## Standard Update Procedure

Run from a clean worktree:

```bash
git status
```

If not clean, commit or stash first.

### 1) Fetch Latest Upstream

```bash
git fetch upstream
```

### 2) Conflict Precheck (Safe Dry Run)

This checks likely conflicts without touching your real clean stack:

```bash
git checkout -B tmp/rebase-conflict-check custom/clean-patch-stack
git rebase upstream/dev
```

If conflicts appear, inspect and note files. Then clean up:

```bash
git rebase --abort
git checkout custom/clean-patch-stack
git branch -D tmp/rebase-conflict-check
```

If no conflicts:

```bash
git checkout custom/clean-patch-stack
git branch -D tmp/rebase-conflict-check
```

### 3) Refresh The Clean Base

```bash
git checkout upstream-track
git reset --hard upstream/dev

git checkout dev
git reset --hard upstream-track
```

### 4) Rebase The Canonical Feature Branches

Rebase each feature branch onto its owning base:

```bash
git checkout custom-clean/infra-maintenance
git rebase dev

git checkout custom-clean/feature-user-owner
git rebase custom-clean/infra-maintenance

git checkout custom-clean/feature-private-job-accounting
git rebase custom-clean/infra-maintenance

git checkout custom-clean/feature-private-job-stats
git rebase custom-clean/feature-private-job-accounting

git checkout custom-clean/feature-queue-comments
git rebase custom-clean/infra-maintenance

git checkout custom-clean/feature-sdcard
git rebase custom-clean/infra-maintenance
```

If rebase stops on conflicts:

```bash
# resolve files
git add <resolved-files>
GIT_EDITOR=true git rebase --continue
# repeat until done
```

### 5) Rebuild `custom/clean-patch-stack`

Recreate the assembled branch from the clean base and replay the feature ranges in canonical order:

```bash
git checkout custom/clean-patch-stack
git reset --hard dev

git cherry-pick dev..custom-clean/infra-maintenance
git cherry-pick custom-clean/infra-maintenance..custom-clean/feature-user-owner
git cherry-pick custom-clean/infra-maintenance..custom-clean/feature-private-job-accounting
git cherry-pick custom-clean/feature-private-job-accounting..custom-clean/feature-private-job-stats
git cherry-pick custom-clean/infra-maintenance..custom-clean/feature-queue-comments
git cherry-pick custom-clean/infra-maintenance..custom-clean/feature-sdcard
```

### 6) Push

The clean stack branches are rebased history, so use force-with-lease:

```bash
git push --force-with-lease origin custom-clean/infra-maintenance
git push --force-with-lease origin custom-clean/feature-user-owner
git push --force-with-lease origin custom-clean/feature-private-job-accounting
git push --force-with-lease origin custom-clean/feature-private-job-stats
git push --force-with-lease origin custom-clean/feature-queue-comments
git push --force-with-lease origin custom-clean/feature-sdcard
git push --force-with-lease origin custom/clean-patch-stack
```

`dev` should usually be a fast-forward to newer upstream commits:

```bash
git push origin dev
```

If `origin/dev` diverged and you intentionally want it to mirror `upstream/dev`, use:

```bash
git push --force-with-lease origin dev
```

## Quick Verification Commands

```bash
git rev-parse --short upstream/dev
git rev-parse --short upstream-track
git rev-parse --short dev
git log --oneline --decorate --graph --max-count=30 custom/clean-patch-stack
```

