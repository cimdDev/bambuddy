import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Calendar, ChevronRight, AlertTriangle, Coins } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatRelativeTime } from '../utils/date';
import { getCurrencySymbol } from '../utils/currency';
import { estimatePrintCost, formatCurrencyAmount } from '../utils/printCost';
import { filterCompatibleQueueItems } from '../utils/printer';
import { QueueItemCommentEditor } from './QueueItemCommentEditor';
import { SlicerUserBadge } from './SlicerUserBadge';
import { SlicerUserEditModal } from './SlicerUserEditModal';

interface PrinterQueueWidgetProps {
  printerId: number;
  printerModel?: string | null;
  loadedFilamentTypes?: Set<string>;
  loadedFilaments?: Set<string>;
}

export function PrinterQueueWidget({ printerId, printerModel, loadedFilamentTypes, loadedFilaments }: PrinterQueueWidgetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { canModify } = useAuth();
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });
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

  const compatibleQueue = queue ? filterCompatibleQueueItems(queue, loadedFilamentTypes, loadedFilaments) : undefined;
  const totalPending = compatibleQueue?.length || 0;

  if (totalPending === 0) {
    return null;
  }

  const nextItem = compatibleQueue?.[0];
  const editingItem = compatibleQueue?.find((item) => item.id === editingItemId) || null;
  const currencySymbol = getCurrencySymbol(settings?.currency || 'USD');
  const nextCost = estimatePrintCost(nextItem?.filament_used_grams, settings?.default_filament_cost ?? 0);
  const canEditComment = !!nextItem && canModify('queue', 'update', nextItem.created_by_id);
  const hasComment = Boolean(nextItem?.comment?.trim());
  const showCommentEditor = !!nextItem && (hasComment || canEditComment);

  const canEditSlicerUser = (item?: typeof nextItem) => {
    if (!item) return false;
    if (item.archive_id) return canModify('archives', 'update', item.created_by_id);
    if (item.library_file_id) return canModify('library', 'update', item.created_by_id);
    return false;
  };

  const renderSlicerUserBadge = (item?: typeof nextItem) => {
    if (!item) return null;

    const slicerUser = item.slicer_user || item.slicer_user_email || null;
    const editable = canEditSlicerUser(item);
    const openEditor = (e: MouseEvent | KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setEditingItemId(item.id);
    };

    if (slicerUser) {
      if (!editable) return <SlicerUserBadge user={slicerUser} />;
      return (
        <span
          role="button"
          tabIndex={0}
          onClick={openEditor}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') openEditor(e);
          }}
          className="rounded-full"
          title={t('queue.editSlicerUser.editExisting')}
        >
          <SlicerUserBadge user={slicerUser} />
        </span>
      );
    }

    const warning = (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
        <AlertTriangle className="w-3 h-3" />
        {t('queue.badges.slicerUserMissingWarning')}
      </span>
    );

    if (!editable) return warning;
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={openEditor}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openEditor(e);
        }}
        title={t('queue.editSlicerUser.addMissing')}
      >
        {warning}
      </span>
    );
  };

  return (
    <>
      <div className="mb-3 p-3 bg-bambu-dark rounded-lg">
        <div className="space-y-2">
          <div className="flex items-start gap-3 min-w-0">
            <Calendar className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-bambu-gray">{t('queue.nextInQueue')}</p>
              <div className="mt-0.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 text-sm text-white truncate">
                    {nextItem?.archive_name || nextItem?.library_file_name || `File #${nextItem?.archive_id || nextItem?.library_file_id}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {renderSlicerUserBadge(nextItem)}
                    {nextItem?.private_job && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">
                        {t('queue.accounting.privateJob')}
                      </span>
                    )}
                    {nextCost != null && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bambu-dark-tertiary text-bambu-gray-light">
                        <Coins className="w-3 h-3" />
                        {formatCurrencyAmount(nextCost, currencySymbol)}
                      </span>
                    )}
                  </div>
                </div>
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
      {editingItem && (
        <SlicerUserEditModal
          item={editingItem}
          onClose={() => setEditingItemId(null)}
        />
      )}
    </>
  );
}
