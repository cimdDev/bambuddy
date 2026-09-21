/**
 * The PSI custom layer's frontend. Upstream files import only from here (and
 * App.tsx from ./app), only at the seams in scripts/psi-seams.txt.
 */
import './i18n';

export { PsiJobStrip, PsiPrinterJobStrip } from './components/PsiJobStrip';
export { psiSplitStatsWidgets, psiStatsWidgets } from './statsWidgets';
export { PSI_ACCOUNTING_PATH } from './paths';
