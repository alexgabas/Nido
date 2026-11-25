import type {
  CustomCategory,
  MonthClosure,
  MonthlyBudget,
  RecurringExpense,
  Transaction,
  UiMode,
} from '../types/nido';
import {
  planCopyPreviousMonthBudgets,
  type CopyPreviousBudgetsPlan,
} from './categories';
import {
  computeRecurringHistoricalAverage,
  roundCents,
  shiftMonthKey,
  type CoupleBalanceResult,
} from './finance';
import {
  extractExplicitBudgetLimits,
  type MonthlyPlanCategoryRow,
  type MonthlyPlanSummary,
} from './monthlyPlanning';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringDueInMonthIgnoringSkip,
  isRecurringSkippedInMonth,
} from './recurrence';

export type GuidedCloseStepId =
  | 'pendientes'
  | 'revision'
  | 'cuentas'
  | 'proximo_mes'
  | 'cerrar';

export interface GuidedCloseStepMeta {
  id: GuidedCloseStepId;
  label: string;
  shortLabel: string;
}

const ALL_STEPS: Record<GuidedCloseStepId, GuidedCloseStepMeta> = {
  pendientes: { id: 'pendientes', label: 'Pendientes del mes', shortLabel: 'Pendientes' },
  revision: { id: 'revision', label: 'Revisión presupuesto vs real', shortLabel: 'Revisión' },
  cuentas: { id: 'cuentas', label: 'Cuentas entre vosotros', shortLabel: 'Cuentas' },
  proximo_mes: { id: 'proximo_mes', label: 'Próximo mes', shortLabel: 'Próximo mes' },
  cerrar: { id: 'cerrar', label: 'Cerrar mes', shortLabel: 'Cerrar' },
};

/**
 * Devuelve los pasos del asistente de cierre según el modo de interfaz.
 * - Sencillo: Pendientes → Cuentas → Cerrar (3 pasos).
 * - Avanzado: Pendientes → Revisión → Cuentas → Próximo mes → Cerrar (5 pasos).
 */
export function computeGuidedCloseSteps(uiMode: UiMode): GuidedCloseStepMeta[] {
  const ids: GuidedCloseStepId[] =
    uiMode === 'sencillo'
      ? ['pendientes', 'cuentas', 'cerrar']
      : ['pendientes', 'revision', 'cuentas', 'proximo_mes', 'cerrar'];
  return ids.map((id) => ALL_STEPS[id]);
}

export interface GuidedClosePendingItem {
  recurring: RecurringExpense;
  dueDate: string;
  suggestedAmount: number;
  templateAmount: number;
  historicalAverage: number | null;
  historicalSampleCount: number;
}

export interface GuidedCloseSkippedItem {
  recurring: RecurringExpense;
  dueDate: string;
}

export interface GuidedClosePendingResult {
  pending: GuidedClosePendingItem[];
  skippedThisMonth: GuidedCloseSkippedItem[];
}

/**
 * Construye los cargos previstos pendientes de registrar en `monthKey` y los marcados como
 * "No se ha producido este mes", sugiriendo la media histórica de las últimas facturas si existe.
 */
export function buildGuidedClosePendingItems(params: {
  monthKey: string;
  monthTransactions: Transaction[];
  recurring: RecurringExpense[];
  historicalTransactions: Transaction[];
  averageSampleCount?: number;
}): GuidedClosePendingResult {
  const {
    monthKey,
    monthTransactions,
    recurring,
    historicalTransactions,
    averageSampleCount = 3,
  } = params;

  const registeredRecurringIds = new Set<string>();
  for (const tx of monthTransactions) {
    if (tx.monthKey !== monthKey || tx.isPrivate || tx.isSettlement) continue;
    if (tx.recurringId) registeredRecurringIds.add(tx.recurringId);
  }

  // Excluir transacciones del mes actual al calcular la media histórica de facturas previas
  const historySource = historicalTransactions.length > 0 ? historicalTransactions : monthTransactions;
  const previousBillTxs = historySource.filter((tx) => tx.monthKey < monthKey);

  const pending: GuidedClosePendingItem[] = [];
  const skippedThisMonth: GuidedCloseSkippedItem[] = [];

  for (const rec of recurring) {
    if (!rec.active) continue;
    if (registeredRecurringIds.has(rec.id)) continue;

    if (isRecurringSkippedInMonth(rec, monthKey)) {
      if (isRecurringDueInMonthIgnoringSkip(rec, monthKey)) {
        skippedThisMonth.push({
          recurring: rec,
          dueDate: getRecurringDueDateForMonth(rec, monthKey),
        });
      }
      continue;
    }

    if (!isRecurringDueInMonth(rec, monthKey)) continue;

    const hist = computeRecurringHistoricalAverage(previousBillTxs, rec.id, averageSampleCount);
    const templateAmount = roundCents(Math.max(0, Number(rec.amount) || 0));
    const suggestedAmount = hist ? hist.average : templateAmount;

    pending.push({
      recurring: rec,
      dueDate: getRecurringDueDateForMonth(rec, monthKey),
      suggestedAmount,
      templateAmount,
      historicalAverage: hist ? hist.average : null,
      historicalSampleCount: hist ? hist.sampleCount : 0,
    });
  }

  pending.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.recurring.concept.localeCompare(b.recurring.concept, 'es')
  );
  skippedThisMonth.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.recurring.concept.localeCompare(b.recurring.concept, 'es')
  );

  return { pending, skippedThisMonth };
}

export type GuidedCloseDeviationKind = 'over_budget' | 'unbudgeted' | 'under_significant' | 'on_track';

export interface GuidedCloseReviewRow {
  row: MonthlyPlanCategoryRow;
  /** Diferencia real - presupuesto (positivo = por encima del presupuesto). Null si no hay presupuesto. */
  delta: number | null;
  /** Porcentaje de desviación sobre presupuesto (ej. +25 o -30). Null si presupuesto es 0 o inexistente. */
  deltaPct: number | null;
  deviationKind: GuidedCloseDeviationKind;
  isSignificant: boolean;
}

export interface GuidedCloseReviewSummary {
  rows: GuidedCloseReviewRow[];
  significantCount: number;
  overBudgetCount: number;
  unbudgetedCount: number;
  totalBudget: number;
  totalRegistered: number;
  totalDelta: number | null;
}

const SIGNIFICANT_DEVIATION_MIN_EUR = 20;
const SIGNIFICANT_UNDER_PCT = -20;
const SIGNIFICANT_OVER_PCT = 10;

/**
 * Analiza en solo lectura las desviaciones entre presupuesto y gasto real del mes
 * reutilizando directamente `MonthlyPlanSummary`.
 */
export function computeGuidedCloseReview(summary: MonthlyPlanSummary): GuidedCloseReviewSummary {
  const rows: GuidedCloseReviewRow[] = [];

  for (const row of summary.categories) {
    // Mostrar categorías con presupuesto configurado o gasto real registrado
    if (!row.hasExplicitBudget && row.registered <= 0) continue;

    const real = roundCents(row.registered);
    const limit = row.hasExplicitBudget && row.budgetLimit !== null ? roundCents(row.budgetLimit) : null;
    const delta = limit !== null ? roundCents(real - limit) : null;
    const deltaPct =
      limit !== null && limit > 0 ? Math.round(((real - limit) / limit) * 100) : null;

    let deviationKind: GuidedCloseDeviationKind = 'on_track';
    let isSignificant = false;

    if (limit === null) {
      if (real > 0) {
        deviationKind = 'unbudgeted';
        isSignificant = real >= SIGNIFICANT_DEVIATION_MIN_EUR;
      }
    } else if (real > limit) {
      deviationKind = 'over_budget';
      isSignificant =
        delta !== null &&
        (delta >= SIGNIFICANT_DEVIATION_MIN_EUR ||
          (deltaPct !== null && deltaPct >= SIGNIFICANT_OVER_PCT) ||
          limit === 0);
    } else if (
      delta !== null &&
      delta <= -SIGNIFICANT_DEVIATION_MIN_EUR &&
      deltaPct !== null &&
      deltaPct <= SIGNIFICANT_UNDER_PCT
    ) {
      deviationKind = 'under_significant';
      isSignificant = true;
    }

    rows.push({
      row,
      delta,
      deltaPct,
      deviationKind,
      isSignificant,
    });
  }

  // Priorizar desviaciones importantes primero, luego mayor gasto real
  const priorityWeight = (kind: GuidedCloseDeviationKind): number => {
    switch (kind) {
      case 'over_budget':
        return 0;
      case 'unbudgeted':
        return 1;
      case 'under_significant':
        return 2;
      default:
        return 3;
    }
  };

  rows.sort(
    (a, b) =>
      Number(b.isSignificant) - Number(a.isSignificant) ||
      priorityWeight(a.deviationKind) - priorityWeight(b.deviationKind) ||
      b.row.registered - a.row.registered ||
      a.row.label.localeCompare(b.row.label, 'es')
  );

  const overBudgetCount = rows.filter((r) => r.deviationKind === 'over_budget').length;
  const unbudgetedCount = rows.filter((r) => r.deviationKind === 'unbudgeted').length;
  const significantCount = rows.filter((r) => r.isSignificant).length;

  return {
    rows,
    significantCount,
    overBudgetCount,
    unbudgetedCount,
    totalBudget: summary.configuredBudgetTotal,
    totalRegistered: summary.registeredTotal,
    totalDelta: summary.hasAnyBudget
      ? roundCents(summary.registeredTotal - summary.configuredBudgetTotal)
      : null,
  };
}

function toNumericLimitsRecord(budget: MonthlyBudget | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of extractExplicitBudgetLimits(budget).entries()) {
    out[k] = v;
  }
  return out;
}

/**
 * Previsualiza la copia de presupuestos del mes seleccionado hacia el mes siguiente
 * reutilizando exactamente `planCopyPreviousMonthBudgets`.
 */
export function buildNextMonthBudgetCopyPlan(params: {
  sourceBudget: MonthlyBudget | null;
  targetBudget: MonthlyBudget | null;
  customCategories: CustomCategory[];
  overwriteExisting: boolean;
}): CopyPreviousBudgetsPlan {
  return planCopyPreviousMonthBudgets({
    prevLimits: toNumericLimitsRecord(params.sourceBudget),
    currentLimits: toNumericLimitsRecord(params.targetBudget),
    customCategories: params.customCategories,
    overwriteExisting: params.overwriteExisting,
  });
}

/**
 * Deriva el paso inicial del asistente directamente del estado real de los datos
 * (sin estado paralelo persistido), permitiendo retomar a mitad de forma coherente.
 */
export function deriveGuidedCloseInitialStep(params: {
  uiMode: UiMode;
  isClosed: boolean;
  pendingCount: number;
  balance: CoupleBalanceResult;
  nextMonthHasBudgets?: boolean;
  sourceHasBudgets?: boolean;
}): GuidedCloseStepId {
  const { uiMode, isClosed, pendingCount, balance, nextMonthHasBudgets, sourceHasBudgets } = params;
  if (isClosed) return 'cerrar';
  if (pendingCount > 0) return 'pendientes';
  if (balance.owesDirection !== 'peace') return 'cuentas';
  if (uiMode === 'avanzado' && sourceHasBudgets && nextMonthHasBudgets === false) {
    return 'proximo_mes';
  }
  return 'cerrar';
}

export const PREVIOUS_MONTH_CLOSE_BANNER_MAX_DAY = 7;

export interface PreviousMonthCloseReminderResult {
  show: boolean;
  prevMonthKey: string;
}

/**
 * Determina si debe mostrarse el aviso discreto en Inicio durante los primeros días del mes
 * (días 1 a 7 en calendario local) cuando el mes anterior aún no está cerrado y tiene
 * movimientos compartidos o cargos recurrentes previstos que revisar.
 */
export function shouldShowPreviousMonthCloseReminder(params: {
  todayISO: string;
  monthClosures: MonthClosure[];
  recentTransactions: Transaction[];
  recurring: RecurringExpense[];
  maxDayOfMonth?: number;
}): PreviousMonthCloseReminderResult {
  const {
    todayISO,
    monthClosures,
    recentTransactions,
    recurring,
    maxDayOfMonth = PREVIOUS_MONTH_CLOSE_BANNER_MAX_DAY,
  } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) {
    return { show: false, prevMonthKey: '' };
  }

  const currentMonthKey = todayISO.slice(0, 7);
  const prevMonthKey = shiftMonthKey(currentMonthKey, -1);
  const dayOfMonth = Number(todayISO.slice(8, 10));

  if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > maxDayOfMonth) {
    return { show: false, prevMonthKey };
  }

  const prevAlreadyClosed = monthClosures.some((c) => c.monthKey === prevMonthKey);
  if (prevAlreadyClosed) {
    return { show: false, prevMonthKey };
  }

  const hasPrevSharedTx = recentTransactions.some(
    (tx) => tx.monthKey === prevMonthKey && !tx.isPrivate && !tx.isSettlement
  );
  const hasPrevDueRecurring = recurring.some((rec) => isRecurringDueInMonth(rec, prevMonthKey));

  return {
    show: hasPrevSharedTx || hasPrevDueRecurring,
    prevMonthKey,
  };
}
