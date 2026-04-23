const STORAGE_KEY = 'bambuddy.slicer-user-memory.v1';
const MAX_ENTRIES = 25;

interface SlicerUserMemoryEntry {
  value: string;
  count: number;
  lastUsedAt: string;
}

function readEntries(): SlicerUserMemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SlicerUserMemoryEntry => (
      entry &&
      typeof entry.value === 'string' &&
      typeof entry.count === 'number' &&
      typeof entry.lastUsedAt === 'string'
    ));
  } catch {
    return [];
  }
}

function writeEntries(entries: SlicerUserMemoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Ignore storage errors (private mode/quota).
  }
}

export function rememberSlicerUser(value: string) {
  const normalized = value.trim();
  if (!normalized) return;

  const now = new Date().toISOString();
  const entries = readEntries();
  const existing = entries.find((entry) => entry.value.toLowerCase() === normalized.toLowerCase());

  if (existing) {
    existing.value = normalized;
    existing.count += 1;
    existing.lastUsedAt = now;
  } else {
    entries.push({
      value: normalized,
      count: 1,
      lastUsedAt: now,
    });
  }

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
  });

  writeEntries(entries);
}

export function getSuggestedSlicerUser(): string | null {
  const [top] = readEntries().sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
  });
  return top?.value ?? null;
}
