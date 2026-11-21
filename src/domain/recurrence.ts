import type { RecurrenceFrequency, RecurringExpense } from '../types/nido';

export function isValidMonthKey(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(val);
}

export function daysInMonthLocal(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  return new Date(Number(yStr), Number(mStr), 0).getDate();
}

export function clampDateForMonthLocal(monthKey: string, dayOfMonth: number): string {
  const maxDay = daysInMonthLocal(monthKey);
  const day = Math.max(1, Math.min(maxDay, Math.round(dayOfMonth)));
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

export function shiftMonthKeyLocal(monthKey: string, deltaMonths: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const dt = new Date(y, m + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function monthsDiff(startMonthKey: string, targetMonthKey: string): number {
  const [sy, sm] = startMonthKey.split('-').map(Number);
  const [ty, tm] = targetMonthKey.split('-').map(Number);
  return (ty - sy) * 12 + (tm - sm);
}

export function frequencyIntervalMonths(freq: RecurrenceFrequency): number {
  switch (freq) {
    case 'mensual':
      return 1;
    case 'bimestral':
      return 2;
    case 'trimestral':
      return 3;
    case 'anual':
      return 12;
  }
}

/**
 * Legacy active non-monthly templates saved before `startMonth` existed should be flagged
 * to the user rather than guessing a fake month.
 */
export function isRecurringMissingStartMonth(rec: RecurringExpense): boolean {
  return Boolean(rec.active) && rec.frequency !== 'mensual' && !isValidMonthKey(rec.startMonth);
}

/**
 * Single authoritative recurrence cadence engine.
 * - Inactive or <= 0 € templates are never due.
 * - Monthly templates without `startMonth` stay due every month (legacy support).
 * - Non-monthly templates without a valid `startMonth` return false (flagged via `isRecurringMissingStartMonth`).
 * - Templates with a valid `startMonth` are due iff `targetMonth >= startMonth` and `(monthsDiff % interval) === 0`.
 */
export function isRecurringDueInMonth(rec: RecurringExpense, monthKey: string): boolean {
  if (!rec.active || (Number(rec.amount) || 0) <= 0) return false;
  if (!isValidMonthKey(monthKey)) return false;

  if (rec.frequency === 'mensual') {
    if (!isValidMonthKey(rec.startMonth)) return true;
    return monthsDiff(rec.startMonth, monthKey) >= 0;
  }

  if (!isValidMonthKey(rec.startMonth)) {
    return false;
  }

  const diff = monthsDiff(rec.startMonth, monthKey);
  if (diff < 0) return false;
  return diff % frequencyIntervalMonths(rec.frequency) === 0;
}

export function getRecurringDueDateForMonth(rec: RecurringExpense, monthKey: string): string {
  return clampDateForMonthLocal(monthKey, rec.dayOfMonth);
}

export function getNextRecurringDueDate(
  rec: RecurringExpense,
  todayISO: string,
  maxLookaheadMonths = 12
): string | null {
  if (!rec.active || (Number(rec.amount) || 0) <= 0) return null;
  const baseMonth = todayISO.slice(0, 7);
  if (!isValidMonthKey(baseMonth)) return null;

  for (let offset = 0; offset <= maxLookaheadMonths; offset++) {
    const candidateMonth = shiftMonthKeyLocal(baseMonth, offset);
    if (!isRecurringDueInMonth(rec, candidateMonth)) continue;
    const dueDate = clampDateForMonthLocal(candidateMonth, rec.dayOfMonth);
    if (dueDate >= todayISO) {
      return dueDate;
    }
  }
  return null;
}

/**
 * Builds a deterministic Firestore-safe document ID (^[a-zA-Z0-9_-]{1,128}$)
 * for a generated monthly recurring transaction so double clicks or concurrent calls
 * cannot create duplicate transactions for the same (monthKey, recurringId).
 */
export function buildDeterministicRecurringTxId(monthKey: string, recurringId: string): string {
  const safeMonth = monthKey.replace(/[^0-9-]/g, '');
  const safeRec = recurringId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'rec';
  const prefix = `recgen_${safeMonth}_`;
  if (safeRec === recurringId && prefix.length + safeRec.length <= 128) {
    return `${prefix}${safeRec}`;
  }
  let hash = 2166136261;
  for (let i = 0; i < recurringId.length; i++) {
    hash ^= recurringId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const maxRecLen = Math.max(16, 128 - prefix.length - 1 - hex.length);
  return `${prefix}${safeRec.slice(0, maxRecLen)}_${hex}`;
}

export interface PartitionedRecurringTemplates {
  activeTemplates: RecurringExpense[];
  pendingTemplates: RecurringExpense[];
  pendingConfigCount: number;
  unanchoredPeriodicCount: number;
}

export function partitionRecurringTemplates(
  recurring: RecurringExpense[]
): PartitionedRecurringTemplates {
  const sorted = [...recurring].sort(
    (a, b) => a.dayOfMonth - b.dayOfMonth || a.concept.localeCompare(b.concept, 'es')
  );
  const activeTemplates = sorted.filter((r) => r.active);
  const pendingTemplates = sorted.filter((r) => !r.active);
  const pendingConfigCount = sorted.filter(
    (r) => !r.active && (Number(r.amount) || 0) <= 0
  ).length;
  const unanchoredPeriodicCount = activeTemplates.filter(isRecurringMissingStartMonth).length;
  return {
    activeTemplates,
    pendingTemplates,
    pendingConfigCount,
    unanchoredPeriodicCount,
  };
}
