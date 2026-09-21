# SOP — keeping the PSI layer on top of upstream Bambuddy

What the layer does is in [psi-spec.md](psi-spec.md). This document is how to
keep it working when upstream moves, how to change it, and how to ship it.

---

## TL;DR — update to a new upstream

```bash
git fetch upstream
git switch psi/main
git branch backup/psi-main-$(date +%Y%m%d) psi/main       # cheap insurance
git rebase upstream/dev                                    # conflicts only at seams, see §4.2
cd frontend && npm ci && cd ..                             # upstream's deps move too
scripts/psi-guard.sh --tests                               # must pass
venv/bin/python -m pytest backend/tests -q -n 3 --ignore=…   # full command + known failures: §8
(cd frontend && npx vitest run && node scripts/check-i18n-parity.mjs)
scripts/psi-deploy.sh build  <upstream-version>-psi.<n>
scripts/psi-deploy.sh deploy <upstream-version>-psi.<n>
# then walk the checklist in §7.3
```

---

## 1. Principles

These are the rules that make an upstream update a routine task. Each one
exists because an earlier generation of this fork broke on exactly that point.

1. **Overlay, not patch.** PSI code lives in PSI directories. Upstream files
   are touched only at *seams*: one import and one insertion (two in `StatsPage.tsx`),
   marked `PSI-SEAM`. There are ten seam files in total (§4.1), all insert-only.
2. **Upstream's models, schemas, routes and client stay untouched.** PSI
   reaches its database columns through its own SQLAlchemy Core *shadow
   tables* (`backend/app/custom/psi/tables.py`), its own API
   (`/api/v1/psi`), its own frontend client (`frontend/src/custom/psi/api.ts`)
   and its own translations (`frontend/src/custom/psi/i18n.ts`).
3. **Hook into data, not into code paths.** The per-run classification is an
   ORM `after_insert` listener on `PrintLogEntry`; users are read lazily from
   the stored file. No hunk in the scheduler, the archive service or any of the
   places upstream creates archives.
4. **Never restore a shared file wholesale** from another branch
   (`git checkout old -- file`, copying a file over). That single operation
   cost an earlier rebuild 298 type errors. Seams are re-applied by hand.
5. **One branch, a few commits.** `psi/main` = `upstream/dev` + the PSI
   commits. No sibling feature branches, no assembled branch, nothing to
   replay twice.
6. **The gate is the definition of done.** `scripts/psi-guard.sh --tests`
   passes, upstream's suites show only the known failures.
7. **Migrations are additive and idempotent.** Add columns, fill `NULL`s.
   Never drop, rename or rewrite a column; old images keep working on the new
   database, which is what makes rollback safe.

## 2. Where things live

```
backend/app/custom/
  __init__.py            install(app) + startup()   ← called from the two main.py seams
  migrations.py          custom-migration runner (idempotent, never fatal)
  psi/
    tables.py            shadow tables + PSI_COLUMNS (the only DDL list)
    classification.py    the four classes, legacy mapping, resolution
    printer_notes.py     reads User= from stored 3MF/G-code
    runs.py              PrintLogEntry hook + the one SQL rule for a run's class
    service.py           card data, edits and how they spread, lazy users
    accounting.py        stats/accounting over runs (mirrors upstream's filters)
    material_prices.py   price per material, written onto spools by a Spool hook
    migrations.py        PSI columns + carry-over of earlier builds' data
    routes.py            /api/v1/psi
backend/tests/psi/       PSI backend tests (unit + integration)
frontend/src/custom/psi/
  index.ts               the only module upstream files import
  api.ts  hooks.ts  metaLoader.ts  model.ts  i18n.ts  …
  components/PsiJobStrip.tsx   the seam component
  pages/PsiAccountingPage.tsx   (+ components/PsiMaterialPrices.tsx below it)
frontend/src/__tests__/psi/    PSI frontend tests
scripts/psi-guard.sh     the gate
scripts/psi-seams.txt    the seam allowlist (enforced)
scripts/psi-deploy.sh    build / deploy / rollback
deploy/psi/compose.psi.yml     image override, layered over upstream's compose file
docs/custom-features/    spec, SOP, README
AGENTS.md                pointer for coding agents (a local, gitignored CLAUDE.md may import it: `@AGENTS.md`)
```

## 3. Branches and tags

| Ref | Role |
|---|---|
| `upstream/dev` | upstream, read-only |
| `psi/main` | **the** PSI branch: upstream/dev + PSI commits. Deploy from here. |
| `psi-release/<tag>` | tag set by `psi-deploy.sh build` on the commit an image was built from |
| `backup/…` | safety copies before rebases; delete when no longer needed |

`psi/main` carries these commits, in this order:

1. `psi(ops)` — gate, seam list, deploy script, docs, agent pointers
2. `psi(core)` — backend layer and its tests, the two `main.py` seams
3. `psi(ui)` — frontend layer and its tests, the eight frontend seams

Keep it that way. A fix goes into the commit it belongs to (§5.2), so the
stack stays three commits that each make sense on their own.

Everything under `custom-clean*/…`, `custom/…`, `archive/rewrite-v1/…`,
`build/…`, `rewrite/…` and the older `backup/…` branches is history from
earlier generations of this fork. Nothing reads them any more; delete them
when you are sure you do not want to look at them again.

Pushing: `psi/main` is rewritten by every rebase, so push with
`git push --force-with-lease origin psi/main`. Never plain `--force`.

## 4. Updating to a new upstream

### 4.1 The seams

`scripts/psi-seams.txt` is the authoritative list. What each seam is and how
to find its place again when upstream moved the code around it:

| File | Seam | Anchor to look for |
|---|---|---|
| `backend/app/main.py` | `psi_custom_install(app)` | after the last `app.include_router(...)`, **before** the static mounts / SPA catch-all |
| `backend/app/main.py` | `await psi_custom_startup()` | in `lifespan`, right after `await init_db()` |
| `pages/ArchivesPage.tsx` | card strip | in `ArchiveCard`, just before the flex spacer above the date/size footer |
| `pages/ArchivesPage.tsx` | list strip (compact) | in `ArchiveListRow`, under the name line |
| `pages/QueuePage.tsx` | card strip | in `SortableQueueItem`, after the option badges, before the progress bar |
| `components/CompactHistoryRow.tsx` | compact strip | after the meta row, before the error message |
| `pages/PrintersPage.tsx` | running job strip | in `PrinterCard`, just before `<PrinterQueueWidget`; needs `isActivePrint`, `printingQueueItems`, `activeArchiveId` in scope |
| `components/PrinterQueueWidget.tsx` | readonly strip | under the next item's name, **inside** the `<Link>` → `variant="readonly"` |
| `pages/FileManagerPage.tsx` | card strip | in `FileCard`, before the last-modified line |
| `pages/FileManagerPage.tsx` | list strip (compact) | in the list row, under the name |
| `pages/StatsPage.tsx` | `...psiStatsWidgets({...})` | at the end of the `widgets` array |
| `pages/StatsPage.tsx` | `psiSplitStatsWidgets(widgets, {...})` | the statement right after the `widgets` array; swaps the charts of `print-activity` and `printer-stats` in place |
| `App.tsx` | import from `./custom/psi/app` + `<Route path="psi" …>` | next to the other routes inside the `Layout` route. Importing `custom/psi/app` also inserts the sidebar entry into upstream's exported `defaultNavItems` (after `stats`) rather than editing the array literal — upstream's tests pin that list. The route requires `PSI_ACCOUNTING_PERMISSION`. |
| `components/Layout.tsx` | import from `../custom/psi/permissions` + `...psiNavPermissions,` | at the end of the `navPermissions` object literal inside `Layout` (the map from nav id to required permission). Imports `custom/psi/permissions` directly, not `custom/psi`: `nav.ts` imports `Layout`, so going through the index would be a cycle. |

Each seam file also has one `import … from '…/custom/psi'; // PSI-SEAM`.

### 4.2 Resolving a rebase conflict

Conflicts can only happen in the ten seam files, because nothing else of
upstream's is modified.

1. Take **upstream's** side of the file completely. During a rebase, "ours"
   is upstream and "theirs" is the PSI commit being replayed:
   `git checkout --ours <file>`.
2. Re-insert the import line and the seam line at the anchor from §4.1. See
   them with `git show REBASE_HEAD -- <file>` (the PSI commit's diff for that
   file) and copy the lines, never the file.
3. If the anchor no longer exists (upstream redesigned the component), place
   the seam where the same information is shown now. The strip needs only
   `entity` and `id`; it adapts to any container. Update §4.1.
4. `git add <file> && git rebase --continue`.

### 4.3 After the rebase — what else can break, and how you notice

| Upstream change | Symptom | Fix |
|---|---|---|
| renamed/dropped a column PSI reads | `test_upstream_columns_psi_reads_still_exist` fails | update `tables.py` (and the code using it) |
| added a column with a PSI name | `test_psi_columns_do_not_collide_with_upstream` fails | see §4.4 |
| saves spools outside the ORM (Core `insert/update` on `spool`) | `test_upstreams_spool_route_fills_the_price` fails, or new spools stay unpriced | price them in that path's place: listener or a seam |
| stopped writing runs through the ORM | `TestRunHook` fails; in production new runs get classified only at next startup | find the new write path; hook it the same way (listener or a seam) |
| changed the stats filters or duration rule | `test_reconciles_with_upstream_stats` fails | mirror the change in `accounting.run_filters` / `run_seconds` |
| renamed permissions or auth helpers | import error / route tests fail | follow the rename in `routes.py`, `service.Caller` |
| moved a UI component a seam imports from (`Button`, `Card`, `MetricToggle`, `Dashboard` type, `ToastContext`, `api/client` `getAuthToken`/`ApiError`) | `tsc` fails in `src/custom/psi` | follow the move |
| stopped exporting `defaultNavItems` from `Layout.tsx`, or froze it | `tsc` fails in `custom/psi/nav.ts`, or the sidebar entry is gone | find the new nav registry and follow it with `nav.ts` |
| moved or renamed the `navPermissions` map in `Layout.tsx` | the rebase conflicts there, or `psiAccountingAccess.test.tsx` fails (entry visible without the permission) | re-insert `...psiNavPermissions,` wherever nav ids are mapped to permissions now |
| changed the permission registry (`ALL_PERMISSIONS`, `PERMISSION_CATEGORIES`, the group label overrides) | `test_psi_permissions.py` fails; the PSI card is missing from the group editor, or admins lose the accounting | follow the change in `custom/psi/permissions.py` |
| renamed the `print-activity` / `printer-stats` widget ids, or changed what `/archives/slim` returns | `psiStatsSplit.test.tsx` or `test_chart_runs_mirror_upstreams_slim_listing` fails; on screen the unsplit charts are back | follow the ids in `PSI_SPLIT_WIDGETS`; mirror the slim change in `accounting.chart_runs` |
| added a new route catch-all or middleware order change | `/api/v1/psi/*` returns HTML | move the `install()` seam before it |
| changed the security route-coverage test | `test_route_auth_coverage` fails | every PSI route needs an auth dependency |

### 4.4 Column collision

If upstream adds a column PSI already uses (e.g. `print_queue.notes`,
`print_archives.slicer_user`):

1. Decide whether upstream's column means the same thing.
2. Same meaning → switch PSI to upstream's column: point the shadow table at
   it, add a data migration that copies PSI values into it where upstream's is
   `NULL`, drop the name from `PSI_COLUMNS`. The old PSI column stays unused.
3. Different meaning → rename the PSI column (`psi_` prefix), with a copying
   migration. New PSI columns are always `psi_`-prefixed for this reason.

## 5. Changing the PSI layer

### 5.1 Where a change goes

* Behaviour, data, API → `backend/app/custom/psi/`, tests in `backend/tests/psi/`.
* UI → `frontend/src/custom/psi/`, tests in `frontend/src/__tests__/psi/`.
* New text → all four languages in `custom/psi/i18n.ts` (`psiI18n.test.ts`
  checks they match).
* New column → add it to `PSI_COLUMNS` (and the shadow table). Never
  `database.py`, never an upstream model.
* The spec changes with the behaviour, in the same commit.

### 5.2 Committing a fix into its commit

```bash
git commit --fixup=<sha of psi(core) or psi(ui) or psi(ops)>
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash upstream/dev
scripts/psi-guard.sh --tests
```

### 5.3 Adding a seam

Only if a surface cannot be reached otherwise. Then:

1. Keep it to one import plus one insertion, no edits to upstream lines.
2. Mark it `PSI-SEAM`, add the file to `scripts/psi-seams.txt`, add the row to
   §4.1 and to the surfaces table in the spec.
3. `scripts/psi-guard.sh` must pass.

## 6. Data and migrations

* Runs on every start, after upstream's `init_db()`. Idempotent; a failure is
  logged, never fatal — the PSI layer then stays off (run hook disabled) and
  upstream runs normally.
* Carry-over from earlier PSI builds happens once by construction (fills only
  `NULL`s, from columns nothing writes any more): old booleans → `psi_class`,
  `print_queue.comment` → `psi_notes`, library `file_metadata` users → columns.
* A startup background task reads the user from every file not read yet
  (logged as `PSI: read the user from N files`).
* Rollback to an older image works: it sees its old columns and ignores the
  new ones. Edits made in the new image are not visible there.

## 7. Release, deploy, rollback

### 7.1 Tags

`<upstream APP_VERSION>-psi.<major>.<minor>`, e.g. `1.2.6b1-psi.3.0`.
`APP_VERSION` is in `backend/app/core/config.py`. Bump *minor* for PSI-only
changes, *major* for a PSI redesign. Never `latest`.

### 7.2 Commands

```bash
scripts/psi-deploy.sh build    1.2.6b1-psi.3.0   # clean tree required; runs the gate; tags the commit
scripts/psi-deploy.sh deploy   1.2.6b1-psi.3.0   # online DB backup into the data volume, then up -d
scripts/psi-deploy.sh rollback 1.2.6b1-psi.2.3   # any earlier built tag
scripts/psi-deploy.sh images
```

Do not run a bare `docker compose up -d` in this directory: upstream's
compose file points at upstream's public image. The PSI image comes from
`deploy/psi/compose.psi.yml`, which the script layers on top.

### 7.3 Checklist after a deploy

- [ ] `docker logs bambuddy | grep PSI` — migrations ran, no `failed`
- [ ] Archives: user chip, class chip and note on cards and list rows
- [ ] An archive without `User=` shows "No user"; repair it, reload, it sticks
- [ ] Queue: set a pending job to private; add a note; both survive a reload
- [ ] Printer card while printing: strip under the job; "next in queue" read-only
- [ ] File manager: strip on 3MF files, note only on STL
- [ ] Stats: the two PSI widgets; their job counts add up to "Total prints"
- [ ] `/psi`: this month's table; export CSV opens in Excel with umlauts intact
- [ ] `/psi` material prices: set a price, a spool of that material without its own price shows it in the inventory

## 8. Tests

```bash
scripts/psi-guard.sh --tests                         # gate + PSI tests
venv/bin/python -m pytest backend/tests -q -n 3 \
  --ignore=backend/tests/unit/services/test_ldap_service.py \
  --ignore=backend/tests/unit/test_spoolbuddy_ssh.py \
  --ignore=backend/tests/integration/test_ldap_provision.py \
  --ignore=backend/tests/integration/test_local_login_gate.py \
  --ignore=backend/tests/integration/test_spoolbuddy.py
(cd frontend && npx vitest run && node scripts/check-i18n-parity.mjs)
```

Known failures on this machine that are not PSI's (missing optional
dependencies and rendering libraries; they fail identically on plain
upstream): `test_ldap_group_sync` (5), `test_virtual_printer_api` CA
certificate (2), `test_settings_api_key_scrubbing::…inventory_update` (1),
`test_plate_thumbnail` (6), `test_stl_thumbnail` (2). The ignored files fail
at collection (`asyncssh` missing). Frontend: `Layout.test.tsx` "hides the
MakerWorld nav entry…" fails on plain upstream `f98381f3d` as well.
