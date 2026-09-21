import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, StickyNote } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { usePsiUpdate } from '../hooks';
import type { PsiMeta } from '../model';

/**
 * One short note per job, editable in place at any time.
 *
 * Blur and Ctrl/Cmd+Enter save, Escape reverts. Two bugs of the old queue
 * comment editor are fixed on purpose: the caret is placed once when editing
 * starts (not on every keystroke), and a refetch that lands while someone is
 * typing never replaces their draft or closes the editor.
 */
export function PsiNote({ meta, variant, readOnly }: { meta: PsiMeta; variant: 'card' | 'compact'; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const update = usePsiUpdate(meta.entity, meta.id);
  const area = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meta.note ?? '');
  const editable = !readOnly && meta.can_edit;

  // Follow the server only while nobody is typing.
  useEffect(() => {
    if (!editing) setDraft(meta.note ?? '');
  }, [meta.note, editing]);

  // Focus and caret once, when editing starts. Depends on `editing` only.
  useEffect(() => {
    if (!editing || !area.current) return;
    const len = area.current.value.length;
    area.current.focus();
    area.current.setSelectionRange(len, len);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (meta.note ?? '').trim()) return;
    update.mutate(
      { note: next || null },
      {
        onError: (e) => {
          setDraft(meta.note ?? '');
          showToast(t('psi.error.save', { message: (e as Error).message }), 'error');
        },
      },
    );
  };

  const revert = () => {
    setDraft(meta.note ?? '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="w-full">
        <textarea
          ref={area}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              revert();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              area.current?.blur();
            }
          }}
          rows={variant === 'card' ? 3 : 2}
          maxLength={2000}
          placeholder={t('psi.note.placeholder')}
          className="w-full resize-y rounded-md border border-bambu-green/60 bg-bambu-dark px-2 py-1 text-xs text-white placeholder:text-bambu-gray focus:outline-none"
          aria-label={t('psi.note.edit')}
        />
        <p className="mt-0.5 text-[10px] text-bambu-gray">{t('psi.note.hint')}</p>
      </div>
    );
  }

  if (!meta.note) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-bambu-gray transition-colors hover:bg-bambu-dark-tertiary hover:text-white"
        data-testid="psi-note-add"
      >
        <Plus className="h-3 w-3" />
        {t('psi.note.add')}
      </button>
    );
  }

  const text = (
    <>
      <StickyNote className="mt-px h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
      <span className={`min-w-0 whitespace-pre-wrap break-words text-left ${variant === 'card' ? 'line-clamp-3' : 'line-clamp-1'}`}>
        {meta.note}
      </span>
      {update.isPending && <Loader2 className="mt-px h-3 w-3 shrink-0 animate-spin" />}
    </>
  );
  const title = meta.note_source === 'queue' ? `${meta.note}\n— ${t('psi.note.fromQueue')}` : meta.note;
  const box = 'flex w-full items-start gap-1.5 rounded-md bg-blue-50/70 dark:bg-blue-500/10 px-2 py-1 text-xs text-bambu-gray-light';

  if (!editable) {
    return <div className={box} title={title} data-testid="psi-note">{text}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`${box} cursor-text hover:ring-1 hover:ring-blue-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-bambu-green`}
      title={`${title}\n${t('psi.note.edit')}`}
      data-testid="psi-note"
    >
      {text}
    </button>
  );
}
