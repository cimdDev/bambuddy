import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Calendar, ChevronRight, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { formatRelativeTime } from '../utils/date';
import { filterCompatibleQueueItems } from '../utils/printer';
import { SlicerUserBadge } from './SlicerUserBadge';
import { SlicerUserEditModal } from './SlicerUserEditModal';

interface PrinterQueueWidgetProps {
  printerId: number;
  printerModel?: string | null;
  loadedFilamentTypes?: Set<string>;
  loadedFilaments?: Set<string>;  // "TYPE:rrggbb" pairs for filament override color matching
}

export function PrinterQueueWidget({ printerId, printerModel, loadedFilamentTypes, loadedFilaments }: PrinterQueueWidgetProps) {
  const { t } = useTranslation();
  const { canModify } = useAuth();
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const { data: queue } = useQuery({
    queryKey: ['queue', printerId, 'pending', printerModel],
    queryFn: () => api.getQueue(printerId, 'pending', printerModel || undefined),
    refetchInterval: 30000,
  });

  // Filter queue to items this printer can actually print (filament type + color check)
  const compatibleQueue = queue ? filterCompatibleQueueItems(queue, loadedFilamentTypes, loadedFilaments) : undefined;
  const totalPending = compatibleQueue?.length || 0;

  if (totalPending === 0) {
    return null;
  }

  const nextItem = compatibleQueue?.[0];
  const editingItem = compatibleQueue?.find((item) => item.id === editingItemId) || null;

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

  // Passive next-in-queue preview. Plate-clear acknowledgment is handled by the
  // card-level "Mark plate as cleared" button (PrintersPage.tsx). Having a
  // second button in this widget caused the two controls to overlap whenever
  // the plate-clear gate was up with auto-dispatch items queued — both POSTed
  // to the same /clear-plate endpoint, so the widget button was pure noise.
  return (
    <>
      <Link
        to="/queue"
        className="block mb-3 p-3 bg-bambu-dark rounded-lg hover:bg-bambu-dark-tertiary transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Calendar className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-bambu-gray">{t('queue.nextInQueue')}</p>
              <p className="text-sm text-white truncate">
                {nextItem?.archive_name || nextItem?.library_file_name || `File #${nextItem?.archive_id || nextItem?.library_file_id}`}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {renderSlicerUserBadge(nextItem)}
              </div>
            </div>
          </div>
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
            <ChevronRight className="w-4 h-4 text-bambu-gray" />
          </div>
        </div>
      </Link>
      {editingItem && (
        <SlicerUserEditModal
          item={editingItem}
          onClose={() => setEditingItemId(null)}
        />
      )}
    </>
  );
}
