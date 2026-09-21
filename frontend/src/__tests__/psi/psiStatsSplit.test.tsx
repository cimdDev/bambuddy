import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DashboardWidget } from '../../components/Dashboard';
import {
  byDuration,
  byHourOfDay,
  byPrinter,
  byWeekday,
  cellBackground,
  countByDay,
  jobTotal,
} from '../../custom/psi/jobSplit';
import type { PsiChartRun, PsiJob } from '../../custom/psi/model';
import { PSI_SPLIT_WIDGETS, psiSplitStatsWidgets } from '../../custom/psi/statsWidgets';

const run = (job: PsiJob, over: Partial<PsiChartRun> = {}): PsiChartRun => ({
  printer_id: 1,
  print_name: 'x',
  print_time_seconds: 3600,
  actual_time_seconds: null,
  filament_used_grams: 10,
  status: 'completed',
  started_at: '2026-09-01T08:00:00Z',
  created_at: '2026-09-01T09:00:00Z',
  job,
  ...over,
});

describe('job split', () => {
  const runs = [
    run('psi'),
    run('psi', { printer_id: 2, filament_used_grams: 40 }),
    run('private', { filament_used_grams: 25.4, status: 'failed' }),
    run('private', { actual_time_seconds: 0, print_time_seconds: null }), // no duration
  ];

  it('adds up to what the upstream chart counts', () => {
    const perDay = Object.values(countByDay(runs));
    expect(perDay.reduce((sum, c) => sum + jobTotal(c), 0)).toBe(runs.length);
    // Upstream leaves runs without a duration out of the duration chart.
    expect(byDuration(runs).reduce((sum, r) => sum + jobTotal(r), 0)).toBe(3);
    expect(byHourOfDay(runs).reduce((sum, r) => sum + r.failures, 0)).toBe(1);
  });

  it('splits each printer and sorts by total, rounding weight like upstream', () => {
    expect(byPrinter(runs, 'weight', (id) => `P${id}`)).toEqual([
      { name: 'P1', psi: 10, private: 35 },
      { name: 'P2', psi: 40, private: 0 },
    ]);
    expect(byPrinter(runs, 'prints', (id) => `P${id}`)[0]).toEqual({ name: 'P1', psi: 1, private: 2 });
  });

  it('averages weekdays over the weeks that had runs', () => {
    const tuesday = byWeekday(runs, 'prints').find((d) => d.name === 'Tue');
    expect(tuesday).toEqual({ name: 'Tue', psi: 2, private: 2 });
  });

  it('colours a cell by job, splits a mixed one, keeps an empty one upstream-dark', () => {
    expect(cellBackground(undefined, 4)).toBeUndefined();
    expect(cellBackground({ psi: 4, private: 0 }, 4)).toBe('rgba(0, 174, 66, 1)');
    expect(cellBackground({ psi: 0, private: 1 }, 4)).toBe('rgba(14, 165, 233, 0.3)');
    expect(cellBackground({ psi: 1, private: 3 }, 4)).toBe(
      'linear-gradient(to top, rgba(14, 165, 233, 1) 75%, rgba(0, 174, 66, 1) 75%)',
    );
  });
});

describe('psiSplitStatsWidgets', () => {
  it('swaps only the two charts and keeps id, title and size', () => {
    const upstream = (id: string): DashboardWidget => ({ id, title: id, component: 'upstream', defaultSize: 2 });
    const widgets = [upstream('quick-stats'), upstream(PSI_SPLIT_WIDGETS.activity), upstream(PSI_SPLIT_WIDGETS.printers)];
    psiSplitStatsWidgets(widgets, { printerNames: new Map() });

    expect(widgets.map((w) => [w.id, w.title, w.defaultSize])).toEqual([
      ['quick-stats', 'quick-stats', 2],
      ['print-activity', 'print-activity', 2],
      ['printer-stats', 'printer-stats', 2],
    ]);
    expect(widgets[0].component).toBe('upstream');
    expect(widgets[1].component).not.toBe('upstream');
    expect(widgets[2].component).not.toBe('upstream');
  });

  it("still finds upstream's widget ids on the stats page", () => {
    // A rename upstream would silently bring back the unsplit charts.
    const page = readFileSync(resolve(__dirname, '../../pages/StatsPage.tsx'), 'utf8');
    for (const id of Object.values(PSI_SPLIT_WIDGETS)) expect(page).toContain(`id: '${id}'`);
  });
});
