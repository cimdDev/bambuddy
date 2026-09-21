import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { render } from '../utils';
import { server } from '../mocks/server';
import { Layout } from '../../components/Layout';
import { psiNavItem, registerPsiNav } from '../../custom/psi/nav';
import { PSI_ACCOUNTING_PERMISSION, PSI_NAV_ID, psiNavPermissions } from '../../custom/psi/permissions';
import { PSI_ACCOUNTING_PATH } from '../../custom/psi/paths';

registerPsiNav();

const asUser = (permissions: string[]) => {
  server.use(
    http.get('/api/v1/auth/status', () => HttpResponse.json({ auth_enabled: true, requires_setup: false })),
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        id: 1,
        username: 'tester',
        role: 'user',
        is_active: true,
        is_admin: false,
        groups: [{ id: 2, name: 'Staff' }],
        permissions,
        created_at: '2026-01-01T00:00:00Z',
      }),
    ),
  );
  window.localStorage.setItem('auth_token', 'test-token');
};

const accountingLink = () => document.querySelector(`aside a[href="${PSI_ACCOUNTING_PATH}"]`);
const statsLink = () => document.querySelector('aside a[href="/stats"]');

describe('PSI accounting access', () => {
  afterEach(() => window.localStorage.removeItem('auth_token'));

  it('gates the sidebar entry on psi_accounting:read', () => {
    expect(PSI_ACCOUNTING_PERMISSION).toBe('psi_accounting:read');
    expect(psiNavItem.id).toBe(PSI_NAV_ID);
    expect(psiNavPermissions).toEqual({ [PSI_NAV_ID]: 'psi_accounting:read' });
  });

  it('hides the entry from a user with stats:read only', async () => {
    asUser(['stats:read']);
    render(<Layout />);
    await waitFor(() => expect(statsLink()).toBeInTheDocument());
    expect(accountingLink()).toBeNull();
  });

  it('shows the entry with psi_accounting:read', async () => {
    asUser(['stats:read', 'psi_accounting:read']);
    render(<Layout />);
    await waitFor(() => expect(accountingLink()).toBeInTheDocument());
  });
});
