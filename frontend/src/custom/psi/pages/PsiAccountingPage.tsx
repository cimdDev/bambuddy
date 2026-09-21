import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, ExternalLink, Info, Loader2, Scale } from 'lucide-react';
import { api } from '../../../api/client';
import { Button } from '../../../components/Button';
import { Card, CardContent } from '../../../components/Card';
import { useToast } from '../../../contexts/ToastContext';
import { getCurrencySymbol } from '../../../utils/currency';
import { psiApi } from '../api';
import { usePsiAccounting } from '../hooks';
import { fmtHours, fmtMoney, fmtWeight } from '../format';
import '../i18n';
import { CLASS_TONE, NO_USER_KEY } from '../model';
import type { PsiAccountingUser, PsiBucket, PsiClass } from '../model';
import { PERIOD_PRESETS, resolvePeriod } from '../period';
import type { Period } from '../period';

const STORAGE_KEY = 'psi-accounting-period';
const PRIVATE_CLASSES: PsiClass[] = ['private', 'private_partial', 'private_own'];

function loadPeriod(): Period {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && PERIOD_PRESETS.includes(saved.preset)) return saved;
  } catch {
    /* ignore */
  }
  return { preset: 'thisMonth' };
}

/**
 * PSI accounting: who printed what, on whose terms, in a period. Counts every
 * print run, exactly like upstream's statistics, so the totals here and there
 * match. "To reimburse" is the cost of private jobs on PSI material; partly own
 * material is shown beside it and settled by hand.
 */
export function PsiAccountingPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [period, setPeriodState] = useState<Period>(loadPeriod);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const setPeriod = (next: Period) => {
    setPeriodState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const range = useMemo(() => resolvePeriod(period), [period]);
  const { data, isLoading } = usePsiAccounting(range);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const currency = getCurrencySymbol(settings?.currency || 'USD');
  const money = (v: number) => fmtMoney(currency, v);

  const exportCsv = async (classes?: PsiClass[]) => {
    setExporting(true);
    try {
      await psiApi.downloadCsv(range, classes);
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const unknown = data?.users.find((u) => u.key === NO_USER_KEY);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
            <Scale className="h-7 w-7 text-bambu-green" />
            {t('psi.accounting.title')}
          </h1>
          <p className="mt-1 text-bambu-gray">{t('psi.accounting.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => exportCsv(PRIVATE_CLASSES)} disabled={exporting || !data?.totals.prints}>
            <Download className="h-4 w-4" />
            {t('psi.accounting.exportPrivate')}
          </Button>
          <Button variant="secondary" onClick={() => exportCsv()} disabled={exporting || !data?.totals.prints}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('psi.accounting.export')}
          </Button>
        </div>
      </div>

      <PeriodPicker period={period} onChange={setPeriod} />

      {isLoading || !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-bambu-green" />
        </div>
      ) : data.totals.prints === 0 ? (
        <p className="py-16 text-center text-bambu-gray">{t('psi.accounting.empty')}</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label={t('psi.accounting.prints')} value={String(data.totals.prints)}
              hint={`${t('psi.stats.job.psi')} ${data.job.psi.prints} · ${t('psi.stats.job.private')} ${data.job.private.prints}`} />
            <Kpi label={t('psi.accounting.hours')} value={fmtHours(data.totals.hours)}
              hint={`${t('psi.stats.job.psi')} ${fmtHours(data.job.psi.hours)} · ${t('psi.stats.job.private')} ${fmtHours(data.job.private.hours)}`} />
            <Kpi label={t('psi.accounting.psiMaterial')} value={money(data.material.psi.cost)} hint={fmtWeight(data.material.psi.grams)} />
            <Kpi label={t('psi.accounting.toReimburse')} value={money(data.by_class.private.cost)}
              hint={t('psi.accounting.toReimburseHint')} tone="text-sky-600 dark:text-sky-300" />
            <Kpi label={t('psi.accounting.partial')} value={money(data.material.partial.cost)}
              hint={t('psi.accounting.partialHint')} tone="text-amber-600 dark:text-amber-300" />
          </div>

          <Card className="mb-4">
            <CardContent className="p-0">
              <div className="border-b border-bambu-dark-tertiary px-4 py-3">
                <h2 className="text-sm font-semibold text-white">{t('psi.accounting.byUser')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-bambu-gray">
                      <th className="px-4 py-2 font-medium">{t('psi.accounting.user')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('psi.accounting.prints')}</th>
                      <ClassHead cls="psi" />
                      <ClassHead cls="private" />
                      <ClassHead cls="private_partial" />
                      <ClassHead cls="private_own" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <Fragment key={user.key}>
                        <UserRow
                          user={user}
                          money={money}
                          open={openUser === user.key}
                          onToggle={() => setOpenUser(openUser === user.key ? null : user.key)}
                        />
                        {openUser === user.key && (
                          <tr className="bg-bambu-dark/40">
                            <td colSpan={6} className="px-4 py-3">
                              <UserRuns userKey={user.key} range={range} money={money} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-1 text-xs text-bambu-gray">
            <p className="flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />{t('psi.accounting.costBasis')} {t('psi.stats.costNote')}</p>
            {data.runs_without_cost > 0 && <p>{t('psi.accounting.missingCost', { count: data.runs_without_cost })}</p>}
            {unknown && <p>{t('psi.accounting.missingUser', { count: unknown.prints })}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation();
  const range = resolvePeriod(period);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-0.5 rounded-lg bg-bambu-dark p-0.5">
        {PERIOD_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset === 'custom' ? { preset, ...range } : { preset })}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              period.preset === preset ? 'bg-bambu-green text-white' : 'text-bambu-gray hover:text-white'
            }`}
          >
            {t(`psi.period.${preset}`)}
          </button>
        ))}
      </div>
      {period.preset === 'custom' && (
        <div className="flex items-center gap-2 text-xs text-bambu-gray">
          <label className="flex items-center gap-1">
            {t('psi.period.from')}
            <input type="date" value={period.dateFrom ?? ''} onChange={(e) => onChange({ ...period, dateFrom: e.target.value || undefined })}
              className="rounded-md border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1 text-white" />
          </label>
          <label className="flex items-center gap-1">
            {t('psi.period.to')}
            <input type="date" value={period.dateTo ?? ''} onChange={(e) => onChange({ ...period, dateTo: e.target.value || undefined })}
              className="rounded-md border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1 text-white" />
          </label>
        </div>
      )}
      {period.preset !== 'custom' && range.dateFrom && (
        <span className="text-xs text-bambu-gray tabular-nums">{range.dateFrom} – {range.dateTo}</span>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone = 'text-white' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-bambu-gray">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-bambu-gray" title={hint}>{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ClassHead({ cls }: { cls: PsiClass }) {
  const { t } = useTranslation();
  return (
    <th className="px-3 py-2 text-right font-medium">
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${CLASS_TONE[cls]}`} title={t(`psi.class.desc.${cls}`)}>
        {t(`psi.class.short.${cls}`)}
      </span>
    </th>
  );
}

function Cell({ bucket, money, emphasize, showCost = true }: { bucket: PsiBucket; money: (v: number) => string; emphasize?: boolean; showCost?: boolean }) {
  if (bucket.prints === 0) return <td className="px-3 py-2 text-right text-bambu-gray/50">–</td>;
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {showCost && <div className={emphasize ? 'font-semibold text-white' : 'text-white'}>{money(bucket.cost)}</div>}
      <div className="text-[11px] text-bambu-gray">{bucket.prints} · {fmtWeight(bucket.grams)}</div>
    </td>
  );
}

function UserRow({ user, money, open, onToggle }: { user: PsiAccountingUser; money: (v: number) => string; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const unknown = user.key === NO_USER_KEY;
  return (
    <tr className="border-t border-bambu-dark-tertiary hover:bg-bambu-dark-tertiary/30">
      <td className="px-4 py-2">
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left" aria-expanded={open}
          title={open ? t('psi.accounting.hideRuns') : t('psi.accounting.showRuns')}>
          {open ? <ChevronDown className="h-4 w-4 text-bambu-gray" /> : <ChevronRight className="h-4 w-4 text-bambu-gray" />}
          <span className={unknown ? 'italic text-amber-600 dark:text-amber-300' : 'text-white'}>{unknown ? t('psi.accounting.noUser') : user.label}</span>
        </button>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-white">{user.prints}</td>
      <Cell bucket={user.by_class.psi} money={money} />
      <Cell bucket={user.by_class.private} money={money} emphasize />
      <Cell bucket={user.by_class.private_partial} money={money} />
      <Cell bucket={user.by_class.private_own} money={money} showCost={false} />
    </tr>
  );
}

function UserRuns({ userKey, range, money }: { userKey: string; range: { dateFrom?: string; dateTo?: string }; money: (v: number) => string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['psi-accounting', 'runs', userKey, range.dateFrom ?? null, range.dateTo ?? null],
    queryFn: () => psiApi.accountingRuns(range, userKey),
  });
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-bambu-green" />;
  if (!data?.length) return <p className="text-xs text-bambu-gray">{t('psi.accounting.empty')}</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-bambu-gray">
          <th className="py-1 pr-3 font-medium">{t('psi.accounting.date')}</th>
          <th className="py-1 pr-3 font-medium">{t('psi.accounting.print')}</th>
          <th className="py-1 pr-3 font-medium">{t('psi.accounting.printer')}</th>
          <th className="py-1 pr-3 font-medium">{t('psi.class.title')}</th>
          <th className="py-1 pr-3 text-right font-medium">{t('psi.accounting.weight')}</th>
          <th className="py-1 pr-3 text-right font-medium">{t('psi.accounting.cost')}</th>
          <th className="py-1" />
        </tr>
      </thead>
      <tbody>
        {data.map((run) => (
          <tr key={run.run_id} className="border-t border-bambu-dark-tertiary/60">
            <td className="py-1 pr-3 tabular-nums text-bambu-gray-light">{run.date ? run.date.slice(0, 10) : '–'}</td>
            <td className="max-w-[16rem] truncate py-1 pr-3 text-white" title={run.print_name ?? ''}>{run.print_name ?? '–'}</td>
            <td className="py-1 pr-3 text-bambu-gray-light">{run.printer_name ?? '–'}</td>
            <td className="py-1 pr-3">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${CLASS_TONE[run.psi_class]}`}>
                {t(`psi.class.short.${run.psi_class}`)}
              </span>
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-bambu-gray-light">{fmtWeight(run.grams)}</td>
            <td className="py-1 pr-3 text-right tabular-nums text-white">{run.cost != null ? money(run.cost) : '–'}</td>
            <td className="py-1 text-right">
              {run.archive_id && (
                <Link to={`/archives?highlight=${run.archive_id}`} className="text-bambu-gray hover:text-bambu-green" title={t('psi.accounting.openArchive')}>
                  <ExternalLink className="inline h-3.5 w-3.5" />
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
