/** Accounting periods. Dates are local calendar days, sent as YYYY-MM-DD. */

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'allTime' | 'custom';
export const PERIOD_PRESETS: PeriodPreset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear', 'allTime', 'custom'];

export interface Period {
  preset: PeriodPreset;
  dateFrom?: string;
  dateTo?: string;
}

export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function presetRange(preset: PeriodPreset, now = new Date()): { dateFrom?: string; dateTo?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'thisMonth':
      return { dateFrom: isoDay(new Date(y, m, 1)), dateTo: isoDay(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { dateFrom: isoDay(new Date(y, m - 1, 1)), dateTo: isoDay(new Date(y, m, 0)) };
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3;
      return { dateFrom: isoDay(new Date(y, q, 1)), dateTo: isoDay(new Date(y, q + 3, 0)) };
    }
    case 'thisYear':
      return { dateFrom: isoDay(new Date(y, 0, 1)), dateTo: isoDay(new Date(y, 11, 31)) };
    case 'lastYear':
      return { dateFrom: isoDay(new Date(y - 1, 0, 1)), dateTo: isoDay(new Date(y - 1, 11, 31)) };
    default:
      return {};
  }
}

export function resolvePeriod(period: Period): { dateFrom?: string; dateTo?: string } {
  return period.preset === 'custom' ? { dateFrom: period.dateFrom, dateTo: period.dateTo } : presetRange(period.preset);
}
