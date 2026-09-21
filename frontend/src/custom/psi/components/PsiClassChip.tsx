import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, GitCompareArrows, Loader2 } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { usePsiUpdate } from '../hooks';
import { CLASS_TONE, PSI_CLASSES } from '../model';
import type { PsiClass, PsiMeta } from '../model';
import { PsiPopover } from './PsiPopover';

/**
 * Shows whether a job is PSI or private, and whose material it used. One
 * control for every surface: a chip that opens the four choices. Editable only
 * with the record's update permission; read-only chips carry no affordance.
 */
export function PsiClassChip({ meta, readOnly, compact }: { meta: PsiMeta; readOnly?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const update = usePsiUpdate(meta.entity, meta.id);

  const cls = meta.psi_class;
  const inherited = meta.psi_class_source !== 'own';
  const origin = meta.psi_class_source && meta.psi_class_source !== 'own'
    ? t('psi.class.inherited', { source: t(`psi.entity.${meta.psi_class_source === 'library' ? 'library' : meta.psi_class_source}`) })
    : meta.psi_class_source === null
      ? t('psi.class.byDefault')
      : null;
  const title = [t(`psi.class.${cls}`), t(`psi.class.desc.${cls}`), origin, meta.runs_mixed ? t('psi.class.mixed') : null]
    .filter(Boolean)
    .join('\n');

  const label = (
    <>
      <span className="truncate">{t(compact ? `psi.class.short.${cls}` : `psi.class.${cls}`)}</span>
      {meta.runs_mixed && <GitCompareArrows className="w-3 h-3 shrink-0" aria-label={t('psi.class.mixed')} />}
      {update.isPending && <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
    </>
  );
  const chip = `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${CLASS_TONE[cls]} ${inherited ? 'border-dashed' : ''}`;

  if (readOnly || !meta.can_edit) {
    return <span className={chip} title={title} data-testid="psi-class">{label}</span>;
  }

  const choose = (value: PsiClass) => {
    setOpen(false);
    if (value === meta.psi_class_own) return;
    update.mutate(
      { psi_class: value },
      { onError: (e) => showToast(t('psi.error.save', { message: (e as Error).message }), 'error') },
    );
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${chip} cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-bambu-green`}
        title={`${title}\n${t('psi.class.change')}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="psi-class"
      >
        {label}
      </button>
      <PsiPopover anchor={anchor} open={open} onClose={close} width={300}>
        <div className="p-2">
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-white">{t('psi.class.title')}</p>
          <div role="radiogroup" className="flex flex-col gap-1">
            {PSI_CLASSES.map((value) => {
              const active = value === cls;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => choose(value)}
                  className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bambu-dark-tertiary ${active ? 'bg-bambu-dark-tertiary/60' : ''}`}
                >
                  <span className={`mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border ${CLASS_TONE[value]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white">{t(`psi.class.${value}`)}</span>
                    <span className="block text-xs text-bambu-gray">{t(`psi.class.desc.${value}`)}</span>
                  </span>
                  {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-bambu-green" />}
                </button>
              );
            })}
          </div>
          <p className="px-2 pt-2 pb-1 text-[11px] text-bambu-gray">{t(`psi.class.applies.${meta.entity}`)}</p>
        </div>
      </PsiPopover>
    </>
  );
}
