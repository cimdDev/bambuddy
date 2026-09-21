# Working on this fork

This is upstream Bambuddy plus the PSI custom layer. Before changing anything,
read `docs/custom-features/SOP.md` (how the fork is maintained) and
`docs/custom-features/psi-spec.md` (what the PSI layer does).

Hard rules:

- PSI code lives in `backend/app/custom/` and `frontend/src/custom/` (tests in
  `backend/tests/psi/`, `frontend/src/__tests__/psi/`).
- Upstream files are touched only at the seams in `scripts/psi-seams.txt`:
  insert-only, marked `PSI-SEAM`. No edits to upstream models, schemas,
  routes, `database.py`, `api/client.ts` or the locale files.
- Never restore a file wholesale from another branch.
- Done means `scripts/psi-guard.sh --tests` passes.
- Branch: `psi/main` (rebased onto `upstream/dev`). Push with
  `--force-with-lease`, and only when asked.
