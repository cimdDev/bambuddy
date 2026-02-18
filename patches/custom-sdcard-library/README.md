# Custom SD-Card File Manager Patch Set

This folder contains a custom patch series against branch/tag `0.2.1b`.

## Included changes
1. SD card File Manager actions (`Print`, `Schedule Print`, `Move to Bambuddy`).
2. Default sorting in printer SD File Manager changed to `Date (newest)`.
3. Backend/API support to import printer SD files into Bambuddy library storage.

## Apply to a clean 0.2.1b checkout

```bash
git checkout 0.2.1b
git checkout -b custom/sdcard-library-patch-021b
git am patches/custom-sdcard-library/*.patch
```

## Validate

```bash
cd frontend && npm run test:run -- src/__tests__/components/FileManagerModal.test.tsx
cd .. && ./venv/bin/python -m pytest backend/tests/integration/test_printers_api.py -q
```

## Notes
- This patch is intended as a custom workflow overlay.
- If you keep pre-commit enabled globally, commit hooks may require `pytest` available for `/usr/bin/python`.
