import type {
  CategoryBudgetLimit,
  ExpenseCategory,
  MonthClosure,
  MonthlyBudget,
  RecurrenceFrequency,
  RecurringExpense,
  Transaction,
} from '../types/nido';
import {
  buildCategoryRegistry,
  mergeMonthlyAndCustomBudgetLimits,
  type CategoryIconKey,
  type CategoryRegistry,
} from './categories';
import { getTodayLocalISO, roundCents } from './finance';
import { extractExplicitBudgetLimits, type MonthlyBudgetCoverage } from './monthlyPlanning';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringDueInMonthIgnoringSkip,
  isRecurringMissingStartMonth,
  isRecurringSkippedInMonth,
} from './recurrence';

export const SHORT_MONTH_LABELS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

export const LONG_MONTH_LABELS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export type AnnualMonthStatus = 'cerrado' | 'abierto' | 'sin_datos';

export interface AnnualMonthRow {
  monthIndex: number; // 1..12
  monthKey: string; // YYYY-MM
  shortLabel: string; // ene..dic
  longLabel: string; // Enero..Diciembre
  status: AnnualMonthStatus;
  isClosed: boolean;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
  /** Si entra en la media mensual habitual (mes completo con cobertura conocida; excluye mes en curso abierto y meses sin datos). */
  includedInAverage: boolean;
  /** Gasto compartido registrado en el mes (excluye privados, liquidaciones, metas y Mudanza). */
  spent: number;
  transactionCount: number;
  /** Total de límites explícitos del mes (0 € es válido si hay al menos un límite explícito). Null si no hay presupuesto. */
  budgetTotal: number | null;
  hasAnyBudget: boolean;
  budgetCoverage: MonthlyBudgetCoverage;
  /** Gasto registrado correspondiente únicamente a categorías con presupuesto explícito en este mes. */
  budgetedSpent: number;
  /** Gasto registrado en categorías sin presupuesto explícito en este mes. */
  unbudgetedSpent: number;
  /** Desviación comparable SOLO sobre la parte presupuestada (budgetedSpent - budgetTotal). Null si no hay presupuesto. */
  comparableDeviation: number | null;
  /** Porcentaje de desviación sobre la parte presupuestada. Null si no hay presupuesto o si budgetTotal === 0. */
  comparableDeviationPct: number | null;
  /** Total guardado en el snapshot de cierre (si existe) para contraste de trazabilidad. */
  closureSnapshotTotal: number | null;
  /** True si el cierre guardado tiene un total distinto al recalculado sobre movimientos actuales. */
  closureDiffersFromTransactions: boolean;
}

export interface AnnualCategoryRow {
  categoryId: ExpenseCategory;
  label: string;
  color: string;
  icon: CategoryIconKey | 'arrow-left-right';
  isCustom: boolean;
  isArchived: boolean;
  isLegacyUnknown: boolean;
  /** Gasto compartido registrado en el año en esta categoría. */
  totalSpent: number;
  /** Porcentaje sobre el gasto compartido total del año (0..100). */
  sharePct: number;
  transactionCount: number;
  monthsWithSpendCount: number;
  /** Mes de mayor gasto registrado en esta categoría dentro del año (null si totalSpent === 0). */
  peakMonthKey: string | null;
  peakMonthAmount: number;
  /** Último mes con movimiento de esta categoría en el año (útil para saltar a Mensual). */
  latestMonthKey: string | null;
  /** Número de meses del año en los que esta categoría tuvo presupuesto explícito (incluido 0 €). */
  budgetedMonthsCount: number;
  /** Suma de límites explícitos en los meses presupuestados (null si budgetedMonthsCount === 0). */
  budgetTotal: number | null;
  /** Gasto registrado SOLO en los meses donde esta categoría tenía presupuesto explícito. */
  budgetedSpent: number;
  /** Gasto registrado en meses donde esta categoría NO tenía presupuesto explícito. */
  unbudgetedSpent: number;
  budgetCoverage: MonthlyBudgetCoverage;
  /** Desviación comparable (budgetedSpent - budgetTotal). Null si sin presupuesto. */
  comparableDeviation: number | null;
  /** Porcentaje de desviación comparable. Null si sin presupuesto o budgetTotal === 0. */
  comparableDeviationPct: number | null;
  /** Comparativa interanual en el mismo tramo del año anterior (solo si hay datos suficientes en year - 1). */
  prevYearSpanSpent: number | null;
  yoyDelta: number | null;
  /** Porcentaje interanual; null si no hay comparativa o si la base del año anterior es 0 €. */
  yoyDeltaPct: number | null;
  /** Evolución intra-anual: diferencia entre el mes pico y la media del resto de meses con gasto en el año. */
  intraYearSpikeDelta: number;
}

export interface AnnualCategoryRiseHighlight {
  categoryId: ExpenseCategory;
  label: string;
  color: string;
  isArchived: boolean;
  basis: 'yoy' | 'intra_year';
  currentAmount: number;
  referenceAmount: number;
  deltaAmount: number;
  /** Null cuando la base de referencia es 0 € (nunca se calcula % sobre base 0). */
  deltaPct: number | null;
  peakMonthKey: string | null;
  peakMonthAmount: number;
}

export interface AnnualBudgetSummary {
  hasAnyBudget: boolean;
  coverage: MonthlyBudgetCoverage;
  /** Suma de todos los límites explícitos configurados en el año (puede ser 0 € si solo hay límites de 0 €). */
  configuredBudgetTotal: number;
  /** Gasto compartido registrado que corresponde a pares (mes, categoría) con presupuesto explícito. */
  budgetedSpentTotal: number;
  /** Gasto compartido registrado en pares (mes, categoría) sin presupuesto explícito. */
  unbudgetedSpentTotal: number;
  /** Desviación únicamente sobre la parte con presupuesto (budgetedSpentTotal - configuredBudgetTotal). */
  comparableDeviation: number | null;
  /** Porcentaje de desviación sobre la parte con presupuesto. Null si sin presupuesto o si configuredBudgetTotal === 0. */
  comparableDeviationPct: number | null;
  monthsWithBudgetCount: number;
  monthsWithCompleteBudgetCount: number;
  monthsWithPartialBudgetCount: number;
}

export interface AnnualYoYComparison {
  prevYear: number;
  /** Mes final incluido en el tramo comparado (1..12). */
  spanEndMonth: number;
  spanLabel: string; // ej. "ene–nov" o "año completo"
  isIncompletePeriod: boolean;
  incompleteReason: string | null;
  hasSufficientData: boolean;
  currentSpanSpent: number;
  prevSpanSpent: number;
  currentSpanCoveredMonths: number;
  prevSpanCoveredMonths: number;
  deltaAmount: number;
  /** Null cuando prevSpanSpent === 0 (nunca se calcula porcentaje sobre base 0 €). */
  deltaPct: number | null;
}

export type NonMonthlyReceiptStatus = 'previsto' | 'registrado';

export interface AnnualNonMonthlyReceipt {
  id: string; // `${recurringId}_${monthKey}`
  recurringId: string;
  concept: string;
  category: ExpenseCategory;
  frequency: Exclude<RecurrenceFrequency, 'mensual'>;
  monthKey: string;
  dueDate: string; // YYYY-MM-DD (fecha real si registrado, fecha vencimiento si previsto)
  amount: number; // importe real si registrado, importe orientativo de plantilla si previsto
  templateAmount: number;
  paidBy: string; // pagador real si registrado, pagador previsto si previsto
  status: NonMonthlyReceiptStatus;
  isPastDue: boolean; // solo true si status === 'previsto' y dueDate < todayISO
  transactionId: string | null;
}

export interface AnnualNonMonthlySummary {
  /** Todos los recibos no mensuales del año seleccionado (previstos + registrados, sin duplicar vinculados). */
  occurrences: AnnualNonMonthlyReceipt[];
  /** Solo los pendientes de registrar del año seleccionado (orden cronológico). */
  plannedOccurrences: AnnualNonMonthlyReceipt[];
  /** Solo los ya vinculados a un gasto registrado del año seleccionado. */
  registeredOccurrences: AnnualNonMonthlyReceipt[];
  plannedTotal: number;
  registeredTotal: number;
  /** Recibos no mensuales omitidos explícitamente mediante `skippedMonths` en este año. */
  skippedInYearCount: number;
  /** Plantillas activas no mensuales sin `startMonth` válido (nunca se inventan fechas). */
  unanchoredTemplates: RecurringExpense[];
}

export interface AnnualBalanceResult {
  year: number;
  todayISO: string;
  currentMonthKey: string;
  isCurrentYear: boolean;
  isFutureYear: boolean;
  /** Total de gasto compartido registrado en el año (excluye privados, liquidaciones, metas y Mudanza). */
  totalSharedSpent: number;
  totalSharedCount: number;
  /** Media mensual sobre meses completos con cobertura conocida (null si 0 meses completos cubiertos). */
  averageMonthlySpent: number | null;
  monthsInAverageCount: number;
  monthsInAverageKeys: string[];
  currentMonthExcludedFromAverage: boolean;
  closedMonthsCount: number;
  closedZeroMonthsCount: number;
  openMonthsWithDataCount: number;
  noDataMonthsCount: number;
  /** Mes con mayor gasto compartido del año (null si no hay gasto). */
  peakMonth: AnnualMonthRow | null;
  months: AnnualMonthRow[];
  categories: AnnualCategoryRow[];
  /** Top categorías con mayor aumento (interanual si hay base suficiente, o picos intra-anuales si es el primer año). */
  topRisingCategories: AnnualCategoryRiseHighlight[];
  archivedCategoriesWithActivityCount: number;
  budgetSummary: AnnualBudgetSummary;
  yoyComparison: AnnualYoYComparison;
  nonMonthlyReceipts: AnnualNonMonthlySummary;
  /** True si algún mes cerrado del año tiene snapshot cuyo total difiere de la suma de movimientos actuales. */
  hasClosureSnapshotDiscrepancy: boolean;
}

export interface ComputeAnnualBalanceInput {
  year: number;
  sharedTransactions: Transaction[];
  systemBudgets: MonthlyBudget[];
  categoryBudgets: CategoryBudgetLimit[];
  monthClosures: MonthClosure[];
  recurring: RecurringExpense[];
  categoryRegistry?: CategoryRegistry;
  /** Fecha local YYYY-MM-DD (por defecto `todayLocalISO()`). Inyectable para pruebas deterministas. */
  todayISO?: string;
}

function toCents(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(roundCents(n) * 100);
}

function isSharedRegularExpense(tx: Transaction): boolean {
  return !tx.isPrivate && !tx.isSettlement && tx.category !== 'liquidacion';
}

function buildYearMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex).padStart(2, '0')}`;
}

function buildBudgetsByMonth(
  systemBudgets: MonthlyBudget[],
  categoryBudgets: CategoryBudgetLimit[]
): Map<string, MonthlyBudget> {
  const sysByMonth = new Map<string, MonthlyBudget>();
  for (const b of systemBudgets) {
    if (b?.monthKey) sysByMonth.set(b.monthKey, b);
  }
  const catByMonth = new Map<string, CategoryBudgetLimit[]>();
  for (const cb of categoryBudgets) {
    if (!cb?.monthKey) continue;
    const list = catByMonth.get(cb.monthKey) ?? [];
    list.push(cb);
    catByMonth.set(cb.monthKey, list);
  }

  const allKeys = new Set<string>([...sysByMonth.keys(), ...catByMonth.keys()]);
  const merged = new Map<string, MonthlyBudget>();
  for (const mk of allKeys) {
    const m = mergeMonthlyAndCustomBudgetLimits(
      sysByMonth.get(mk) ?? null,
      catByMonth.get(mk) ?? [],
      mk
    );
    if (m) merged.set(mk, m);
  }
  return merged;
}

/**
 * Extrae los años disponibles ordenados de más reciente a más antiguo,
 * incluyendo siempre el año actual y cualquier año con movimientos, cierres o presupuestos.
 */
export function extractAvailableYears(params: {
  sharedTransactions: Transaction[];
  monthClosures: MonthClosure[];
  systemBudgets: MonthlyBudget[];
  categoryBudgets: CategoryBudgetLimit[];
  todayISO?: string;
  selectedYear?: number;
}): number[] {
  const today = params.todayISO ?? getTodayLocalISO();
  const currentYear = Number(today.slice(0, 4)) || new Date().getFullYear();
  const years = new Set<number>([currentYear]);
  if (params.selectedYear && Number.isInteger(params.selectedYear)) {
    years.add(params.selectedYear);
  }

  const addFromMonthKey = (mk: string | undefined) => {
    if (!mk || mk.length < 4) return;
    const y = Number(mk.slice(0, 4));
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) years.add(y);
  };

  for (const tx of params.sharedTransactions) {
    if (!isSharedRegularExpense(tx)) continue;
    addFromMonthKey(tx.monthKey);
  }
  for (const cl of params.monthClosures) addFromMonthKey(cl.monthKey);
  for (const b of params.systemBudgets) addFromMonthKey(b.monthKey);
  for (const cb of params.categoryBudgets) addFromMonthKey(cb.monthKey);

  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Calcula el Balance anual del hogar de forma pura, reproducible y sin mutaciones.
 * - Excluye privados, liquidaciones, Mudanza y movimientos de metas.
 * - Distingue «Mes cerrado», «Mes abierto» y «Sin datos».
 * - Un mes cerrado con 0 € cuenta como 0 € en la media; un mes sin datos nunca se convierte en 0 €.
 * - El mes en curso abierto queda fuera de la media mensual habitual.
 * - Compara presupuesto y gasto registrado sin mezclar previsiones y respetando 0 € como límite válido.
 * - Nunca muestra desviación engañosa ni porcentajes sobre base 0 €.
 * - Calcula recibos no mensuales (bimestrales, trimestrales, anuales) respetando startMonth y skippedMonths,
 *   distinguiendo previsto vs registrado sin duplicar vinculados.
 */
export function computeAnnualBalance(input: ComputeAnnualBalanceInput): AnnualBalanceResult {
  const todayISO = input.todayISO ?? getTodayLocalISO();
  const currentMonthKey = todayISO.slice(0, 7);
  const currentYear = Number(todayISO.slice(0, 4));
  const currentMonthNum = Number(todayISO.slice(5, 7));
  const year = input.year;
  const isCurrentYear = year === currentYear;
  const isFutureYear = year > currentYear;
  const registry = input.categoryRegistry ?? buildCategoryRegistry();

  // 1. Filtrar exclusivamente gasto corriente compartido (sin privados ni liquidaciones)
  const regularSharedTxs = input.sharedTransactions.filter(isSharedRegularExpense);

  const txsByMonth = new Map<string, Transaction[]>();
  for (const tx of regularSharedTxs) {
    const list = txsByMonth.get(tx.monthKey) ?? [];
    list.push(tx);
    txsByMonth.set(tx.monthKey, list);
  }

  const closureByMonth = new Map<string, MonthClosure>();
  for (const cl of input.monthClosures) {
    closureByMonth.set(cl.monthKey, cl);
  }

  const budgetsByMonth = buildBudgetsByMonth(input.systemBudgets, input.categoryBudgets);

  // Acumuladores por categoría para el año seleccionado
  interface CatAcc {
    totalCents: number;
    txCount: number;
    monthCents: Map<string, number>;
    budgetedMonthsCount: number;
    budgetTotalCents: number;
    budgetedSpentCents: number;
    unbudgetedSpentCents: number;
  }
  const catAccMap = new Map<string, CatAcc>();
  const getCatAcc = (catId: string): CatAcc => {
    let acc = catAccMap.get(catId);
    if (!acc) {
      acc = {
        totalCents: 0,
        txCount: 0,
        monthCents: new Map<string, number>(),
        budgetedMonthsCount: 0,
        budgetTotalCents: 0,
        budgetedSpentCents: 0,
        unbudgetedSpentCents: 0,
      };
      catAccMap.set(catId, acc);
    }
    return acc;
  };

  // 2. Construir los 12 meses del año seleccionado
  const months: AnnualMonthRow[] = [];
  let totalSharedCents = 0;
  let totalSharedCount = 0;
  let averageBaseCents = 0;
  const monthsInAverageKeys: string[] = [];
  let currentMonthExcludedFromAverage = false;
  let closedMonthsCount = 0;
  let closedZeroMonthsCount = 0;
  let openMonthsWithDataCount = 0;
  let noDataMonthsCount = 0;
  let hasClosureSnapshotDiscrepancy = false;

  // Acumuladores anuales de presupuesto (siempre solo sobre pares (mes, categoría) con límite explícito)
  let annualConfiguredBudgetCents = 0;
  let annualBudgetedSpentCents = 0;
  let annualUnbudgetedSpentCents = 0;
  let annualHasAnyBudget = false;
  let monthsWithBudgetCount = 0;
  let monthsWithCompleteBudgetCount = 0;
  let monthsWithPartialBudgetCount = 0;

  for (let m = 1; m <= 12; m++) {
    const monthKey = buildYearMonthKey(year, m);
    const monthTxs = txsByMonth.get(monthKey) ?? [];
    const closure = closureByMonth.get(monthKey) ?? null;
    const isClosed = Boolean(closure);
    const isCurrentMonth = monthKey === currentMonthKey;
    const isFutureMonth = monthKey > currentMonthKey;

    let monthSpentCents = 0;
    const monthSpentByCat = new Map<string, { cents: number; count: number }>();
    for (const tx of monthTxs) {
      const c = toCents(tx.amount);
      monthSpentCents += c;
      const prev = monthSpentByCat.get(tx.category) ?? { cents: 0, count: 0 };
      prev.cents += c;
      prev.count += 1;
      monthSpentByCat.set(tx.category, prev);
    }

    const status: AnnualMonthStatus = isClosed
      ? 'cerrado'
      : monthTxs.length > 0
        ? 'abierto'
        : 'sin_datos';

    if (status === 'cerrado') {
      closedMonthsCount += 1;
      if (monthSpentCents === 0) closedZeroMonthsCount += 1;
    } else if (status === 'abierto') {
      openMonthsWithDataCount += 1;
    } else {
      noDataMonthsCount += 1;
    }

    // Reglas de inclusión en media mensual habitual:
    // - Mes futuro: nunca
    // - Mes en curso abierto: nunca (señalar explícitamente)
    // - Mes cerrado (incluso con 0 €): SÍ cuenta
    // - Mes pasado abierto con movimientos registrados: SÍ cuenta
    // - Mes sin datos: nunca (no se convierte en 0 €)
    let includedInAverage = false;
    if (!isFutureMonth) {
      if (isCurrentMonth && !isClosed) {
        currentMonthExcludedFromAverage = true;
      } else if (status === 'cerrado' || status === 'abierto') {
        includedInAverage = true;
      }
    }

    if (includedInAverage) {
      averageBaseCents += monthSpentCents;
      monthsInAverageKeys.push(monthKey);
    }

    totalSharedCents += monthSpentCents;
    totalSharedCount += monthTxs.length;

    // Presupuesto del mes (solo límites explícitos, respetando 0 €)
    const explicitLimits = extractExplicitBudgetLimits(budgetsByMonth.get(monthKey));
    const hasAnyBudget = explicitLimits.size > 0;
    let monthBudgetTotalCents = 0;
    let monthBudgetedSpentCents = 0;
    let monthUnbudgetedSpentCents = 0;

    const monthCatIds = new Set<string>([...explicitLimits.keys(), ...monthSpentByCat.keys()]);
    for (const catId of monthCatIds) {
      const spentEntry = monthSpentByCat.get(catId);
      const spentCents = spentEntry?.cents ?? 0;
      const txCount = spentEntry?.count ?? 0;
      const hasLimit = explicitLimits.has(catId);
      const limitCents = hasLimit ? toCents(explicitLimits.get(catId)!) : 0;

      const acc = getCatAcc(catId);
      if (txCount > 0) {
        acc.totalCents += spentCents;
        acc.txCount += txCount;
        acc.monthCents.set(monthKey, (acc.monthCents.get(monthKey) ?? 0) + spentCents);
      }

      if (hasLimit) {
        monthBudgetTotalCents += limitCents;
        monthBudgetedSpentCents += spentCents;
        acc.budgetedMonthsCount += 1;
        acc.budgetTotalCents += limitCents;
        acc.budgetedSpentCents += spentCents;
      } else if (spentCents > 0) {
        monthUnbudgetedSpentCents += spentCents;
        acc.unbudgetedSpentCents += spentCents;
      }
    }

    const monthBudgetCoverage: MonthlyBudgetCoverage = !hasAnyBudget
      ? 'none'
      : monthUnbudgetedSpentCents > 0
        ? 'partial'
        : 'complete';

    if (hasAnyBudget) {
      annualHasAnyBudget = true;
      monthsWithBudgetCount += 1;
      if (monthBudgetCoverage === 'complete') monthsWithCompleteBudgetCount += 1;
      if (monthBudgetCoverage === 'partial') monthsWithPartialBudgetCount += 1;
      annualConfiguredBudgetCents += monthBudgetTotalCents;
      annualBudgetedSpentCents += monthBudgetedSpentCents;
    }
    annualUnbudgetedSpentCents += monthUnbudgetedSpentCents;

    const comparableDevCents = hasAnyBudget ? monthBudgetedSpentCents - monthBudgetTotalCents : null;
    const comparableDevPct =
      comparableDevCents !== null && monthBudgetTotalCents > 0
        ? Math.round((comparableDevCents / monthBudgetTotalCents) * 1000) / 10
        : null;

    const closureSnapshotTotal = closure ? roundCents(closure.totalSpent) : null;
    const closureDiffersFromTransactions =
      closureSnapshotTotal !== null && Math.abs(toCents(closureSnapshotTotal) - monthSpentCents) > 1;
    if (closureDiffersFromTransactions) hasClosureSnapshotDiscrepancy = true;

    months.push({
      monthIndex: m,
      monthKey,
      shortLabel: SHORT_MONTH_LABELS_ES[m - 1],
      longLabel: LONG_MONTH_LABELS_ES[m - 1],
      status,
      isClosed,
      isCurrentMonth,
      isFutureMonth,
      includedInAverage,
      spent: monthSpentCents / 100,
      transactionCount: monthTxs.length,
      budgetTotal: hasAnyBudget ? monthBudgetTotalCents / 100 : null,
      hasAnyBudget,
      budgetCoverage: monthBudgetCoverage,
      budgetedSpent: monthBudgetedSpentCents / 100,
      unbudgetedSpent: monthUnbudgetedSpentCents / 100,
      comparableDeviation: comparableDevCents !== null ? comparableDevCents / 100 : null,
      comparableDeviationPct: comparableDevPct,
      closureSnapshotTotal,
      closureDiffersFromTransactions,
    });
  }

  // 3. Comparativa interanual (mismo tramo del año anterior)
  const prevYear = year - 1;
  const spanEndMonth = isCurrentYear ? Math.max(1, Math.min(12, currentMonthNum)) : 12;
  const isIncompletePeriod = isCurrentYear && (currentMonthNum < 12 || !closureByMonth.has(currentMonthKey));
  const spanLabel =
    spanEndMonth === 12 && !isIncompletePeriod
      ? 'año completo'
      : spanEndMonth === 1
        ? SHORT_MONTH_LABELS_ES[0]
        : `${SHORT_MONTH_LABELS_ES[0]}–${SHORT_MONTH_LABELS_ES[spanEndMonth - 1]}`;

  let currentSpanCents = 0;
  let prevSpanCents = 0;
  let currentSpanCoveredMonths = 0;
  let prevSpanCoveredMonths = 0;
  const currentSpanByCatCents = new Map<string, number>();
  const prevSpanByCatCents = new Map<string, number>();

  for (let m = 1; m <= spanEndMonth; m++) {
    const curMk = buildYearMonthKey(year, m);
    const prevMk = buildYearMonthKey(prevYear, m);

    const curTxs = txsByMonth.get(curMk) ?? [];
    const prevTxs = txsByMonth.get(prevMk) ?? [];

    if (closureByMonth.has(curMk) || curTxs.length > 0) {
      currentSpanCoveredMonths += 1;
    }
    if (closureByMonth.has(prevMk) || prevTxs.length > 0) {
      prevSpanCoveredMonths += 1;
    }

    for (const tx of curTxs) {
      const c = toCents(tx.amount);
      currentSpanCents += c;
      currentSpanByCatCents.set(tx.category, (currentSpanByCatCents.get(tx.category) ?? 0) + c);
    }
    for (const tx of prevTxs) {
      const c = toCents(tx.amount);
      prevSpanCents += c;
      prevSpanByCatCents.set(tx.category, (prevSpanByCatCents.get(tx.category) ?? 0) + c);
    }
  }

  const yoyHasSufficientData =
    !isFutureYear && currentSpanCoveredMonths > 0 && prevSpanCoveredMonths > 0;
  const yoyDeltaCents = currentSpanCents - prevSpanCents;
  // Nunca calcular porcentaje sobre base 0 €
  const yoyDeltaPct =
    yoyHasSufficientData && prevSpanCents > 0
      ? Math.round((yoyDeltaCents / prevSpanCents) * 1000) / 10
      : null;

  let incompleteReason: string | null = null;
  if (isCurrentYear) {
    const curMonthClosed = closureByMonth.has(currentMonthKey);
    incompleteReason = curMonthClosed
      ? `Tramo ${spanLabel} (${year} aún en curso)`
      : `Tramo ${spanLabel} (${LONG_MONTH_LABELS_ES[currentMonthNum - 1]} sigue abierto)`;
  } else if (!isFutureYear && closedMonthsCount + openMonthsWithDataCount < 12) {
    incompleteReason = `Solo ${closedMonthsCount + openMonthsWithDataCount} de 12 meses tienen cobertura en ${year}`;
  }

  const yoyComparison: AnnualYoYComparison = {
    prevYear,
    spanEndMonth,
    spanLabel,
    isIncompletePeriod,
    incompleteReason,
    hasSufficientData: yoyHasSufficientData,
    currentSpanSpent: currentSpanCents / 100,
    prevSpanSpent: prevSpanCents / 100,
    currentSpanCoveredMonths,
    prevSpanCoveredMonths,
    deltaAmount: yoyDeltaCents / 100,
    deltaPct: yoyDeltaPct,
  };

  // 4. Desglose por categoría (conservando archivadas y categorías desconocidas/legacy)
  // Si hay YoY suficiente, incluir también categorías que tuvieron gasto en year - 1 aunque en year sean 0
  if (yoyHasSufficientData) {
    for (const catId of prevSpanByCatCents.keys()) {
      getCatAcc(catId);
    }
  }

  const categories: AnnualCategoryRow[] = [];
  for (const [catId, acc] of catAccMap.entries()) {
    const hasActivityOrBudget =
      acc.totalCents > 0 ||
      acc.budgetedMonthsCount > 0 ||
      (yoyHasSufficientData && (prevSpanByCatCents.get(catId) ?? 0) > 0);
    if (!hasActivityOrBudget) continue;

    const meta = registry.getMeta(catId);
    let peakMonthKey: string | null = null;
    let peakMonthCents = 0;
    let latestMonthKey: string | null = null;
    let monthsWithSpendCount = 0;

    for (const [mk, cents] of acc.monthCents.entries()) {
      if (cents > 0) {
        monthsWithSpendCount += 1;
        if (cents > peakMonthCents || (cents === peakMonthCents && (!peakMonthKey || mk > peakMonthKey))) {
          peakMonthCents = cents;
          peakMonthKey = mk;
        }
        if (!latestMonthKey || mk > latestMonthKey) {
          latestMonthKey = mk;
        }
      }
    }

    const catBudgetCoverage: MonthlyBudgetCoverage =
      acc.budgetedMonthsCount === 0
        ? 'none'
        : acc.unbudgetedSpentCents > 0
          ? 'partial'
          : 'complete';

    const catCompDevCents =
      acc.budgetedMonthsCount > 0 ? acc.budgetedSpentCents - acc.budgetTotalCents : null;
    const catCompDevPct =
      catCompDevCents !== null && acc.budgetTotalCents > 0
        ? Math.round((catCompDevCents / acc.budgetTotalCents) * 1000) / 10
        : null;

    const prevCatCents = yoyHasSufficientData ? (prevSpanByCatCents.get(catId) ?? 0) : null;
    const curCatSpanCents = currentSpanByCatCents.get(catId) ?? 0;
    const catYoyDeltaCents = prevCatCents !== null ? curCatSpanCents - prevCatCents : null;
    const catYoyDeltaPct =
      prevCatCents !== null && prevCatCents > 0 && catYoyDeltaCents !== null
        ? Math.round((catYoyDeltaCents / prevCatCents) * 1000) / 10
        : null;

    // Pico intra-anual: cuánto superó su mes pico respecto a la media de sus otros meses con gasto
    let intraYearSpikeDelta = 0;
    if (monthsWithSpendCount >= 2 && peakMonthCents > 0) {
      const otherMonthsAvgCents = (acc.totalCents - peakMonthCents) / (monthsWithSpendCount - 1);
      intraYearSpikeDelta = Math.max(0, Math.round(peakMonthCents - otherMonthsAvgCents)) / 100;
    }

    categories.push({
      categoryId: catId,
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      isCustom: !meta.isSystem,
      isArchived: meta.archived,
      isLegacyUnknown: meta.isUnknown,
      totalSpent: acc.totalCents / 100,
      sharePct:
        totalSharedCents > 0 ? Math.round((acc.totalCents / totalSharedCents) * 1000) / 10 : 0,
      transactionCount: acc.txCount,
      monthsWithSpendCount,
      peakMonthKey,
      peakMonthAmount: peakMonthCents / 100,
      latestMonthKey,
      budgetedMonthsCount: acc.budgetedMonthsCount,
      budgetTotal: acc.budgetedMonthsCount > 0 ? acc.budgetTotalCents / 100 : null,
      budgetedSpent: acc.budgetedSpentCents / 100,
      unbudgetedSpent: acc.unbudgetedSpentCents / 100,
      budgetCoverage: catBudgetCoverage,
      comparableDeviation: catCompDevCents !== null ? catCompDevCents / 100 : null,
      comparableDeviationPct: catCompDevPct,
      prevYearSpanSpent: prevCatCents !== null ? prevCatCents / 100 : null,
      yoyDelta: catYoyDeltaCents !== null ? catYoyDeltaCents / 100 : null,
      yoyDeltaPct: catYoyDeltaPct,
      intraYearSpikeDelta,
    });
  }

  categories.sort(
    (a, b) =>
      b.totalSpent - a.totalSpent ||
      (b.budgetTotal ?? -1) - (a.budgetTotal ?? -1) ||
      a.label.localeCompare(b.label, 'es')
  );

  // 5. Categorías que más han aumentado (YoY si hay datos suficientes, o picos intra-anuales)
  const topRisingCategories: AnnualCategoryRiseHighlight[] = [];
  if (yoyHasSufficientData) {
    const yoyRisers = categories
      .filter((c) => c.yoyDelta !== null && c.yoyDelta > 0)
      .sort((a, b) => (b.yoyDelta ?? 0) - (a.yoyDelta ?? 0))
      .slice(0, 4);
    for (const c of yoyRisers) {
      topRisingCategories.push({
        categoryId: c.categoryId,
        label: c.label,
        color: c.color,
        isArchived: c.isArchived,
        basis: 'yoy',
        currentAmount: roundCents((currentSpanByCatCents.get(c.categoryId) ?? 0) / 100),
        referenceAmount: c.prevYearSpanSpent ?? 0,
        deltaAmount: c.yoyDelta ?? 0,
        deltaPct: c.yoyDeltaPct,
        peakMonthKey: c.peakMonthKey,
        peakMonthAmount: c.peakMonthAmount,
      });
    }
  } else {
    const intraRisers = categories
      .filter((c) => c.intraYearSpikeDelta > 0 && c.peakMonthKey)
      .sort((a, b) => b.intraYearSpikeDelta - a.intraYearSpikeDelta)
      .slice(0, 4);
    for (const c of intraRisers) {
      const otherAvg =
        c.monthsWithSpendCount >= 2
          ? roundCents((c.totalSpent - c.peakMonthAmount) / (c.monthsWithSpendCount - 1))
          : 0;
      const pct =
        otherAvg > 0
          ? Math.round(((c.peakMonthAmount - otherAvg) / otherAvg) * 1000) / 10
          : null;
      topRisingCategories.push({
        categoryId: c.categoryId,
        label: c.label,
        color: c.color,
        isArchived: c.isArchived,
        basis: 'intra_year',
        currentAmount: c.peakMonthAmount,
        referenceAmount: otherAvg,
        deltaAmount: roundCents(c.peakMonthAmount - otherAvg),
        deltaPct: pct,
        peakMonthKey: c.peakMonthKey,
        peakMonthAmount: c.peakMonthAmount,
      });
    }
  }

  // 6. Resumen anual de presupuesto
  const annualBudgetCoverage: MonthlyBudgetCoverage = !annualHasAnyBudget
    ? 'none'
    : annualUnbudgetedSpentCents > 0
      ? 'partial'
      : 'complete';

  const annualCompDevCents = annualHasAnyBudget
    ? annualBudgetedSpentCents - annualConfiguredBudgetCents
    : null;
  const annualCompDevPct =
    annualCompDevCents !== null && annualConfiguredBudgetCents > 0
      ? Math.round((annualCompDevCents / annualConfiguredBudgetCents) * 1000) / 10
      : null;

  const budgetSummary: AnnualBudgetSummary = {
    hasAnyBudget: annualHasAnyBudget,
    coverage: annualBudgetCoverage,
    configuredBudgetTotal: annualConfiguredBudgetCents / 100,
    budgetedSpentTotal: annualBudgetedSpentCents / 100,
    unbudgetedSpentTotal: annualUnbudgetedSpentCents / 100,
    comparableDeviation: annualCompDevCents !== null ? annualCompDevCents / 100 : null,
    comparableDeviationPct: annualCompDevPct,
    monthsWithBudgetCount,
    monthsWithCompleteBudgetCount,
    monthsWithPartialBudgetCount,
  };

  // 7. Mes pico del año
  let peakMonth: AnnualMonthRow | null = null;
  for (const row of months) {
    if (row.spent > 0 && (!peakMonth || row.spent > peakMonth.spent)) {
      peakMonth = row;
    }
  }

  // 8. Recibos no mensuales del año seleccionado (bimestral, trimestral, anual)
  const unanchoredTemplates: RecurringExpense[] = [];
  const occurrences: AnnualNonMonthlyReceipt[] = [];
  let skippedInYearCount = 0;

  // Índice de movimientos compartidos vinculados a plantillas en el año seleccionado
  const linkedByRecAndMonth = new Map<string, Transaction[]>();
  for (const tx of regularSharedTxs) {
    if (!tx.recurringId || !tx.monthKey.startsWith(`${year}-`)) continue;
    const key = `${tx.recurringId}::${tx.monthKey}`;
    const list = linkedByRecAndMonth.get(key) ?? [];
    list.push(tx);
    linkedByRecAndMonth.set(key, list);
  }

  for (const rec of input.recurring) {
    if (!rec.active || rec.frequency === 'mensual') continue;
    if (isRecurringMissingStartMonth(rec)) {
      unanchoredTemplates.push(rec);
      continue;
    }
    const freq = rec.frequency; // 'bimestral' | 'trimestral' | 'anual'
    const tplAmount = roundCents(Math.max(0, Number(rec.amount) || 0));

    for (let m = 1; m <= 12; m++) {
      const monthKey = buildYearMonthKey(year, m);
      const linkedTxs = linkedByRecAndMonth.get(`${rec.id}::${monthKey}`) ?? [];

      if (linkedTxs.length > 0) {
        // Ya registrado y vinculado: no se duplica como previsto
        const realCents = linkedTxs.reduce((sum, tx) => sum + toCents(tx.amount), 0);
        const primaryTx = linkedTxs[0];
        occurrences.push({
          id: `${rec.id}_${monthKey}`,
          recurringId: rec.id,
          concept: rec.concept,
          category: rec.category,
          frequency: freq,
          monthKey,
          dueDate: primaryTx.date,
          amount: realCents / 100,
          templateAmount: tplAmount,
          paidBy: primaryTx.paidBy,
          status: 'registrado',
          isPastDue: false,
          transactionId: primaryTx.id,
        });
        continue;
      }

      if (isRecurringDueInMonth(rec, monthKey)) {
        const dueDate = getRecurringDueDateForMonth(rec, monthKey);
        occurrences.push({
          id: `${rec.id}_${monthKey}`,
          recurringId: rec.id,
          concept: rec.concept,
          category: rec.category,
          frequency: freq,
          monthKey,
          dueDate,
          amount: tplAmount,
          templateAmount: tplAmount,
          paidBy: rec.paidByDefault,
          status: 'previsto',
          isPastDue: dueDate < todayISO,
          transactionId: null,
        });
      } else if (
        isRecurringDueInMonthIgnoringSkip(rec, monthKey) &&
        isRecurringSkippedInMonth(rec, monthKey)
      ) {
        skippedInYearCount += 1;
      }
    }
  }

  occurrences.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.concept.localeCompare(b.concept, 'es')
  );
  unanchoredTemplates.sort((a, b) => a.concept.localeCompare(b.concept, 'es'));

  const plannedOccurrences = occurrences.filter((o) => o.status === 'previsto');
  const registeredOccurrences = occurrences.filter((o) => o.status === 'registrado');

  const plannedTotalCents = plannedOccurrences.reduce((s, o) => s + toCents(o.amount), 0);
  const registeredTotalCents = registeredOccurrences.reduce((s, o) => s + toCents(o.amount), 0);

  const nonMonthlyReceipts: AnnualNonMonthlySummary = {
    occurrences,
    plannedOccurrences,
    registeredOccurrences,
    plannedTotal: plannedTotalCents / 100,
    registeredTotal: registeredTotalCents / 100,
    skippedInYearCount,
    unanchoredTemplates,
  };

  const averageMonthlySpent =
    monthsInAverageKeys.length > 0
      ? roundCents(averageBaseCents / monthsInAverageKeys.length / 100)
      : null;

  const archivedCategoriesWithActivityCount = categories.filter(
    (c) => c.isArchived && c.totalSpent > 0
  ).length;

  return {
    year,
    todayISO,
    currentMonthKey,
    isCurrentYear,
    isFutureYear,
    totalSharedSpent: totalSharedCents / 100,
    totalSharedCount,
    averageMonthlySpent,
    monthsInAverageCount: monthsInAverageKeys.length,
    monthsInAverageKeys,
    currentMonthExcludedFromAverage,
    closedMonthsCount,
    closedZeroMonthsCount,
    openMonthsWithDataCount,
    noDataMonthsCount,
    peakMonth,
    months,
    categories,
    topRisingCategories,
    archivedCategoriesWithActivityCount,
    budgetSummary,
    yoyComparison,
    nonMonthlyReceipts,
    hasClosureSnapshotDiscrepancy,
  };
}

// ─── Caché en sesión aislada por (householdId, viewerUid) ──────────────────────

export interface ScopedAnnualBalanceEntry {
  sharedTransactions: Transaction[];
  systemBudgets: MonthlyBudget[];
  categoryBudgets: CategoryBudgetLimit[];
  loadedAt: number;
}

export interface ScopedAnnualBalanceCache {
  get(householdId: string, viewerUid: string): ScopedAnnualBalanceEntry | null;
  set(householdId: string, viewerUid: string, entry: ScopedAnnualBalanceEntry): void;
  invalidateScope(householdId: string, viewerUid: string): void;
  invalidateHousehold(householdId: string): void;
  clearAll(): void;
}

export function createScopedAnnualBalanceCache(): ScopedAnnualBalanceCache {
  const store = new Map<string, ScopedAnnualBalanceEntry>();
  const buildKey = (householdId: string, viewerUid: string) => `${householdId}::${viewerUid}`;

  return {
    get(householdId, viewerUid) {
      if (!householdId || !viewerUid) return null;
      return store.get(buildKey(householdId, viewerUid)) ?? null;
    },
    set(householdId, viewerUid, entry) {
      if (!householdId || !viewerUid) return;
      store.set(buildKey(householdId, viewerUid), entry);
    },
    invalidateScope(householdId, viewerUid) {
      if (!householdId || !viewerUid) return;
      store.delete(buildKey(householdId, viewerUid));
    },
    invalidateHousehold(householdId) {
      if (!householdId) return;
      const prefix = `${householdId}::`;
      for (const k of Array.from(store.keys())) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    },
    clearAll() {
      store.clear();
    },
  };
}

export const annualBalanceSessionCache = createScopedAnnualBalanceCache();
