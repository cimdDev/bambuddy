import { useEffect, useRef, useState } from 'react';
import { MessageSquare, MessageSquarePlus, Pencil } from 'lucide-react';

interface QueueItemCommentEditorProps {
  comment?: string | null;
  canEdit: boolean;
  onSave?: (comment: string | null) => Promise<void>;
  label: string;
  addLabel: string;
  editLabel: string;
  placeholder: string;
  savingLabel: string;
  compact?: boolean;
}

export function QueueItemCommentEditor({
  comment,
  canEdit,
  onSave,
  label,
  addLabel,
  editLabel,
  placeholder,
  savingLabel,
  compact = false,
}: QueueItemCommentEditorProps) {
  const savedComment = comment?.trim() ?? '';
  const [draft, setDraft] = useState(savedComment);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(savedComment);
    setIsEditing(false);
    setIsSaving(false);
  }, [savedComment]);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draft.length, draft.length);
    }
  }, [draft.length, isEditing]);

  const commitDraft = async () => {
    if (!canEdit || !onSave) {
      setIsEditing(false);
      return;
    }

    const nextComment = draft.trim();
    if (nextComment === savedComment) {
      setDraft(savedComment);
      setIsEditing(false);
      return;
    }

    try {
      setIsSaving(true);
      await onSave(nextComment || null);
      setIsEditing(false);
    } catch {
      setDraft(savedComment);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEditing = () => {
    setDraft(savedComment);
    setIsEditing(false);
  };

  if (!savedComment && !canEdit && !isEditing) {
    return null;
  }

  const containerClassName = compact
    ? 'mt-2 rounded-lg border border-bambu-dark-tertiary/70 bg-bambu-dark/50 p-2.5'
    : 'mt-2 rounded-lg border border-bambu-dark-tertiary bg-bambu-dark/60 p-3';
  const labelClassName = compact
    ? 'text-[11px] text-bambu-gray'
    : 'text-xs text-bambu-gray';
  const commentClassName = compact
    ? 'mt-1 text-xs leading-relaxed text-bambu-gray-light whitespace-pre-wrap break-words'
    : 'mt-1.5 text-sm leading-relaxed text-bambu-gray-light whitespace-pre-wrap break-words';
  const buttonClassName = compact
    ? 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-bambu-gray hover:text-white hover:bg-bambu-dark-tertiary'
    : 'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-bambu-gray hover:text-white hover:bg-bambu-dark-tertiary';

  if (isEditing) {
    return (
      <div className={containerClassName} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 ${labelClassName}`}>
            <MessageSquare className="h-3.5 w-3.5" />
            {label}
          </span>
          {isSaving && (
            <span className="text-[11px] text-bambu-gray">{savingLabel}</span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          rows={compact ? 2 : 3}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            void commitDraft();
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelEditing();
            }
          }}
          className="mt-2 w-full resize-none rounded-lg border border-bambu-dark-tertiary bg-bambu-dark-secondary px-3 py-2 text-sm text-white placeholder:text-bambu-gray focus:border-bambu-green focus:outline-none"
        />
      </div>
    );
  }

  if (!savedComment) {
    return canEdit ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsEditing(true);
        }}
        className={`${buttonClassName} mt-2 border border-dashed border-bambu-dark-tertiary`}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    ) : null;
  }

  return (
    <div className={containerClassName} onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 ${labelClassName}`}>
          <MessageSquare className="h-3.5 w-3.5" />
          {label}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsEditing(true);
            }}
            className={buttonClassName}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editLabel}
          </button>
        )}
      </div>
      <p className={commentClassName}>{savedComment}</p>
    </div>
  );
}
