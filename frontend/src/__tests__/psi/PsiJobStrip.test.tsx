/**
 * The PSI strip on the cards: what it shows, who may edit it, and the note
 * editor's behaviour, including the two bugs of the old queue comment editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../utils';
import { server } from '../mocks/server';
import { PsiJobStrip } from '../../custom/psi';
import { psiMetaKey } from '../../custom/psi/hooks';
import type { PsiMeta } from '../../custom/psi/model';

function meta(overrides: Partial<PsiMeta> = {}): PsiMeta {
  return {
    entity: 'archive',
    id: 1,
    printable: true,
    user: { name: 'alice', email: 'alice@psi.ch', source: 'file', record: { entity: 'archive', id: 1 } },
    can_edit_user: true,
    psi_class: 'psi',
    psi_class_own: null,
    psi_class_source: null,
    runs_mixed: false,
    note: null,
    note_source: null,
    can_edit: true,
    ...overrides,
  };
}

/** Serve /psi/meta from a table and record every request's query string. */
function serveMeta(records: Record<string, PsiMeta>) {
  const requests: string[] = [];
  server.use(
    http.get('/api/v1/psi/meta', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      const out: Record<string, Record<string, PsiMeta>> = { archive: {}, queue: {}, library: {} };
      for (const entity of ['archive', 'queue', 'library'] as const) {
        for (const id of (url.searchParams.get(entity) ?? '').split(',').filter(Boolean)) {
          const hit = records[`${entity}:${id}`];
          if (hit) out[entity][id] = hit;
        }
      }
      return HttpResponse.json(out);
    }),
  );
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PsiJobStrip', () => {
  it('shows user, class and note', async () => {
    serveMeta({ 'archive:1': meta({ psi_class: 'private', psi_class_own: 'private', psi_class_source: 'own', note: 'for the bike' }) });
    render(<PsiJobStrip entity="archive" id={1} />);
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByTestId('psi-class')).toHaveTextContent(/private|privat/i);
    expect(screen.getByTestId('psi-note')).toHaveTextContent('for the bike');
  });

  it('batches every card of one render into one request', async () => {
    const requests = serveMeta({
      'archive:1': meta(),
      'archive:2': meta({ id: 2 }),
      'queue:7': meta({ entity: 'queue', id: 7 }),
    });
    render(
      <>
        <PsiJobStrip entity="archive" id={1} />
        <PsiJobStrip entity="archive" id={2} />
        <PsiJobStrip entity="queue" id={7} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('psi-strip')).toHaveLength(3));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('archive=1%2C2');
    expect(requests[0]).toContain('queue=7');
  });

  it('shows the missing user to everyone, but only editors get a button', async () => {
    serveMeta({
      'archive:1': meta({ user: { name: null, email: null, source: null, record: { entity: 'archive', id: 1 } }, can_edit_user: false }),
    });
    render(<PsiJobStrip entity="archive" id={1} />);
    const badge = await screen.findByTestId('psi-user');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveTextContent(/user/i);
  });

  it('read-only has no controls at all (safe inside a link)', async () => {
    serveMeta({ 'queue:7': meta({ entity: 'queue', id: 7, note: 'n' }) });
    render(<PsiJobStrip entity="queue" id={7} variant="readonly" />);
    const strip = await screen.findByTestId('psi-strip');
    expect(within(strip).queryAllByRole('button')).toHaveLength(0);
  });

  it('renders nothing without a note and without edit rights', async () => {
    serveMeta({ 'archive:1': meta({ can_edit: false }) });
    render(<PsiJobStrip entity="archive" id={1} />);
    await screen.findByTestId('psi-strip');
    expect(screen.queryByTestId('psi-note')).toBeNull();
    expect(screen.queryByTestId('psi-note-add')).toBeNull();
  });

  it('a non-printable library file shows only the note', async () => {
    serveMeta({ 'library:3': meta({ entity: 'library', id: 3, printable: false, note: 'STEP source' }) });
    render(<PsiJobStrip entity="library" id={3} />);
    expect(await screen.findByTestId('psi-note')).toHaveTextContent('STEP source');
    expect(screen.queryByTestId('psi-user')).toBeNull();
    expect(screen.queryByTestId('psi-class')).toBeNull();
  });

  it('changing the class saves it on the record', async () => {
    serveMeta({ 'queue:7': meta({ entity: 'queue', id: 7 }) });
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/v1/psi/queue/7', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(meta({ entity: 'queue', id: 7, psi_class: 'private_own', psi_class_own: 'private_own', psi_class_source: 'own' }));
      }),
    );
    render(<PsiJobStrip entity="queue" id={7} />);
    await userEvent.click(await screen.findByTestId('psi-class'));
    const options = await screen.findAllByRole('radio');
    await userEvent.click(options[3]);
    await waitFor(() => expect(bodies).toEqual([{ psi_class: 'private_own' }]));
  });
});

describe('PsiNote editing', () => {
  function patchRecorder(path: string, reply: PsiMeta) {
    const bodies: Array<{ note?: string | null }> = [];
    server.use(
      http.patch(path, async ({ request }) => {
        bodies.push((await request.json()) as { note?: string | null });
        return HttpResponse.json(reply);
      }),
    );
    return bodies;
  }

  it('blur saves the trimmed note', async () => {
    serveMeta({ 'archive:1': meta() });
    const bodies = patchRecorder('/api/v1/psi/archives/1', meta({ note: 'hello' }));
    render(<PsiJobStrip entity="archive" id={1} />);
    await userEvent.click(await screen.findByTestId('psi-note-add'));
    await userEvent.type(screen.getByRole('textbox'), '  hello  ');
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(bodies).toEqual([{ note: 'hello' }]));
  });

  it('whitespace only clears the note to null', async () => {
    serveMeta({ 'archive:1': meta({ note: 'old' }) });
    const bodies = patchRecorder('/api/v1/psi/archives/1', meta());
    render(<PsiJobStrip entity="archive" id={1} />);
    await userEvent.click(await screen.findByTestId('psi-note'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, '   ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(bodies).toEqual([{ note: null }]));
  });

  it('Escape reverts without saving', async () => {
    serveMeta({ 'archive:1': meta({ note: 'keep me' }) });
    const bodies = patchRecorder('/api/v1/psi/archives/1', meta());
    render(<PsiJobStrip entity="archive" id={1} />);
    await userEvent.click(await screen.findByTestId('psi-note'));
    await userEvent.type(screen.getByRole('textbox'), ' changed');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByTestId('psi-note')).toHaveTextContent('keep me');
    expect(bodies).toEqual([]);
  });

  it('places the caret once when editing starts, not on every keystroke', async () => {
    serveMeta({ 'archive:1': meta({ note: 'abc' }) });
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
    render(<PsiJobStrip entity="archive" id={1} />);
    await userEvent.click(await screen.findByTestId('psi-note'));
    await userEvent.type(screen.getByRole('textbox'), 'def');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a refetch while typing keeps the draft and the editor open', async () => {
    serveMeta({ 'archive:1': meta({ note: 'v1' }) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PsiJobStrip entity="archive" id={1} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByTestId('psi-note'));
    await userEvent.type(screen.getByRole('textbox'), ' draft');

    // Someone else's edit lands while this operator is still typing.
    act(() => {
      qc.setQueryData(psiMetaKey('archive', 1), meta({ note: 'v2 from someone else' }));
    });
    expect(screen.getByRole('textbox')).toHaveValue('v1 draft');
  });
});
