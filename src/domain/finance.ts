import { TRANSACTION_CATEGORY_LABELS } from './presets';
import {
  getNextRecurringDueDate,
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
} from './recurrence';
import type {
  ExpenseCategory,
  FurnitureItem,
  GoalMovement,
  HouseholdMember,
  HouseholdSettings,
  InitialCost,
  MonthClosure,
  MonthlyBudget,
  RecurrenceFrequency,
  RecurringExpense,
  SavingsGoal,
  SplitPresetChoice,
  Transaction,
  TransactionCategory,
} from '../types/nido';

// ─── Local Calendar Date Helpers (NEVER derive local day from UTC ISO slice) ──

export function formatLocalDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayLocalISO(now: Date = new Date()): string {
  return formatLocalDateISO(now);
}

export function getCurrentMonthKeyLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const dt = new Date(y, m + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDateES(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatMonthLabelES(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const dt = new Date(Number(yStr), Number(mStr) - 1, 1);
  const label = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(dt);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatMonthShortES(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const dt = new Date(Number(yStr), Number(mStr) - 1, 1);
  return new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(dt);
}

export function daysInMonth(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  return new Date(Number(yStr), Number(mStr), 0).getDate();
}

export function clampDateForMonth(monthKey: string, dayOfMonth: number): string {
  const maxDay = daysInMonth(monthKey);
  const day = Math.max(1, Math.min(maxDay, Math.round(dayOfMonth)));
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

export function monthsUntilLocal(fromISO: string, toISO: string): number {
  if (!toISO || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)) return 0;
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  let diff = (ty - fy) * 12 + (tm - fm);
  if (td > fd) diff += 0;
  return Math.max(1, diff);
}

// ─── Currency Formatting (es-ES) ─────────────────────────────────────────────

const eurFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
});

const pctFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatEUR(value: number): string {
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  return eurFormatter.format(clean);
}

export function formatPctES(value: number): string {
  const clean = Number.isFinite(value) ? value : 0;
  return `${pctFormatter.format(clean)}%`;
}

export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ─── Split Formula ───────────────────────────────────────────────────────────

export function clampSplitPct(value: unknown, fallback = 50): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

export function normalizeSplitPair(presetAValue: unknown): { presetA: number; presetB: number } {
  const presetA = clampSplitPct(presetAValue, 50);
  const presetB = Math.round((100 - presetA) * 10) / 10;
  return { presetA, presetB };
}

export function computeEffectiveSplitPctA(settings: HouseholdSettings): number {
  if (settings.splitMode === 'income') {
    const a = Math.max(0, Number(settings.incomeA) || 0);
    const b = Math.max(0, Number(settings.incomeB) || 0);
    const total = a + b;
    if (total <= 0) return 50;
    return Math.round((a / total) * 1000) / 10;
  }
  return clampSplitPct(settings.presetA, 50);
}

export function resolveSplitPctForChoice(
  choice: SplitPresetChoice,
  viewerIsMemberA: boolean,
  effectiveSplitPctA: number,
  customSplitPctA?: unknown
): number {
  switch (choice) {
    case 'segun_reparto':
      return clampSplitPct(effectiveSplitPctA, 50);
    case 'a_medias':
      return 50;
    case 'solo_yo':
      return viewerIsMemberA ? 100 : 0;
    case 'solo_pareja':
      return viewerIsMemberA ? 0 : 100;
    case 'personalizado':
      return clampSplitPct(customSplitPctA, effectiveSplitPctA);
  }
}

export function inferSplitChoice(
  splitPctA: number,
  viewerIsMemberA: boolean,
  effectiveSplitPctA: number
): SplitPresetChoice {
  const clean = clampSplitPct(splitPctA, effectiveSplitPctA);
  if (Math.abs(clean - clampSplitPct(effectiveSplitPctA, 50)) < 0.05) {
    return 'segun_reparto';
  }
  if (Math.abs(clean - 50) < 0.05) {
    return 'a_medias';
  }
  if (clean === 100) {
    return viewerIsMemberA ? 'solo_yo' : 'solo_pareja';
  }
  if (clean === 0) {
    return viewerIsMemberA ? 'solo_pareja' : 'solo_yo';
  }
  return 'personalizado';
}

// ─── Couple Balance & Settlement Calculation ─────────────────────────────────

export interface CoupleBalanceResult {
  totalSpent: number;
  personalTotalSpent: number;
  paidA: number;
  paidB: number;
  paidComun: number;
  shareA: number;
  shareB: number;
  balanceA: number; // > 0 => B owes A; < 0 => A owes B
  owesDirection: 'peace' | 'b_owes_a' | 'a_owes_b';
  owesAmount: number;
  summaryText: string;
}

export function calculateCoupleBalance(
  transactions: Transaction[],
  memberA: HouseholdMember | undefined,
  memberB: HouseholdMember | undefined
): CoupleBalanceResult {
  const uidA = memberA?.uid ?? 'member_a';
  const uidB = memberB?.uid ?? 'member_b';
  const nameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const nameB = memberB?.displayName?.split(' ')[0] || 'Persona B';

  let totalSpent = 0;
  let personalTotalSpent = 0;
  let paidA = 0;
  let paidB = 0;
  let paidComun = 0;
  let shareA = 0;
  let shareB = 0;
  let settlementDeltaA = 0;

  for (const tx of transactions) {
    if (tx.isPrivate) continue;
    const amount = Math.max(0, Number(tx.amount) || 0);
    if (tx.isSettlement) {
      // If A pays settlement to B, A's balance increases (+amount). If B pays A, A's balance decreases (-amount).
      if (tx.paidBy === uidA && tx.settlementTo === uidB) {
        settlementDeltaA += amount;
      } else if (tx.paidBy === uidB && tx.settlementTo === uidA) {
        settlementDeltaA -= amount;
      }
      continue;
    }

    totalSpent += amount;
    if (tx.paidBy === 'cuenta_comun' || tx.paidBy === 'comun') {
      paidComun += amount;
      continue;
    }

    personalTotalSpent += amount;
    const pctA = clampSplitPct(tx.splitPctA, 50) / 100;
    const txShareA = amount * pctA;
    const txShareB = amount - txShareA;

    shareA += txShareA;
    shareB += txShareB;

    if (tx.paidBy === uidA) {
      paidA += amount;
    } else if (tx.paidBy === uidB) {
      paidB += amount;
    }
  }

  // Formula: Saldo_A = Pagado_A - (Total_gastos_personales * %_A) + liquidaciones_netas
  const rawBalanceA = paidA - shareA + settlementDeltaA;
  const balanceA = roundCents(rawBalanceA);

  let owesDirection: CoupleBalanceResult['owesDirection'] = 'peace';
  let owesAmount = 0;
  let summaryText = 'Estáis en paz';

  if (Math.abs(balanceA) >= 0.01) {
    owesAmount = roundCents(Math.abs(balanceA));
    if (balanceA > 0) {
      owesDirection = 'b_owes_a';
      summaryText = `${nameB} debe ${formatEUR(owesAmount)} a ${nameA}`;
    } else {
      owesDirection = 'a_owes_b';
      summaryText = `${nameA} debe ${formatEUR(owesAmount)} a ${nameB}`;
    }
  }

  return {
    totalSpent: roundCents(totalSpent),
    personalTotalSpent: roundCents(personalTotalSpent),
    paidA: roundCents(paidA),
    paidB: roundCents(paidB),
    paidComun: roundCents(paidComun),
    shareA: roundCents(shareA),
    shareB: roundCents(shareB),
    balanceA,
    owesDirection,
    owesAmount,
    summaryText,
  };
}

export function formatCoupleBalanceSecondPerson(
  balance: CoupleBalanceResult,
  currentMember: HouseholdMember | undefined,
  memberA: HouseholdMember | undefined,
  memberB: HouseholdMember | undefined
): string {
  if (!memberB) {
    return 'Aún no se ha unido nadie más al hogar';
  }
  if (balance.owesDirection === 'peace') {
    return 'Estáis en paz';
  }
  const firstNameA = memberA?.displayName?.trim() || 'Tu pareja';
  const firstNameB = memberB?.displayName?.trim() || 'Tu pareja';
  const amountText = formatEUR(balance.owesAmount);
  const viewerIsA = !currentMember || currentMember.uid === memberA?.uid;

  if (viewerIsA) {
    return balance.owesDirection === 'b_owes_a'
      ? `${firstNameB} te debe ${amountText}`
      : `Le debes ${amountText} a ${firstNameB}`;
  }
  return balance.owesDirection === 'a_owes_b'
    ? `${firstNameA} te debe ${amountText}`
    : `Le debes ${amountText} a ${firstNameA}`;
}

// ─── Recurring Expenses & Budget Helpers ─────────────────────────────────────

export function monthlyEquivalent(amount: number, frequency: RecurrenceFrequency): number {
  const clean = Math.max(0, Number(amount) || 0);
  switch (frequency) {
    case 'mensual':
      return roundCents(clean);
    case 'bimestral':
      return roundCents(clean / 2);
    case 'trimestral':
      return roundCents(clean / 3);
    case 'anual':
      return roundCents(clean / 12);
  }
}

export function isRecurringTemplatePending(rec: RecurringExpense): boolean {
  return !rec.active && (Number(rec.amount) || 0) <= 0;
}

export function findMissingRecurringForMonth(
  recurringList: RecurringExpense[],
  existingMonthTransactions: Transaction[],
  monthKey: string
): RecurringExpense[] {
  const existingIds = new Set(
    existingMonthTransactions
      .filter((t) => !t.isPrivate && Boolean(t.recurringId))
      .map((t) => t.recurringId as string)
  );
  return recurringList.filter((rec) => {
    if (existingIds.has(rec.id)) return false;
    return isRecurringDueInMonth(rec, monthKey);
  });
}

export interface UpcomingCharge {
  recurringId: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  dayOfMonth: number;
  dueDate: string;
  frequency: RecurrenceFrequency;
}

export function getUpcomingCharges(
  recurringList: RecurringExpense[],
  todayISO: string,
  limit = 6
): UpcomingCharge[] {
  const upcoming: UpcomingCharge[] = [];
  for (const rec of recurringList) {
    const dueDate = getNextRecurringDueDate(rec, todayISO, 12);
    if (!dueDate) continue;
    upcoming.push({
      recurringId: rec.id,
      concept: rec.concept,
      category: rec.category,
      amount: rec.amount,
      dayOfMonth: rec.dayOfMonth,
      dueDate,
      frequency: rec.frequency,
    });
  }

  return upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, limit);
}

export function localDaysBetween(fromISO: string, toISO: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromISO) || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)) {
    return NaN;
  }
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export interface UpcomingAlertCharge extends UpcomingCharge {
  daysUntil: number;
  alreadyGenerated: boolean;
}

export function getUpcomingChargesWithinDays(
  recurringList: RecurringExpense[],
  todayISO: string,
  maxDays = 3,
  transactions: Transaction[] = []
): UpcomingAlertCharge[] {
  const currentMonth = todayISO.slice(0, 7);
  const nextMonth = shiftMonthKey(currentMonth, 1);
  const existingKeys = new Set(
    transactions
      .filter((t) => !t.isPrivate && Boolean(t.recurringId))
      .map((t) => `${t.monthKey}::${t.recurringId}`)
  );

  const alerts: UpcomingAlertCharge[] = [];
  for (const rec of recurringList) {
    if (!rec.active || (Number(rec.amount) || 0) <= 0) continue;
    const candidates = [currentMonth, nextMonth];
    for (const targetMonth of candidates) {
      if (!isRecurringDueInMonth(rec, targetMonth)) continue;
      const dueDate = getRecurringDueDateForMonth(rec, targetMonth);
      const diff = localDaysBetween(todayISO, dueDate);
      if (Number.isFinite(diff) && diff >= 0 && diff <= maxDays) {
        if (existingKeys.has(`${targetMonth}::${rec.id}`)) {
          break;
        }
        alerts.push({
          recurringId: rec.id,
          concept: rec.concept,
          category: rec.category,
          amount: rec.amount,
          dayOfMonth: rec.dayOfMonth,
          dueDate,
          frequency: rec.frequency,
          daysUntil: diff,
          alreadyGenerated: false,
        });
        break;
      }
    }
  }

  return alerts.sort((a, b) => a.daysUntil - b.daysUntil || a.dueDate.localeCompare(b.dueDate));
}

export type BudgetTrafficLight = 'sin_limite' | 'verde' | 'ambar' | 'rojo';

export interface CategoryBudgetProgress {
  category: ExpenseCategory;
  spent: number;
  limit: number;
  hasLimit?: boolean;
  pct: number;
  status: BudgetTrafficLight;
  isRecurringOnly: boolean;
}

export function computeBudgetProgress(
  transactions: Transaction[],
  budget: MonthlyBudget | null
): CategoryBudgetProgress[] {
  const spentMap = new Map<ExpenseCategory, number>();
  const hasRecurringByCat = new Set<ExpenseCategory>();
  const hasNonRecurringByCat = new Set<ExpenseCategory>();

  for (const tx of transactions) {
    if (tx.isPrivate || tx.isSettlement || tx.category === 'liquidacion') continue;
    const amt = Number(tx.amount) || 0;
    spentMap.set(tx.category, (spentMap.get(tx.category) ?? 0) + amt);
    if (amt > 0) {
      if (tx.recurringId && String(tx.recurringId).trim() !== '') {
        hasRecurringByCat.add(tx.category);
      } else {
        hasNonRecurringByCat.add(tx.category);
      }
    }
  }

  const limits = budget?.limits ?? {};
  const categories = new Set<ExpenseCategory>([
    ...(Object.keys(limits) as ExpenseCategory[]),
    ...Array.from(spentMap.keys()),
  ]);

  const result: CategoryBudgetProgress[] = [];
  for (const category of categories) {
    const spent = roundCents(spentMap.get(category) ?? 0);
    const rawLimit = Object.prototype.hasOwnProperty.call(limits, category)
      ? limits[category]
      : undefined;
    const hasLimit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit >= 0;
    const limit = hasLimit ? roundCents(rawLimit) : 0;
    if (spent === 0 && !hasLimit) continue;
    const isRecurringOnly =
      hasRecurringByCat.has(category) && !hasNonRecurringByCat.has(category);
    let status: BudgetTrafficLight = 'sin_limite';
    let pct = 0;
    if (hasLimit) {
      if (limit === 0) {
        if (spent > 0) {
          status = 'rojo';
          pct = 100;
        } else {
          status = 'verde';
          pct = 0;
        }
      } else {
        pct = Math.round((spent / limit) * 100);
        if (spent > limit) status = 'rojo';
        else if (isRecurringOnly) status = 'verde';
        else if (pct < 80) status = 'verde';
        else status = 'ambar';
      }
    }
    result.push({ category, spent, limit, hasLimit, pct, status, isRecurringOnly });
  }

  return result.sort((a, b) => b.spent - a.spent);
}

export interface BudgetThresholdAlert {
  category: ExpenseCategory;
  spent: number;
  limit: number;
  pct: number;
  atLimit: boolean;
  exceeded: boolean;
  overAmount: number;
}

export function getBudgetThresholdAlerts(
  transactions: Transaction[],
  budget: MonthlyBudget | null,
  thresholdPct = 80
): BudgetThresholdAlert[] {
  const progress = computeBudgetProgress(transactions, budget);
  return progress
    .filter((bp) => {
      const hasLimit = bp.hasLimit ?? bp.limit > 0;
      if (!hasLimit) return false;
      if (bp.limit === 0) {
        return bp.spent > 0;
      }
      const ratioPct = (bp.spent / bp.limit) * 100;
      if (ratioPct < thresholdPct) return false;
      if (bp.isRecurringOnly && bp.spent <= bp.limit) {
        return false;
      }
      return true;
    })
    .map((bp) => {
      const exceeded = bp.spent > bp.limit;
      const atLimit = bp.limit > 0 && !exceeded && Math.abs(bp.spent - bp.limit) < 0.005;
      const overAmount = exceeded ? roundCents(bp.spent - bp.limit) : 0;
      return {
        category: bp.category,
        spent: bp.spent,
        limit: bp.limit,
        pct: bp.limit > 0 ? Math.round((bp.spent / bp.limit) * 100) : 100,
        atLimit,
        exceeded,
        overAmount,
      };
    })
    .sort((a, b) => {
      const ratioA = a.limit > 0 ? a.spent / a.limit : Number.POSITIVE_INFINITY;
      const ratioB = b.limit > 0 ? b.spent / b.limit : Number.POSITIVE_INFINITY;
      return ratioB - ratioA || b.overAmount - a.overAmount;
    });
}

// ─── Global Transaction Search & 6-Month Category Comparison ─────────────────

function normalizeSearchText(val: string): string {
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export interface GlobalSearchCriteria {
  text: string;
  amountQuery: string;
  category: TransactionCategory | 'todas';
}

export function filterGlobalTransactions(
  transactions: Transaction[],
  criteria: GlobalSearchCriteria,
  categoryLabels: Record<string, string> = TRANSACTION_CATEGORY_LABELS
): Transaction[] {
  const qText = normalizeSearchText(criteria.text);
  const qAmtRaw = criteria.amountQuery.trim().replace(/\s+/g, '').replace('€', '');
  const qAmtNormalized = qAmtRaw.replace(',', '.');
  const qAmtNumeric = qAmtNormalized !== '' ? Number(qAmtNormalized) : NaN;
  const hasNumericAmt = qAmtNormalized !== '' && Number.isFinite(qAmtNumeric);

  return [...transactions]
    .filter((tx) => {
      if (criteria.category !== 'todas' && tx.category !== criteria.category) return false;
      if (qText) {
        const catLabel = categoryLabels[tx.category] || TRANSACTION_CATEGORY_LABELS[tx.category] || tx.category;
        const hay = normalizeSearchText(`${tx.concept} ${tx.notes} ${catLabel}`);
        if (!hay.includes(qText)) return false;
      }
      if (qAmtRaw) {
        const amtFixedDot = tx.amount.toFixed(2);
        const amtFixedComma = amtFixedDot.replace('.', ',');
        const amtRawStr = String(tx.amount);
        const exactMatch = hasNumericAmt && Math.abs(tx.amount - qAmtNumeric) < 0.005;
        const partialMatch =
          amtFixedComma.includes(qAmtRaw.replace('.', ',')) ||
          amtFixedDot.includes(qAmtNormalized) ||
          amtRawStr.includes(qAmtNormalized);
        if (!exactMatch && !partialMatch) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type ComparisonDirection = 'up' | 'down' | 'flat';

export interface CategoryComparisonRow {
  category: ExpenseCategory;
  current: number;
  prev: number;
  avg6: number;
  vsPrevPct: number | null;
  vsPrevDir: ComparisonDirection;
  vsAvg6Pct: number | null;
  vsAvg6Dir: ComparisonDirection;
}

export interface CategoryComparisonResult {
  activePriorMonths: number;
  rows: CategoryComparisonRow[];
}

function calcDelta(
  current: number,
  baseline: number
): { pct: number | null; dir: ComparisonDirection } {
  const diff = roundCents(current - baseline);
  if (Math.abs(diff) < 0.01) {
    return { pct: 0, dir: 'flat' };
  }
  const dir: ComparisonDirection = diff > 0 ? 'up' : 'down';
  if (baseline <= 0) {
    return { pct: null, dir };
  }
  const pct = Math.round(((current - baseline) / baseline) * 1000) / 10;
  return { pct, dir };
}

export function computeCategoryComparison(
  transactions: Transaction[],
  targetMonthKey: string
): CategoryComparisonResult {
  const prevMonthKey = shiftMonthKey(targetMonthKey, -1);
  const prior6Keys = new Set<string>();
  for (let i = 1; i <= 6; i++) {
    prior6Keys.add(shiftMonthKey(targetMonthKey, -i));
  }

  const currentMap = new Map<ExpenseCategory, number>();
  const prevMap = new Map<ExpenseCategory, number>();
  const prior6SumMap = new Map<ExpenseCategory, number>();
  const activeMonthsSet = new Set<string>();

  for (const tx of transactions) {
    if (tx.isPrivate || tx.isSettlement || tx.category === 'liquidacion') continue;
    const amt = Math.max(0, Number(tx.amount) || 0);
    const cat = tx.category;
    if (tx.monthKey === targetMonthKey) {
      currentMap.set(cat, (currentMap.get(cat) ?? 0) + amt);
    }
    if (tx.monthKey === prevMonthKey) {
      prevMap.set(cat, (prevMap.get(cat) ?? 0) + amt);
    }
    if (prior6Keys.has(tx.monthKey)) {
      prior6SumMap.set(cat, (prior6SumMap.get(cat) ?? 0) + amt);
      if (amt > 0) activeMonthsSet.add(tx.monthKey);
    }
  }

  const activePriorMonths = activeMonthsSet.size;
  const allCats = new Set<ExpenseCategory>([
    ...currentMap.keys(),
    ...prevMap.keys(),
    ...prior6SumMap.keys(),
  ]);

  const rows: CategoryComparisonRow[] = [];
  for (const category of allCats) {
    const current = roundCents(currentMap.get(category) ?? 0);
    const prev = roundCents(prevMap.get(category) ?? 0);
    const sum6 = prior6SumMap.get(category) ?? 0;
    const avg6 = activePriorMonths > 0 ? roundCents(sum6 / activePriorMonths) : 0;

    if (current === 0 && prev === 0 && avg6 === 0) continue;

    const vsPrev = calcDelta(current, prev);
    const vsAvg6 = activePriorMonths > 0 ? calcDelta(current, avg6) : { pct: null, dir: current > 0 ? ('up' as const) : ('flat' as const) };

    rows.push({
      category,
      current,
      prev,
      avg6,
      vsPrevPct: vsPrev.pct,
      vsPrevDir: vsPrev.dir,
      vsAvg6Pct: vsAvg6.pct,
      vsAvg6Dir: vsAvg6.dir,
    });
  }

  rows.sort((a, b) => b.current - a.current || b.avg6 - a.avg6);
  return { activePriorMonths, rows };
}

// ─── Mudanza Summaries ───────────────────────────────────────────────────────

export interface InitialCostsSummary {
  totalPlanned: number;
  totalPaid: number;
  totalPending: number;
  shareA: number;
  shareB: number;
  paidA: number;
  paidB: number;
  paidComun: number;
}

export function computeInitialCostsSummary(
  costs: InitialCost[],
  splitPctA: number,
  uidA: string,
  uidB: string
): InitialCostsSummary {
  let totalPlanned = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let paidA = 0;
  let paidB = 0;
  let paidComun = 0;

  for (const c of costs) {
    const amt = Math.max(0, Number(c.amount) || 0);
    totalPlanned += amt;
    if (c.status === 'pagado') {
      totalPaid += amt;
      if (c.paidBy === uidA) paidA += amt;
      else if (c.paidBy === uidB) paidB += amt;
      else paidComun += amt;
    } else {
      totalPending += amt;
    }
  }

  const pctA = clampSplitPct(splitPctA, 50) / 100;
  const shareA = roundCents(totalPlanned * pctA);
  const shareB = roundCents(totalPlanned - shareA);

  return {
    totalPlanned: roundCents(totalPlanned),
    totalPaid: roundCents(totalPaid),
    totalPending: roundCents(totalPending),
    shareA,
    shareB,
    paidA: roundCents(paidA),
    paidB: roundCents(paidB),
    paidComun: roundCents(paidComun),
  };
}

export interface FurnitureSummary {
  totalAll: number;
  totalSpent: number;
  totalPending: number;
  totalCart: number;
  cartCount: number;
  boughtCount: number;
  totalCount: number;
  boughtPct: number;
}

export function computeFurnitureSummary(items: FurnitureItem[]): FurnitureSummary {
  let totalAll = 0;
  let totalSpent = 0;
  let totalPending = 0;
  let totalCart = 0;
  let cartCount = 0;
  let boughtCount = 0;

  for (const item of items) {
    const lineTotal = Math.max(0, Number(item.unitPrice) || 0) * Math.max(1, Number(item.qty) || 1);
    if (item.status === 'ya_lo_tenemos') {
      boughtCount += 1;
      continue;
    }
    totalAll += lineTotal;
    if (item.status === 'comprado') {
      totalSpent += lineTotal;
      boughtCount += 1;
    } else if (item.status === 'en_carrito') {
      totalCart += lineTotal;
      totalPending += lineTotal;
      cartCount += 1;
    } else {
      totalPending += lineTotal;
    }
  }

  const totalCount = items.length;
  const boughtPct = totalCount > 0 ? Math.round((boughtCount / totalCount) * 100) : 0;

  return {
    totalAll: roundCents(totalAll),
    totalSpent: roundCents(totalSpent),
    totalPending: roundCents(totalPending),
    totalCart: roundCents(totalCart),
    cartCount,
    boughtCount,
    totalCount,
    boughtPct,
  };
}

export function buildIkeaSearchUrl(name: string): string {
  return `https://www.ikea.com/es/es/search/?q=${encodeURIComponent(name.trim())}`;
}

// ─── Savings Goals & Emergency Cushion ───────────────────────────────────────

export interface GoalProgress {
  goal: SavingsGoal;
  savedAmount: number;
  pct: number;
  remaining: number;
  monthlyNeeded: number | null;
  monthsLeft: number | null;
  isCompleted: boolean;
}

export function computeGoalProgress(
  goal: SavingsGoal,
  movements: GoalMovement[],
  todayISO: string
): GoalProgress {
  const savedRaw = movements
    .filter((m) => m.goalId === goal.id)
    .reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
  const savedAmount = roundCents(Math.max(0, savedRaw));
  const target = Math.max(0, Number(goal.targetAmount) || 0);
  const pct = target > 0 ? Math.min(100, Math.round((savedAmount / target) * 1000) / 10) : 0;
  const remaining = roundCents(Math.max(0, target - savedAmount));
  const isCompleted = target > 0 && savedAmount >= target;

  let monthlyNeeded: number | null = null;
  let monthsLeft: number | null = null;
  if (goal.targetDate && remaining > 0) {
    monthsLeft = monthsUntilLocal(todayISO, goal.targetDate);
    monthlyNeeded = roundCents(remaining / monthsLeft);
  }

  return {
    goal,
    savedAmount,
    pct,
    remaining,
    monthlyNeeded,
    monthsLeft,
    isCompleted,
  };
}

export function computeEmergencyTarget(
  recurringList: RecurringExpense[],
  months: 3 | 6
): number {
  const fixedMonthly = recurringList
    .filter((r) => r.active && (Number(r.amount) || 0) > 0)
    .reduce((acc, r) => acc + monthlyEquivalent(r.amount, r.frequency), 0);
  return roundCents(fixedMonthly * months);
}

const VARIABLE_BUDGET_CATEGORIES: readonly ExpenseCategory[] = [
  'supermercado',
  'ocio',
  'transporte',
  'otros',
];

export interface SavingsCapacityOptions {
  transactions?: Transaction[];
  monthClosures?: MonthClosure[];
  currentMonthKey?: string;
  budget?: MonthlyBudget | null;
}

export interface SavingsCapacityResult {
  incomeA: number;
  incomeB: number;
  totalIncome: number;
  activeFixedMonthly: number;
  historyAvg3Months: number;
  historyMonthsUsed: number;
  hasHistory: boolean;
  variableBudgetsMonthly: number;
  habitualSpend: number;
  fixedMonthly: number;
  variableMonthly: number;
  capacity: number;
  hasIncomeConfigured: boolean;
}

export function computeSavingsCapacity(
  settings: HouseholdSettings,
  recurringList: RecurringExpense[],
  options?: SavingsCapacityOptions
): SavingsCapacityResult {
  const incomeA = roundCents(Math.max(0, Number(settings.incomeA) || 0));
  const incomeB = roundCents(Math.max(0, Number(settings.incomeB) || 0));
  const totalIncome = roundCents(incomeA + incomeB);
  const activeFixedMonthly = roundCents(
    recurringList
      .filter((r) => r.active && (Number(r.amount) || 0) > 0)
      .reduce((acc, r) => acc + monthlyEquivalent(r.amount, r.frequency), 0)
  );

  const refMonthKey = options?.currentMonthKey || getCurrentMonthKeyLocal();
  const closedTotals = new Map<string, number>();
  for (const closure of options?.monthClosures ?? []) {
    if (closure.monthKey) {
      closedTotals.set(closure.monthKey, roundCents(Math.max(0, Number(closure.totalSpent) || 0)));
    }
  }

  const spendByMonth = new Map<string, number>();
  for (const tx of options?.transactions ?? []) {
    if (tx.isPrivate || tx.isSettlement || tx.category === 'liquidacion') continue;
    if (!tx.monthKey) continue;
    const amt = Math.max(0, Number(tx.amount) || 0);
    spendByMonth.set(tx.monthKey, (spendByMonth.get(tx.monthKey) ?? 0) + amt);
  }

  const eligibleMonths = new Set<string>();
  for (const mk of closedTotals.keys()) {
    eligibleMonths.add(mk);
  }
  for (const [mk, total] of spendByMonth.entries()) {
    if (mk < refMonthKey && total > 0) {
      eligibleMonths.add(mk);
    }
  }

  const last3Months = Array.from(eligibleMonths)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 3);

  const hasHistory = last3Months.length > 0;
  let historyAvg3Months = 0;
  if (hasHistory) {
    const sum = last3Months.reduce((acc, mk) => {
      if (spendByMonth.has(mk)) return acc + (spendByMonth.get(mk) ?? 0);
      return acc + (closedTotals.get(mk) ?? 0);
    }, 0);
    historyAvg3Months = roundCents(sum / last3Months.length);
  }

  const limits = options?.budget?.limits ?? {};
  const activeRecurringCats = new Set(
    recurringList.filter((r) => r.active && (Number(r.amount) || 0) > 0).map((r) => r.category)
  );
  const variableCustomSum = Object.entries(limits).reduce((acc, [cat, val]) => {
    if (cat.startsWith('cat_') && !activeRecurringCats.has(cat)) {
      return acc + Math.max(0, Number(val) || 0);
    }
    return acc;
  }, 0);
  const variableBudgetsMonthly = roundCents(
    VARIABLE_BUDGET_CATEGORIES.reduce(
      (acc, cat) => acc + Math.max(0, Number(limits[cat]) || 0),
      0
    ) + variableCustomSum
  );

  let habitualSpend: number;
  let variableMonthly: number;
  if (hasHistory) {
    habitualSpend = roundCents(Math.max(activeFixedMonthly, historyAvg3Months));
    variableMonthly = roundCents(Math.max(0, habitualSpend - activeFixedMonthly));
  } else {
    variableMonthly = variableBudgetsMonthly;
    habitualSpend = roundCents(activeFixedMonthly + variableBudgetsMonthly);
  }

  const capacity = roundCents(totalIncome - habitualSpend);

  return {
    incomeA,
    incomeB,
    totalIncome,
    activeFixedMonthly,
    historyAvg3Months,
    historyMonthsUsed: last3Months.length,
    hasHistory,
    variableBudgetsMonthly,
    habitualSpend,
    fixedMonthly: activeFixedMonthly,
    variableMonthly,
    capacity,
    hasIncomeConfigured: totalIncome > 0,
  };
}

export interface SavingsMemberShare {
  uid: string;
  displayName: string;
  totalContributed: number;
  actualPct: number;
  agreedPct: number;
}

export function computeSavingsByMember(
  movements: GoalMovement[],
  memberA: HouseholdMember | undefined,
  memberB: HouseholdMember | undefined,
  agreedPctA: number
): SavingsMemberShare[] {
  const uidA = memberA?.uid ?? 'member_a';
  const uidB = memberB?.uid ?? 'member_b';
  let sumA = 0;
  let sumB = 0;
  for (const m of movements) {
    if (m.by === uidA) sumA += m.amount;
    else if (m.by === uidB) sumB += m.amount;
  }
  const cleanA = roundCents(Math.max(0, sumA));
  const cleanB = roundCents(Math.max(0, sumB));
  const total = cleanA + cleanB;

  return [
    {
      uid: uidA,
      displayName: memberA?.displayName || 'Persona A',
      totalContributed: cleanA,
      actualPct: total > 0 ? Math.round((cleanA / total) * 1000) / 10 : 0,
      agreedPct: agreedPctA,
    },
    ...(memberB
      ? [
          {
            uid: uidB,
            displayName: memberB.displayName || 'Persona B',
            totalContributed: cleanB,
            actualPct: total > 0 ? Math.round((cleanB / total) * 1000) / 10 : 0,
            agreedPct: Math.round((100 - agreedPctA) * 10) / 10,
          },
        ]
      : []),
  ];
}

export interface RecurringHistoricalAverage {
  average: number;
  sampleCount: number;
  lastDate: string;
}

/**
 * Calcula la media de las últimas N facturas compartidas registradas para una plantilla recurrente.
 * Excluye gastos privados y liquidaciones. Pensada solo para sugerencia explícita al usuario.
 */
export function computeRecurringHistoricalAverage(
  transactions: Transaction[],
  recurringId: string | null | undefined,
  count = 3
): RecurringHistoricalAverage | null {
  if (!recurringId) return null;
  const maxItems = Math.max(1, Math.floor(count));
  const deduped = new Map<string, Transaction>();
  for (const tx of transactions) {
    if (
      tx.isPrivate ||
      tx.isSettlement ||
      tx.category === 'liquidacion' ||
      tx.recurringId !== recurringId ||
      (Number(tx.amount) || 0) <= 0
    ) {
      continue;
    }
    if (!deduped.has(tx.id)) {
      deduped.set(tx.id, tx);
    }
  }
  const sorted = Array.from(deduped.values()).sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) return null;
  const slice = sorted.slice(0, maxItems);
  const total = slice.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  return {
    average: roundCents(total / slice.length),
    sampleCount: slice.length,
    lastDate: slice[0].date,
  };
}
