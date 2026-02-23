import { FileText } from 'lucide-react';

interface SlicerUserBadgeProps {
  user: string;
  className?: string;
  textClassName?: string;
  title?: string;
  truncate?: boolean;
}

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function SlicerUserBadge({
  user,
  className,
  textClassName,
  title,
  truncate = false,
}: SlicerUserBadgeProps) {
  return (
    <span
      className={joinClasses(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-tight',
        'bg-emerald-100 text-emerald-800 border-emerald-300/80 ring-1 ring-emerald-500/10',
        'dark:bg-bambu-green/15 dark:text-bambu-green dark:border-bambu-green/30 dark:ring-bambu-green/15',
        className,
      )}
      title={title || `Sliced by: ${user}`}
    >
      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
      <span className={joinClasses(truncate && 'truncate', textClassName)}>{user}</span>
    </span>
  );
}
