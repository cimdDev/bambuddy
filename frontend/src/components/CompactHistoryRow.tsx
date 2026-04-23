import {
  CheckCircle,
  XCircle,
  SkipForward,
  X,
  RefreshCw,
  Trash2,
  Printer,
  Timer,
  Layers,
} from 'lucide-react';
import { api } from '../api/client';
import { type TimeFormat, formatDuration, formatRelativeTime } from '../utils/date';
import type { PrintQueueItem, Permission } from '../api/client';
import { Button } from './Button';
import { QueueItemCommentEditor } from './QueueItemCommentEditor';

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
  timeFormat = 'system',
  hasPermission,
  canModify,
  t,
}: {
  item: PrintQueueItem;
  onRequeue: () => void;
  onRemove: () => void;
  onUpdateComment?: (comment: string | null) => Promise<void>;
  timeFormat?: TimeFormat;
  hasPermission: (permission: Permission) => boolean;
  canModify: (resource: 'queue' | 'archives' | 'library', action: 'update' | 'delete' | 'reprint', createdById: number | null | undefined) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.cancelled;
  const StatusIcon = config.icon;
  const displayName = item.archive_name || item.library_file_name || `File #${item.archive_id || item.library_file_id}`;

  const thumbnailUrl = item.archive_thumbnail
    ? api.getArchiveThumbnail(item.archive_id!)
    : item.library_file_thumbnail
      ? api.getLibraryFileThumbnailUrl(item.library_file_id!)
      : null;

  const completedTime = item.completed_at || item.created_at;
  const canEditComment = !!onUpdateComment && canModify('queue', 'update', item.created_by_id);

  return (
    <div className={`rounded-lg border border-bambu-dark-tertiary border-l-[3px] bg-bambu-dark-secondary px-3 py-2 ${config.border}`}>
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Status icon */}
        <StatusIcon className={`w-4 h-4 shrink-0 ${config.color}`} />

        {/* Thumbnail */}
        <div className="w-8 h-8 shrink-0 bg-bambu-dark rounded overflow-hidden">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-bambu-gray">
              <Layers className="w-4 h-4" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {displayName}
          </span>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.printer_name && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-bambu-gray shrink-0">
                <Printer className="w-3 h-3" />
                <span className="truncate max-w-[100px]">{item.printer_name}</span>
              </span>
            )}

            {item.print_time_seconds && (
              <span className="hidden sm:flex items-center gap-1 text-xs text-bambu-gray shrink-0">
                <Timer className="w-3 h-3" />
                {formatDuration(item.print_time_seconds)}
              </span>
            )}

            <span className="text-xs text-bambu-gray shrink-0">
              {formatRelativeTime(completedTime, timeFormat, t)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
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

      <QueueItemCommentEditor
        comment={item.comment}
        canEdit={canEditComment}
        onSave={onUpdateComment}
        label={t('queue.comment.label')}
        addLabel={t('queue.comment.add')}
        editLabel={t('queue.comment.edit')}
        placeholder={t('queue.comment.placeholder')}
        savingLabel={t('common.saving')}
        compact
      />
    </div>
  );
}
