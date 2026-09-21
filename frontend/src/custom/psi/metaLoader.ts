/**
 * Batches the per-card meta requests of one render into a single HTTP call.
 *
 * Every card asks for its own record (`usePsiMeta('archive', 12)`), which keeps
 * call sites to "entity and id" only. Requests made within one short window are
 * collected and sent as one `GET /psi/meta?archive=…&queue=…&library=…`.
 */
import { psiApi } from './api';
import type { PsiEntity, PsiMeta } from './model';

type Waiter = { resolve: (meta: PsiMeta | null) => void; reject: (error: unknown) => void };

const WINDOW_MS = 16;
const MAX_IDS_PER_ENTITY = 500;

let pending = new Map<PsiEntity, Map<number, Waiter[]>>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function loadMeta(entity: PsiEntity, id: number): Promise<PsiMeta | null> {
  return new Promise((resolve, reject) => {
    const byId = pending.get(entity) ?? new Map<number, Waiter[]>();
    pending.set(entity, byId);
    const waiters = byId.get(id) ?? [];
    waiters.push({ resolve, reject });
    byId.set(id, waiters);
    if (timer === null) timer = setTimeout(flush, WINDOW_MS);
  });
}

async function flush(): Promise<void> {
  const batch = pending;
  pending = new Map();
  timer = null;

  // Split into chunks the backend accepts (500 ids per entity per call).
  const chunks: Array<Partial<Record<PsiEntity, number[]>>> = [];
  for (const [entity, byId] of batch) {
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_ENTITY) {
      const index = i / MAX_IDS_PER_ENTITY;
      chunks[index] = { ...(chunks[index] ?? {}), [entity]: ids.slice(i, i + MAX_IDS_PER_ENTITY) };
    }
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const response = await psiApi.meta(chunk);
      for (const [entity, ids] of Object.entries(chunk) as Array<[PsiEntity, number[]]>) {
        for (const id of ids) {
          const meta = response[entity]?.[String(id)] ?? null;
          batch.get(entity)?.get(id)?.forEach((w) => w.resolve(meta));
        }
      }
    } catch (error) {
      for (const [entity, ids] of Object.entries(chunk) as Array<[PsiEntity, number[]]>) {
        for (const id of ids) batch.get(entity)?.get(id)?.forEach((w) => w.reject(error));
      }
    }
  }));
}
