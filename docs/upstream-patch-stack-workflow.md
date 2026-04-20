# Upstream `dev` + Custom Patch Stack Workflow

This repo uses a 3-branch stack:

- `upstream-track`: exact mirror of `upstream/dev`
- `dev`: local integration base (also kept equal to `upstream/dev`)
- `custom/patch-stack`: custom commits rebased on top of `dev`

## What happens to `origin/*` branches?

Nothing changes on `origin/*` until you push.

After a local rebase:

- `origin/dev` stays where it was
- `origin/custom/patch-stack` stays where it was
- local branches move, remote branches do not

## Standard update procedure

Run from a clean worktree:

```bash
git status
```

If not clean, commit or stash first.

### 1) Fetch latest upstream

```bash
git fetch upstream
```

### 2) Conflict precheck (safe dry run)

This checks rebase conflicts without touching your real branch:

```bash
git checkout -B tmp/rebase-conflict-check custom/patch-stack
git rebase upstream/dev
```

If conflicts appear, inspect and note files. Then clean up:

```bash
git rebase --abort
git checkout custom/patch-stack
git branch -D tmp/rebase-conflict-check
```

If no conflicts:

```bash
git checkout custom/patch-stack
git branch -D tmp/rebase-conflict-check
```

### 3) Real update

```bash
git checkout upstream-track
git reset --hard upstream/dev

git checkout dev
git reset --hard upstream-track

git checkout custom/patch-stack
git rebase dev
```

If rebase stops on conflicts:

```bash
# resolve files
git add <resolved-files>
GIT_EDITOR=true git rebase --continue
# repeat until done
```

### 4) Push

`custom/patch-stack` is rebased history, so use force-with-lease:

```bash
git push --force-with-lease origin custom/patch-stack
```

`dev` should usually be a fast-forward to newer upstream commits:

```bash
git push origin dev
```

If `origin/dev` diverged and you intentionally want it to mirror `upstream/dev`, use:

```bash
git push --force-with-lease origin dev
```

## Quick verification commands

```bash
git rev-parse --short upstream/dev
git rev-parse --short upstream-track
git rev-parse --short dev
git log --oneline --decorate --graph --max-count=20 custom/patch-stack
```

