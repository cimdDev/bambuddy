import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { MetricToggle, type Metric } from '../../../components/MetricToggle';
import { useAuth } from '../../../contexts/AuthContext';
import type { PeriodQuery } from '../api';
import { JOB_SWATCH, MATERIAL_SWATCH, printerSegments } from '../buckets';
import { usePsiAccounting } from '../hooks';
import { fmtHours, fmtMoney, fmtWeight } from '../format';
import { PSI_ACCOUNTING_PATH } from '../paths';
import { PSI_ACCOUNTING_PERMISSION } from '../permissions';
import '../i18n';
import { PsiBucketBar } from './PsiBucketBar';

export function PsiSummaryWidget({ period, currency }: { period: PeriodQuery; currency: string }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { data } = usePsiAccounting(period);
  if (!data) return null;
  if (data.totals.prints === 0) return <p className="text-sm text-bambu-gray">{t('psi.stats.empty')}</p>;

  const job = (field: 'prints' | 'hours') =>
    (['psi', 'private'] as const).map((k) => ({ key: k, label: t(`psi.stats.job.${k}`), value: data.job[k][field], swatch: JOB_SWATCH[k] }));
  const material = (field: 'grams' | 'cost') =>
    (['psi', 'partial', 'own'] as const).map((k) => ({
      key: k,
      label: t(`psi.stats.material.${k}`),
      value: data.material[k][field],
      swatch: MATERIAL_SWATCH[k],
    }));

  return (
    <div className="space-y-4">
      <Row label={t('psi.stats.jobs')}><PsiBucketBar segments={job('prints')} format={(v) => String(v)} /></Row>
      <Row label={t('psi.stats.time')}><PsiBucketBar segments={job('hours')} format={fmtHours} /></Row>
      <Row label={t('psi.stats.weight')}><PsiBucketBar segments={material('grams')} format={fmtWeight} /></Row>
      <Row label={t('psi.stats.cost')}>
        <PsiBucketBar segments={material('cost')} format={(v) => fmtMoney(currency, v)} />
        <p className="mt-1.5 text-[11px] text-bambu-gray">{t('psi.stats.costNote')}</p>
      </Row>
      {hasPermission(PSI_ACCOUNTING_PERMISSION) && (
        <Link to={PSI_ACCOUNTING_PATH} className="inline-flex items-center gap-1 text-xs text-bambu-green hover:underline">
          {t('psi.stats.openAccounting')}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-bambu-gray-light">{label}</p>
      {children}
    </div>
  );
}

export function PsiPrinterWidget({ period, printerNames }: { period: PeriodQuery; printerNames?: Map<string, string> }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>('weight');
  const { data } = usePsiAccounting(period);
  if (!data) return null;
  if (data.printers.length === 0) return <p className="text-sm text-bambu-gray">{t('psi.stats.empty')}</p>;
  const format = metric === 'weight' ? fmtWeight : metric === 'time' ? fmtHours : (v: number) => String(v);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <MetricToggle value={metric} onChange={setMetric} />
      </div>
      {data.printers.map((p) => (
        <div key={String(p.printer_id)}>
          <p className="mb-1 truncate text-xs text-white">
            {(p.printer_id != null && printerNames?.get(String(p.printer_id))) || p.printer_name || t('psi.stats.unknownPrinter')}
          </p>
          <PsiBucketBar segments={printerSegments(p, metric, t)} format={format} />
        </div>
      ))}
    </div>
  );
}
