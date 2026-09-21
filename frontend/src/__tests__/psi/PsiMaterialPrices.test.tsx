/**
 * The material price card: lists materials with their spool counts, saves the
 * whole list, and is read-only without inventory:update.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../utils';
import { setAuthToken } from '../../api/client';
import { server } from '../mocks/server';
import { PsiMaterialPrices } from '../../custom/psi/components/PsiMaterialPrices';
import type { PsiMaterialPrice } from '../../custom/psi/model';

const ROWS: PsiMaterialPrice[] = [
  { material: 'PETG', cost_per_kg: null, spools: 2, auto: 0, own: 0, unpriced: 2 },
  { material: 'PLA', cost_per_kg: 20, spools: 3, auto: 2, own: 1, unpriced: 0 },
];

function servePrices() {
  const saved: unknown[] = [];
  server.use(
    http.get('/api/v1/psi/material-prices', () => HttpResponse.json(ROWS)),
    http.put('/api/v1/psi/material-prices', async ({ request }) => {
      saved.push(await request.json());
      return HttpResponse.json({ repriced: 2, materials: ROWS });
    }),
  );
  return saved;
}

const asUser = (permissions: string[]) => {
  server.use(
    http.get('/api/v1/auth/status', () => HttpResponse.json({ auth_enabled: true, requires_setup: false })),
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        id: 1, username: 'tester', role: 'user', is_active: true, is_admin: false,
        groups: [], permissions, created_at: '2026-01-01T00:00:00Z',
      }),
    ),
  );
  setAuthToken('test-token');
};

describe('PsiMaterialPrices', () => {
  afterEach(() => setAuthToken(null));

  it('lists materials with how their spools are priced', async () => {
    servePrices();
    render(<PsiMaterialPrices currency="CHF" globalDefault={25} />);
    expect(await screen.findByText('PLA')).toBeInTheDocument();
    expect(screen.getByLabelText('Price per kg for PLA')).toHaveValue('20');
    expect(screen.getByText('2 with this price · 1 with its own price')).toBeInTheDocument();
    expect(screen.getByText('2 without price')).toBeInTheDocument();
    expect(screen.getByLabelText('Price per kg for PETG')).toHaveAttribute('placeholder', 'default 25');
  });

  it('saves the whole list, including an added material', async () => {
    const saved = servePrices();
    const user = userEvent.setup();
    render(<PsiMaterialPrices currency="CHF" />);
    await user.type(await screen.findByLabelText('Price per kg for PETG'), '22,5');
    await user.type(screen.getByLabelText('Add material'), 'tpu{Enter}');
    await user.type(screen.getByLabelText('Price per kg for TPU'), '35');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toEqual([{ prices: { PETG: 22.5, PLA: 20, TPU: 35 } }]));
  });

  it('blocks saving an invalid price', async () => {
    servePrices();
    const user = userEvent.setup();
    render(<PsiMaterialPrices currency="CHF" />);
    const input = await screen.findByLabelText('Price per kg for PLA');
    await user.clear(input);
    await user.type(input, '-3');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is read-only without inventory:update', async () => {
    asUser(['inventory:read', 'psi_accounting:read']);
    servePrices();
    render(<PsiMaterialPrices currency="CHF" />);
    await waitFor(() => expect(screen.getByLabelText('Price per kg for PLA')).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
