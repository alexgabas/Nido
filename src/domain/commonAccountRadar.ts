import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type RecurringExpense,
  type Transaction,
} from '../types/nido';
import { clampSplitPct, formatLocalDateISO, getTodayLocalISO, roundCents } from './finance';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringMissingStartMonth,
  isValidMonthKey,
} from './recurrence';

export type RadarItemSource = 'future_tx' | 'planned_recurring';

export interface RadarChargeItem {
  id: string;
  date: string; // YYYY-MM-DD
  concept: string;
  category: ExpenseCategory;
  amount: number;
  source: RadarItemSource;
  splitPctA: number;
  isOverdueUnregistered: boolean;
}

export interface CommonAccountRadarResult {
  monthKey: string;
  todayISO: string;
  registeredToDateTotal: number;
  registeredToDateCount: number;
  requiredAvailableTotal: number;
  next5DaysTotal: number;
  next5DaysItems: RadarChargeItem[];
  restOfMonthTotal: number;
  restOfMonthItems: RadarChargeItem[];
  overdueUnregisteredTotal: number;
  overdueUnregisteredItems: RadarChargeItem[];
  allPendingItems: RadarChargeItem[];
  orientativeShareA: number;
  orientativeShareB: number;
  balanceStatus: 'not_provided' | 'covered' | 'shortfall';
  indicatedBalance: number | null;
  shortfallAmount: number;
  marginAmount: number;
  unanchoredCommonTemplates: RecurringExpense[];
}

export function addLocalDaysISO(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return formatLocalDateISO(dt);
}

function isCommonAccountPayer(paidBy: string): boolean {
  return paidBy === COMMON_ACCOUNT_ID || paidBy === 'comun';
}

export function computeCommonAccountRadar(
  monthKey: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  effectiveSplitPctA: number,
  options?: {
    todayISO?: string;
    currentCommonBalance?: number | null;
  }
): CommonAccountRadarResult {
  const todayISO = options?.todayISO || getTodayLocalISO();
  const emptyResult: CommonAccountRadarResult = {
    monthKey,
    todayISO,
    registeredToDateTotal: 0,
    registeredToDateCount: 0,
    requiredAvailableTotal: 0,
    next5DaysTotal: 0,
    next5DaysItems: [],
    restOfMonthTotal: 0,
    restOfMonthItems: [],
    overdueUnregisteredTotal: 0,
    overdueUnregisteredItems: [],
    allPendingItems: [],
    orientativeShareA: 0,
    orientativeShareB: 0,
    balanceStatus: 'not_provided',
    indicatedBalance: null,
    shortfallAmount: 0,
    marginAmount: 0,
    unanchoredCommonTemplates: [],
  };

  if (!isValidMonthKey(monthKey)) {
    return emptyResult;
  }

  const fiveDaysLimitISO = addLocalDaysISO(todayISO, 5);
  const monthSharedTxs = transactions.filter(
    (t) =>
      t.monthKey === monthKey &&
      !t.isPrivate &&
      !t.isSettlement &&
      t.category !== 'liquidacion'
  );

  // Any non-private tx referencing a recurringId counts as already generated for that month
  const registeredRecurringIds = new Set<string>();
  for (const tx of monthSharedTxs) {
    if (tx.recurringId) {
      registeredRecurringIds.add(tx.recurringId);
    }
  }

  let registeredToDateTotal = 0;
  let registeredToDateCount = 0;
  const pendingItems: RadarChargeItem[] = [];

  for (const tx of monthSharedTxs) {
    if (!isCommonAccountPayer(tx.paidBy)) continue;
    const amount = Math.max(0, Number(tx.amount) || 0);
    if (tx.date <= todayISO) {
      registeredToDateTotal += amount;
      registeredToDateCount += 1;
    } else {
      pendingItems.push({
        id: `tx_${tx.id}`,
        date: tx.date,
        concept: tx.concept,
        category: tx.category === 'liquidacion' ? 'otros' : tx.category,
        amount: roundCents(amount),
        source: 'future_tx',
        splitPctA: clampSplitPct(tx.splitPctA, effectiveSplitPctA),
        isOverdueUnregistered: false,
      });
    }
  }

  const unanchoredCommonTemplates: RecurringExpense[] = [];

  for (const rec of recurring) {
    if (!isCommonAccountPayer(rec.paidByDefault)) continue;
    if (isRecurringMissingStartMonth(rec)) {
      unanchoredCommonTemplates.push(rec);
    }
    if (registeredRecurringIds.has(rec.id)) continue;
    if (!isRecurringDueInMonth(rec, monthKey)) continue;
    const dueDate = getRecurringDueDateForMonth(rec, monthKey);
    const recSplitA =
      rec.splitOverride !== null && rec.splitOverride !== undefined
        ? clampSplitPct(rec.splitOverride, effectiveSplitPctA)
        : clampSplitPct(effectiveSplitPctA, 50);

    pendingItems.push({
      id: `rec_${monthKey}_${rec.id}`,
      date: dueDate,
      concept: rec.concept,
      category: rec.category,
      amount: roundCents(Math.max(0, Number(rec.amount) || 0)),
      source: 'planned_recurring',
      splitPctA: recSplitA,
      isOverdueUnregistered: dueDate < todayISO,
    });
  }

  pendingItems.sort(
    (a, b) => a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept, 'es')
  );

  const overdueUnregisteredItems: RadarChargeItem[] = [];
  const next5DaysItems: RadarChargeItem[] = [];
  const restOfMonthItems: RadarChargeItem[] = [];

  let overdueUnregisteredTotal = 0;
  let next5DaysTotal = 0;
  let restOfMonthTotal = 0;
  let orientativeShareA = 0;
  let orientativeShareB = 0;

  for (const item of pendingItems) {
    const shareA = item.amount * (item.splitPctA / 100);
    const shareB = item.amount - shareA;
    orientativeShareA += shareA;
    orientativeShareB += shareB;

    if (item.date < todayISO) {
      overdueUnregisteredItems.push(item);
      overdueUnregisteredTotal += item.amount;
    } else if (item.date <= fiveDaysLimitISO) {
      next5DaysItems.push(item);
      next5DaysTotal += item.amount;
    } else {
      restOfMonthItems.push(item);
      restOfMonthTotal += item.amount;
    }
  }

  const requiredAvailableTotal = roundCents(
    overdueUnregisteredTotal + next5DaysTotal + restOfMonthTotal
  );

  const rawBalance = options?.currentCommonBalance;
  const indicatedBalance =
    rawBalance !== null &&
    rawBalance !== undefined &&
    Number.isFinite(rawBalance) &&
    rawBalance >= 0
      ? roundCents(rawBalance)
      : null;

  let balanceStatus: CommonAccountRadarResult['balanceStatus'] = 'not_provided';
  let shortfallAmount = 0;
  let marginAmount = 0;

  if (indicatedBalance !== null) {
    const delta = roundCents(indicatedBalance - requiredAvailableTotal);
    if (delta < 0) {
      balanceStatus = 'shortfall';
      shortfallAmount = roundCents(Math.abs(delta));
    } else {
      balanceStatus = 'covered';
      marginAmount = delta;
    }
  }

  return {
    monthKey,
    todayISO,
    registeredToDateTotal: roundCents(registeredToDateTotal),
    registeredToDateCount,
    requiredAvailableTotal,
    next5DaysTotal: roundCents(next5DaysTotal),
    next5DaysItems,
    restOfMonthTotal: roundCents(restOfMonthTotal),
    restOfMonthItems,
    overdueUnregisteredTotal: roundCents(overdueUnregisteredTotal),
    overdueUnregisteredItems,
    allPendingItems: pendingItems,
    orientativeShareA: roundCents(orientativeShareA),
    orientativeShareB: roundCents(orientativeShareB),
    balanceStatus,
    indicatedBalance,
    shortfallAmount,
    marginAmount,
    unanchoredCommonTemplates,
  };
}
