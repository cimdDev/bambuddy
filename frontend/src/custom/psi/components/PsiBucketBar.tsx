/** A labelled proportional bar. Renders nothing for an empty total. */
export interface PsiSegment {
  key: string;
  label: string;
  value: number;
  swatch: string;
}

export function PsiBucketBar({ segments, format }: { segments: PsiSegment[]; format: (value: number) => string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-bambu-dark">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.key}
              className={s.swatch}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${format(s.value)}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {segments.map((s) => (
          <span key={s.key} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.swatch}`} />
            <span className="truncate text-bambu-gray">{s.label}</span>
            <span className="tabular-nums text-white">{format(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
