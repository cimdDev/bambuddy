import type { KeyboardEvent, MouseEvent } from 'react';
import '../i18n';
import { usePsiMeta } from '../hooks';
import type { PsiEntity } from '../model';
import { PsiClassChip } from './PsiClassChip';
import { PsiNote } from './PsiNote';
import { PsiUserBadge } from './PsiUserBadge';

export type PsiStripVariant = 'card' | 'compact' | 'readonly';

const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * The one PSI seam on every card: who sliced it, PSI or private (and whose
 * material), and the job's note. Call sites pass the record and nothing else;
 * the strip loads its own data (batched across the page), knows its own
 * permissions and saves its own edits.
 *
 * - `card`: chips on one line, the note below (archive, file and queue cards).
 * - `compact`: everything on one line (list rows, queue history).
 * - `readonly`: no controls at all, safe inside a link (printer queue tile).
 */
export function PsiJobStrip({
  entity,
  id,
  variant = 'card',
  className = '',
}: {
  entity: PsiEntity;
  id: number | null | undefined;
  variant?: PsiStripVariant;
  className?: string;
}) {
  const { data: meta } = usePsiMeta(entity, id);
  if (!meta) return null;

  const readOnly = variant === 'readonly';
  const chips = meta.printable ? (
    <>
      <PsiUserBadge meta={meta} readOnly={readOnly} />
      <PsiClassChip meta={meta} readOnly={readOnly} compact={variant !== 'card'} />
    </>
  ) : null;

  if (readOnly) {
    return (
      <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`} data-testid="psi-strip">
        {chips}
        {meta.note && (
          <span className="min-w-0 max-w-full truncate text-[11px] text-bambu-gray" title={meta.note}>
            {meta.note}
          </span>
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
        onClick={stop}
        onKeyDown={stop}
        data-testid="psi-strip"
      >
        {chips}
        <div className="min-w-0 max-w-full flex-1 basis-40">
          <PsiNote meta={meta} variant="compact" />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} onClick={stop} onKeyDown={stop} data-testid="psi-strip">
      {chips && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div>}
      <PsiNote meta={meta} variant="card" />
    </div>
  );
}

/**
 * The printer card's running job: its queue item when Bambuddy dispatched it,
 * otherwise the archive the printer reports as current.
 */
export function PsiPrinterJobStrip({
  queueItemId,
  archiveId,
  className = '',
}: {
  queueItemId?: number | null;
  archiveId?: number | null;
  className?: string;
}) {
  if (queueItemId) return <PsiJobStrip entity="queue" id={queueItemId} variant="compact" className={className} />;
  if (archiveId) return <PsiJobStrip entity="archive" id={archiveId} variant="compact" className={className} />;
  return null;
}
