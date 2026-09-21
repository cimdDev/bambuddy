import i18n from '../../i18n';
import type { DashboardWidget } from '../../components/Dashboard';
import type { PeriodQuery } from './api';
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
