import {
  COMMON_ACCOUNT_ID,
  type InitialCost,
  type Transaction,
} from '../types/nido';
import {
  INITIAL_COST_CATEGORY_LABELS,
  TRANSACTION_CATEGORY_LABELS,
} from './presets';
import { roundCents } from './finance';

export type GlobalSearchOrigin = 'todos' | 'mensual' | 'mudanza';

export type GlobalSearchRecord =
  | { kind: 'mensual'; sortDate: string; tx: Transaction }
  | { kind: 'mudanza'; sortDate: string; cost: InitialCost };

export interface ExtendedGlobalSearchCriteria {
  origin: GlobalSearchOrigin;
  payer: string; // 'todos' | COMMON_ACCOUNT_ID | memberUid
  text: string;
  amountQuery: string;
  category: string; // 'todas' | categoryId | 'liquidacion'
}

export interface ExtendedGlobalSearchSummary {
  items: GlobalSearchRecord[];
  monthlyCount: number;
  monthlyExpenseTotal: number;
  movingCount: number;
  movingTotal: number;
  movingPaidTotal: number;
  movingPendingTotal: number;
}

export interface GlobalSearchCacheEntry {
  householdId: string;
  viewerUid: string;
  transactions: Transaction[];
  initialCosts: InitialCost[];
  loadedAt: string;
}

export interface ScopedGlobalSearchCache {
  get: (householdId: string, viewerUid: string) => GlobalSearchCacheEntry | null;
  set: (
    householdId: string,
    viewerUid: string,
    data: { transactions: Transaction[]; initialCosts: InitialCost[] }
  ) => GlobalSearchCacheEntry;
  invalidateScope: (householdId: string, viewerUid: string) => void;
  invalidateHousehold: (householdId: string) => void;
  clearAll: () => void;
  size: () => number;
}

export function buildGlobalSearchCacheScopeKey(householdId: string, viewerUid: string): string {
  return `${householdId}::${viewerUid}`;
}

export function createScopedGlobalSearchCache(): ScopedGlobalSearchCache {
  const store = new Map<string, GlobalSearchCacheEntry>();

  return {
    get(householdId: string, viewerUid: string): GlobalSearchCacheEntry | null {
      if (!householdId || !viewerUid) return null;
      return store.get(buildGlobalSearchCacheScopeKey(householdId, viewerUid)) ?? null;
    },
    set(
      householdId: string,
      viewerUid: string,
      data: { transactions: Transaction[]; initialCosts: InitialCost[] }
    ): GlobalSearchCacheEntry {
      const entry: GlobalSearchCacheEntry = {
        householdId,
        viewerUid,
        transactions: [...data.transactions],
        initialCosts: [...data.initialCosts],
        loadedAt: new Date().toISOString(),
      };
      if (householdId && viewerUid) {
        store.set(buildGlobalSearchCacheScopeKey(householdId, viewerUid), entry);
      }
      return entry;
    },
    invalidateScope(householdId: string, viewerUid: string): void {
      if (!householdId || !viewerUid) return;
      store.delete(buildGlobalSearchCacheScopeKey(householdId, viewerUid));
    },
    invalidateHousehold(householdId: string): void {
      if (!householdId) return;
      const prefix = `${householdId}::`;
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) {
          store.delete(key);
        }
      }
    },
    clearAll(): void {
      store.clear();
    },
    size(): number {
      return store.size;
    },
  };
}

export const globalSearchSessionCache = createScopedGlobalSearchCache();

export function normalizeGlobalPayerId(paidBy: string | undefined | null): string {
  const clean = String(paidBy ?? '').trim();
  if (!clean || clean === 'comun') return COMMON_ACCOUNT_ID;
  return clean;
}

function normalizeSearchStr(val: string): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesAmountQuery(amount: number, qAmtRaw: string, qAmtNormalized: string, qAmtNumeric: number, hasNumericAmt: boolean): boolean {
  if (!qAmtRaw) return true;
  const amtFixedDot = amount.toFixed(2);
  const amtFixedComma = amtFixedDot.replace('.', ',');
  const amtRawStr = String(amount);
  const exactMatch = hasNumericAmt && Math.abs(amount - qAmtNumeric) < 0.005;
  const partialMatch =
    amtFixedComma.includes(qAmtRaw.replace('.', ',')) ||
    amtFixedDot.includes(qAmtNormalized) ||
    amtRawStr.includes(qAmtNormalized);
  return exactMatch || partialMatch;
}

export function filterGlobalExpenses(
  transactions: readonly Transaction[],
  initialCosts: readonly InitialCost[],
  criteria: ExtendedGlobalSearchCriteria,
  options?: {
    viewerUid?: string;
    expenseCategoryLabels?: Record<string, string>;
    initialCostCategoryLabels?: Record<string, string>;
  }
): ExtendedGlobalSearchSummary {
  const qText = normalizeSearchStr(criteria.text);
  const qAmtRaw = criteria.amountQuery.trim().replace(/\s+/g, '').replace('€', '');
  const qAmtNormalized = qAmtRaw.replace(',', '.');
  const qAmtNumeric = qAmtNormalized !== '' ? Number(qAmtNormalized) : NaN;
  const hasNumericAmt = qAmtNormalized !== '' && Number.isFinite(qAmtNumeric);
  const targetPayer =
    criteria.payer && criteria.payer !== 'todos'
      ? normalizeGlobalPayerId(criteria.payer)
      : 'todos';
  const targetCategory = criteria.category || 'todas';
  const viewerUid = options?.viewerUid;
  const txCatLabels = options?.expenseCategoryLabels ?? TRANSACTION_CATEGORY_LABELS;
  const costCatLabels = options?.initialCostCategoryLabels ?? INITIAL_COST_CATEGORY_LABELS;

  const items: GlobalSearchRecord[] = [];
  let monthlyCount = 0;
  let monthlyExpenseTotal = 0;
  let movingCount = 0;
  let movingTotal = 0;
  let movingPaidTotal = 0;
  let movingPendingTotal = 0;

  if (criteria.origin === 'todos' || criteria.origin === 'mensual') {
    for (const tx of transactions) {
      // Defensa en profundidad para aislamiento de gastos privados
      if (tx.isPrivate && viewerUid && tx.createdBy !== viewerUid) continue;
      if (targetCategory !== 'todas' && tx.category !== targetCategory) continue;
      if (targetPayer !== 'todos' && normalizeGlobalPayerId(tx.paidBy) !== targetPayer) continue;
      if (!matchesAmountQuery(tx.amount, qAmtRaw, qAmtNormalized, qAmtNumeric, hasNumericAmt)) {
        continue;
      }
      if (qText) {
        const catLabel = txCatLabels[tx.category] || TRANSACTION_CATEGORY_LABELS[tx.category] || tx.category;
        const hay = normalizeSearchStr(`${tx.concept} ${tx.notes} ${catLabel}`);
        if (!hay.includes(qText)) continue;
      }

      items.push({
        kind: 'mensual',
        sortDate: tx.date || `${tx.monthKey}-01`,
        tx,
      });
      monthlyCount += 1;
      if (!tx.isSettlement) {
        monthlyExpenseTotal += Number(tx.amount) || 0;
      }
    }
  }

  if (criteria.origin === 'todos' || criteria.origin === 'mudanza') {
    for (const cost of initialCosts) {
      if (targetCategory !== 'todas' && cost.category !== targetCategory) continue;
      if (targetPayer !== 'todos' && normalizeGlobalPayerId(cost.paidBy) !== targetPayer) continue;
      if (!matchesAmountQuery(cost.amount, qAmtRaw, qAmtNormalized, qAmtNumeric, hasNumericAmt)) {
        continue;
      }
      if (qText) {
        const catLabel =
          costCatLabels[cost.category] ||
          txCatLabels[cost.category] ||
          cost.category;
        const hay = normalizeSearchStr(`${cost.concept} ${cost.notes} ${catLabel}`);
        if (!hay.includes(qText)) continue;
      }

      const sortDate = cost.dueDate || (cost.createdAt ? cost.createdAt.slice(0, 10) : '0000-00-00');
      items.push({
        kind: 'mudanza',
        sortDate,
        cost,
      });
      movingCount += 1;
      const amt = Number(cost.amount) || 0;
      movingTotal += amt;
      if (cost.status === 'pagado') {
        movingPaidTotal += amt;
      } else {
        movingPendingTotal += amt;
      }
    }
  }

  items.sort((a, b) => {
    const cmpDate = b.sortDate.localeCompare(a.sortDate);
    if (cmpDate !== 0) return cmpDate;
    const idA = a.kind === 'mensual' ? a.tx.id : a.cost.id;
    const idB = b.kind === 'mensual' ? b.tx.id : b.cost.id;
    return idB.localeCompare(idA);
  });

  return {
    items,
    monthlyCount,
    monthlyExpenseTotal: roundCents(monthlyExpenseTotal),
    movingCount,
    movingTotal: roundCents(movingTotal),
    movingPaidTotal: roundCents(movingPaidTotal),
    movingPendingTotal: roundCents(movingPendingTotal),
  };
}
