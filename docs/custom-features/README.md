# PSI custom features

This fork adds one thing to upstream Bambuddy: **PSI job tracking**. On every
card where a print appears (printer, queue, archive, file manager) you see who
sliced it, whether it is a PSI or a private job and whose filament it used,
and a note. The statistics and the PSI accounting page (`/psi`) add it up.

| Document | For |
|---|---|
| [psi-spec.md](psi-spec.md) | what the layer does, exactly; decisions; corrections to earlier specs |
| [SOP.md](SOP.md) | updating to a new upstream, changing the layer, deploying, rolling back |

Code: `backend/app/custom/`, `frontend/src/custom/`. Upstream files are
touched only at the ten seam files in `scripts/psi-seams.txt`.

## Retired

| Feature / document | Status |
|---|---|
| SD card / printer file browser (`feature-sdcard`) | **deprecated** — no longer used, not implemented |
| Queue comments (`feature-queue-comments`) | replaced by print notes; existing comments were carried over |
| User owner, private-job accounting, private-job stats, print notes (separate specs) | merged into [psi-spec.md](psi-spec.md) |
| Rebuild handoffs, `infra-maintenance`, sibling `custom-clean*` branches | replaced by [SOP.md](SOP.md) and the single `psi/main` branch |

The old documents are still in git history (`custom-clean-v3/*` branches) if
you ever need to look something up; none of them is current.
