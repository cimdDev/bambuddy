import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, UserRound, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { Card, CardContent } from '../../../components/Card';
import { usePsiUserRepair, usePsiUserSuggestions } from '../hooks';
import { displayUser } from '../model';
import type { PsiUser } from '../model';

/** Repair who sliced a record. Writes to the record that holds the user. */
export function PsiUserDialog({ user, onClose }: { user: PsiUser; onClose: () => void }) {
  const { t } = useTranslation();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(displayUser(user) ?? '');
  const repair = usePsiUserRepair();
  const suggestions = usePsiUserSuggestions(true);
  const record = user.record;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  if (!record) return null;
  const trimmed = value.trim();

  const submit = () => {
    if (!trimmed || repair.isPending) return;
    repair.mutate({ entity: record.entity, id: record.id, value: trimmed }, { onSuccess: onClose });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!repair.isPending) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !repair.isPending) onClose();
      }}
      role="presentation"
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-full bg-bambu-dark p-2 text-bambu-green">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-white">{t('psi.user.dialogTitle')}</h3>
              <p className="mt-1 text-xs text-bambu-gray">
                {t('psi.user.writesTo', { target: t(`psi.entity.${record.entity}`) })}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-bambu-gray hover:text-white" aria-label={t('psi.common.close')}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="mb-1 block text-xs font-medium text-bambu-gray-light" htmlFor={`${listId}-input`}>
              {t('psi.user.label')}
            </label>
            <input
              id={`${listId}-input`}
              ref={input}
              list={listId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('psi.user.placeholder')}
              maxLength={255}
              autoComplete="off"
              className="w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-3 py-2 text-sm text-white placeholder:text-bambu-gray focus:border-bambu-green focus:outline-none"
            />
            <datalist id={listId}>
              {(suggestions.data ?? []).map((s) => {
                const label = displayUser(s);
                return label ? <option key={`${s.name}|${s.email}`} value={label} /> : null;
              })}
            </datalist>
            <p className="mt-2 text-xs text-bambu-gray">{t('psi.user.help')}</p>
            {repair.isError && (
              <p className="mt-2 text-xs text-red-500">{t('psi.error.save', { message: (repair.error as Error).message })}</p>
            )}
            <div className="mt-5 flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={repair.isPending}>
                {t('psi.common.cancel')}
              </Button>
              <Button type="submit" className="flex-1" disabled={!trimmed || repair.isPending}>
                {repair.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('psi.common.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
