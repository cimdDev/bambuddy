# Custom Clean Bugfix Workflow

This document is the day-to-day SOP for bugfixes after cutover to the clean custom stack.

It complements:

- [`docs/upstream-patch-stack-workflow.md`](docs/upstream-patch-stack-workflow.md)

That runbook covers upstream sync and stack maintenance.
This one covers how to land custom bugfixes without breaking feature ownership or the clean linear stack.

## Core Rules

- Do not implement fixes directly on `custom/patch-stack` only.
- Do not merge feature branches back into `custom/patch-stack`.
- Do not use old messy custom history as implementation input.
- Keep `custom-clean/feature-*` branches as the source of truth.
- Replay fixes onto `custom/clean-patch-stack` after they are committed on the owning feature branch.
- Keep `custom/patch-stack` aligned to `custom/clean-patch-stack`.

## Branch Roles

- `custom-clean/infra-maintenance`
  Use for stack maintenance, workflow docs, and non-feature-specific maintenance changes.
- `custom-clean/feature-user-owner`
  Use for ownership, slicer-user, archive/library ownership, and related permission logic.
- `custom-clean/feature-private-job-accounting`
  Use for private-job accounting behavior and related queue/accounting logic.
- `custom-clean/feature-private-job-stats`
  Use for private-job stats and reporting behavior.
- `custom-clean/feature-queue-comments`
  Use for queue comment behavior and related queue comment UI/API wiring.
- `custom-clean/feature-sdcard`
  Use for printer-file import, SD-card, file-manager import/move, and related flows.
- `custom/clean-patch-stack`
  Linear assembled stack built from the clean feature branches.
- `custom/patch-stack`
  Working branch that should mirror `custom/clean-patch-stack`.

## Intended History Shape

Feature fixes do not merge back into the stack branches.

They are replayed onto the stack, usually with `git cherry-pick`, so:

- the feature branch keeps the canonical fix commit
- the stack gets an equivalent replayed commit
- history stays linear and rebase-friendly

This means the graph will show parallel lines for feature branches and stack branches.
That is expected.

## Standard Bugfix Flow

### 1. Identify the owning feature branch

Choose the branch that owns the behavior being fixed.

If the fix spans multiple features, stop and decide ownership before changing code.
If needed, split the fix into separate commits on separate owning branches.

### 2. Commit the fix on the owning feature branch

Example:

```bash
cd /home/psi/projects/bambuddy

git checkout custom-clean/feature-sdcard
# make the fix
git add <files>
git commit -m "fix(custom): clean up failed printer imports"
```

### 3. Replay the fix onto `custom/clean-patch-stack`

Replay in feature order if multiple fixes are involved.

```bash
git checkout custom/clean-patch-stack
git cherry-pick <feature-branch-fix-commit>
```

### 4. Keep `custom/patch-stack` aligned to `custom/clean-patch-stack`

If `custom/patch-stack` should reflect the assembled clean stack, move or replay it to match.

Preferred:

```bash
git checkout custom/patch-stack
git reset --hard custom/clean-patch-stack
```

Only do this when you intentionally want `custom/patch-stack` to mirror the clean assembled stack exactly.

If the branch is published, push with lease protection:

```bash
git push --force-with-lease origin custom/patch-stack
```

### 5. Push the owning branch and stack branches

```bash
git push origin custom-clean/feature-sdcard
git push origin custom/clean-patch-stack
git push --force-with-lease origin custom/patch-stack
```

## Multi-Fix Example

If a working tree contains fixes for multiple feature areas:

1. Reset the stack worktree back to clean.
2. Check out the first owning feature branch.
3. Apply only that branch's fix.
4. Commit it.
5. Repeat for each other owning branch.
6. Replay the resulting commits onto `custom/clean-patch-stack` in stack order.
7. Re-align `custom/patch-stack` to the updated clean stack.

Do not leave unrelated fixes bundled together on `custom/patch-stack`.

## What To Avoid

- `git merge custom-clean/feature-*` into `custom/patch-stack`
- direct hotfix-only commits on `custom/patch-stack` with no owning feature commit
- mixing multiple feature-owned bugfixes into one commit
- pulling old `custom/patch-stack` history into clean feature branches

## Quick Verification

Use these commands to confirm the shape is right:

```bash
git branch -avv | rg 'custom/patch-stack|custom/clean-patch-stack|custom-clean/'
git log --oneline --decorate --graph --max-count=20 --all --simplify-by-decoration
git status
```

Healthy signs:

- owning `custom-clean/feature-*` branches contain the canonical bugfix commits
- `custom/clean-patch-stack` contains replayed equivalents in linear order
- `custom/patch-stack` matches or intentionally mirrors `custom/clean-patch-stack`
- no stray uncommitted fixes are left on the stack branch

### 🧹 Feature Branch Cleanup and Squashing SOP

When developing a new feature on a separate branch, the commit history can become messy (e.g., "fix stuff", "oops", "remove debug"). Before merging or cherry-picking, the history must be cleaned up to contain only meaningful, atomic commits.

**Goal:** To squash a series of commits into a clean, logical sequence of changes that represent the feature's evolution.

**Recommended Tool:** Interactive Rebase (`git rebase -i`).

**Workflow Steps:**

1.  **Checkout and Rebase:**
    ```bash
    git checkout my-feature
    git fetch origin
    git rebase -i origin/main # Replace origin/main with the target branch
    ```

2.  **Interactive Rebase Editor:**
    An editor will open showing your commits. You must edit the instructions to combine them:
    *   Use `pick <commit>` for commits you want to keep as is.
    *   Use `squash <commit>` to combine the changes of `<commit>` into the previous commit (and you will be prompted to write a combined commit message).
    *   Use `fixup <commit>` to combine the changes of `<commit>` into the previous commit, but **discard** the commit message of `<commit>`.

    **Example Transformation:**
    ```
    pick a1 First attempt
    squash b2 fix stuff
    fixup c3 remove debug
    pick d4 final implementation
    ```

3.  **Save and Exit:** Save and close the editor. Git will replay the branch and combine the commits according to your instructions.

4.  **Verification:**
    *   Check the new history: `git log --oneline`
    *   Check the difference from the target branch: `git diff origin/main`

5.  **Pushing the Clean History:**
    If this branch already exists remotely, you must force push to overwrite the history:
    ```bash
    git push --force-with-lease
    ```

**Advanced Tips:**

*   **`--autosquash`:** When fixing an older commit, use `git commit --fixup <old-commit-hash>` followed by `git rebase -i --autosquash origin/main`. Git will automatically place the fix commit next to the original and mark it as a fixup.

**Final Integration:**
After cleaning the branch, you can either:
*   **Merge:** `git checkout main` followed by `git merge --no-ff my-feature`
*   **Cherry-Pick:** `git checkout patchstack` followed by `git cherry-pick <commit1> <commit2> <commit3>`
