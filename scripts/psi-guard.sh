#!/usr/bin/env bash
#
# PSI gate. Run before every commit that is meant to be deployed, and after
# every rebase onto a new upstream. See docs/custom-features/SOP.md.
#
#   1. Seam budget: every file that differs from upstream is either owned by
#      the PSI layer (its own directories) or listed in scripts/psi-seams.txt.
#   2. Seams are insertions only (no deleted upstream line) and each seam file
#      carries a PSI-SEAM marker in what it adds.
#   3. Nothing upstream deleted comes back; no build output is committed.
#   4. The frontend typechecks with zero errors.
#   5. (--tests) the PSI backend and frontend tests pass.
#
# Usage: scripts/psi-guard.sh [--base <ref>] [--no-typecheck] [--tests]
set -uo pipefail

BASE="upstream/dev"
RUN_TYPECHECK=1
RUN_TESTS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --no-typecheck) RUN_TYPECHECK=0; shift ;;
    --tests) RUN_TESTS=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "psi-guard: unknown option $1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)" || exit 2
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "psi-guard: base '$BASE' not found (git fetch upstream?)" >&2; exit 2; }
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

# Paths the PSI layer owns outright. Anything here may change freely.
OWNED_RE='^(backend/app/custom/|backend/tests/psi/|frontend/src/custom/|frontend/src/__tests__/psi/|docs/custom-features/|deploy/psi/|scripts/psi-|AGENTS\.md$)'
mapfile -t SEAMS < <(grep -vE '^\s*(#|$)' scripts/psi-seams.txt | awk '{print $1}')

FAILED=0
fail() { FAILED=1; echo "  FAIL: $1"; }
is_seam() { local f; for f in "${SEAMS[@]}"; do [ "$f" = "$1" ] && return 0; done; return 1; }

echo "psi-guard: $(git rev-parse --short "$MERGE_BASE") (merge-base with $BASE) .. $(git rev-parse --short HEAD)"
echo

echo "[1/4] seam budget"
while IFS=$'\t' read -r added removed path; do
  [ -z "${path:-}" ] && continue
  if [[ "$path" =~ $OWNED_RE ]]; then continue; fi
  if ! is_seam "$path"; then
    fail "$path is an upstream file outside the seam list (scripts/psi-seams.txt). Move the change into the PSI layer, or add a seam deliberately."
    continue
  fi
  if [ "$removed" != "0" ]; then
    fail "$path deletes $removed upstream line(s). Seams are insertions only."
  fi
  if ! git diff "$MERGE_BASE" -- "$path" | grep -q '^+.*PSI-SEAM'; then
    fail "$path has no PSI-SEAM marker in its added lines."
  fi
done < <(git diff --numstat "$MERGE_BASE")
[ "$FAILED" -eq 0 ] && echo "  ok: $(git diff --name-only "$MERGE_BASE" | grep -cvE "$OWNED_RE") upstream file(s) touched, all listed seams, insert-only"
echo

echo "[2/4] resurrected modules and build output"
CHANGED="$(git diff --name-only --diff-filter=A "$MERGE_BASE")"
for dead in backend/app/services/background_dispatch.py; do
  grep -qxF "$dead" <<< "$CHANGED" && fail "$dead is back; upstream deleted it."
done
grep -q '^static/assets/' <<< "$(git diff --name-only "$MERGE_BASE")" && fail "build output under static/assets/ is in the diff."
[ "$FAILED" -eq 0 ] && echo "  ok"
echo

echo "[3/4] frontend typecheck"
if [ "$RUN_TYPECHECK" -eq 0 ]; then
  echo "  skipped"
elif [ ! -d frontend/node_modules ]; then
  fail "frontend/node_modules missing — run 'npm ci' in frontend/."
else
  OUT="$(cd frontend && npx tsc -p tsconfig.app.json --noEmit 2>&1)"
  if [ -n "$OUT" ]; then fail "tsc errors:"; head -30 <<< "$OUT" | sed 's/^/         /'; else echo "  ok: zero errors"; fi
fi
echo

echo "[4/4] PSI tests"
if [ "$RUN_TESTS" -eq 0 ]; then
  echo "  skipped (pass --tests)"
else
  PY="${PYTHON:-venv/bin/python}"
  "$PY" -m pytest backend/tests/psi -q -p no:cacheprovider >/tmp/psi-guard-backend.log 2>&1 \
    && echo "  ok: backend ($(tail -1 /tmp/psi-guard-backend.log))" \
    || { fail "backend PSI tests failed:"; tail -20 /tmp/psi-guard-backend.log | sed 's/^/         /'; }
  (cd frontend && npx vitest run src/__tests__/psi >/tmp/psi-guard-frontend.log 2>&1) \
    && echo "  ok: frontend" \
    || { fail "frontend PSI tests failed:"; tail -20 /tmp/psi-guard-frontend.log | sed 's/^/         /'; }
fi
echo

if [ "$FAILED" -ne 0 ]; then echo "psi-guard: GATE FAILED"; exit 1; fi
echo "psi-guard: gate passed"
