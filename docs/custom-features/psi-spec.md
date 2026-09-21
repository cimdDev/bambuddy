# PSI job tracking — specification

Status: **v4** (2026-09-21). Replaces every earlier document in this folder
(`feature-user-owner`, `feature-private-job-accounting`,
`feature-private-job-stats`, `feature-print-notes`, `feature-queue-comments`,
`feature-sdcard`, `infra-maintenance`, the rebuild handoffs). Where this
document disagrees with them, this document is right; the differences are
listed under [Corrections](#corrections-to-earlier-specs).

How the layer is kept on top of upstream is in [SOP.md](SOP.md).

---

## 1. What it is for

Every print at PSI answers four questions, on every card where a print appears:

| Question | Field | Default |
|---|---|---|
| Who sliced it? | **User**, from `User=` in the slicer's printer notes | missing (shown as a warning) |
| Company or private work? | **Job type**: PSI / private | PSI |
| Whose filament? | **Material**: PSI / partly own / own (private jobs only) | PSI material |
| Anything to know? | **Note**, one free text | none |

And the statistics and the accounting page must add these up correctly: how
much was company work, how much private, and what each person owes for private
work printed on PSI material.

## 2. Surfaces

One component, `<PsiJobStrip entity id variant />`, is placed once on each
surface. It shows the user chip, the class chip and the note, loads its own
data, knows its own permissions and saves its own edits.

| Surface | Record | Variant | Seam file |
|---|---|---|---|
| Archive card | archive | card | `pages/ArchivesPage.tsx` |
| Archive list row | archive | compact | `pages/ArchivesPage.tsx` |
| Queue card (pending, printing) | queue item | card | `pages/QueuePage.tsx` |
| Queue history row | queue item | compact | `components/CompactHistoryRow.tsx` |
| Printer card, running job | queue item, else archive | compact | `pages/PrintersPage.tsx` |
| Printer card, "next in queue" | queue item | readonly | `components/PrinterQueueWidget.tsx` |
| File manager card | library file | card | `pages/FileManagerPage.tsx` |
| File manager list row | library file | compact | `pages/FileManagerPage.tsx` |
| Stats dashboard | runs | 2 widgets | `pages/StatsPage.tsx` |
| PSI accounting page (`/psi`) + sidebar entry | runs | page | `App.tsx` |

`readonly` exists because the "next in queue" tile is one `<Link>`; a button
inside an anchor is invalid markup. Library files that are not print jobs
(STL, STEP, …) show the note only.

The sidebar entry "PSI accounting" sits after Stats and is shown to everyone
(upstream's per-entry permission map is internal to `Layout.tsx`); the page
itself requires `stats:read`, like upstream's Stats page.

## 3. Data model

All PSI columns are added by the PSI migration to upstream tables. Upstream's
ORM models do not know them (see SOP, "Shadow tables").

| Table | Column | Meaning |
|---|---|---|
| `print_archives` | `slicer_user`, `slicer_user_email` | who sliced it |
| | `psi_user_checked` | fingerprint of the file the user was read from, or `manual` |
| | `psi_class` | class, `NULL` = inherit |
| | `notes` (upstream's) | the archive's note |
| `library_files` | `slicer_user`, `slicer_user_email`, `psi_user_checked` | as above |
| | `psi_class` | default class for jobs from this file |
| | `notes` (upstream's) | the file's note |
| `print_queue` | `psi_class` | class of this job, `NULL` = inherit |
| | `psi_notes` | the job's note |
| `print_log_entries` | `psi_class` | the class this run is **accounted** under, frozen when the run is recorded |

### 3.1 Class: four legal states

| `psi_class` | Job | Material | Accounting |
|---|---|---|---|
| `psi` | PSI | PSI | company work, company spend |
| `private` | private | PSI | **company spend** the employee owes |
| `private_partial` | private | partly own | own bucket, never split |
| `private_own` | private | own | not company spend |

`NULL` means "not set": the record inherits, and finally counts as `psi`.
A PSI job cannot have own material; that combination does not exist.

Two rules that read backwards:

* A private job on PSI material **is** PSI spend. That is the number the
  reimbursement conversation needs.
* `private_partial` records that the filament was partly private, not how
  much. It is reported on its own and settled by hand.

### 3.2 User

* Read from the stored file: `User=<name>` line → name; a bare token with `@`
  and no whitespace → e-mail. Last match wins; other lines are ignored.
  Sources: `Metadata/project_settings.config` → `printer_notes` in a 3MF, or
  the `; printer_notes =` line of G-code.
* Read **lazily**: when a card asks for it, when the accounting needs it, and
  by a background pass at startup. Not at ingestion. A file that changes
  (path or size) is read again; a human repair (`manual`) never is.
* Display rule everywhere: name, else e-mail, else "No user" warning.
* An archive without a user falls back to its source library file's user.
  A queue item has no user of its own: it shows its archive's, else its
  library file's.
* Repair: typed value → e-mail if it looks like one, else name; the other
  field is cleared. Set-or-replace only. Always written to the record that
  holds the user (archive or library file), so every card showing it updates.
* Suggestions in the repair dialog: users already seen, most frequent first.

### 3.3 Note

* One text per record, no author, history or threads. Trimmed on save;
  whitespace only → `NULL`, never `""`. Max 2000 characters.
* Never frozen: editable at any queue status and on any archive or file.
* Each record owns its note; there are no live links between records.
* Queue item → archive: while the job prints, the archive shows the queue
  note if it has none of its own; when the run is recorded, the note is copied
  onto the archive if it still has none (copy-on-create; never overwritten).
* Library file → queue item: no. A file note ("calibration file") must not
  reappear on every job.
* Inline editing: blur and Ctrl/Cmd+Enter save, Escape reverts. The caret is
  set once when editing starts; a refetch never replaces a draft being typed.

## 4. Inheritance and how edits spread

Resolution (first set value wins, then `psi`):

* **Queue item:** own → its library file → its archive → that archive's file.
* **Archive:** own → the queue item printing it right now → its library file.
* **Library file:** own.
* **Run** (at the moment it is recorded): the queue item's resolution if the
  run came from a queue item, else the archive's own → its file.

Edits:

| Edited on | Changes |
|---|---|
| Archive | the archive, **all** its runs, all queue items that already printed it (not pending ones) |
| Queue item | the item and its own runs; its archive too if the item is printing or produced the archive's latest run |
| Library file | the file only (default for future jobs) |

When a queue run is recorded, the archive takes the run's class, so an archive
shows how its latest run was classified. If an archive's runs were classified
differently (a reprint on other terms), its chip shows a "mixed" marker.

## 5. Statistics and accounting

Source: **print runs** (`print_log_entries`), with exactly the rows, date
filter (`created_at`), user filter (`created_by_id`, `-1` = none) and duration
rule (stored duration wins, including `0`) of upstream's `GET /archives/stats`.
The PSI totals therefore equal the stats page totals, always.

* Counts and print time: PSI vs private (two buckets).
* Filament and cost: PSI material (`psi` + `private`), partly own, own
  (three buckets).
* Per user (the run's archive user, falling back to its file's):
  `to_reimburse` = cost of `private` runs; partly-own cost beside it.
* Runs without a cost count as 0 (as upstream) and are reported.
* Unknown users are listed last with a pointer to fix them on the cards.

Accounting page `/psi`: period presets (this/last month, quarter, year, all,
custom), KPI tiles, table per user with drill-down to runs (link to archive),
CSV export (all runs or private runs; `;`-separated, UTF-8 with BOM for Excel).

## 6. API (`/api/v1/psi`)

| Method | Path | Permission |
|---|---|---|
| GET | `/meta?archive=1,2&queue=3&library=4` | any of `archives/queue/library:read_all|read_own`; per record read_all or own |
| PATCH | `/archives/{id}` `{psi_class?, note?}` | `archives:update_all` / `update_own` |
| PATCH | `/queue/{id}` `{psi_class?, note?}` | `queue:update_all` / `update_own`, any status |
| PATCH | `/library/{id}` `{psi_class?, note?}` | `library:update_all` / `update_own` |
| PUT | `/archives/{id}/user`, `/library/{id}/user` `{value}` | update permission of that record |
| GET | `/users` | read (as `/meta`) |
| GET | `/accounting?date_from&date_to&created_by_id` | `stats:read` (+ `stats:filter_by_user` to filter) |
| GET | `/accounting/runs?…&user_key&classes` | same |
| GET | `/accounting/export?…&classes` | same (CSV) |

No new permission exists. Without edit rights the chips and the note are shown
without affordance; the missing-user warning is shown to everyone. Nothing is
rendered for a note that is empty when the viewer cannot edit.

PSI edits never go through upstream's `PATCH /queue/{id}`: its status and
`dispatching_at` guards protect in-flight prints (#2615) and stay untouched.

## 7. Acceptance criteria

1. A 3MF with `User=alice` in its printer notes shows `alice` on its archive,
   file and queue cards, without anyone opening a dialog.
2. A file without it shows "No user" to everyone; an editor can fix it from
   any card, and every card showing that record updates.
3. Every card shows PSI or the private class; PSI is the default.
4. Marking a library file private makes new jobs from it private; marking a
   queue item private makes its run private; the archive follows.
5. A reprint on other terms keeps the earlier runs' class; the archive shows
   "mixed".
6. A note can be written, changed and cleared on a queued, printing and
   finished job, an archive and a file at any time; a queue note is on the
   archive after the run.
7. Stats widgets and the accounting page add up to upstream's stats totals for
   the same period and user filter.
8. `to_reimburse` for a user equals the cost of their `private` runs; own
   material never counts as PSI spend; partly own is reported separately.
9. Data from earlier PSI builds (flags, queue comments, library users) is
   carried over on first start; the old columns stay for rollback.

## 8. Decisions

**Not upstream's cost centres.** Upstream has cost centres, wallets and
billing (`/finance`). They attribute money to Bambuddy user accounts and have
no notion of material ownership; PSI's "who" is the slicer user, who often has
no Bambuddy account, and PSI settles private work outside the app on trust.
Revisit if PSI ever gives every printing person an account and turns billing
on.

**Lazy user resolution over ingestion hooks.** Upstream creates archives on
at least six code paths and adds more. Reading the user from the stored file
on demand needs no hook in any of them, and it repairs gaps: the psi.2.3 build
had no parser, and 35 of the last 60 production archives carry a `User=` line
that was never read.

**Per-run class over archive-only class.** Upstream's statistics count runs
and a reprint reuses its archive (#1378); upstream solved the same problem for
batches with `print_log_entries.queue_item_id` (#342). Classifying runs is the
only way the accounting stays right for reprints.

**One `psi_class` column over three booleans.** Same four states, no illegal
combinations, no normaliser on every write path.

**English, German, French, Italian only.** Other languages fall back to
English. Fourteen locales for an internal feature was the largest single
source of merge conflicts.

## Corrections to earlier specs

| Earlier spec said | Now | Why |
|---|---|---|
| Stats read archives only | Stats read runs, each with a frozen class | upstream counts runs; reprints share an archive |
| Three flags, normalised everywhere | One `psi_class` column | same semantics, illegal states unrepresentable |
| Library files have no class (v3) | Library class = default for its jobs | psi.1.x had it; 187 production files use it |
| Parse user at ingestion (`ThreeMFParser` hook) | Read lazily from the stored file | no upstream hunk; heals deployment gaps |
| Queue → archive handoff in the scheduler | At run insert (ORM hook) + display inheritance while printing | covers every path, no scheduler hunk |
| Archive search matches the user | Dropped | needs a hunk in upstream search; the accounting page lists runs per user |
| Upload review strip | Dropped | the file card shows and repairs the user right after upload |
| Queue comments, queue only (`comment`) | One note per record (`psi_notes` on queue) | comments were carried over |
| All 13/14 locales | en/de/fr/it, fallback en | maintenance cost |
| SD card feature | **Deprecated, not implemented** | no longer used |
| Rebuild handoffs, sibling feature branches | One branch, one SOP | see SOP |
