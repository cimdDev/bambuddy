import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calendar, ChevronRight, Clock, Coins } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { formatRelativeTime } from '../utils/date';
import { getCurrencySymbol } from '../utils/currency';
import { estimatePrintCost, formatCurrencyAmount } from '../utils/printCost';
import { filterCompatibleQueueItems } from '../utils/printer';
import { queueItemDisplayName } from '../utils/queueItemName';
import { SlicerUserBadge } from './SlicerUserBadge';
import { SlicerUserEditModal } from './SlicerUserEditModal';

interface PrinterQueueWidgetProps {
  printerId: number;
  printerModel?: string | null;
  loadedFilamentTypes?: Set<string>;
  loadedFilaments?: Set<string>;
  loadedVariants?: Set<string>;
  variant?: 'card' | 'panelExtension';
}

export function PrinterQueueWidget({ printerId, printerModel, loadedFilamentTypes, loadedFilaments, loadedVariants, variant = 'card' }: PrinterQueueWidgetProps) {
  const { t } = useTranslation();
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

  const compatibleQueue = queue ? filterCompatibleQueueItems(queue, loadedFilamentTypes, loadedFilaments, loadedVariants) : undefined;
  const totalPending = compatibleQueue?.length || 0;

  if (totalPending === 0) {
    return null;
  }

  const nextItem = compatibleQueue?.[0];
  const editingItem = compatibleQueue?.find((item) => item.id === editingItemId) || null;
  const currencySymbol = getCurrencySymbol(settings?.currency || 'USD');
  const nextCost = estimatePrintCost(nextItem?.filament_used_grams, settings?.default_filament_cost ?? 0);

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

  const linkClassName = variant === 'panelExtension'
    ? 'block mt-2 border-t border-bambu-dark-tertiary pt-2 pl-1 hover:opacity-90 transition-opacity'
    : 'block mb-3 p-3 bg-bambu-dark rounded-lg hover:bg-bambu-dark-tertiary transition-colors';

  return (
    <>
      <Link
        to="/queue"
        className={linkClassName}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Calendar className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-bambu-gray">{t('queue.nextInQueue')}</p>
              <p className="text-sm text-white truncate">
                {nextItem ? queueItemDisplayName(nextItem) : ''}
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
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-bambu-gray flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {nextItem?.scheduled_time ? formatRelativeTime(nextItem.scheduled_time, 'system', t) : t('time.waiting')}
            </span>
            {totalPending > 1 && (
              <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 rounded">
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
