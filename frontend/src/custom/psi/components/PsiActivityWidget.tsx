/**
 * Upstream's "Print activity" widget (PrintCalendar / HourlyHeatmap in
 * `pages/StatsPage.tsx`), with every cell split into PSI (green) and private
 * (blue). Layout, sizing and period rules are upstream's, copied; only the
 * colour and the tooltip differ.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localDateKey } from '../../../utils/date';
import type { PeriodQuery } from '../api';
import { usePsiChartRuns } from '../hooks';
import { HOUR_LABELS, JOBS, cellBackground, countByDay, countByDayHour, jobRgba, jobTotal } from '../jobSplit';
import type { JobCounts } from '../jobSplit';
import '../i18n';

export function PsiActivityWidget({ period, size = 2 }: { period: PeriodQuery; size?: 1 | 2 | 4 }) {
  const { data: runs = [] } = usePsiChartRuns(period);
  const { dateFrom, dateTo } = period;

  const spanDays = useMemo(() => {
    if (dateFrom && dateTo) {
      return Math.max((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000, 0) + 1;
    }
    if (dateFrom) {
      return Math.max((Date.now() - new Date(dateFrom).getTime()) / 86400000, 0) + 1;
    }
    return Infinity;
  }, [dateFrom, dateTo]);

  if (spanDays <= 7 && dateFrom && dateTo) {
    return <HourlyGrid counts={countByDayHour(runs)} dateFrom={dateFrom} dateTo={dateTo} />;
  }
  const sizeDefault = size === 1 ? 3 : size === 2 ? 6 : 12;
  const months = spanDays === Infinity ? sizeDefault : Math.max(1, Math.ceil(spanDays / 30));
  return <Calendar counts={countByDay(runs)} months={months} />;
}

function useCellTitle() {
  const { t } = useTranslation();
  return (label: string, c: JobCounts | undefined) =>
    t('psi.stats.activityCell', { label, count: c ? jobTotal(c) : 0, psi: c?.psi ?? 0, private: c?.private ?? 0 });
}

const maxOf = (counts: Record<string, JobCounts>) => Math.max(1, ...Object.values(counts).map(jobTotal));

function Calendar({ counts, months }: { counts: Record<string, JobCounts>; months: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const title = useCellTitle();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0]?.contentRect.width || 0));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday

    const weeks: Date[][] = [];
    const monthLabels: { month: string; weekIndex: number }[] = [];
    let currentWeek: Date[] = [];
    let lastMonth = -1;
    let weekIndex = 0;
    const current = new Date(startDate);
    while (current <= today) {
      if (current.getDay() === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }
      if (current.getMonth() !== lastMonth) {
        monthLabels.push({ month: current.toLocaleDateString('en-US', { month: 'short' }), weekIndex });
        lastMonth = current.getMonth();
      }
      currentWeek.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);
    return { weeks, monthLabels };
  }, [months]);

  const maxCount = maxOf(counts);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const numWeeks = weeks.length;
  const dayLabelWidth = 32;
  const gap = 2;
  const availableWidth = containerWidth - dayLabelWidth - 16;
  const calculatedCellSize = numWeeks > 0 ? Math.floor((availableWidth - (numWeeks - 1) * gap) / numWeeks) : 12;
  const cellSize = Math.max(8, Math.min(20, calculatedCellSize));
  const fontSize = cellSize <= 10 ? 10 : 12;
  const todayKey = localDateKey(new Date());

  return (
    <div ref={containerRef} className="w-full flex justify-center">
      {containerWidth > 0 && (
        <div>
          <div className="flex mb-1" style={{ marginLeft: dayLabelWidth + 4 }}>
            {monthLabels.map(({ month, weekIndex }, i) => (
              <div
                key={i}
                className="text-bambu-gray"
                style={{
                  fontSize,
                  marginLeft: i === 0 ? 0 : `${(weekIndex - (monthLabels[i - 1]?.weekIndex || 0)) * (cellSize + gap) - 24}px`,
                }}
              >
                {month}
              </div>
            ))}
          </div>

          <div className="flex" style={{ gap }}>
            <div className="flex flex-col" style={{ gap, marginRight: 4, width: dayLabelWidth }}>
              {dayLabels.map((day, i) => (
                <div
                  key={day}
                  className="text-bambu-gray flex items-center"
                  style={{ width: dayLabelWidth, height: cellSize, fontSize, visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
                >
                  {day}
                </div>
              ))}
            </div>

            {weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="flex flex-col" style={{ gap }}>
                {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
                  const day = week.find((d) => d.getDay() === dayOfWeek);
                  if (!day) return <div key={dayOfWeek} style={{ width: cellSize, height: cellSize }} />;
                  const key = localDateKey(day);
                  return (
                    <Cell
                      key={dayOfWeek}
                      counts={counts[key]}
                      max={maxCount}
                      size={cellSize}
                      ring={key === todayKey}
                      title={title(day.toLocaleDateString(), counts[key])}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <Legend size={cellSize} fontSize={fontSize} gap={gap} />
        </div>
      )}
    </div>
  );
}

function HourlyGrid({ counts, dateFrom, dateTo }: { counts: Record<string, JobCounts>; dateFrom: string; dateTo: string }) {
  const title = useCellTitle();
  const days = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const current = new Date(dateFrom + 'T00:00:00');
    const end = new Date(dateTo + 'T00:00:00');
    while (current <= end) {
      out.push({
        key: localDateKey(current),
        label: current.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      });
      current.setDate(current.getDate() + 1);
    }
    return out;
  }, [dateFrom, dateTo]);

  const maxCount = maxOf(counts);
  const cellSize = 20;
  const gap = 2;
  const dayLabelWidth = 80;

  return (
    <div className="w-full overflow-x-auto">
      <div className="inline-flex flex-col" style={{ gap }}>
        <div className="flex" style={{ gap, marginLeft: dayLabelWidth + 4 }}>
          {HOUR_LABELS.map((label, i) => (
            <div
              key={i}
              className="text-bambu-gray text-[10px] text-center"
              style={{ width: cellSize, visibility: i % 2 === 0 ? 'visible' : 'hidden' }}
            >
              {label}
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day.key} className="flex items-center" style={{ gap }}>
            <div className="text-bambu-gray text-[10px] flex-shrink-0 truncate" style={{ width: dayLabelWidth }}>
              {day.label}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const c = counts[`${day.key}-${hour}`];
              return (
                <Cell key={hour} counts={c} max={maxCount} size={cellSize} title={title(`${day.label} ${HOUR_LABELS[hour]}`, c)} />
              );
            })}
          </div>
        ))}
      </div>
      <Legend size={cellSize} fontSize={12} gap={gap} />
    </div>
  );
}

function Cell({ counts, max, size, title, ring = false }: {
  counts: JobCounts | undefined;
  max: number;
  size: number;
  title: string;
  ring?: boolean;
}) {
  const background = cellBackground(counts, max);
  return (
    <div
      className={`rounded-sm ${background ? '' : 'bg-bambu-dark'} ${ring ? 'ring-1 ring-white' : ''}`}
      style={{ width: size, height: size, background }}
      title={title}
    />
  );
}

/** Upstream's less/more scale, drawn once per job, then the job names. */
function Legend({ size, fontSize, gap }: { size: number; fontSize: number; gap: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-bambu-gray" style={{ fontSize }}>
      {JOBS.map((job) => (
        <div key={job} className="flex items-center gap-2">
          <span>{t(`psi.stats.job.${job}`)}</span>
          <div className="flex" style={{ gap }}>
            {[0.3, 0.5, 0.75, 1].map((alpha) => (
              <div key={alpha} className="rounded-sm" style={{ width: size, height: size, background: jobRgba(job, alpha) }} />
            ))}
          </div>
        </div>
      ))}
      <span>{t('psi.stats.activityLegend')}</span>
    </div>
  );
}
