import type {
  CommonAccountManualBalance,
  ExpenseCategory,
  MonthlyBudget,
  RecurringExpense,
  Transaction,
} from '../types/nido';
import {
  buildCategoryRegistry,
  isValidSelectorCategoryId,
  type CategoryRegistry,
} from './categories';
import { roundCents } from './finance';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringMissingStartMonth,
} from './recurrence';

export const MAX_PLANNED_COMMON_CATEGORIES = 60;

export type MonthlyBudgetCoverage = 'none' | 'partial' | 'complete';

export type MonthlyCategoryBudgetStatus = 'none' | 'zero_ok' | 'under' | 'over';

export interface MonthlyPendingRecurringItem {
  recurringId: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  paidByDefault: string;
  splitOverride: number | null;
}

export interface MonthlyPlanCategoryRow {
  categoryId: ExpenseCategory;
  label: string;
  color: string;
  isCustom: boolean;
  isArchived: boolean;
  isLegacyUnknown: boolean;
  registered: number;
  registeredCount: number;
  pendingPlanned: number;
  pendingItems: MonthlyPendingRecurringItem[];
  committed: number; // registered + pendingPlanned
  hasExplicitBudget: boolean;
  budgetLimit: number | null; // 0 es un límite explícito válido
  unconsumedBudgetMargin: number; // max(0, budgetLimit - committed) si hay presupuesto
  estimatedClose: number; // max(budgetLimit, committed) si hay presupuesto, si no committed
  budgetStatus: MonthlyCategoryBudgetStatus;
}

export interface MonthlyPlanSummary {
  monthKey: string;
  /** Suma de límites explícitamente configurados para este mes (puede ser 0 si solo hay límites de 0 €). */
  configuredBudgetTotal: number;
  /** True si hay al menos una categoría con presupuesto explícito configurado (incluido 0 €). */
  hasAnyBudget: boolean;
  /** 'none' sin límites, 'partial' si hay actividad/previsiones en categorías sin límite, 'complete' si todo tiene límite. */
  budgetCoverage: MonthlyBudgetCoverage;
  /** Total de gastos compartidos registrados en el mes (excluye privados y liquidaciones). */
  registeredTotal: number;
  registeredCount: number;
  /** Cargos previstos pendientes de registrar de plantillas activas que vencen en el mes sin movimiento vinculado. */
  pendingPlannedTotal: number;
  pendingPlannedItems: MonthlyPendingRecurringItem[];
  /** Margen presupuestado aún no consumido (ni registrado ni comprometido en plantillas pendientes). */
  unconsumedBudgetMarginTotal: number;
  /** Estimación de cierre = registeredTotal + pendingPlannedTotal + unconsumedBudgetMarginTotal. */
  estimatedCloseTotal: number;
  /** Filas desglosadas por categoría con presupuesto, gasto registrado o cargo previsto. */
  categories: MonthlyPlanCategoryRow[];
  /** Categorías con gasto registrado o cargo previsto pero sin presupuesto explícito en este mes. */
  unbudgetedActivityCategories: MonthlyPlanCategoryRow[];
  /** Plantillas activas no mensuales que no tienen startMonth válido y no se pueden proyectar con seguridad. */
  unanchoredRecurringTemplates: RecurringExpense[];
  /** Número de categorías archivadas que siguen teniendo actividad o previsión en este mes. */
  archivedWithActivityCount: number;
}

/**
 * Comprueba si un string es una fecha calendario válida YYYY-MM-DD (sin desbordes como 2026-02-31).
 */
export function isValidLocalDateISO(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * Sanitiza la lista de categorías variables planificadas para financiarse desde la Cuenta común.
 */
export function sanitizePlannedCommonCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || clean === 'liquidacion') continue;
    if (!isValidSelectorCategoryId(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= MAX_PLANNED_COMMON_CATEGORIES) break;
  }
  return out;
}

/**
 * Sanitiza un saldo manual disponible de Cuenta común. Devuelve null si no es válido o está ausente.
 */
export function sanitizeCommonAccountManualBalance(
  raw: unknown
): CommonAccountManualBalance | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const amountNum = Number(obj.amount);
  if (!Number.isFinite(amountNum) || amountNum < 0) return null;
  if (!isValidLocalDateISO(obj.referenceDate)) return null;
  const updatedBy =
    typeof obj.updatedBy === 'string' && obj.updatedBy.trim().length > 0
      ? obj.updatedBy.trim().slice(0, 128)
      : '';
  const updatedAt =
    typeof obj.updatedAt === 'string' && obj.updatedAt.trim().length > 0
      ? obj.updatedAt.trim().slice(0, 64)
      : '';
  if (!updatedBy || !updatedAt) return null;
  return {
    amount: roundCents(amountNum),
    referenceDate: obj.referenceDate,
    updatedBy,
    updatedAt,
  };
}

/**
 * Extrae el mapa de límites explícitos del presupuesto del mes.
 * Respeta 0 como presupuesto explícito válido (distinto de "sin presupuesto").
 */
export function extractExplicitBudgetLimits(budget: MonthlyBudget | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  const rawLimits = budget?.limits;
  if (!rawLimits || typeof rawLimits !== 'object') return map;
  for (const [catId, rawVal] of Object.entries(rawLimits)) {
    if (!Object.prototype.hasOwnProperty.call(rawLimits, catId)) continue;
    if (catId === 'liquidacion') continue;
    if (typeof rawVal === 'number' && Number.isFinite(rawVal) && rawVal >= 0) {
      map.set(catId, roundCents(rawVal));
    }
  }
  return map;
}

/**
 * Calcula un resumen mensual único y coherente (usado tanto en modo Sencillo como Avanzado)
 * evitando doble conteo entre presupuesto, plantillas recurrentes y movimientos ya registrados.
 *
 * Fórmula por categoría c:
 *   committed(c) = registered(c) + pendingPlanned(c)
 *   si tiene presupuesto explícito B(c) (incluido 0 €):
 *     unconsumedBudgetMargin(c) = max(0, B(c) - committed(c))
 *     estimatedClose(c) = max(B(c), committed(c)) = registered(c) + pendingPlanned(c) + unconsumedBudgetMargin(c)
 *   si NO tiene presupuesto explícito:
 *     unconsumedBudgetMargin(c) = 0
 *     estimatedClose(c) = committed(c)
 */
export function computeMonthlyPlanSummary(params: {
  monthKey: string;
  transactions: Transaction[];
  recurring: RecurringExpense[];
  budget: MonthlyBudget | null | undefined;
  categoryRegistry?: CategoryRegistry;
}): MonthlyPlanSummary {
  const { monthKey, transactions, recurring, budget } = params;
  const registry = params.categoryRegistry ?? buildCategoryRegistry();

  // 1. Gastos compartidos registrados del mes (excluye privados y liquidaciones)
  const sharedMonthTxs = transactions.filter(
    (t) =>
      t.monthKey === monthKey &&
      !t.isPrivate &&
      !t.isSettlement &&
      t.category !== 'liquidacion'
  );

  // 2. Plantillas ya materializadas este mes (por recurringId) -> no se vuelven a contar como previstas
  const linkedRecurringIds = new Set<string>();
  for (const tx of sharedMonthTxs) {
    if (tx.recurringId) linkedRecurringIds.add(tx.recurringId);
  }

  // 3. Plantillas activas pendientes de registrar en este mes + plantillas no mensuales sin startMonth
  const unanchoredRecurringTemplates: RecurringExpense[] = [];
  const pendingPlannedItems: MonthlyPendingRecurringItem[] = [];

  for (const rec of recurring) {
    if (!rec.active) continue;
    if (isRecurringMissingStartMonth(rec)) {
      unanchoredRecurringTemplates.push(rec);
      continue;
    }
    if (linkedRecurringIds.has(rec.id)) continue;
    if (!isRecurringDueInMonth(rec, monthKey)) continue;
    pendingPlannedItems.push({
      recurringId: rec.id,
      concept: rec.concept,
      category: rec.category,
      amount: roundCents(Math.max(0, Number(rec.amount) || 0)),
      dueDate: getRecurringDueDateForMonth(rec, monthKey),
      paidByDefault: rec.paidByDefault,
      splitOverride: rec.splitOverride ?? null,
    });
  }

  pendingPlannedItems.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.concept.localeCompare(b.concept, 'es')
  );

  // 4. Agrupación por categoría (incluyendo personalizadas y archivadas si tienen actividad/previsión)
  const explicitLimits = extractExplicitBudgetLimits(budget);
  const regByCat = new Map<string, { totalCents: number; count: number }>();
  for (const tx of sharedMonthTxs) {
    const prev = regByCat.get(tx.category) ?? { totalCents: 0, count: 0 };
    prev.totalCents += Math.round(roundCents(tx.amount) * 100);
    prev.count += 1;
    regByCat.set(tx.category, prev);
  }

  const pendingByCat = new Map<string, { totalCents: number; items: MonthlyPendingRecurringItem[] }>();
  for (const item of pendingPlannedItems) {
    const prev = pendingByCat.get(item.category) ?? { totalCents: 0, items: [] };
    prev.totalCents += Math.round(item.amount * 100);
    prev.items.push(item);
    pendingByCat.set(item.category, prev);
  }

  const allCategoryIds = new Set<string>();
  for (const catId of explicitLimits.keys()) allCategoryIds.add(catId);
  for (const catId of regByCat.keys()) allCategoryIds.add(catId);
  for (const catId of pendingByCat.keys()) allCategoryIds.add(catId);

  const categories: MonthlyPlanCategoryRow[] = [];
  let registeredTotalCents = 0;
  let pendingTotalCents = 0;
  let unconsumedMarginTotalCents = 0;
  let configuredBudgetTotalCents = 0;

  for (const catId of allCategoryIds) {
    const resolved = registry.getMeta(catId);
    const regEntry = regByCat.get(catId);
    const pendEntry = pendingByCat.get(catId);

    const registeredCents = regEntry?.totalCents ?? 0;
    const registeredCount = regEntry?.count ?? 0;
    const pendingCents = pendEntry?.totalCents ?? 0;
    const pendingItems = pendEntry?.items ?? [];
    const committedCents = registeredCents + pendingCents;

    const hasExplicitBudget = explicitLimits.has(catId);
    const budgetLimit = hasExplicitBudget ? explicitLimits.get(catId)! : null;
    const budgetCents = budgetLimit !== null ? Math.round(budgetLimit * 100) : 0;

    const unconsumedMarginCents = hasExplicitBudget
      ? Math.max(0, budgetCents - committedCents)
      : 0;
    const estimatedCloseCents = hasExplicitBudget
      ? Math.max(budgetCents, committedCents)
      : committedCents;

    let budgetStatus: MonthlyCategoryBudgetStatus = 'none';
    if (hasExplicitBudget) {
      if (budgetCents === 0 && committedCents === 0) {
        budgetStatus = 'zero_ok';
      } else if (committedCents > budgetCents) {
        budgetStatus = 'over';
      } else {
        budgetStatus = 'under';
      }
    }

    registeredTotalCents += registeredCents;
    pendingTotalCents += pendingCents;
    unconsumedMarginTotalCents += unconsumedMarginCents;
    if (hasExplicitBudget) configuredBudgetTotalCents += budgetCents;

    categories.push({
      categoryId: catId,
      label: resolved.label,
      color: resolved.color,
      isCustom: !resolved.isSystem,
      isArchived: resolved.archived,
      isLegacyUnknown: resolved.isUnknown,
      registered: registeredCents / 100,
      registeredCount,
      pendingPlanned: pendingCents / 100,
      pendingItems,
      committed: committedCents / 100,
      hasExplicitBudget,
      budgetLimit,
      unconsumedBudgetMargin: unconsumedMarginCents / 100,
      estimatedClose: estimatedCloseCents / 100,
      budgetStatus,
    });
  }

  // Ordenar de mayor estimación a menor, y luego alfabético en español
  categories.sort(
    (a, b) =>
      b.estimatedClose - a.estimatedClose ||
      b.committed - a.committed ||
      a.label.localeCompare(b.label, 'es')
  );

  const hasAnyBudget = explicitLimits.size > 0;
  const unbudgetedActivityCategories = categories.filter(
    (row) => !row.hasExplicitBudget && (row.registered > 0 || row.pendingPlanned > 0)
  );
  const budgetCoverage: MonthlyBudgetCoverage = !hasAnyBudget
    ? 'none'
    : unbudgetedActivityCategories.length > 0
      ? 'partial'
      : 'complete';

  const archivedWithActivityCount = categories.filter(
    (row) => row.isArchived && (row.registered > 0 || row.pendingPlanned > 0)
  ).length;

  const estimatedCloseTotalCents =
    registeredTotalCents + pendingTotalCents + unconsumedMarginTotalCents;

  return {
    monthKey,
    configuredBudgetTotal: configuredBudgetTotalCents / 100,
    hasAnyBudget,
    budgetCoverage,
    registeredTotal: registeredTotalCents / 100,
    registeredCount: sharedMonthTxs.length,
    pendingPlannedTotal: pendingTotalCents / 100,
    pendingPlannedItems,
    unconsumedBudgetMarginTotal: unconsumedMarginTotalCents / 100,
    estimatedCloseTotal: estimatedCloseTotalCents / 100,
    categories,
    unbudgetedActivityCategories,
    unanchoredRecurringTemplates,
    archivedWithActivityCount,
  };
}
