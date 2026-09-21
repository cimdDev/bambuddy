import i18n from '../../i18n';
import type { DashboardWidget } from '../../components/Dashboard';
import type { PeriodQuery } from './api';
import { PsiActivityWidget } from './components/PsiActivityWidget';
import { PsiPrinterStatsWidget } from './components/PsiPrinterStatsWidget';
import { PsiPrinterWidget, PsiSummaryWidget } from './components/PsiStatsWidgets';
import './i18n';

/**
 * The PSI widgets for upstream's stats dashboard. Same period and user filter
 * as the page's own widgets, so the numbers add up to the page's totals.
 */
export function psiStatsWidgets({
  dateFrom,
  dateTo,
  createdById,
  currency,
  printerNames,
}: PeriodQuery & { currency: string; printerNames?: Map<string, string> }): DashboardWidget[] {
  const period = { dateFrom, dateTo, createdById };
  return [
    {
      id: 'psi-summary',
      title: i18n.t('psi.stats.summaryTitle'),
      component: <PsiSummaryWidget period={period} currency={currency} />,
      defaultSize: 2,
    },
    {
      id: 'psi-printers',
      title: i18n.t('psi.stats.byPrinterTitle'),
      component: <PsiPrinterWidget period={period} printerNames={printerNames} />,
      defaultSize: 2,
    },
  ];
}

/**
 * Swaps the charts of upstream's "Print activity" and "Printer stats" widgets
 * for PSI copies split into PSI (green) and private (blue). Same ids, titles
 * and sizes, so saved dashboard layouts keep working. Upstream's widget list
 * is edited in place: the seam is one call after it, no upstream line changes.
 */
export function psiSplitStatsWidgets(
  widgets: DashboardWidget[],
  { dateFrom, dateTo, createdById, printerNames }: PeriodQuery & { printerNames: Map<string, string> },
): void {
  const period = { dateFrom, dateTo, createdById };
  for (const widget of widgets) {
    if (widget.id === PSI_SPLIT_WIDGETS.activity) {
      widget.component = (size) => <PsiActivityWidget period={period} size={size} />;
    } else if (widget.id === PSI_SPLIT_WIDGETS.printers) {
      widget.component = <PsiPrinterStatsWidget period={period} printerNames={printerNames} />;
    }
  }
}

/** Upstream's widget ids. `psiStatsSplit.test.tsx` fails if upstream renames them. */
export const PSI_SPLIT_WIDGETS = { activity: 'print-activity', printers: 'printer-stats' } as const;
