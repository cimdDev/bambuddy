import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, UserRound } from 'lucide-react';
import { displayUser } from '../model';
import type { PsiMeta } from '../model';
import { PsiUserDialog } from './PsiUserDialog';

/**
 * Who sliced the print (the `User=` line of the slicer's printer notes). Three
 * states in one component: present, missing, and editable. The missing state is
 * the common case this exists for, so it is visible to everyone; only people
 * allowed to edit the underlying record get the button.
 */
export function PsiUserBadge({ meta, readOnly }: { meta: PsiMeta; readOnly?: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const name = displayUser(meta.user);
  const editable = !readOnly && meta.can_edit_user && meta.user.record != null;

  const source = meta.user.source === 'manual'
    ? t('psi.user.sourceManual')
    : meta.user.source === 'library'
      ? t('psi.user.sourceLibrary')
      : meta.user.source === 'file'
        ? t('psi.user.sourceFile')
        : t('psi.user.missingHint');
  const title = [name, meta.user.name && meta.user.email ? meta.user.email : null, source, editable ? t('psi.user.edit') : null]
    .filter(Boolean)
    .join('\n');

  const tone = name
    ? 'border-bambu-dark-tertiary bg-bambu-dark-tertiary/50 text-bambu-gray-light'
    : 'border-dashed border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const chip = `inline-flex max-w-[12rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${tone}`;
  const content = (
    <>
      {name ? <UserRound className="h-3 w-3 shrink-0" /> : <TriangleAlert className="h-3 w-3 shrink-0" />}
      <span className="truncate">{name ?? t('psi.user.missing')}</span>
    </>
  );

  if (!editable) {
    return <span className={chip} title={title} data-testid="psi-user">{content}</span>;
  }
  return (
    <>
      <button
        type="button"
        className={`${chip} cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-bambu-green`}
        title={title}
        onClick={() => setEditing(true)}
        data-testid="psi-user"
      >
        {content}
      </button>
      {editing && <PsiUserDialog user={meta.user} onClose={() => setEditing(false)} />}
    </>
  );
}
