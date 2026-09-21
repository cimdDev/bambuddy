import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Tags } from 'lucide-react';
import { Button } from '../../../components/Button';
import { Card, CardContent } from '../../../components/Card';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { usePsiMaterialPrices, usePsiSaveMaterialPrices } from '../hooks';
import '../i18n';
import type { PsiMaterialPrice } from '../model';

type Draft = Record<string, string>;

const normalize = (material: string) => material.trim().toUpperCase().slice(0, 50);
const toDraft = (rows: PsiMaterialPrice[]): Draft =>
  Object.fromEntries(rows.map((r) => [r.material, r.cost_per_kg == null ? '' : String(r.cost_per_kg)]));

/** Parses a typed price; `undefined` means "not a valid price". */
function parsePrice(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Default price per kg for each material. Saving writes it onto every spool of
 * that material that has no price of its own (backend: `material_prices.py`);
 * spools with a typed price keep it.
 */
export function PsiMaterialPrices({ currency, globalDefault }: { currency: string; globalDefault?: number }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('inventory:read');
  const canEdit = hasPermission('inventory:update');
  const { data, isLoading } = usePsiMaterialPrices(canRead);
  const save = usePsiSaveMaterialPrices();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newMaterial, setNewMaterial] = useState('');

  const saved = useMemo(() => toDraft(data ?? []), [data]);
  const values = draft ?? saved;
  const byMaterial = useMemo(() => new Map((data ?? []).map((r) => [r.material, r])), [data]);
  const materials = Object.keys(values).sort();
  const invalid = materials.filter((m) => parsePrice(values[m]) === undefined);
  const dirty = draft !== null && materials.some((m) => (saved[m] ?? '') !== values[m]);

  if (!canRead) return null;

  const edit = (material: string, value: string) => setDraft({ ...values, [material]: value });

  const add = () => {
    const material = normalize(newMaterial);
    if (!material) return;
    if (!(material in values)) edit(material, '');
    setNewMaterial('');
  };

  const submit = () => {
    const prices: Record<string, number | null> = {};
    for (const m of materials) prices[m] = parsePrice(values[m]) ?? null;
    save.mutate(prices, {
      onSuccess: (result) => {
        setDraft(null);
        showToast(t('psi.prices.saved', { count: result.repriced }), 'success');
      },
      onError: (e) => showToast(t('psi.error.save', { message: (e as Error).message }), 'error'),
    });
  };

  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="border-b border-bambu-dark-tertiary px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Tags className="h-4 w-4 text-bambu-green" />
            {t('psi.prices.title')}
          </h2>
          <p className="mt-1 text-xs text-bambu-gray">{t('psi.prices.help')}</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-bambu-green" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-bambu-gray">
                  <th className="px-4 py-2 font-medium">{t('psi.prices.material')}</th>
                  <th className="px-3 py-2 font-medium">{t('psi.prices.price', { currency })}</th>
                  <th className="px-3 py-2 font-medium">{t('psi.prices.spools')}</th>
                </tr>
              </thead>
              <tbody>
                {materials.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-xs text-bambu-gray">{t('psi.prices.empty')}</td>
                  </tr>
                )}
                {materials.map((material) => {
                  const row = byMaterial.get(material);
                  const bad = parsePrice(values[material]) === undefined;
                  return (
                    <tr key={material} className="border-t border-bambu-dark-tertiary">
                      <td className="px-4 py-2 font-medium text-white">{material}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={t('psi.prices.priceFor', { material })}
                          value={values[material]}
                          onChange={(e) => edit(material, e.target.value)}
                          disabled={!canEdit}
                          placeholder={globalDefault != null ? t('psi.prices.placeholder', { value: globalDefault }) : ''}
                          className={`w-28 rounded-md border bg-bambu-dark px-2 py-1 text-right tabular-nums text-white focus:outline-none disabled:opacity-60 ${
                            bad ? 'border-red-500' : 'border-bambu-dark-tertiary focus:border-bambu-green'
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-bambu-gray">
                        {row && row.spools > 0
                          ? [
                              row.auto > 0 && t('psi.prices.auto', { count: row.auto }),
                              row.own > 0 && t('psi.prices.own', { count: row.own }),
                              row.unpriced > 0 && t('psi.prices.unpriced', { count: row.unpriced }),
                            ].filter(Boolean).join(' · ')
                          : t('psi.prices.noSpools')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bambu-dark-tertiary px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newMaterial}
                onChange={(e) => setNewMaterial(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder={t('psi.prices.addPlaceholder')}
                aria-label={t('psi.prices.add')}
                className="w-40 rounded-md border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1 text-sm text-white focus:border-bambu-green focus:outline-none"
              />
              <Button variant="secondary" size="sm" onClick={add} disabled={!normalize(newMaterial)}>
                <Plus className="h-4 w-4" />
                {t('psi.prices.add')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {draft !== null && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={save.isPending}>
                  {t('psi.common.cancel')}
                </Button>
              )}
              <Button size="sm" onClick={submit} disabled={!dirty || invalid.length > 0 || save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('psi.common.save')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
