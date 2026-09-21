import { Scale } from 'lucide-react';
import { defaultNavItems } from '../../components/Layout';
import { PSI_ACCOUNTING_PATH } from './paths';
import './i18n';

export const psiNavItem = { id: 'psi-accounting', to: PSI_ACCOUNTING_PATH, icon: Scale, labelKey: 'psi.nav.accounting' };

/**
 * Add the accounting page to upstream's sidebar, right after Stats.
 *
 * Done by inserting into upstream's exported `defaultNavItems` at startup
 * rather than by editing the array literal in Layout.tsx: upstream's tests pin
 * that list, so a literal entry would mean patching their tests too. Called
 * once from the App.tsx seam (via ./app), before the first render; the
 * sidebar settings pick the entry up from the same array.
 */
export function registerPsiNav(): void {
  if (defaultNavItems.some((item) => item.id === psiNavItem.id)) return;
  const stats = defaultNavItems.findIndex((item) => item.id === 'stats');
  defaultNavItems.splice(stats >= 0 ? stats + 1 : defaultNavItems.length, 0, psiNavItem);
}
