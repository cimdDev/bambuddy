/**
 * Upstream's "Printer stats" widget (`PrinterStatsWidget` in
 * `pages/StatsPage.tsx`), with every bar stacked into PSI (green) and private
 * (blue). Charts, toggles and bucketing are upstream's; upstream's per-metric
 * bar colours give way to the job colours, failures stay red.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MetricToggle, type Metric } from '../../../components/MetricToggle';
import { formatWeight } from '../../../utils/weight';
import type { PeriodQuery } from '../api';
import { usePsiChartRuns } from '../hooks';
import { JOBS, JOB_COLOR, byDuration, byHourOfDay, byPrinter, byWeekday } from '../jobSplit';
import '../i18n';

const TOOLTIP_STYLE = { backgroundColor: '#2d2d2d', border: '1px solid #3d3d3d', borderRadius: '8px' };
const LEGEND_STYLE = { fontSize: 11 };

export function PsiPrinterStatsWidget({ period, printerNames }: { period: PeriodQuery; printerNames: Map<string, string> }) {
  const { t } = useTranslation();
  const { data: runs = [] } = usePsiChartRuns(period);
  const [printerMetric, setPrinterMetric] = useState<Metric>('weight');
  const [habitsMetric, setHabitsMetric] = useState<Metric>('weight');

  const printerData = useMemo(
    () => byPrinter(runs, printerMetric, (id) => printerNames.get(id) || `${t('common.printer')} ${id}`),
    [runs, printerMetric, printerNames, t],
  );
  const durationData = useMemo(() => byDuration(runs), [runs]);
  const habitsData = useMemo(() => byWeekday(runs, habitsMetric), [runs, habitsMetric]);
  const hourlyData = useMemo(() => byHourOfDay(runs), [runs]);

  const unit = (m: Metric) => (m === 'weight' ? 'g' : m === 'time' ? 'h' : '');
  const format = (m: Metric) => (v: number | undefined) =>
    m === 'weight' ? formatWeight(Number(v ?? 0)) : `${v ?? 0}${unit(m)}`;
  const jobBars = (stackId: string, radius: [number, number, number, number]) =>
    JOBS.map((job, i) => (
      <Bar
        key={job}
        dataKey={job}
        stackId={stackId}
        name={t(`psi.stats.job.${job}`)}
        fill={JOB_COLOR[job]}
        // Only the outer segment gets rounded corners.
        radius={i === JOBS.length - 1 ? radius : [0, 0, 0, 0]}
      />
    ));

  const noData = <p className="text-bambu-gray text-center py-4">{t('stats.noArchiveData')}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-bambu-dark rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-bambu-gray">{t('stats.printsByPrinter')}</h4>
          <MetricToggle value={printerMetric} onChange={setPrinterMetric} />
        </div>
        {printerData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(140, printerData.length * 40) + 24}>
            <BarChart data={printerData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3d3d3d" />
              <XAxis type="number" stroke="#9ca3af" tick={{ fontSize: 11 }} unit={unit(printerMetric)} />
              <YAxis type="category" dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} width={100} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={format(printerMetric)} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {jobBars('printer', [0, 4, 4, 0])}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-bambu-gray text-center py-4">{t('stats.noPrinterData')}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-bambu-dark rounded-lg p-4">
          <h4 className="text-sm font-medium text-bambu-gray mb-3">{t('stats.printDuration')}</h4>
          {runs.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={durationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d3d3d" />
                <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                {jobBars('duration', [4, 4, 0, 0])}
              </BarChart>
            </ResponsiveContainer>
          ) : noData}
        </div>

        <div className="bg-bambu-dark rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-bambu-gray">{t('stats.printHabits')}</h4>
            <MetricToggle value={habitsMetric} onChange={setHabitsMetric} />
          </div>
          {runs.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={habitsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d3d3d" />
                <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} unit={unit(habitsMetric)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={format(habitsMetric)} />
                {jobBars('habits', [4, 4, 0, 0])}
              </BarChart>
            </ResponsiveContainer>
          ) : noData}
        </div>

        <div className="bg-bambu-dark rounded-lg p-4">
          <h4 className="text-sm font-medium text-bambu-gray mb-3">{t('stats.printTimeOfDay')}</h4>
          {runs.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3d3d3d" />
                <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 10 }} interval={5} />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                {jobBars('hour', [2, 2, 0, 0])}
                <Bar dataKey="failures" name={t('stats.failed')} fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : noData}
        </div>
      </div>
    </div>
  );
}
