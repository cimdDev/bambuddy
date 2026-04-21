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
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { type TimeFormat, formatDuration, formatRelativeTime } from '../utils/date';
import type { PrintQueueItem, Permission } from '../api/client';
import { Button } from './Button';

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
  onUpdateAccounting,
  timeFormat = 'system',
  hasPermission,
  canModify,
  t,
}: {
  item: PrintQueueItem;
  onRequeue: () => void;
  onRemove: () => void;
  onUpdateAccounting: (patch: {
    private_job?: boolean;
    private_material?: boolean;
    private_material_partial?: boolean;
  }) => Promise<void>;
  timeFormat?: TimeFormat;
  hasPermission: (permission: Permission) => boolean;
  canModify: (resource: 'queue' | 'archives' | 'library', action: 'update' | 'delete' | 'reprint', createdById: number | null | undefined) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.cancelled;
  const StatusIcon = config.icon;
  const displayName = item.archive_name || item.library_file_name || `File #${item.archive_id || item.library_file_id}`;
  const canEditAccounting = canModify('queue', 'update', item.created_by_id);
  const privateMaterialUsage = item.private_material
    ? 'private_full'
    : item.private_material_partial
      ? 'private_partial'
      : 'company';

  const thumbnailUrl = item.archive_thumbnail
    ? api.getArchiveThumbnail(item.archive_id!)
    : item.library_file_thumbnail
      ? api.getLibraryFileThumbnailUrl(item.library_file_id!)
      : null;

  const completedTime = item.completed_at || item.created_at;

  return (
    <div className={`flex items-start gap-2 sm:gap-3 px-3 py-2 bg-bambu-dark-secondary rounded-lg border border-bambu-dark-tertiary border-l-[3px] ${config.border}`}>
      {/* Status icon */}
      <StatusIcon className={`w-4 h-4 shrink-0 mt-2 ${config.color}`} />

      {/* Thumbnail */}
      <div className="w-8 h-8 shrink-0 bg-bambu-dark rounded overflow-hidden mt-1">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-bambu-gray">
            <Layers className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-medium truncate min-w-0 flex-1">
            {displayName}
          </span>
          {item.archive_id ? (
            <Link
              to={`/archives?highlight=${item.archive_id}`}
              className="text-bambu-gray hover:text-bambu-green transition-colors shrink-0"
              title={t('queue.viewArchive')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          ) : item.library_file_id ? (
            <Link
              to={`/library?highlight=${item.library_file_id}`}
              className="text-bambu-gray hover:text-bambu-green transition-colors shrink-0"
              title={t('queue.viewInFileManager')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          ) : null}
        </div>

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
          <span className="text-xs text-bambu-gray">
            {formatRelativeTime(completedTime, timeFormat, t)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => {
              if (!canEditAccounting) return;
              const nextPrivateJob = !item.private_job;
              void onUpdateAccounting({
                private_job: nextPrivateJob,
                private_material: nextPrivateJob ? item.private_material : false,
                private_material_partial: nextPrivateJob ? item.private_material_partial : false,
              });
            }}
            disabled={!canEditAccounting}
            className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full border transition-colors ${
              item.private_job
                ? 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20'
                : 'bg-bambu-dark/40 text-bambu-gray border-bambu-dark-tertiary hover:text-white'
            } ${!canEditAccounting ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={!canEditAccounting ? t('queue.permissions.noEdit') : t('queue.accounting.privateJob')}
          >
            {t('queue.accounting.privateJob')}
          </button>

          {item.private_job && (
            <button
              type="button"
              onClick={() => {
                if (!canEditAccounting) return;
                const nextUsage =
                  privateMaterialUsage === 'company'
                    ? 'private_partial'
                    : privateMaterialUsage === 'private_partial'
                      ? 'private_full'
                      : 'company';
                void onUpdateAccounting({
                  private_job: true,
                  private_material: nextUsage === 'private_full',
                  private_material_partial: nextUsage === 'private_partial',
                });
              }}
              disabled={!canEditAccounting}
              className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full border transition-colors ${
                privateMaterialUsage === 'private_full'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : privateMaterialUsage === 'private_partial'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                    : 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20'
              } ${!canEditAccounting ? 'opacity-60 cursor-not-allowed' : ''}`}
              title={!canEditAccounting ? t('queue.permissions.noEdit') : t('queue.accounting.privateMaterial')}
            >
              {privateMaterialUsage === 'private_full'
                ? t('queue.accounting.privateMaterialFull')
                : privateMaterialUsage === 'private_partial'
                  ? t('queue.accounting.privateMaterialPartial')
                  : t('queue.accounting.companyMaterial')}
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
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
  );
}
