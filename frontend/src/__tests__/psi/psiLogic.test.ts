import { describe, expect, it } from 'vitest';
import { printerSegments } from '../../custom/psi/buckets';
import { displayUser } from '../../custom/psi/model';
import type { PsiBucket, PsiClass } from '../../custom/psi/model';
import { presetRange } from '../../custom/psi/period';

const b = (prints: number, hours = 0, grams = 0): PsiBucket => ({ prints, hours, grams, cost: 0 });

describe('displayUser', () => {
  it('prefers the name, then the address, then nothing', () => {
    expect(displayUser({ name: 'alice', email: 'a@x.ch' })).toBe('alice');
    expect(displayUser({ name: null, email: 'a@x.ch' })).toBe('a@x.ch');
    expect(displayUser({ name: null, email: null })).toBeNull();
  });
});

describe('printerSegments', () => {
  const printer = {
    printer_id: 1,
    printer_name: 'X1C',
    by_class: { psi: b(2, 2, 100), private: b(1, 1, 20), private_partial: b(1, 1, 30), private_own: b(1, 1, 40) } as Record<PsiClass, PsiBucket>,
  };
  const t = (k: string) => k;

  it('weight has three buckets and counts private-on-PSI as PSI material', () => {
    const seg = printerSegments(printer, 'weight', t);
    expect(seg.map((s) => [s.key, s.value])).toEqual([['psi', 120], ['partial', 30], ['own', 40]]);
  });

  it('prints and time have two buckets; partial is not padded in', () => {
    expect(printerSegments(printer, 'prints', t).map((s) => [s.key, s.value])).toEqual([['psi', 2], ['private', 3]]);
    expect(printerSegments(printer, 'time', t)).toHaveLength(2);
  });
});

describe('presetRange', () => {
  const now = new Date(2026, 1, 14); // 14 Feb 2026

  it('covers whole calendar months and quarters', () => {
    expect(presetRange('thisMonth', now)).toEqual({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    expect(presetRange('lastMonth', now)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(presetRange('thisQuarter', now)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-03-31' });
    expect(presetRange('lastYear', now)).toEqual({ dateFrom: '2025-01-01', dateTo: '2025-12-31' });
  });

  it('all time is unbounded', () => {
    expect(presetRange('allTime', now)).toEqual({});
  });
});

describe('registerPsiNav', () => {
  it('adds the accounting entry once, right after Stats', async () => {
    const { defaultNavItems } = await import('../../components/Layout');
    const { registerPsiNav } = await import('../../custom/psi/nav');
    registerPsiNav();
    registerPsiNav();
    const ids = defaultNavItems.map((item) => item.id);
    expect(ids.filter((id) => id === 'psi-accounting')).toHaveLength(1);
    expect(ids.indexOf('psi-accounting')).toBe(ids.indexOf('stats') + 1);
  });
});
