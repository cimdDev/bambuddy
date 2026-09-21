import type { Metric } from '../../components/MetricToggle';
import { CLASS_SWATCH } from './model';
import type { PsiAccounting, PsiClass } from './model';

export const MATERIAL_SWATCH = { psi: CLASS_SWATCH.psi, partial: CLASS_SWATCH.private_partial, own: CLASS_SWATCH.private_own };
export const JOB_SWATCH = { psi: CLASS_SWATCH.psi, private: CLASS_SWATCH.private };

/** Buckets per metric: prints and time split on the job; only weight has three. */
export function printerSegments(printer: PsiAccounting['printers'][number], metric: Metric, t: (k: string) => string) {
  const sum = (classes: PsiClass[], field: 'prints' | 'hours' | 'grams') =>
    classes.reduce((acc, c) => acc + printer.by_class[c][field], 0);
  if (metric === 'weight') {
    return [
      { key: 'psi', label: t('psi.stats.material.psi'), value: sum(['psi', 'private'], 'grams'), swatch: MATERIAL_SWATCH.psi },
      { key: 'partial', label: t('psi.stats.material.partial'), value: sum(['private_partial'], 'grams'), swatch: MATERIAL_SWATCH.partial },
      { key: 'own', label: t('psi.stats.material.own'), value: sum(['private_own'], 'grams'), swatch: MATERIAL_SWATCH.own },
    ];
  }
  const field = metric === 'time' ? 'hours' : 'prints';
  return [
    { key: 'psi', label: t('psi.stats.job.psi'), value: sum(['psi'], field), swatch: JOB_SWATCH.psi },
    { key: 'private', label: t('psi.stats.job.private'), value: sum(['private', 'private_partial', 'private_own'], field), swatch: JOB_SWATCH.private },
  ];
}
