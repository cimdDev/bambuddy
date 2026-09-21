/**
 * PSI / private split of the stats page's activity and printer charts.
 *
 * Each function mirrors one computation in upstream's `pages/StatsPage.tsx`
 * (same fields, same fallbacks) and adds the job type, so a split chart adds
 * up to exactly what the upstream chart drew.
 */
import type { Metric } from '../../components/MetricToggle';
import { localDateKey, parseUTCDate } from '../../utils/date';
import type { PsiChartRun, PsiJob } from './model';

/** Same colours as the class chips: bambu-green and Tailwind's sky-500. */
export const JOB_COLOR: Record<PsiJob, string> = { psi: '#00ae42', private: '#0ea5e9' };
const JOB_RGB: Record<PsiJob, string> = { psi: '0, 174, 66', private: '14, 165, 233' };

export const JOBS: readonly PsiJob[] = ['psi', 'private'];

export type JobCounts = Record<PsiJob, number>;
const empty = (): JobCounts => ({ psi: 0, private: 0 });
export const jobTotal = (c: JobCounts) => c.psi + c.private;

const runSeconds = (r: PsiChartRun) => r.actual_time_seconds || r.print_time_seconds || 0;

// ------------------------------------------------------------------ activity

/** Runs per local day (`YYYY-MM-DD`), as upstream's PrintCalendar buckets them. */
export function countByDay(runs: PsiChartRun[]): Record<string, JobCounts> {
  const out: Record<string, JobCounts> = {};
  for (const r of runs) {
    const day = localDateKey(r.created_at);
    if (!day) continue;
    (out[day] ??= empty())[r.job]++;
  }
  return out;
}

/** Runs per local day and hour (`YYYY-MM-DD-H`), as upstream's HourlyHeatmap buckets them. */
export function countByDayHour(runs: PsiChartRun[]): Record<string, JobCounts> {
  const out: Record<string, JobCounts> = {};
  for (const r of runs) {
    const date = parseUTCDate(r.created_at);
    if (!date) continue;
    const key = `${localDateKey(date)}-${date.getHours()}`;
    (out[key] ??= empty())[r.job]++;
  }
  return out;
}

/** Upstream's four intensity steps (30/50/75/100 %), as an alpha. */
export function intensity(count: number, max: number): number {
  const ratio = count / Math.max(1, max);
  if (ratio <= 0.25) return 0.3;
  if (ratio <= 0.5) return 0.5;
  if (ratio <= 0.75) return 0.75;
  return 1;
}

export const jobRgba = (job: PsiJob, alpha: number) => `rgba(${JOB_RGB[job]}, ${alpha})`;

/**
 * A heatmap cell: brightness from the total, as upstream; colour from the job.
 * A cell with both is split bottom-up in proportion (private below, PSI above).
 * `undefined` for an empty cell, which keeps upstream's `bg-bambu-dark`.
 */
export function cellBackground(counts: JobCounts | undefined, max: number): string | undefined {
  const total = counts ? jobTotal(counts) : 0;
  if (!counts || total === 0) return undefined;
  const alpha = intensity(total, max);
  if (counts.private === 0) return jobRgba('psi', alpha);
  if (counts.psi === 0) return jobRgba('private', alpha);
  const share = Math.round((counts.private / total) * 100);
  return `linear-gradient(to top, ${jobRgba('private', alpha)} ${share}%, ${jobRgba('psi', alpha)} ${share}%)`;
}

// ------------------------------------------------------------------ printers

export type JobRow = { name: string } & JobCounts;

const metricValue = (r: PsiChartRun, metric: Metric) =>
  metric === 'prints' ? 1 : metric === 'weight' ? r.filament_used_grams || 0 : runSeconds(r) / 3600;

/** Per printer, largest total first. Weight in whole grams, time in hours to 0.1, as upstream. */
export function byPrinter(
  runs: PsiChartRun[],
  metric: Metric,
  printerName: (id: string) => string,
): JobRow[] {
  const map = new Map<string, JobCounts>();
  for (const r of runs) {
    if (!r.printer_id) continue;
    const id = String(r.printer_id);
    const entry = map.get(id) ?? empty();
    entry[r.job] += metricValue(r, metric);
    map.set(id, entry);
  }
  const round = (v: number) => (metric === 'weight' ? Math.round(v) : metric === 'time' ? Math.round(v * 10) / 10 : v);
  return Array.from(map.entries())
    .map(([id, c]) => ({ name: printerName(id), psi: round(c.psi), private: round(c.private) }))
    .sort((a, b) => jobTotal(b) - jobTotal(a));
}

export const DURATION_BUCKETS = [
  { key: '<30m', max: 1800 },
  { key: '30m-1h', max: 3600 },
  { key: '1-2h', max: 7200 },
  { key: '2-4h', max: 14400 },
  { key: '4-8h', max: 28800 },
  { key: '8-12h', max: 43200 },
  { key: '12-24h', max: 86400 },
  { key: '24h+', max: Infinity },
];

/** Runs per duration bucket; runs without a duration are left out, as upstream. */
export function byDuration(runs: PsiChartRun[]): JobRow[] {
  const rows = DURATION_BUCKETS.map((b) => ({ name: b.key, ...empty() }));
  for (const r of runs) {
    const seconds = runSeconds(r);
    if (seconds <= 0) continue;
    const i = DURATION_BUCKETS.findIndex((b) => seconds <= b.max);
    rows[i][r.job]++;
  }
  return rows;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Average per weekday over the weeks that had any run, as upstream. */
export function byWeekday(runs: PsiChartRun[], metric: Metric): JobRow[] {
  const sums = DAY_LABELS.map(empty);
  const weeks = new Set<string>();
  for (const r of runs) {
    const date = parseUTCDate(r.created_at) || new Date(r.created_at);
    const day = (date.getDay() + 6) % 7;
    sums[day][r.job] += metricValue(r, metric);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - day);
    weeks.add(localDateKey(weekStart));
  }
  const n = Math.max(weeks.size, 1);
  const avg = (v: number) => Math.round((v / n) * 10) / 10;
  return DAY_LABELS.map((name, i) => ({ name, psi: avg(sums[i].psi), private: avg(sums[i].private) }));
}

export const HOUR_LABELS = [
  '12am', '1am', '2am', '3am', '4am', '5am',
  '6am', '7am', '8am', '9am', '10am', '11am',
  '12pm', '1pm', '2pm', '3pm', '4pm', '5pm',
  '6pm', '7pm', '8pm', '9pm', '10pm', '11pm',
];

/** Runs per local start hour, plus failures (drawn beside, in upstream's red). */
export function byHourOfDay(runs: PsiChartRun[]): (JobRow & { failures: number })[] {
  const rows = HOUR_LABELS.map((name) => ({ name, ...empty(), failures: 0 }));
  for (const r of runs) {
    const date = parseUTCDate(r.started_at);
    if (!date) continue;
    const row = rows[date.getHours()];
    row[r.job]++;
    if (r.status === 'failed') row.failures++;
  }
  return rows;
}
