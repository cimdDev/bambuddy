/**
 * PSI API client. Deliberately separate from upstream's `api/client.ts`: the
 * PSI layer only borrows the auth token and the error type, so upstream can
 * rewrite its client freely without touching PSI and vice versa.
 */
import { ApiError, getAuthToken } from '../../api/client';
import type {
  PsiAccounting,
  PsiChartRun,
  PsiClass,
  PsiEntity,
  PsiMaterialPrice,
  PsiMeta,
  PsiRunRow,
  PsiUserSuggestion,
} from './model';

const BASE = '/api/v1/psi';

const ENTITY_PATH: Record<PsiEntity, string> = { archive: 'archives', queue: 'queue', library: 'library' };

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fail(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({}));
  const detail = body?.detail;
  const message = typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
      ? detail.map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error,\s*/i, '')).join('; ')
      : `HTTP ${response.status}`;
  throw new ApiError(message || `HTTP ${response.status}`, response.status);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers: { ...headers(init.body != null), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) return fail(response);
  return response.json() as Promise<T>;
}

export interface PeriodQuery {
  dateFrom?: string;
  dateTo?: string;
  createdById?: number;
}

function periodParams(q: PeriodQuery, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  if (q.dateFrom) p.set('date_from', q.dateFrom);
  if (q.dateTo) p.set('date_to', q.dateTo);
  if (q.createdById !== undefined) p.set('created_by_id', String(q.createdById));
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type MetaResponse = Record<PsiEntity, Record<string, PsiMeta>>;

export const psiApi = {
  meta(ids: Partial<Record<PsiEntity, number[]>>): Promise<MetaResponse> {
    const p = new URLSearchParams();
    for (const [entity, list] of Object.entries(ids)) if (list?.length) p.set(entity, list.join(','));
    return request<MetaResponse>(`/meta?${p.toString()}`);
  },
  update(entity: PsiEntity, id: number, body: { psi_class?: PsiClass | null; note?: string | null }): Promise<PsiMeta> {
    return request<PsiMeta>(`/${ENTITY_PATH[entity]}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  repairUser(entity: 'archive' | 'library', id: number, value: string): Promise<PsiMeta> {
    return request<PsiMeta>(`/${ENTITY_PATH[entity]}/${id}/user`, { method: 'PUT', body: JSON.stringify({ value }) });
  },
  users(): Promise<PsiUserSuggestion[]> {
    return request<PsiUserSuggestion[]>('/users');
  },
  accounting(q: PeriodQuery): Promise<PsiAccounting> {
    return request<PsiAccounting>(`/accounting${periodParams(q)}`);
  },
  /** Upstream's `/archives/slim` rows with each run's job type, for the split stats charts. */
  chartRuns(q: PeriodQuery): Promise<PsiChartRun[]> {
    return request<PsiChartRun[]>(`/stats/runs${periodParams(q)}`);
  },
  accountingRuns(q: PeriodQuery, userKey?: string, classes?: PsiClass[]): Promise<PsiRunRow[]> {
    return request<PsiRunRow[]>(`/accounting/runs${periodParams(q, { user_key: userKey, classes: classes?.join(',') })}`);
  },
  materialPrices(): Promise<PsiMaterialPrice[]> {
    return request<PsiMaterialPrice[]>('/material-prices');
  },
  /** Replaces the whole price list; materials left out lose their price. */
  saveMaterialPrices(prices: Record<string, number | null>): Promise<{ repriced: number; materials: PsiMaterialPrice[] }> {
    return request('/material-prices', { method: 'PUT', body: JSON.stringify({ prices }) });
  },
  /** Fetches the CSV with the auth header and hands it to the browser as a download. */
  async downloadCsv(q: PeriodQuery, classes?: PsiClass[]): Promise<void> {
    const response = await fetch(`${BASE}/accounting/export${periodParams(q, { classes: classes?.join(',') })}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: headers(false),
    });
    if (!response.ok) return fail(response);
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'psi-accounting.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
