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
import { QueueItemCommentEditor } from './QueueItemCommentEditor';
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
  onUpdateComment,
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
  onUpdateComment?: (comment: string | null) => Promise<void>;
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
  const canEditComment = !!onUpdateComment && canModify('queue', 'update', item.created_by_id);
  const openSlicerUserEditor = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowSlicerUserEdit(true);
  };

  return (
    <>
      <div className={`rounded-lg border border-bambu-dark-tertiary border-l-[3px] bg-bambu-dark-secondary px-3 py-2 ${config.border}`}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,42%)_auto] md:items-end">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0">
            <StatusIcon className={`mt-1 h-4 w-4 shrink-0 ${config.color}`} />

            <div className="mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded bg-bambu-dark">
              {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-bambu-gray">
                  <Layers className="h-4 w-4" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <span className="block min-w-0 truncate text-sm font-medium text-white">
                {displayName}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.printer_name && (
                  <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                    <Printer className="h-3 w-3" />
                    <span className="truncate max-w-[100px]">{item.printer_name}</span>
                  </span>
                )}
                {item.print_time_seconds && (
                  <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                    <Timer className="h-3 w-3" />
                    {formatDuration(item.print_time_seconds)}
                  </span>
                )}
                {itemCost != null && (
                  <span className="inline-flex items-center gap-1 text-xs text-bambu-gray">
                    <Coins className="h-3 w-3" />
                    {formatCurrencyAmount(itemCost, currencySymbol)}
                  </span>
                )}
                <span className="text-xs text-bambu-gray">
                  {formatRelativeTime(completedTime, timeFormat, t)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {slicerUser ? (
                  canEditSlicerUser ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={openSlicerUserEditor}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') openSlicerUserEditor(e);
                      }}
                      className="inline-flex rounded-full"
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
                      <AlertCircle className="h-3 w-3" />
                      {t('queue.badges.slicerUserMissingWarning')}
                    </span>
                  </span>
                )}
                {item.private_job && (
                  <>
                    <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300 sm:px-2 sm:text-xs">
                      {t('queue.accounting.privateJob')}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs ${
                        privateMaterialUsage === 'private_full'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                          : privateMaterialUsage === 'private_partial'
                            ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                            : 'border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300'
                      }`}
                    >
                      {privateMaterialUsage === 'private_full'
                        ? t('queue.accounting.privateMaterialFull')
                        : privateMaterialUsage === 'private_partial'
                          ? t('queue.accounting.privateMaterialPartial')
                          : t('queue.accounting.companyMaterial')}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 md:self-end">
            <QueueItemCommentEditor
              comment={item.comment}
              canEdit={canEditComment}
              onSave={onUpdateComment}
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

          <div className="mt-0.5 flex shrink-0 items-center gap-0.5 md:self-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRequeue}
              disabled={!hasPermission('queue:create')}
              title={!hasPermission('queue:create') ? t('queue.permissions.noRequeue') : t('queue.actions.requeue')}
              className="p-1.5 text-bambu-green hover:bg-bambu-green/10 hover:text-bambu-green/80"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={!canModify('queue', 'delete', item.created_by_id)}
              title={!canModify('queue', 'delete', item.created_by_id) ? t('queue.permissions.noRemove') : t('common.remove')}
              className="p-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
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
