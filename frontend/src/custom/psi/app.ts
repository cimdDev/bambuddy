/**
 * Entry point for the App.tsx seam only: registers app-wide PSI pieces (the
 * sidebar entry) and provides the accounting page for the route.
 */
import './i18n';
import { registerPsiNav } from './nav';

registerPsiNav();

export { PsiAccountingPage } from './pages/PsiAccountingPage';
