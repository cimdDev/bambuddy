import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Package,
  Palette,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../api/client';
import type {
  ColorCatalogEntry,
  InventorySpool,
  OrderBatchConfigSlotInput,
  OrderBatchDetail,
  OrderBatchPlate,
  OrderBatchPlateConfig,
} from '../api/client';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { ConfirmModal } from '../components/ConfirmModal';
import { useToast } from '../contexts/ToastContext';

function formatDuration(seconds?: number | null) {
  if (!seconds && seconds !== 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  if (!/^#?[0-9A-Fa-f]{6}$/.test(raw)) return null;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  return `#${hex.toUpperCase()}`;
}

function hexDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  const hexA = normalizeHexColor(a)?.slice(1);
  const hexB = normalizeHexColor(b)?.slice(1);
  if (!hexA || !hexB) return null;
  const ar = Number.parseInt(hexA.slice(0, 2), 16);
  const ag = Number.parseInt(hexA.slice(2, 4), 16);
  const ab = Number.parseInt(hexA.slice(4, 6), 16);
  const br = Number.parseInt(hexB.slice(0, 2), 16);
  const bg = Number.parseInt(hexB.slice(2, 4), 16);
  const bb = Number.parseInt(hexB.slice(4, 6), 16);
  if ([ar, ag, ab, br, bg, bb].some((v) => Number.isNaN(v))) return null;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function brandMatchesCatalog(manufacturer: string | null | undefined, brand: string | null | undefined): boolean {
  const m = (manufacturer || '').trim().toLowerCase();
  const b = (brand || '').trim().toLowerCase();
  if (!m || !b) return true;
  return m.includes(b) || b.includes(m);
}

function materialMatchesCatalog(catalogMaterial: string | null | undefined, sourceMaterial: string | null | undefined): boolean {
  const cm = (catalogMaterial || '').trim();
  const sm = (sourceMaterial || '').trim();
  if (!cm || !sm) return true;
  const cmFamily = normalizeMaterialFamily(cm);
  const smFamily = normalizeMaterialFamily(sm);
  if (cmFamily && smFamily && cmFamily === smFamily) return true;
  const cu = cm.toUpperCase();
  const su = sm.toUpperCase();
  return cu.includes(su) || su.includes(cu);
}

function findBestCatalogColorMatch(
  catalog: ColorCatalogEntry[],
  params: { brand?: string | null; material?: string | null; colorHex?: string | null }
): { entry: ColorCatalogEntry | null; matchType: 'exact' | 'closest' | 'fallback' } {
  const colorHex = normalizeHexColor(params.colorHex);
  if (!catalog.length || !colorHex) return { entry: null, matchType: 'fallback' };

  const preferred = catalog.filter(
    (c) => brandMatchesCatalog(c.manufacturer, params.brand) && materialMatchesCatalog(c.material, params.material)
  );
  const pool = preferred.length ? preferred : catalog;

  const exact = pool.find((c) => normalizeHexColor(c.hex_color) === colorHex);
  if (exact) return { entry: exact, matchType: 'exact' };

  let best: { entry: ColorCatalogEntry; dist: number } | null = null;
  for (const entry of pool) {
    const dist = hexDistance(colorHex, entry.hex_color);
    if (dist === null) continue;
    if (!best || dist < best.dist) best = { entry, dist };
  }
  if (best) return { entry: best.entry, matchType: 'closest' };
  return { entry: null, matchType: 'fallback' };
}

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

type PlateBaseRow = {
  slot_index: number;
  material_type: string | null;
  color_hex: string | null;
  color_family: string | null;
  used_g: number | null;
  nozzle_assignment: string | null;
};

type ConfigDraft = {
  name: string;
  quantityTarget: string;
  requiredPrinterModel: string;
  dispatchLimit: string;
  slots: Record<number, OrderBatchConfigSlotInput>;
};

type SelectorState = {
  configId: number;
  slotIndex: number;
  baseRow: PlateBaseRow;
} | null;

function colorSwatchStyle(hex: string | null | undefined) {
  return { backgroundColor: normalizeHexColor(hex) || '#808080' };
}

function spoolHex(spool: InventorySpool): string | null {
  if (!spool.rgba || spool.rgba.length < 6) return null;
  return `#${spool.rgba.slice(0, 6)}`;
}

function spoolRemainingG(spool: InventorySpool): number | null {
  if (!Number.isFinite(spool.label_weight) || !Number.isFinite(spool.weight_used)) return null;
  return Math.max(0, Math.round(spool.label_weight - spool.weight_used));
}

function normalizeMaterialFamily(value: string | null | undefined): string {
  const raw = (value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('PLA')) return 'PLA';
  if (raw.startsWith('PETG')) return 'PETG';
  if (raw.startsWith('ABS')) return 'ABS';
  if (raw.startsWith('ASA')) return 'ASA';
  if (raw.startsWith('TPU')) return 'TPU';
  if (raw.startsWith('PA')) return 'PA';
  return raw;
}

function getPlateBaseRows(plate: OrderBatchPlate): PlateBaseRow[] {
  const snapshot = (plate.plate_metadata_snapshot || {}) as Record<string, unknown>;
  const raw = Array.isArray(snapshot.filament_map) ? snapshot.filament_map : [];
  const rows: PlateBaseRow[] = [];
  const seen = new Set<number>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const slotRaw = e.slot_id ?? e.slot_index;
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 1 || seen.has(slot)) continue;
    seen.add(slot);
    rows.push({
      slot_index: slot,
      material_type: (e.material_type as string | null) ?? (e.type as string | null) ?? null,
      color_hex: (e.color_hex as string | null) ?? (e.color as string | null) ?? null,
      color_family: (e.color_family as string | null) ?? null,
      used_g: typeof e.used_g === 'number' ? e.used_g : typeof e.used_grams === 'number' ? (e.used_grams as number) : null,
      nozzle_assignment:
        e.nozzle_assignment !== undefined && e.nozzle_assignment !== null ? String(e.nozzle_assignment) : null,
    });
  }

  if (!rows.length) {
    const cfgSlots = plate.configs.flatMap((cfg) => cfg.slots);
    for (const slot of cfgSlots) {
      if (seen.has(slot.slot_index)) continue;
      seen.add(slot.slot_index);
      rows.push({
        slot_index: slot.slot_index,
        material_type: slot.material_type,
        color_hex: slot.color_hex,
        color_family: slot.color_family,
        used_g: null,
        nozzle_assignment: slot.nozzle_assignment ?? null,
      });
    }
  }

  return rows.sort((a, b) => a.slot_index - b.slot_index);
}

function formatColorLabel(materialType: string | null, colorHex: string | null): string {
  const mat = materialType || '—';
  const color = normalizeHexColor(colorHex) || '—';
  return `${mat} ${color}`;
}

function computePlateProgress(plate: OrderBatchPlate) {
  const progress = {
    qty_total: 0,
    qty_dispatched: 0,
    qty_completed: 0,
    qty_failed: 0,
    qty_cancelled: 0,
    qty_queued: 0,
    qty_printing: 0,
    remaining_to_dispatch: 0,
  };
  for (const cfg of plate.configs) {
    progress.qty_total += cfg.quantity_target;
    progress.qty_dispatched += cfg.progress.dispatched_non_cancelled;
    progress.qty_completed += cfg.progress.completed_runs;
    progress.qty_failed += cfg.progress.failed_runs;
    progress.qty_cancelled += cfg.progress.cancelled_runs;
    progress.qty_queued += cfg.progress.queued_runs;
    progress.qty_printing += cfg.progress.printing_runs;
    progress.remaining_to_dispatch += cfg.progress.remaining_to_dispatch;
  }
  return progress;
}

function ProgressBar({
  value,
  max,
  className = '',
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className={`h-1.5 sm:h-2 rounded-full bg-bambu-dark-tertiary overflow-hidden ${className}`}>
      <div className="h-full bg-bambu-green rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function OrderColorOverrideSelectorModal({
  isOpen,
  baseRow,
  currentSlot,
  onClose,
  onApplyCatalogColor,
  onResetToBase,
}: {
  isOpen: boolean;
  baseRow: PlateBaseRow | null;
  currentSlot: OrderBatchConfigSlotInput | null;
  onClose: () => void;
  onApplyCatalogColor: (entry: ColorCatalogEntry) => void;
  onResetToBase: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [colorFilterCatalogId, setColorFilterCatalogId] = useState<number | null>(null);
  const [inventoryOnly, setInventoryOnly] = useState(true);

  const { data: spools = [], isLoading: spoolsLoading } = useQuery({
    queryKey: ['inventory-spools'],
    queryFn: () => api.getSpools(),
    enabled: isOpen,
  });
  const { data: colorCatalog = [], isLoading: colorCatalogLoading } = useQuery({
    queryKey: ['color-catalog'],
    queryFn: () => api.getColorCatalog(),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setBrandFilter('');
    setColorFilterCatalogId(null);
    setInventoryOnly(true);
    setMaterialFilter((currentSlot?.material_type || baseRow?.material_type || '').trim());
  }, [isOpen, baseRow?.material_type, currentSlot?.material_type]);

  const normalizedMaterialFilter = normalizeMaterialFamily(materialFilter);
  const activeInventorySpools = useMemo(
    () =>
      spools.filter((spool) => {
        if (spool.archived_at) return false;
        const remaining = spoolRemainingG(spool);
        return remaining === null || remaining > 0;
      }),
    [spools]
  );

  const spoolCatalogMatchById = useMemo(() => {
    const out = new Map<number, { entry: ColorCatalogEntry | null; matchType: 'exact' | 'closest' | 'fallback' }>();
    for (const spool of spools) {
      out.set(
        spool.id,
        findBestCatalogColorMatch(colorCatalog, {
          brand: spool.brand,
          material: spool.material,
          colorHex: spoolHex(spool),
        })
      );
    }
    return out;
  }, [spools, colorCatalog]);

  const inventoryCatalogAvailability = useMemo(() => {
    const counts = new Map<number, number>();
    const byId = new Map<number, { exact: number; closest: number; entry: ColorCatalogEntry }>();
    for (const spool of activeInventorySpools) {
      const match = spoolCatalogMatchById.get(spool.id);
      if (!match?.entry) continue;
      const id = match.entry.id;
      counts.set(id, (counts.get(id) || 0) + 1);
      const existing = byId.get(id) || { exact: 0, closest: 0, entry: match.entry };
      if (match.matchType === 'exact') existing.exact += 1;
      else if (match.matchType === 'closest') existing.closest += 1;
      byId.set(id, existing);
    }
    return { counts, byId };
  }, [activeInventorySpools, spoolCatalogMatchById]);

  const filteredCatalogEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return colorCatalog.filter((entry) => {
      const availableCount = inventoryCatalogAvailability.counts.get(entry.id) || 0;
      if (inventoryOnly && availableCount <= 0) return false;
      if (normalizedMaterialFilter && normalizeMaterialFamily(entry.material) !== normalizedMaterialFilter) return false;
      if (brandFilter && entry.manufacturer !== brandFilter) return false;
      if (colorFilterCatalogId && entry.id !== colorFilterCatalogId) return false;
      if (!q) return true;
      return (
        entry.color_name.toLowerCase().includes(q) ||
        (entry.manufacturer || '').toLowerCase().includes(q) ||
        (entry.material || '').toLowerCase().includes(q) ||
        (entry.hex_color || '').toLowerCase().includes(q)
      );
    });
  }, [colorCatalog, inventoryCatalogAvailability, inventoryOnly, normalizedMaterialFilter, brandFilter, colorFilterCatalogId, search]);

  const materialOptions = useMemo(() => {
    const values = new Set<string>();
    const sourceEntries = colorCatalog.filter((e) => (inventoryCatalogAvailability.counts.get(e.id) || 0) > 0);
    for (const entry of sourceEntries) {
      const normalized = normalizeMaterialFamily(entry.material);
      if (normalized) values.add(normalized);
    }
    return Array.from(values).sort();
  }, [colorCatalog, inventoryCatalogAvailability]);

  const brandOptions = useMemo(() => {
    const values = new Set<string>();
    const sourceEntries = colorCatalog.filter((e) => (inventoryCatalogAvailability.counts.get(e.id) || 0) > 0);
    for (const entry of sourceEntries) {
      if (entry.manufacturer) values.add(entry.manufacturer);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [colorCatalog, inventoryCatalogAvailability]);

  const colorFilterOptions = useMemo(() => {
    const entries = colorCatalog.filter((entry) => (inventoryCatalogAvailability.counts.get(entry.id) || 0) > 0);
    return entries
      .map((entry) => ({
        entry,
        count: inventoryCatalogAvailability.counts.get(entry.id) || 0,
      }))
      .sort((a, b) => a.entry.color_name.localeCompare(b.entry.color_name));
  }, [colorCatalog, inventoryCatalogAvailability]);

  if (!isOpen || !baseRow) return null;

  const busy = spoolsLoading || colorCatalogLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bambu-dark-tertiary">
          <div className="flex items-center gap-2 min-w-0">
            <Palette className="w-4 h-4 text-bambu-green shrink-0" />
            <div className="min-w-0">
              <div className="text-white font-medium text-sm">{t('orders.selector.title')}</div>
              <div className="text-xs text-bambu-gray truncate">
                {t('orders.slotLabel', { slotIndex: baseRow.slot_index })} · {baseRow.material_type || '—'} ·{' '}
                {normalizeHexColor(baseRow.color_hex) || '—'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bambu-dark-tertiary text-bambu-gray hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_auto_auto_auto] gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-bambu-gray" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-bambu-dark border border-bambu-dark-tertiary rounded-lg text-white text-sm"
                placeholder={t('orders.selector.searchPlaceholder')}
              />
            </div>
            <select
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
              className="bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">{t('orders.selector.allMaterials')}</option>
              {materialOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">{t('orders.selector.allBrands')}</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark text-xs text-bambu-gray-light whitespace-nowrap">
              <input
                type="checkbox"
                checked={inventoryOnly}
                onChange={(e) => setInventoryOnly(e.target.checked)}
                className="accent-bambu-green"
              />
              {t('orders.selector.inventoryOnly')}
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-bambu-gray">{t('orders.selector.availableColors')}</div>
              <div className="text-[11px] text-bambu-gray">
                {filteredCatalogEntries.length} {t('orders.selector.matches')}
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setColorFilterCatalogId(null)}
                className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                  colorFilterCatalogId === null
                    ? 'border-bambu-green bg-bambu-green/10 text-bambu-green'
                    : 'border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light hover:border-bambu-gray'
                }`}
              >
                {t('orders.selector.allColors')}
              </button>
              {colorFilterOptions.map(({ entry, count }) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setColorFilterCatalogId(entry.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                    colorFilterCatalogId === entry.id
                      ? 'border-bambu-green bg-bambu-green/10 text-bambu-green'
                      : 'border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light hover:border-bambu-gray'
                  }`}
                  title={`${entry.color_name} (${count})`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-white/10"
                    style={colorSwatchStyle(entry.hex_color)}
                  />
                  <span className="truncate max-w-[120px]">{entry.color_name}</span>
                  <span className="text-[10px] px-1 py-0 rounded bg-bambu-dark-secondary border border-bambu-dark-tertiary">
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {normalizedMaterialFilter && (
              <span className="px-2 py-0.5 rounded-full border border-bambu-green/20 bg-bambu-green/10 text-bambu-green">
                {normalizedMaterialFilter}
              </span>
            )}
            {colorFilterCatalogId !== null && (
              <span className="px-2 py-0.5 rounded-full border border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light">
                {t('orders.selector.color')}:{' '}
                {colorFilterOptions.find((opt) => opt.entry.id === colorFilterCatalogId)?.entry.color_name || `#${colorFilterCatalogId}`}
              </span>
            )}
          </div>

          <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 max-h-[420px] overflow-y-auto">
            {busy ? (
              <div className="flex items-center justify-center py-10 text-bambu-gray gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('orders.selector.loading')}
              </div>
            ) : filteredCatalogEntries.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredCatalogEntries.map((entry) => {
                    const inventoryCount = inventoryCatalogAvailability.counts.get(entry.id) || 0;
                    const inventoryClosestCount = inventoryCatalogAvailability.byId.get(entry.id)?.closest || 0;
                    const selected = currentSlot?.metadata_json && typeof currentSlot.metadata_json === 'object'
                      ? (currentSlot.metadata_json as Record<string, unknown>).color_catalog_id === entry.id
                      : false;
                    return (
                      <button
                        key={entry.id}
                        onClick={() => onApplyCatalogColor(entry)}
                        className={`text-left rounded-xl border p-3 shadow-sm transition-all ${
                          selected
                            ? 'border-bambu-green bg-bambu-green/10 shadow-bambu-green/10'
                            : 'border-bambu-dark-tertiary bg-gradient-to-br from-bambu-card to-bambu-dark-secondary hover:border-bambu-green/40'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark flex items-center justify-center shrink-0">
                            <span className="w-5 h-5 rounded-full border border-white/10" style={colorSwatchStyle(entry.hex_color)} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-white text-sm font-medium truncate">
                                {entry.manufacturer ? `${entry.manufacturer} ` : ''}{entry.material || baseRow.material_type || ''}
                              </div>
                              {selected && <Check className="w-4 h-4 text-bambu-green shrink-0" />}
                            </div>
                            <div className="text-xs text-bambu-gray mt-1">
                              {entry.color_name}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {entry.hex_color && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] border border-bambu-dark-tertiary bg-bambu-dark text-white">
                                  {normalizeHexColor(entry.hex_color)}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-full text-[11px] border border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light">
                                {t('orders.selector.catalogTag', { id: entry.id })}
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[11px] border border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light">
                                {t('orders.selector.inventoryMatches', { count: inventoryCount })}
                              </span>
                              {inventoryClosestCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                  {t('orders.selector.closestCatalog')}
                                </span>
                              )}
                              {inventoryCount === 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] border border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light">
                                  {t('orders.selector.catalogFallback')}
                                </span>
                              )}
                              {entry.material && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] border border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray-light">
                                  {entry.material}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center text-bambu-gray text-sm">
                  {inventoryOnly ? t('orders.selector.noInventoryMatches') : t('orders.selector.noCatalogMatches')}
                </div>
              )
            }
          </div>
        </div>

        <div className="px-4 py-3 border-t border-bambu-dark-tertiary flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onResetToBase}>
            {t('orders.selector.resetToBase')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderHeaderEditor({
  order,
  onChanged,
  onDeleted,
}: {
  order: OrderBatchDetail;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [name, setName] = useState(order.name);
  const [customer, setCustomer] = useState(order.customer_label || '');
  const [dueDate, setDueDate] = useState(toDateInputValue(order.due_date));
  const [notes, setNotes] = useState(order.notes || '');
  const [statusValue, setStatusValue] = useState(order.status || 'draft');
  const [showNotes, setShowNotes] = useState(Boolean(order.notes));
  const [confirmAction, setConfirmAction] = useState<null | 'halt' | 'close' | 'delete'>(null);

  useEffect(() => {
    setName(order.name);
    setCustomer(order.customer_label || '');
    setDueDate(toDateInputValue(order.due_date));
    setNotes(order.notes || '');
    setStatusValue(order.status || 'draft');
    setShowNotes(Boolean(order.notes));
  }, [order.id, order.name, order.customer_label, order.due_date, order.notes, order.updated_at]);

  const isFinalOrder = order.status === 'completed' || order.status === 'cancelled';

  const allowedStatusOptions = useMemo(() => {
    const current = (order.status || 'draft').toLowerCase();
    const map: Record<string, string[]> = {
      draft: ['draft', 'active', 'paused', 'cancelled'],
      active: ['active', 'paused', 'completed', 'cancelled'],
      running: ['running', 'active', 'paused', 'completed', 'cancelled'],
      paused: ['paused', 'active', 'completed', 'cancelled'],
      completed: ['completed'],
      cancelled: ['cancelled'],
    };
    return map[current] || [order.status || 'draft'];
  }, [order.status]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateOrder(order.id, {
        name: name.trim(),
        customer_label: customer.trim() || null,
        due_date: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
        notes: notes.trim() || null,
        status: statusValue,
      }),
    onSuccess: () => {
      onChanged();
      showToast(t('orders.headerSaved'), 'success');
    },
    onError: (err: Error) => showToast(err.message || t('orders.headerSaveFailed'), 'error'),
  });

  const onSave = () => {
    if (!name.trim()) {
      showToast(t('orders.orderNameRequired'), 'error');
      return;
    }
    saveMutation.mutate();
  };

  const lifecycleMutation = useMutation({
    mutationFn: async (action: 'halt' | 'close' | 'delete') => {
      if (action === 'delete') {
        return api.deleteOrder(order.id);
      }
      if (action === 'halt') {
        return api.updateOrder(order.id, { status: 'paused' });
      }
      return api.updateOrder(order.id, { status: 'completed' });
    },
    onSuccess: (_res, action) => {
      setConfirmAction(null);
      if (action === 'delete') {
        showToast(t('orders.orderDeleted'), 'success');
        onDeleted();
        return;
      }
      onChanged();
      showToast(
        action === 'halt' ? t('orders.orderHalted') : t('orders.orderClosed'),
        'success'
      );
    },
    onError: (err: Error) => {
      showToast(err.message || t('orders.orderActionFailed'), 'error');
    },
  });

  const quickResumeMutation = useMutation({
    mutationFn: () => api.updateOrder(order.id, { status: 'active' }),
    onSuccess: () => {
      onChanged();
      showToast(t('orders.orderResumed'), 'success');
    },
    onError: (err: Error) => showToast(err.message || t('orders.orderActionFailed'), 'error'),
  });

  const statusLabel = (value: string) => t(`orders.statusOptions.${value}`, { defaultValue: value });

  return (
    <Card>
      <CardHeader className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-white font-medium text-sm md:text-base">{t('orders.orderHeader')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={() => setShowNotes((v) => !v)}
          >
            {showNotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showNotes ? t('orders.hideNotes') : t('orders.showNotes')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-bambu-gray mb-1">{t('orders.orderName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
              disabled={isFinalOrder}
            />
          </div>
          <div>
            <label className="block text-xs text-bambu-gray mb-1">{t('orders.customer')}</label>
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
              placeholder={t('orders.customerPlaceholder')}
              disabled={isFinalOrder}
            />
          </div>
          <div>
            <label className="block text-xs text-bambu-gray mb-1">{t('orders.dueDateOptional')}</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
              disabled={isFinalOrder}
            />
          </div>
          <div>
            <label className="block text-xs text-bambu-gray mb-1">{t('orders.orderStatus')}</label>
            <select
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark text-white text-sm"
              disabled={isFinalOrder}
            >
              {allowedStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {showNotes && (
          <div>
            <label className="block text-xs text-bambu-gray mb-1">{t('orders.notesOptional')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm resize-y min-h-[64px]"
              placeholder={t('orders.notesPlaceholder')}
              disabled={isFinalOrder}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {!isFinalOrder && order.status !== 'paused' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmAction('halt')}
                disabled={lifecycleMutation.isPending}
              >
                <Pause className="w-4 h-4" />
                {t('orders.haltOrder')}
              </Button>
            )}
            {!isFinalOrder && order.status === 'paused' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => quickResumeMutation.mutate()}
                disabled={quickResumeMutation.isPending}
              >
                {quickResumeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {t('orders.resumeOrder')}
              </Button>
            )}
            {!isFinalOrder && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmAction('close')}
                disabled={lifecycleMutation.isPending}
              >
                <Check className="w-4 h-4" />
                {t('orders.closeOrder')}
              </Button>
            )}
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setConfirmAction('delete')}
              disabled={lifecycleMutation.isPending}
            >
              <Trash2 className="w-4 h-4" />
              {t('orders.deleteOrder')}
            </Button>
          </div>
          <Button size="sm" onClick={onSave} disabled={saveMutation.isPending || isFinalOrder}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('orders.saveHeader')}
          </Button>
        </div>

        {confirmAction && (
          <ConfirmModal
            title={
              confirmAction === 'halt'
                ? t('orders.confirmHaltTitle')
                : confirmAction === 'close'
                ? t('orders.confirmCloseTitle')
                : t('orders.confirmDeleteTitle')
            }
            message={
              confirmAction === 'halt'
                ? t('orders.confirmHaltMessage')
                : confirmAction === 'close'
                ? t('orders.confirmCloseMessage')
                : t('orders.confirmDeleteMessage')
            }
            confirmText={
              confirmAction === 'halt'
                ? t('orders.haltOrder')
                : confirmAction === 'close'
                ? t('orders.closeOrder')
                : t('orders.deleteOrder')
            }
            variant={confirmAction === 'delete' ? 'danger' : 'warning'}
            isLoading={lifecycleMutation.isPending}
            onCancel={() => setConfirmAction(null)}
            onConfirm={() => lifecycleMutation.mutate(confirmAction)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function OrderProgressSummaryCard({ order }: { order: OrderBatchDetail }) {
  const { t } = useTranslation();

  const summaryLabel = (key: string) => t(`orders.summary.${key}`, { defaultValue: key });
  const summaryQuantityTarget = Number(order.progress_summary?.quantity_target || 0);
  const summaryCompletedRuns = Number(order.progress_summary?.completed_runs || 0);
  const summaryProgressMax = Math.max(summaryQuantityTarget, 1);
  const summaryProgressPct = summaryQuantityTarget > 0 ? Math.round((summaryCompletedRuns / summaryQuantityTarget) * 100) : 0;

  return (
    <Card>
      <CardHeader className="px-3 py-2.5">
        <h2 className="text-white font-medium text-sm md:text-base">{t('orders.progressSummary')}</h2>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2">
          <div className="flex items-center gap-2">
            <ProgressBar value={summaryCompletedRuns} max={summaryProgressMax} className="flex-1 h-2" />
            <span className="text-xs text-white min-w-[38px] text-right">{summaryProgressPct}%</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-sm">
          {Object.entries(order.progress_summary || {}).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2">
              <div className="text-bambu-gray text-[11px] leading-tight">{summaryLabel(key)}</div>
              <div className="text-white font-semibold text-base leading-tight mt-0.5">{String(value)}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PlateMatrixCard({
  orderId,
  sourceLibraryFileId,
  plate,
  onChanged,
}: {
  orderId: number;
  sourceLibraryFileId: number | null;
  plate: OrderBatchPlate;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [newConfigName, setNewConfigName] = useState('');
  const [plateDispatchLimit, setPlateDispatchLimit] = useState('');
  const [drafts, setDrafts] = useState<Record<number, ConfigDraft>>({});
  const [selectorState, setSelectorState] = useState<SelectorState>(null);
  const [plateDispatchPreparing, setPlateDispatchPreparing] = useState(false);

  const baseRows = useMemo(() => getPlateBaseRows(plate), [plate]);
  const plateProgress = useMemo(() => computePlateProgress(plate), [plate]);
  const completionTarget = Math.max(plateProgress.qty_total, 0);
  const visibleConfigs = useMemo(
    () => plate.configs.filter((cfg) => cfg.status !== 'cancelled'),
    [plate.configs]
  );
  const hiddenCancelledCount = plate.configs.length - visibleConfigs.length;

  useEffect(() => {
    const next: Record<number, ConfigDraft> = {};
    for (const cfg of plate.configs) {
      const slots: Record<number, OrderBatchConfigSlotInput> = {};
      for (const slot of cfg.slots) {
        slots[slot.slot_index] = {
          slot_index: slot.slot_index,
          material_type: slot.material_type ?? null,
          color_hex: slot.color_hex ?? null,
          color_family: slot.color_family ?? null,
          brand_name: slot.brand_name ?? null,
          filament_name: slot.filament_name ?? null,
          nozzle_assignment: slot.nozzle_assignment ?? null,
          metadata_json: slot.metadata_json ?? null,
        };
      }
      next[cfg.id] = {
        name: cfg.name || '',
        quantityTarget: String(cfg.quantity_target),
        requiredPrinterModel: cfg.required_printer_model || '',
        dispatchLimit: '',
        slots,
      };
    }
    setDrafts(next);
  }, [plate.configs]);

  const createConfigMutation = useMutation({
    mutationFn: () =>
      api.createOrderConfig(orderId, {
        plate_index: plate.plate_index,
        quantity_target: 0,
        name: newConfigName.trim() || t('orders.modifiedConfigDefault'),
        seed_slots_from_plate: true,
      }),
    onSuccess: () => {
      setNewConfigName('');
      onChanged();
      showToast(t('orders.addConfigSuccess', { plateIndex: plate.plate_index }), 'success');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const dispatchPlateMutation = useMutation({
    mutationFn: () => {
      const parsed = plateDispatchLimit.trim() ? parsePositiveInt(plateDispatchLimit) : undefined;
      return api.dispatchOrderPlate(orderId, plate.plate_index, parsed);
    },
    onSuccess: (res) => {
      setPlateDispatchLimit('');
      onChanged();
      showToast(
        t('orders.dispatchPlateSuccess', {
          plateIndex: plate.plate_index,
          count: res.created_count,
          remaining: res.remaining_to_dispatch,
        }),
        'success'
      );
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const updateDraft = (configId: number, updater: (draft: ConfigDraft) => ConfigDraft) => {
    setDrafts((prev) => {
      const current = prev[configId];
      if (!current) return prev;
      return { ...prev, [configId]: updater(current) };
    });
  };

  const setSlotPatch = (configId: number, slotIndex: number, patch: Partial<OrderBatchConfigSlotInput>) => {
    updateDraft(configId, (draft) => {
      const existing = draft.slots[slotIndex] || { slot_index: slotIndex };
      return {
        ...draft,
        slots: {
          ...draft.slots,
          [slotIndex]: {
            ...existing,
            ...patch,
            slot_index: slotIndex,
          },
        },
      };
    });
  };

  const openSelector = (configId: number, baseRow: PlateBaseRow) => {
    setSelectorState({ configId, slotIndex: baseRow.slot_index, baseRow });
  };

  const applyCatalogColorSelection = (entry: ColorCatalogEntry) => {
    if (!selectorState) return;
    const current = drafts[selectorState.configId]?.slots[selectorState.slotIndex];
    const currentMeta =
      current?.metadata_json && typeof current.metadata_json === 'object'
        ? (current.metadata_json as Record<string, unknown>)
        : {};
    const patch: Partial<OrderBatchConfigSlotInput> = {
      material_type: selectorState.baseRow.material_type,
      color_hex: normalizeHexColor(entry.hex_color) || selectorState.baseRow.color_hex,
      brand_name: entry.manufacturer ?? null,
      filament_name: entry.color_name ?? current?.filament_name ?? null,
      metadata_json: {
        ...currentMeta,
        color_catalog_id: entry.id,
        inventory_spool_id: null,
        filament_catalog_id: null,
        selected_spool_snapshot: null,
        selected_filament_snapshot: null,
        selected_color_catalog_snapshot: {
          id: entry.id,
          manufacturer: entry.manufacturer,
          material: entry.material,
          color_name: entry.color_name,
          color_hex: normalizeHexColor(entry.hex_color),
        },
      },
    };
    setSlotPatch(selectorState.configId, selectorState.slotIndex, patch);
    setSelectorState(null);
  };

  const resetSlotToBase = (configId: number, row: PlateBaseRow) => {
    const current = drafts[configId]?.slots[row.slot_index];
    const currentMeta =
      current?.metadata_json && typeof current.metadata_json === 'object'
        ? (current.metadata_json as Record<string, unknown>)
        : {};
    const sourceSlot =
      currentMeta.source_slot && typeof currentMeta.source_slot === 'object'
        ? (currentMeta.source_slot as Record<string, unknown>)
        : undefined;
    setSlotPatch(configId, row.slot_index, {
      material_type: row.material_type,
      color_hex: row.color_hex,
      brand_name: null,
      filament_name: null,
      metadata_json: sourceSlot ? { source_slot: sourceSlot } : null,
    });
  };

  const persistConfigColumn = async (
    cfg: OrderBatchPlateConfig,
    options: { silent?: boolean; refreshAfter?: boolean } = {}
  ): Promise<boolean> => {
    const { silent = false, refreshAfter = true } = options;
    const draft = drafts[cfg.id];
    if (!draft) return true;
    const qty = parseNonNegativeInt(draft.quantityTarget);
    if (qty === null) {
      if (!silent) showToast(t('orders.invalidQty'), 'error');
      return false;
    }

    for (const row of baseRows) {
      const slot = draft.slots[row.slot_index];
      const colorHex = normalizeHexColor(slot?.color_hex);
      if ((slot?.color_hex || '').trim() && !colorHex) {
        if (!silent) showToast(t('orders.invalidColorHex', { slotIndex: row.slot_index }), 'error');
        return false;
      }
    }

    try {
      await api.updateOrderConfig(cfg.id, {
        name: draft.name.trim() || null,
        quantity_target: qty,
        required_printer_model: draft.requiredPrinterModel.trim() || null,
      });

      const slotsPayload: OrderBatchConfigSlotInput[] = baseRows.map((row) => {
        const existing = draft.slots[row.slot_index] || { slot_index: row.slot_index };
        return {
          slot_index: row.slot_index,
          material_type: existing.material_type ?? row.material_type ?? null,
          color_hex: normalizeHexColor(existing.color_hex) ?? null,
          color_family: existing.color_family ?? row.color_family ?? null,
          brand_name: existing.brand_name ?? null,
          filament_name: existing.filament_name ?? null,
          nozzle_assignment: existing.nozzle_assignment ?? row.nozzle_assignment ?? null,
          metadata_json: existing.metadata_json ?? null,
        };
      });
      await api.replaceOrderConfigSlots(cfg.id, slotsPayload);
      if (refreshAfter) onChanged();
      if (!silent) showToast(t('orders.savedConfigSuccess', { code: cfg.config_code }), 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('orders.saveConfigFailed'), 'error');
      return false;
    }
  };

  const saveConfigColumn = async (cfg: OrderBatchPlateConfig) => {
    await persistConfigColumn(cfg);
  };

  const dispatchConfigColumn = async (cfg: OrderBatchPlateConfig) => {
    const draft = drafts[cfg.id];
    const parsedLimit = draft?.dispatchLimit?.trim() ? parsePositiveInt(draft.dispatchLimit) : undefined;
    if (draft?.dispatchLimit?.trim() && parsedLimit === null) {
      showToast(t('orders.invalidDispatchLimit'), 'error');
      return;
    }
    try {
      const persisted = await persistConfigColumn(cfg, { silent: true, refreshAfter: false });
      if (!persisted) return;
      const res = await api.dispatchOrderConfig(cfg.id, parsedLimit ?? undefined);
      updateDraft(cfg.id, (d) => ({ ...d, dispatchLimit: '' }));
      onChanged();
      showToast(
        t('orders.dispatchConfigSuccess', {
          count: res.created_count,
          code: cfg.config_code,
          remaining: res.remaining_to_dispatch,
        }),
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('orders.dispatchFailed'), 'error');
    }
  };

  const cancelConfigColumn = async (cfg: OrderBatchPlateConfig) => {
    try {
      await api.updateOrderConfig(cfg.id, { status: 'cancelled', quantity_target: 0 });
      onChanged();
      showToast(t('orders.configRemoved', { code: cfg.config_code }), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('orders.updateConfigFailed'), 'error');
    }
  };

  const handleDispatchPlate = async () => {
    if (plateDispatchLimit.trim() && parsePositiveInt(plateDispatchLimit) === null) {
      showToast(t('orders.invalidDispatchLimit'), 'error');
      return;
    }
    setPlateDispatchPreparing(true);
    try {
      for (const cfg of visibleConfigs) {
        const persisted = await persistConfigColumn(cfg, { silent: true, refreshAfter: false });
        if (!persisted) return;
      }
      await dispatchPlateMutation.mutateAsync();
    } finally {
      setPlateDispatchPreparing(false);
    }
  };

  const onAddConfig = () => {
    createConfigMutation.mutate();
  };

  const gcodeRef = ((plate.plate_metadata_snapshot || {}) as Record<string, unknown>).gcode_ref as
    | { path?: string }
    | undefined;
  const objects = (((plate.plate_metadata_snapshot || {}) as Record<string, unknown>).objects as unknown[] | undefined)
    ?.map((v) => String(v)) || [];
  const previewUrl = sourceLibraryFileId ? api.getLibraryFilePlateThumbnail(sourceLibraryFileId, plate.plate_index) : null;
  const progressTargetForBar = Math.max(completionTarget || 0, 1);
  const plateCompletionPct = plateProgress.qty_total > 0 ? Math.round((plateProgress.qty_completed / plateProgress.qty_total) * 100) : 0;
  const filamentChips = baseRows.slice(0, 6);
  const extraFilamentChipCount = Math.max(baseRows.length - filamentChips.length, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="px-3 py-2.5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-white font-medium text-sm md:text-base truncate">
                  {t('orders.plateTitle', { index: plate.plate_index })}
                  {plate.plate_name ? ` · ${plate.plate_name}` : ''}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-bambu-dark border border-bambu-dark-tertiary text-bambu-gray-light">
                  {t('orders.plateObjectCount', { count: plate.object_count })}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-bambu-dark border border-bambu-dark-tertiary text-bambu-gray-light">
                  {t('orders.estTimeShort', { time: formatDuration(plate.estimated_duration_sec) })}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-bambu-dark border border-bambu-dark-tertiary text-bambu-gray-light">
                  {t('orders.estFilamentShort', { grams: plate.estimated_filament_grams ?? '—' })}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <ProgressBar value={plateProgress.qty_completed} max={progressTargetForBar} className="flex-1 h-1.5" />
                <span className="text-xs text-white min-w-[34px] text-right">{plateCompletionPct}%</span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              {collapsed ? t('orders.expand') : t('orders.collapse')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {filamentChips.map((row) => (
              <span
                key={`fil-chip-${plate.id}-${row.slot_index}`}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark text-[11px] text-bambu-gray-light"
              >
                <span className="w-2.5 h-2.5 rounded-full border border-white/10" style={colorSwatchStyle(row.color_hex)} />
                <span>{row.material_type || '—'}</span>
              </span>
            ))}
            {extraFilamentChipCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark text-[11px] text-bambu-gray-light">
                +{extraFilamentChipCount}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      {collapsed ? (
        <CardContent className="p-3 pt-2.5">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] gap-2.5 items-stretch">
            <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-1.5 min-h-[150px] h-full">
              <div className="h-full rounded-md bg-bambu-dark-secondary border border-bambu-dark-tertiary overflow-hidden flex items-center justify-center">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t('orders.platePreviewAlt', { index: plate.plate_index })}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Layers className="w-8 h-8 text-bambu-gray" />
                )}
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-1.5 text-[11px]">
                <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                  <div className="text-bambu-gray">{t('orders.qtyTotal')}</div>
                  <div className="text-white font-semibold text-sm leading-tight">{plateProgress.qty_total}</div>
                </div>
                <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                  <div className="text-bambu-gray">{t('orders.qtyCompleted')}</div>
                  <div className="text-white font-semibold text-sm leading-tight">{plateProgress.qty_completed}</div>
                </div>
                <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                  <div className="text-bambu-gray">{t('orders.qtyDispatched')}</div>
                  <div className="text-white font-semibold text-sm leading-tight">{plateProgress.qty_dispatched}</div>
                </div>
                <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                  <div className="text-bambu-gray">{t('orders.qtyFailedCancelled')}</div>
                  <div className="text-white font-semibold text-sm leading-tight">{plateProgress.qty_failed + plateProgress.qty_cancelled}</div>
                </div>
                <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                  <div className="text-bambu-gray">{t('orders.matrix.configCount')}</div>
                  <div className="text-white font-semibold text-sm leading-tight">{visibleConfigs.length}</div>
                </div>
              </div>
              <div className="text-[11px] text-bambu-gray truncate">
                {t('orders.plateProgressLine', {
                  completed: plateProgress.qty_completed,
                  target: plateProgress.qty_total,
                  queued: plateProgress.qty_queued,
                  printing: plateProgress.qty_printing,
                  remaining: plateProgress.remaining_to_dispatch,
                })}
              </div>
              {visibleConfigs.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                  {visibleConfigs.slice(0, 4).map((cfg) => (
                    <div key={`cfg-collapsed-${cfg.id}`} className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-2 py-1">
                      <div className="text-[11px] text-white font-medium truncate">
                        {cfg.name || t('orders.config', { code: cfg.config_code })}
                      </div>
                      <div className="text-[10px] text-bambu-gray truncate">
                        {t('orders.matrix.configProgressLine', {
                          queued: cfg.progress.queued_runs,
                          printing: cfg.progress.printing_runs,
                          completed: cfg.progress.completed_runs,
                          remaining: cfg.progress.remaining_to_dispatch,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      ) : (
        <CardContent className="p-3 pt-2.5 space-y-2.5">
          <div className="grid grid-cols-1 xl:grid-cols-[252px_minmax(0,1fr)] gap-2.5">
            <div className="space-y-2">
              <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2">
                <div className="text-xs text-bambu-gray truncate" title={gcodeRef?.path || ''}>
                  {t('orders.gcodeRef')}: {gcodeRef?.path || t('orders.notAvailable')}
                </div>
                <div className="text-xs text-bambu-gray mt-1">
                  {t('orders.objects')}: {objects.length ? objects.join(', ') : t('orders.noObjects')}
                </div>
              </div>

              <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-bambu-dark-tertiary p-2">
                    <div className="text-bambu-gray">{t('orders.qtyTotal')}</div>
                    <div className="text-white font-semibold">{plateProgress.qty_total}</div>
                  </div>
                  <div className="rounded border border-bambu-dark-tertiary p-2">
                    <div className="text-bambu-gray">{t('orders.qtyDispatched')}</div>
                    <div className="text-white font-semibold">{plateProgress.qty_dispatched}</div>
                  </div>
                  <div className="rounded border border-bambu-dark-tertiary p-2">
                    <div className="text-bambu-gray">{t('orders.qtyCompleted')}</div>
                    <div className="text-white font-semibold">{plateProgress.qty_completed}</div>
                  </div>
                  <div className="rounded border border-bambu-dark-tertiary p-2">
                    <div className="text-bambu-gray">{t('orders.qtyFailedCancelled')}</div>
                    <div className="text-white font-semibold">
                      {plateProgress.qty_failed + plateProgress.qty_cancelled}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2 space-y-2">
                <div className="text-xs font-medium text-white uppercase tracking-wide">{t('orders.plateActions')}</div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={plateDispatchLimit}
                    onChange={(e) => setPlateDispatchLimit(e.target.value)}
                    className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-3 py-2 text-white text-sm"
                    placeholder={t('orders.dispatchLimitPlaceholder')}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDispatchPlate}
                    disabled={dispatchPlateMutation.isPending || plateDispatchPreparing}
                  >
                    {dispatchPlateMutation.isPending || plateDispatchPreparing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    {t('orders.dispatchPlate')}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={newConfigName}
                    onChange={(e) => setNewConfigName(e.target.value)}
                    className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-3 py-2 text-white text-sm"
                    placeholder={t('orders.newConfigNamePlaceholder')}
                  />
                  <Button size="sm" onClick={onAddConfig} disabled={createConfigMutation.isPending}>
                    {createConfigMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    {t('orders.addConfigButton')}
                  </Button>
                </div>
                {hiddenCancelledCount > 0 && (
                  <div className="text-xs text-bambu-gray">
                    {t('orders.hiddenCancelledConfigs', { count: hiddenCancelledCount })}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-bambu-dark-tertiary bg-bambu-dark p-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm text-white font-medium">{t('orders.configMatrix')}</div>
                <div className="text-[11px] text-bambu-gray">
                  {t('orders.matrix.configCount')}: {visibleConfigs.length}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-max border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 bg-bambu-dark px-2 py-2 text-left text-bambu-gray-light border-b border-bambu-dark-tertiary/70 min-w-[180px]">
                        {t('orders.matrix.baseMaterials')}
                      </th>
                      <th className="px-2 py-2 text-left text-bambu-gray-light border-b border-bambu-dark-tertiary/70 min-w-[200px] bg-bambu-dark-secondary/70">
                        <div className="font-medium text-white">{t('orders.matrix.original')}</div>
                        <div className="text-xs text-bambu-gray">{t('orders.matrix.originalReadonly')}</div>
                      </th>
                      {visibleConfigs.map((cfg) => {
                        const draft = drafts[cfg.id];
                        return (
                          <th
                            key={cfg.id}
                            className="align-top px-2 py-2 text-left text-bambu-gray-light border-b border-bambu-dark-tertiary/70 min-w-[230px]"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-bambu-gray">{t('orders.config', { code: cfg.config_code })}</div>
                                <button
                                  className="p-1 rounded hover:bg-bambu-dark-tertiary text-bambu-gray hover:text-red-400"
                                  onClick={() => void cancelConfigColumn(cfg)}
                                  title={t('orders.removeConfig')}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <input
                                value={draft?.name ?? ''}
                                onChange={(e) =>
                                  updateDraft(cfg.id, (d) => ({ ...d, name: e.target.value }))
                                }
                                className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-2 py-1.5 text-white text-xs"
                                placeholder={t('orders.configNamePlaceholder')}
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  value={draft?.quantityTarget ?? String(cfg.quantity_target)}
                                  onChange={(e) =>
                                    updateDraft(cfg.id, (d) => ({ ...d, quantityTarget: e.target.value }))
                                  }
                                  className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-2 py-1.5 text-white text-xs"
                                  placeholder={t('orders.qty')}
                                />
                                <input
                                  value={draft?.requiredPrinterModel ?? ''}
                                  onChange={(e) =>
                                    updateDraft(cfg.id, (d) => ({ ...d, requiredPrinterModel: e.target.value }))
                                  }
                                  className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-2 py-1.5 text-white text-xs"
                                  placeholder={t('orders.printerModelOptional')}
                                />
                              </div>
                              <div className="text-xs text-bambu-gray">
                                {t('orders.matrix.configProgressLine', {
                                  queued: cfg.progress.queued_runs,
                                  printing: cfg.progress.printing_runs,
                                  completed: cfg.progress.completed_runs,
                                  remaining: cfg.progress.remaining_to_dispatch,
                                })}
                              </div>
                              <div className="flex gap-1.5">
                                <input
                                  type="number"
                                  min={1}
                                  value={draft?.dispatchLimit ?? ''}
                                  onChange={(e) =>
                                    updateDraft(cfg.id, (d) => ({ ...d, dispatchLimit: e.target.value }))
                                  }
                                  className="w-full bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded px-2 py-1.5 text-white text-xs"
                                  placeholder={t('orders.dispatchLimitPlaceholder')}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void dispatchConfigColumn(cfg)}
                                  className="px-2.5"
                                >
                                  <Play className="w-4 h-4" />
                                  {t('orders.dispatch')}
                                </Button>
                              </div>
                              <Button size="sm" className="w-full" onClick={() => void saveConfigColumn(cfg)}>
                                <Save className="w-4 h-4" />
                                {t('orders.saveColumn')}
                              </Button>
                            </div>
                          </th>
                        );
                      })}
                      {!visibleConfigs.length && (
                        <th className="px-2 py-2 text-left text-bambu-gray border-b border-bambu-dark-tertiary/70 min-w-[220px]">
                          {t('orders.noConfigsForPlate')}
                        </th>
                      )}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-20 bg-bambu-dark px-2 py-2 text-left text-bambu-gray border-b border-bambu-dark-tertiary/60">
                        {t('orders.matrix.rowUsage')}
                      </th>
                      <th className="px-2 py-2 text-left text-bambu-gray border-b border-bambu-dark-tertiary/60 bg-bambu-dark-secondary/70">
                        {t('orders.matrix.baseValue')}
                      </th>
                      {visibleConfigs.map((cfg) => (
                        <th key={`base-sep-${cfg.id}`} className="px-2 py-2 text-left text-bambu-gray border-b border-bambu-dark-tertiary/60">
                          {t('orders.matrix.overrideValue')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {baseRows.map((row) => (
                      <tr key={row.slot_index}>
                        <td className="sticky left-0 z-10 bg-bambu-dark px-2 py-2 border-b border-bambu-dark-tertiary/50 align-top">
                          <div className="font-medium text-white">{t('orders.slotLabel', { slotIndex: row.slot_index })}</div>
                          <div className="text-xs text-bambu-gray mt-1">{row.material_type || '—'}</div>
                          <div className="text-xs text-bambu-gray">{row.color_family || '—'}</div>
                          {row.used_g !== null && row.used_g !== undefined && (
                            <div className="text-xs text-bambu-gray">{t('orders.usedGrams', { grams: row.used_g })}</div>
                          )}
                        </td>

                        <td className="px-2 py-2 border-b border-bambu-dark-tertiary/50 align-top bg-bambu-dark-secondary/30">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-4 h-4 rounded border border-bambu-dark-tertiary"
                              style={{ backgroundColor: normalizeHexColor(row.color_hex) || '#000000' }}
                            />
                            <div className="text-white">{formatColorLabel(row.material_type, row.color_hex)}</div>
                          </div>
                          <div className="text-xs text-bambu-gray mt-1">{t('orders.matrix.originalBaseRow')}</div>
                        </td>

                        {visibleConfigs.map((cfg) => {
                          const draft = drafts[cfg.id];
                          const slot = draft?.slots[row.slot_index];
                          const effectiveMaterial = slot?.material_type ?? row.material_type ?? null;
                          const effectiveColor = slot?.color_hex ?? row.color_hex ?? null;
                          const normalizedColor = normalizeHexColor(effectiveColor);
                          return (
                            <td key={`${cfg.id}-${row.slot_index}`} className="px-2 py-2 border-b border-bambu-dark-tertiary/50 align-top">
                              {(() => {
                                const meta =
                                  slot?.metadata_json && typeof slot.metadata_json === 'object'
                                    ? (slot.metadata_json as Record<string, unknown>)
                                    : {};
                                const spoolSnap =
                                  meta.selected_spool_snapshot && typeof meta.selected_spool_snapshot === 'object'
                                    ? (meta.selected_spool_snapshot as Record<string, unknown>)
                                    : null;
                                const filamentSnap =
                                  meta.selected_filament_snapshot && typeof meta.selected_filament_snapshot === 'object'
                                    ? (meta.selected_filament_snapshot as Record<string, unknown>)
                                    : null;
                                const colorCatalogSnap =
                                  meta.selected_color_catalog_snapshot && typeof meta.selected_color_catalog_snapshot === 'object'
                                    ? (meta.selected_color_catalog_snapshot as Record<string, unknown>)
                                    : null;
                                const hasOverride = normalizeHexColor(effectiveColor) !== normalizeHexColor(row.color_hex)
                                  || (meta.color_catalog_id != null)
                                  || (meta.filament_catalog_id != null);
                                const colorLabel =
                                  (typeof colorCatalogSnap?.color_name === 'string' && colorCatalogSnap.color_name) ||
                                  (typeof spoolSnap?.color_name === 'string' && spoolSnap.color_name) ||
                                  (typeof filamentSnap?.color === 'string' && filamentSnap.color) ||
                                  normalizedColor ||
                                  '—';

                                return (
                                  <div className="space-y-2">
                                    <div className="rounded-lg border border-bambu-dark-tertiary/70 bg-bambu-dark-secondary/20 p-2">
                                      <div className="flex items-center gap-2">
                                        <span className="w-4 h-4 rounded border border-white/10" style={colorSwatchStyle(effectiveColor)} />
                                        <div className="min-w-0 flex-1">
                                          <div className="text-xs text-white truncate">
                                            {
                                              (typeof colorCatalogSnap?.manufacturer === 'string' && colorCatalogSnap.manufacturer) ||
                                              (typeof spoolSnap?.brand === 'string' && spoolSnap.brand) ||
                                              (typeof filamentSnap?.brand === 'string' && filamentSnap.brand) ||
                                              slot?.brand_name ||
                                              '—'
                                            }
                                            {' · '}
                                            {effectiveMaterial || '—'}
                                          </div>
                                          <div className="text-[11px] text-bambu-gray truncate">{colorLabel}</div>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {normalizedColor && (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] border border-bambu-dark-tertiary bg-bambu-dark text-white">
                                            {normalizedColor}
                                          </span>
                                        )}
                                        {meta.color_catalog_id != null && (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] border border-bambu-dark-tertiary bg-bambu-dark text-blue-300">
                                            {t('orders.selector.catalogColorTag', { id: meta.color_catalog_id })}
                                          </span>
                                        )}
                                        {meta.filament_catalog_id != null && (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] border border-bambu-dark-tertiary bg-bambu-dark text-blue-300">
                                            {t('orders.selector.catalogTag', { id: meta.filament_catalog_id })}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex gap-1.5">
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => openSelector(cfg.id, row)}
                                      >
                                        <Package className="w-4 h-4" />
                                        {t('orders.matrix.selectCatalogColor')}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => resetSlotToBase(cfg.id, row)}
                                        title={t('orders.selector.resetToBase')}
                                      >
                                        <X className="w-4 h-4" />
                                      </Button>
                                    </div>
                                    <div className={`text-[11px] ${hasOverride ? 'text-bambu-green' : 'text-bambu-gray'}`}>
                                      {hasOverride ? t('orders.matrix.colorOverride') : t('orders.matrix.noOverride')}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      )}

      <OrderColorOverrideSelectorModal
        isOpen={selectorState !== null}
        baseRow={selectorState?.baseRow ?? null}
        currentSlot={
          selectorState ? (drafts[selectorState.configId]?.slots[selectorState.slotIndex] ?? null) : null
        }
        onClose={() => setSelectorState(null)}
        onApplyCatalogColor={applyCatalogColorSelection}
        onResetToBase={() => {
          if (!selectorState) return;
          resetSlotToBase(selectorState.configId, selectorState.baseRow);
          setSelectorState(null);
        }}
      />
    </Card>
  );
}

export function OrderDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const orderId = Number(params.id);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [orderDispatchLimit, setOrderDispatchLimit] = useState('');

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.getOrder(orderId),
    enabled: Number.isFinite(orderId) && orderId > 0,
    refetchInterval: 5000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const dispatchOrder = useMutation({
    mutationFn: () => {
      const parsedLimit = orderDispatchLimit.trim() ? parsePositiveInt(orderDispatchLimit) : undefined;
      return api.dispatchOrderRemaining(orderId, parsedLimit);
    },
    onSuccess: (res) => {
      refresh();
      showToast(
        t('orders.dispatchOrderSuccess', { count: res.created_count, remaining: res.remaining_to_dispatch }),
        'success'
      );
      setOrderDispatchLimit('');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const onDispatchOrder = () => {
    if (orderDispatchLimit.trim() && parsePositiveInt(orderDispatchLimit) === null) {
      showToast(t('orders.invalidDispatchLimit'), 'error');
      return;
    }
    dispatchOrder.mutate();
  };

  if (!Number.isFinite(orderId) || orderId <= 0) {
    return <div className="p-4 md:p-8 text-bambu-gray">{t('orders.invalidOrderId')}</div>;
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center gap-2 text-bambu-gray">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('orders.loadingOrder')}
      </div>
    );
  }

  if (error || !order) {
    return <div className="p-4 md:p-8 text-red-400">{(error as Error | undefined)?.message || t('orders.orderNotFound')}</div>;
  }

  return (
    <div className="p-4 md:p-8 min-h-[calc(100vh-64px)] space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <Link to="/orders" className="text-sm text-bambu-gray hover:text-white inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" />
            {t('orders.backToOrders')}
          </Link>
          <h1 className="text-xl md:text-2xl font-semibold text-white mt-1">{order.name}</h1>
          <p className="text-sm text-bambu-gray mt-0.5">
            {t('orders.sourceFile')}: {order.source_file_name} ({t('orders.libraryFile')} #{order.source_library_file_id ?? t('orders.notAvailable')}) · {t('orders.orderStatus')}={order.status} ·{' '}
            {t('orders.planRevision')}={order.plan_revision}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <input
            type="number"
            min={1}
            value={orderDispatchLimit}
            onChange={(e) => setOrderDispatchLimit(e.target.value)}
            className="w-24 bg-bambu-dark border border-bambu-dark-tertiary rounded-lg px-3 py-2 text-white text-sm"
            placeholder={t('orders.dispatchLimitPlaceholder')}
          />
          <Button size="sm" onClick={onDispatchOrder} disabled={dispatchOrder.isPending}>
            {dispatchOrder.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {t('orders.dispatchRemaining')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4">
        <OrderHeaderEditor
          order={order}
          onChanged={refresh}
          onDeleted={() => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['queue'] });
            navigate('/orders');
          }}
        />
        <OrderProgressSummaryCard order={order} />
      </div>

      {order.plates.map((plate) => (
        <PlateMatrixCard
          key={plate.id}
          orderId={order.id}
          sourceLibraryFileId={order.source_library_file_id}
          plate={plate}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}
