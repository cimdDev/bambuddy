import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';

interface QueueItemCommentEditorProps {
  comment?: string | null;
  canEdit: boolean;
  onSave?: (comment: string | null) => Promise<void>;
  onEditingChange?: (isEditing: boolean) => void;
  label: string;
  addLabel: string;
  placeholder: string;
  savingLabel: string;
  compact?: boolean;
  noMargin?: boolean;
  singleLine?: boolean;
  iconOnlyLabel?: boolean;
  rightAlignAddButton?: boolean;
  bare?: boolean;
  autoOpen?: boolean;
}

export function QueueItemCommentEditor({
  comment,
  canEdit,
  onSave,
  onEditingChange,
  label,
  addLabel,
  placeholder,
  savingLabel,
  compact = false,
  noMargin = false,
  singleLine = false,
  iconOnlyLabel = false,
  rightAlignAddButton = false,
  bare = false,
  autoOpen = false,
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

  useEffect(() => {
    if (!isEditing || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft, isEditing]);

  useEffect(() => {
    if (autoOpen && !isEditing) {
      setIsEditing(true);
    }
  }, [autoOpen, isEditing]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

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

  const marginClassName = noMargin ? '' : 'mt-2';
  const containerClassName = compact
    ? `${marginClassName} rounded-lg border border-bambu-dark-tertiary/70 bg-bambu-dark/50 p-2.5`.trim()
    : `${marginClassName} rounded-lg border border-bambu-dark-tertiary bg-bambu-dark/60 p-3`.trim();
  const bareContainerClassName = `${marginClassName} rounded-md border border-bambu-dark-tertiary bg-black/20 px-2 py-1.5`.trim();
  const labelClassName = compact
    ? 'text-[11px] text-bambu-gray'
    : 'text-xs text-bambu-gray';
  const commentClassName = compact
    ? singleLine
      ? 'min-w-0 flex-1 truncate text-xs leading-4 text-bambu-gray-light'
      : 'mt-1 text-xs leading-relaxed text-bambu-gray-light whitespace-pre-wrap break-words'
    : singleLine
      ? 'min-w-0 flex-1 truncate text-sm leading-5 text-bambu-gray-light'
      : 'mt-1.5 text-sm leading-relaxed text-bambu-gray-light whitespace-pre-wrap break-words';
  const buttonClassName = compact
    ? 'inline-flex items-center gap-1 rounded-md border border-bambu-dark-tertiary bg-black/20 px-2 py-1 text-[11px] text-bambu-gray-light hover:border-bambu-gray hover:text-white'
    : 'inline-flex items-center gap-1 rounded-md border border-bambu-dark-tertiary bg-black/20 px-2.5 py-1.5 text-xs text-bambu-gray-light hover:border-bambu-gray hover:text-white';
  const labelContent = (
    <>
      <MessageSquare className="h-3.5 w-3.5" />
      {!iconOnlyLabel && label}
    </>
  );
  const openEditor = (event: MouseEvent) => {
    if (!canEdit) return;
    event.stopPropagation();
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <div className={bare ? bareContainerClassName : containerClassName} onClick={(event) => event.stopPropagation()}>
        {!bare && (
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 ${labelClassName}`}>
              {labelContent}
            </span>
            {isSaving && (
              <span className="text-[11px] text-bambu-gray">{savingLabel}</span>
            )}
          </div>
        )}
        {bare && isSaving && (
          <div className="mb-1 text-[11px] text-bambu-gray">{savingLabel}</div>
        )}
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
          className={bare
            ? 'w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-xs sm:text-sm text-bambu-gray-light placeholder:text-bambu-gray focus:outline-none'
            : 'mt-2 w-full resize-none overflow-hidden rounded-lg border border-bambu-dark-tertiary bg-bambu-dark-secondary px-3 py-2 text-sm text-white placeholder:text-bambu-gray focus:border-bambu-green focus:outline-none'}
        />
      </div>
    );
  }

  if (!savedComment) {
    return canEdit ? (
      <div className={`${marginClassName} ${rightAlignAddButton ? 'flex justify-end' : ''}`.trim()}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsEditing(true);
          }}
          className={buttonClassName}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>
    ) : null;
  }

  return (
    <div
      className={bare ? bareContainerClassName : containerClassName}
      onClick={(event) => {
        if (canEdit) {
          openEditor(event);
          return;
        }
        event.stopPropagation();
      }}
    >
      {singleLine ? (
        <div className="flex items-center gap-2">
          <span className={`inline-flex shrink-0 items-center gap-1.5 ${labelClassName}`}>
            {labelContent}
          </span>
          <p className={commentClassName} title={savedComment}>
            {savedComment}
          </p>
        </div>
      ) : (
        <>
          {bare ? (
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-xs sm:text-sm text-bambu-gray-light break-words whitespace-pre-wrap">
                {savedComment}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 ${labelClassName}`}>
                  {labelContent}
                </span>
              </div>
              <p className={commentClassName}>{savedComment}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
