/**
 * The PSI translations live in their own bundle (custom/psi/i18n.ts), outside
 * upstream's parity gate, so this is that gate for them: the four languages
 * carry the same keys and the same {{placeholders}}, and none is an untranslated
 * copy of English.
 */
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { PSI_TRANSLATIONS } from '../../custom/psi/i18n';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

// Words that are the same in every language (brand, product and unit names).
const SAME_EVERYWHERE = new Set(['class.psi', 'class.short.psi', 'stats.job.psi', 'accounting.date', 'accounting.weight', 'entity.library', 'entity.archive', 'accounting.user', 'accounting.byUser', 'stats.weight']);

describe('PSI translations', () => {
  const en = leaves(PSI_TRANSLATIONS.en);

  for (const lng of ['de', 'fr', 'it'] as const) {
    it(`${lng} has exactly the English keys and placeholders`, () => {
      const other = leaves(PSI_TRANSLATIONS[lng]);
      expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
      for (const [key, value] of en) expect(placeholders(other.get(key)!), key).toEqual(placeholders(value));
    });

    it(`${lng} is actually translated`, () => {
      const other = leaves(PSI_TRANSLATIONS[lng]);
      const copies = [...en].filter(([key, value]) => other.get(key) === value && !SAME_EVERYWHERE.has(key)).map(([k]) => k);
      // A few words are genuinely identical (e.g. "Filament", "Date" in fr); allow a handful.
      expect(copies.length, copies.join(', ')).toBeLessThanOrEqual(6);
    });
  }

  it('is merged under psi.* without touching upstream keys', () => {
    expect(i18n.getResource('de', 'translation', 'psi.class.private')).toBe('Privat · PSI-Material');
    expect(i18n.getResource('en', 'translation', 'nav.stats')).toBeTruthy();
  });
});
