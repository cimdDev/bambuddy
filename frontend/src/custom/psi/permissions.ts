/**
 * PSI's own permission (backend: `custom/psi/permissions.py`). Admins hold it;
 * other groups get it from the "PSI" card in the group editor.
 *
 * Imported directly by the Layout.tsx seam, not through ./index: nav.ts
 * imports Layout, so this file must import nothing from the PSI layer.
 */
import type { Permission } from '../../api/client';

/** Not in upstream's `Permission` union, hence the cast. */
export const PSI_ACCOUNTING_PERMISSION = 'psi_accounting:read' as Permission;

export const PSI_NAV_ID = 'psi-accounting';

/** Spread into upstream's `navPermissions` map in Layout.tsx: the sidebar entry needs the permission. */
export const psiNavPermissions: Record<string, Permission> = { [PSI_NAV_ID]: PSI_ACCOUNTING_PERMISSION };
