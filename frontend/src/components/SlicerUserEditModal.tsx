import { useEffect, useState, type MouseEvent } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { rememberSlicerUser } from '../utils/slicerUserMemory';
import { Button } from './Button';
import { Card, CardContent } from './Card';

export interface EditableSlicerUserTarget {
  archive_id?: number | null;
  library_file_id?: number | null;
  slicer_user?: string | null;
  slicer_user_email?: string | null;
}

interface SlicerUserEditModalProps {
  item: EditableSlicerUserTarget;
  onClose: () => void;
  onCancelled?: () => void;
  initialValue?: string;
  description?: string;
  hint?: string;
  onSaved?: (value: string) => void;
}

function toSlicerUserPayload(value: string) {
  const trimmed = value.trim();
  const looksLikeEmail = trimmed.includes('@') && !/\s/.test(trimmed);

  return looksLikeEmail
    ? { slicer_user: null, slicer_user_email: trimmed }
    : { slicer_user: trimmed, slicer_user_email: null };
}

export function SlicerUserEditModal({
  item,
  onClose,
  onCancelled,
  initialValue,
  description,
  hint,
  onSaved,
}: SlicerUserEditModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [value, setValue] = useState(initialValue ?? item.slicer_user ?? item.slicer_user_email ?? '');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new Error(t('queue.editSlicerUser.required'));
      }

      const payload = toSlicerUserPayload(trimmed);
      if (item.archive_id) {
        await api.updateArchive(item.archive_id, payload);
        return;
      }
      if (item.library_file_id) {
        await api.updateLibraryFile(item.library_file_id, payload);
        return;
      }
      throw new Error(t('queue.editSlicerUser.unsupported'));
    },
    onSuccess: async () => {
      const trimmed = value.trim();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['queue'] }),
        queryClient.invalidateQueries({ queryKey: ['archives'] }),
        queryClient.invalidateQueries({ queryKey: ['library-files'] }),
        queryClient.invalidateQueries({ queryKey: ['archive', item.archive_id] }),
        queryClient.invalidateQueries({ queryKey: ['library-file', item.library_file_id] }),
      ]);
      rememberSlicerUser(trimmed);
      onSaved?.(trimmed);
      showToast(t('queue.editSlicerUser.saved'), 'success');
      onClose();
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    },
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saveMutation.isPending) {
        onCancelled?.();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancelled, onClose, saveMutation.isPending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={saveMutation.isPending ? undefined : () => {
        onCancelled?.();
        onClose();
      }}
    >
      <Card className="w-full max-w-md" onClick={(e: MouseEvent) => e.stopPropagation()}>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-bambu-dark p-2 text-bambu-green">
              <UserRound className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="mb-2 text-lg font-semibold text-white">{t('queue.editSlicerUser.title')}</h3>
              <p className="mb-4 text-sm text-bambu-gray">{description ?? t('queue.editSlicerUser.description')}</p>
              <label htmlFor="manual-slicer-user" className="mb-2 block text-sm font-medium text-white">
                {t('queue.editSlicerUser.label')}
              </label>
              <input
                id="manual-slicer-user"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('queue.editSlicerUser.placeholder')}
                disabled={saveMutation.isPending}
                autoFocus
                className="w-full rounded-lg border border-bambu-dark-tertiary bg-bambu-dark px-3 py-2 text-white outline-none transition-colors focus:border-bambu-green"
              />
              {hint && (
                <p className="mt-2 text-xs text-bambu-gray-light">{hint}</p>
              )}
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                onCancelled?.();
                onClose();
              }}
              className="flex-1"
              disabled={saveMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              className="flex-1"
              disabled={saveMutation.isPending || !value.trim()}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.save')}
                </>
              ) : (
                t('common.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
