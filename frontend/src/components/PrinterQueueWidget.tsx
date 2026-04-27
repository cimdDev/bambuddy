import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Calendar, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/date';
import { filterCompatibleQueueItems } from '../utils/printer';
import { QueueItemCommentEditor } from './QueueItemCommentEditor';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface PrinterQueueWidgetProps {
  printerId: number;
  printerModel?: string | null;
  loadedFilamentTypes?: Set<string>;
  loadedFilaments?: Set<string>;  // "TYPE:rrggbb" pairs for filament override color matching
}

export function PrinterQueueWidget({ printerId, printerModel, loadedFilamentTypes, loadedFilaments }: PrinterQueueWidgetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { canModify } = useAuth();
  const { data: queue } = useQuery({
    queryKey: ['queue', printerId, 'pending', printerModel],
    queryFn: () => api.getQueue(printerId, 'pending', printerModel || undefined),
    refetchInterval: 30000,
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ itemId, comment }: { itemId: number; comment: string | null }) =>
      api.updateQueueItem(itemId, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue', printerId] });
      queryClient.invalidateQueries({ queryKey: ['queue', printerId, 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (error: Error) => showToast(error.message || t('printers.toast.failedToUpdate'), 'error'),
  });

  // Filter queue to items this printer can actually print (filament type + color check)
  const compatibleQueue = queue ? filterCompatibleQueueItems(queue, loadedFilamentTypes, loadedFilaments) : undefined;
  const totalPending = compatibleQueue?.length || 0;

  if (totalPending === 0) {
    return null;
  }

  const nextItem = compatibleQueue?.[0];
  const canEditComment = !!nextItem && canModify('queue', 'update', nextItem.created_by_id);
  const hasComment = Boolean(nextItem?.comment?.trim());
  const showCommentEditor = !!nextItem && (hasComment || canEditComment);

  // Passive next-in-queue preview. Plate-clear acknowledgment is handled by the
  // card-level "Mark plate as cleared" button (PrintersPage.tsx). Having a
  // second button in this widget caused the two controls to overlap whenever
  // the plate-clear gate was up with auto-dispatch items queued — both POSTed
  // to the same /clear-plate endpoint, so the widget button was pure noise.
  return (
    <div className="mb-3 p-3 bg-bambu-dark rounded-lg">
      <div className="space-y-2">
        <div className="flex items-start gap-3 min-w-0">
          <Calendar className="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-bambu-gray">{t('queue.nextInQueue')}</p>
            <div className="mt-0.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <p className="min-w-0 flex-1 text-sm text-white truncate">
                {nextItem?.archive_name || nextItem?.library_file_name || `File #${nextItem?.archive_id || nextItem?.library_file_id}`}
              </p>
              {showCommentEditor && nextItem && (
                <div className="w-full min-w-0 sm:w-auto sm:max-w-[280px] sm:flex-shrink-0">
                  <QueueItemCommentEditor
                    comment={nextItem.comment}
                    canEdit={canEditComment}
                    onSave={async (comment) => {
                      await updateCommentMutation.mutateAsync({ itemId: nextItem.id, comment });
                    }}
                    label={t('queue.comment.label')}
                    addLabel={t('queue.comment.add')}
                    placeholder={t('queue.comment.placeholder')}
                    savingLabel={t('common.saving')}
                    compact
                    noMargin
                    bare
                    rightAlignAddButton
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-bambu-gray flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {nextItem?.scheduled_time ? formatRelativeTime(nextItem.scheduled_time, 'system', t) : t('time.waiting')}
            </span>
            {totalPending > 1 && (
              <span className="text-xs px-1.5 py-0.5 bg-yellow-400/20 text-yellow-400 rounded">
                +{totalPending - 1}
              </span>
            )}
            <Link
              to="/queue"
              className="p-1 rounded hover:bg-bambu-dark-tertiary transition-colors"
              aria-label={t('queue.nextInQueue')}
              title={t('queue.nextInQueue')}
            >
              <ChevronRight className="w-4 h-4 text-bambu-gray" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
