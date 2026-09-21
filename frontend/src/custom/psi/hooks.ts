import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { psiApi } from './api';
import { loadMeta } from './metaLoader';
import type { PeriodQuery } from './api';
import type { PsiClass, PsiEntity, PsiMeta } from './model';

export const psiMetaKey = (entity: PsiEntity, id: number) => ['psi-meta', entity, id] as const;

export function usePsiMeta(entity: PsiEntity, id: number | null | undefined) {
  return useQuery({
    queryKey: psiMetaKey(entity, id ?? -1),
    queryFn: () => loadMeta(entity, id as number),
    enabled: id != null && id > 0,
    staleTime: 30_000,
  });
}

/**
 * Saves a record's class or note. An edit can spread to linked records (an
 * archive edit reclassifies its runs and history rows, a queue edit its
 * archive), so every cached card and the accounting are refreshed afterwards.
 */
export function usePsiUpdate(entity: PsiEntity, id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { psi_class?: PsiClass | null; note?: string | null }) => psiApi.update(entity, id, body),
    onSuccess: (meta: PsiMeta) => {
      qc.setQueryData(psiMetaKey(entity, id), meta);
      void qc.invalidateQueries({ queryKey: ['psi-meta'] });
      void qc.invalidateQueries({ queryKey: ['psi-accounting'] });
    },
  });
}

export function usePsiUserRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entity, id, value }: { entity: 'archive' | 'library'; id: number; value: string }) =>
      psiApi.repairUser(entity, id, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['psi-meta'] });
      void qc.invalidateQueries({ queryKey: ['psi-users'] });
      void qc.invalidateQueries({ queryKey: ['psi-accounting'] });
    },
  });
}

export function usePsiUserSuggestions(enabled: boolean) {
  return useQuery({ queryKey: ['psi-users'], queryFn: psiApi.users, enabled, staleTime: 5 * 60_000 });
}

export function usePsiAccounting(period: PeriodQuery) {
  return useQuery({
    queryKey: ['psi-accounting', period.dateFrom ?? null, period.dateTo ?? null, period.createdById ?? null],
    queryFn: () => psiApi.accounting(period),
  });
}
