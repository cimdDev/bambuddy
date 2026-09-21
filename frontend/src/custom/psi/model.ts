/** PSI job data as the cards see it. Mirrors backend/app/custom/psi/service.py. */

export type PsiEntity = 'archive' | 'queue' | 'library';

/** Four legal states; see backend/app/custom/psi/classification.py. */
export type PsiClass = 'psi' | 'private' | 'private_partial' | 'private_own';
export const PSI_CLASSES: readonly PsiClass[] = ['psi', 'private', 'private_partial', 'private_own'];

/** Company or private work; material does not matter. */
export type PsiJob = 'psi' | 'private';

export type PsiClassSource = 'own' | 'library' | 'archive' | 'queue' | null;

export interface PsiUser {
  name: string | null;
  email: string | null;
  /** 'file' = read from the printer notes, 'manual' = typed, 'library' = inherited. */
  source: 'file' | 'manual' | 'library' | null;
  /** The record a repair writes to. */
  record: { entity: 'archive' | 'library'; id: number } | null;
}

export interface PsiMeta {
  entity: PsiEntity;
  id: number;
  /** False for library files that are not print jobs (STL, STEP…): note only. */
  printable: boolean;
  user: PsiUser;
  can_edit_user: boolean;
  psi_class: PsiClass;
  psi_class_own: PsiClass | null;
  psi_class_source: PsiClassSource;
  runs_mixed: boolean;
  note: string | null;
  note_source: 'own' | 'queue' | null;
  can_edit: boolean;
}

export interface PsiUserSuggestion {
  name: string | null;
  email: string | null;
  count: number;
}

export interface PsiBucket {
  prints: number;
  hours: number;
  grams: number;
  cost: number;
}

export interface PsiAccountingUser {
  key: string;
  label: string | null;
  prints: number;
  by_class: Record<PsiClass, PsiBucket>;
  to_reimburse: number;
  partial_cost: number;
}

export interface PsiAccountingPrinter {
  printer_id: number | null;
  printer_name: string | null;
  by_class: Record<PsiClass, PsiBucket>;
}

export interface PsiAccounting {
  totals: PsiBucket;
  by_class: Record<PsiClass, PsiBucket>;
  job: Record<'psi' | 'private', { prints: number; hours: number }>;
  material: Record<'psi' | 'partial' | 'own', { grams: number; cost: number }>;
  users: PsiAccountingUser[];
  printers: PsiAccountingPrinter[];
  runs_without_cost: number;
}

export interface PsiRunRow {
  run_id: number;
  archive_id: number | null;
  date: string | null;
  user: string | null;
  psi_class: PsiClass;
  print_name: string | null;
  printer_name: string | null;
  status: string;
  grams: number;
  cost: number | null;
  hours: number;
}

export const NO_USER_KEY = '__none__';

/** The canonical display rule: name, else address, else missing. */
export function displayUser(user: Pick<PsiUser, 'name' | 'email'> | null | undefined): string | null {
  return user?.name || user?.email || null;
}

export function isPrivate(cls: PsiClass): boolean {
  return cls !== 'psi';
}

/** Tailwind classes per class, in upstream's light/dark badge idiom. */
export const CLASS_TONE: Record<PsiClass, string> = {
  psi: 'bg-emerald-50 dark:bg-bambu-green/15 text-emerald-700 dark:text-bambu-green border-emerald-200 dark:border-bambu-green/30',
  private: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
  private_partial: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  private_own: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
};

/** Solid swatch per class for bars and legends. */
export const CLASS_SWATCH: Record<PsiClass, string> = {
  psi: 'bg-bambu-green',
  private: 'bg-sky-500',
  private_partial: 'bg-amber-500',
  private_own: 'bg-purple-500',
};

/** One run as upstream's `/archives/slim` lists it, plus its job type. */
export interface PsiChartRun {
  printer_id: number | null;
  print_name: string | null;
  print_time_seconds: number | null;
  actual_time_seconds: number | null;
  filament_used_grams: number | null;
  status: string;
  started_at: string | null;
  created_at: string;
  job: PsiJob;
}

/** A material's default price and how its (non-archived) spools are priced. */
export interface PsiMaterialPrice {
  material: string;
  cost_per_kg: number | null;
  spools: number;
  /** Spools carrying this material price. */
  auto: number;
  /** Spools with a price someone typed. */
  own: number;
  /** Spools without a price: they fall back to the global default. */
  unpriced: number;
}
