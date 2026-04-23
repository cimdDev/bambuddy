import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  SkipForward,
  X,
  RefreshCw,
  Trash2,
  Printer,
  Timer,
  Layers,
  Coins,
} from 'lucide-react';
import { api } from '../api/client';
import { type TimeFormat, formatDuration, formatRelativeTime } from '../utils/date';
import { estimatePrintCost, formatCurrencyAmount } from '../utils/printCost';
import type { PrintQueueItem, Permission } from '../api/client';
import { Button } from './Button';
import { SlicerUserBadge } from './SlicerUserBadge';
import { SlicerUserEditModal } from './SlicerUserEditModal';

const STATUS_CONFIG = {
  completed: { icon: CheckCircle, color: 'text-emerald-400', border: 'border-l-emerald-500' },
  failed: { icon: XCircle, color: 'text-red-400', border: 'border-l-red-500' },
  skipped: { icon: SkipForward, color: 'text-orange-400', border: 'border-l-gray-500' },
  cancelled: { icon: X, color: 'text-gray-400', border: 'border-l-gray-500' },
} as const;

export function CompactHistoryRow({
  item,
  onRequeue,
  onRemove,
  defaultCostPerKg,
  currencySymbol,
  timeFormat = 'system',
  hasPermission,
  canModify,
  t,
}: {
  item: PrintQueueItem;
  onRequeue: () => void;
  onRemove: () => void;
  defaultCostPerKg: number;
  currencySymbol: string;
  timeFormat?: TimeFormat;
  hasPermission: (permission: Permission) => boolean;
  canModify: (resource: 'queue' | 'archives' | 'library', action: 'update' | 'delete' | 'reprint', createdById: number | null | undefined) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [showSlicerUserEdit, setShowSlicerUserEdit] = useState(false);
  const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.cancelled;
  const StatusIcon = config.icon;
  const displayName = item.archive_name || item.library_file_name || `File #${item.archive_id || item.library_file_id}`;
  const slicerUser = item.slicer_user || item.slicer_user_email || null;
  const canEditSlicerUser = item.archive_id
    ? canModify('archives', 'update', item.created_by_id)
    : item.library_file_id
      ? canModify('library', 'update', item.created_by_id)
      : false;
  const privateMaterialUsage = item.private_material
    ? 'private_full'
    : item.private_material_partial
      ? 'private_partial'
      : 'company';
  const itemCost = estimatePrintCost(item.filament_used_grams, defaultCostPerKg);

  const thumbnailUrl = item.archive_thumbnail
    ? api.getArchiveThumbnail(item.archive_id!)
    : item.library_file_thumbnail
      ? api.getLibraryFileThumbnailUrl(item.library_file_id!)
      : null;

  const completedTime = item.completed_at || item.created_at;
  const openSlicerUserEditor = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowSlicerUserEdit(true);
  };

  return (
    <>
      <div className={`flex items-start gap-2 sm:gap-3 px-3 py-2 bg-bambu-dark-secondary rounded-lg border border-bambu-dark-tertiary border-l-[3px] ${config.border}`}>
        <StatusIcon className={`w-4 h-4 shrink-0 mt-1 ${config.color}`} />

        <div className="w-8 h-8 shrink-0 bg-bambu-dark rounded overflow-hidden mt-0.5">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-bambu-gray">
              <Layers className="w-4 h-4" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <span className="text-sm text-white font-medium truncate min-w-0 block">
            {displayName}
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {item.printer_name && (
              <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                <Printer className="w-3 h-3" />
                <span className="truncate max-w-[100px]">{item.printer_name}</span>
              </span>
            )}
            {item.print_time_seconds && (
              <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                <Timer className="w-3 h-3" />
                {formatDuration(item.print_time_seconds)}
              </span>
            )}
            {itemCost != null && (
              <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                <Coins className="w-3 h-3" />
                {formatCurrencyAmount(itemCost, currencySymbol)}
              </span>
            )}
            <span className="text-xs text-bambu-gray">
              {formatRelativeTime(completedTime, timeFormat, t)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {item.private_job && (
              <>
                <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20">
                  {t('queue.accounting.privateJob')}
                </span>
                <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full border ${
                  privateMaterialUsage === 'private_full'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : privateMaterialUsage === 'private_partial'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                      : 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20'
                }`}>
                  {privateMaterialUsage === 'private_full'
                    ? t('queue.accounting.privateMaterialFull')
                    : privateMaterialUsage === 'private_partial'
                      ? t('queue.accounting.privateMaterialPartial')
                      : t('queue.accounting.companyMaterial')}
                </span>
              </>
            )}
            {slicerUser ? (
              canEditSlicerUser ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={openSlicerUserEditor}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openSlicerUserEditor(e);
                  }}
                  className="rounded-full"
                  title={t('queue.editSlicerUser.editExisting')}
                >
                  <SlicerUserBadge user={slicerUser} />
                </span>
              ) : (
                <SlicerUserBadge user={slicerUser} />
              )
            ) : (
              <span
                role={canEditSlicerUser ? 'button' : undefined}
                tabIndex={canEditSlicerUser ? 0 : undefined}
                onClick={canEditSlicerUser ? openSlicerUserEditor : undefined}
                onKeyDown={canEditSlicerUser ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') openSlicerUserEditor(e);
                } : undefined}
                title={canEditSlicerUser ? t('queue.editSlicerUser.addMissing') : t('queue.badges.slicerUserMissingWarning')}
              >
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                  <AlertCircle className="w-3 h-3" />
                  {t('queue.badges.slicerUserMissingWarning')}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRequeue}
            disabled={!hasPermission('queue:create')}
            title={!hasPermission('queue:create') ? t('queue.permissions.noRequeue') : t('queue.actions.requeue')}
            className="text-bambu-green hover:text-bambu-green/80 hover:bg-bambu-green/10 p-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={!canModify('queue', 'delete', item.created_by_id)}
            title={!canModify('queue', 'delete', item.created_by_id) ? t('queue.permissions.noRemove') : t('common.remove')}
            className="p-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {showSlicerUserEdit && (
        <SlicerUserEditModal
          item={item}
          onClose={() => setShowSlicerUserEdit(false)}
        />
      )}
    </>
  );
}
