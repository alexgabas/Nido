import {
  COMMON_ACCOUNT_ID,
  type CommonAccountManualBalance,
  type ExpenseCategory,
  type MonthlyBudget,
  type RecurringExpense,
  type Transaction,
} from '../types/nido';
import { buildCategoryRegistry, type CategoryRegistry } from './categories';
import {
  clampSplitPct,
  getTodayLocalISO,
  localDaysBetween,
  roundCents,
} from './finance';
import {
  extractExplicitBudgetLimits,
  isValidLocalDateISO,
  sanitizePlannedCommonCategories,
} from './monthlyPlanning';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
} from './recurrence';

export interface CommonAccountScheduledItem {
  id: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  daysUntil: number; // relativo a referenceDate (o todayISO cuando no hay saldo manual)
  isFromRecurring: boolean;
  recurringId: string | null;
  splitPctA: number;
  hasSplitOverride: boolean;
}

export interface CommonAccountPlannedVariableRow {
  categoryId: ExpenseCategory;
  label: string;
  color: string;
  isArchived: boolean;
  hasExplicitBudget: boolean;
  budgetLimit: number | null;
  registeredCommon: number;
  registeredIndividual: number;
  pendingCommon: number;
  pendingIndividual: number;
  /** Margen variable restante planificado para Cuenta común (sin duplicar recurrentes ni registrados). */
  unconsumedVariableMargin: number;
  /** Total asignado a Cuenta común en esta categoría = registeredCommon + pendingCommon + unconsumedVariableMargin. */
  categoryCommonTotal: number;
}

export interface CommonAccountRadarResult {
  monthKey: string;
  todayISO: string;
  /** Fecha de referencia usada para separar necesidades futuras vs pasadas (manualBalance.referenceDate o todayISO). */
  referenceDate: string;
  /** Gastos compartidos cargados a Cuenta común en TODO el mes. */
  registeredCommonTotal: number;
  registeredCommonCount: number;
  /** Gastos de Cuenta común registrados hasta la fecha de referencia (no se vuelven a restar del saldo manual). */
  registeredToDateTotal: number;
  registeredToDateCount: number;
  /** Gastos de Cuenta común registrados con fecha posterior a la fecha de referencia. */
  registeredAfterReferenceTotal: number;
  /** Plantillas activas de Cuenta común pendientes de registrar en el mes (total mensual). */
  pendingCommonRecurringTotal: number;
  pendingCommonRecurringItems: CommonAccountScheduledItem[];
  /** Plantillas de Cuenta común con fecha anterior a referenceDate aún sin movimiento registrado. */
  unregisteredBeforeRefItems: CommonAccountScheduledItem[];
  unregisteredBeforeRefTotal: number;
  /** Desglose de categorías variables seleccionadas para financiarse desde Cuenta común. */
  plannedVariableRows: CommonAccountPlannedVariableRow[];
  /** Categorías seleccionadas que no tienen presupuesto configurado este mes. */
  missingBudgetCategories: CommonAccountPlannedVariableRow[];
  /** Suma del margen variable restante planificado desde Cuenta común (sin doble conteo). */
  plannedVariableMarginTotal: number;
  /** Necesidad prevista total del mes para Cuenta común = registeredCommonTotal + pendingCommonRecurringTotal + plannedVariableMarginTotal. */
  totalMonthlyNeed: number;
  /** Aportación orientativa mensual de cada miembro (reconciliada al céntimo: monthlyShareA + monthlyShareB === totalMonthlyNeed). */
  monthlyShareA: number;
  monthlyShareB: number;
  /** Próximos 5 días (desde referenceDate hasta referenceDate + 5 días). */
  next5DaysItems: CommonAccountScheduledItem[];
  next5DaysTotal: number;
  /** Resto del mes (> referenceDate + 5 días). */
  restOfMonthItems: CommonAccountScheduledItem[];
  restOfMonthTotal: number;
  /** Importe previsto que debéis tener disponible desde referenceDate (futuros registrados + pendientes >= refDate + margen variable). */
  requiredAvailableTotal: number;
  /** Aportación orientativa sobre requiredAvailableTotal (exacta al céntimo: orientativeShareA + orientativeShareB === requiredAvailableTotal). */
  orientativeShareA: number;
  orientativeShareB: number;
  /** Porcentaje base del hogar aplicado por defecto. */
  defaultSplitPctA: number;
  /** True si algún movimiento o plantilla de Cuenta común usa un reparto distinto al del hogar. */
  hasCustomSplitOverrides: boolean;
  /** Saldo manual compartido con fecha de referencia (null si no se ha introducido). */
  manualBalance: CommonAccountManualBalance | null;
  currentCommonBalance: number | null;
  balanceStatus: 'not_provided' | 'outdated_month' | 'covered' | 'shortfall';
  /** Días transcurridos desde referenceDate hasta todayISO (null si no hay saldo manual). */
  balanceAgeDays: number | null;
  /** True si el saldo manual tiene más de 3 días o fecha futura respecto a hoy. */
  isBalanceStale: boolean;
  /** True si la fecha del saldo manual pertenece a otro mes distinto de monthKey. */
  isBalanceOutdatedMonth: boolean;
  shortfallAmount: number;
  shortfallShareA: number;
  shortfallShareB: number;
  marginAmount: number;
}

export interface CommonAccountRadarOptions {
  todayISO?: string;
  /** Compatibilidad legacy: saldo numérico asumido a fecha todayISO. Preferir `manualBalance`. */
  currentCommonBalance?: number | null;
  /** Saldo manual compartido con fecha de referencia y autor. */
  manualBalance?: CommonAccountManualBalance | null;
  /** Presupuesto del mes (sistema + personalizadas). */
  budget?: MonthlyBudget | null;
  /** Categorías variables que la pareja planifica financiar desde la Cuenta común. */
  plannedCommonCategoryIds?: readonly string[];
  /** Registro de categorías para etiquetas/colores de personalizadas y archivadas. */
  categoryRegistry?: CategoryRegistry;
}

/**
 * Reparte una lista de partidas con porcentajes potencialmente distintos garantizando
 * reconciliación exacta al céntimo: shareA + shareB === total.
 */
export function allocateExactMemberShares(
  items: ReadonlyArray<{ amount: number; splitPctA: number }>,
  fallbackSplitPctA: number
): { total: number; shareA: number; shareB: number } {
  const safeFallback = clampSplitPct(fallbackSplitPctA, 50);
  let totalCents = 0;
  let rawShareACents = 0;

  for (const item of items) {
    const cents = Math.round(roundCents(Math.max(0, item.amount)) * 100);
    if (cents <= 0) continue;
    const pctA = clampSplitPct(item.splitPctA, safeFallback);
    totalCents += cents;
    rawShareACents += (cents * pctA) / 100;
  }

  const shareACents = Math.max(0, Math.min(totalCents, Math.round(rawShareACents)));
  const shareBCents = totalCents - shareACents;

  return {
    total: totalCents / 100,
    shareA: shareACents / 100,
    shareB: shareBCents / 100,
  };
}

/**
 * Reparte un importe concreto (p. ej. el importe faltante) con un porcentaje A garantizando
 * shareA + shareB === amount al céntimo exacto.
 */
export function splitAmountExactCents(
  amount: number,
  splitPctA: number
): { shareA: number; shareB: number } {
  const totalCents = Math.max(0, Math.round(roundCents(amount) * 100));
  const pctA = clampSplitPct(splitPctA, 50);
  const shareACents = Math.max(0, Math.min(totalCents, Math.round((totalCents * pctA) / 100)));
  const shareBCents = totalCents - shareACents;
  return {
    shareA: shareACents / 100,
    shareB: shareBCents / 100,
  };
}

/**
 * Radar y planificación de aportaciones a la Cuenta común:
 * - Excluye siempre gastos privados y liquidaciones.
 * - No duplica plantillas recurrentes ya registradas en el mes.
 * - Integra categorías variables planificadas para Cuenta común usando solo su margen
 *   presupuestario aún no consumido (evitando doble conteo con recurrentes y gastos registrados).
 * - Si hay saldo manual con fecha de referencia, solo resta necesidades posteriores o vigentes
 *   desde esa fecha (nunca vuelve a restar gastos anteriores a la fecha del saldo).
 * - Nunca modifica saldos históricos ni genera deudas entre miembros.
 */
export function computeCommonAccountRadar(
  monthKey: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  effectiveSplitPctA: number,
  options?: CommonAccountRadarOptions
): CommonAccountRadarResult {
  const todayISO = options?.todayISO ?? getTodayLocalISO();
  const safeDefaultSplit = clampSplitPct(effectiveSplitPctA, 50);
  const registry = options?.categoryRegistry ?? buildCategoryRegistry();

  // Resolver saldo manual efectivo (nuevo manualBalance con fecha o legacy currentCommonBalance)
  let resolvedManualBalance: CommonAccountManualBalance | null = null;
  if (
    options?.manualBalance &&
    Number.isFinite(options.manualBalance.amount) &&
    options.manualBalance.amount >= 0 &&
    isValidLocalDateISO(options.manualBalance.referenceDate)
  ) {
    resolvedManualBalance = {
      amount: roundCents(options.manualBalance.amount),
      referenceDate: options.manualBalance.referenceDate,
      updatedBy: options.manualBalance.updatedBy,
      updatedAt: options.manualBalance.updatedAt,
    };
  } else if (
    typeof options?.currentCommonBalance === 'number' &&
    Number.isFinite(options.currentCommonBalance) &&
    options.currentCommonBalance >= 0
  ) {
    resolvedManualBalance = {
      amount: roundCents(options.currentCommonBalance),
      referenceDate: todayISO,
      updatedBy: '',
      updatedAt: '',
    };
  }

  const isBalanceOutdatedMonth =
    resolvedManualBalance !== null &&
    resolvedManualBalance.referenceDate.slice(0, 7) !== monthKey;

  // Si el saldo pertenece al mes seleccionado, la fecha de referencia para separar pasado/futuro es referenceDate.
  // Si no hay saldo (o es de otro mes), usamos todayISO como referencia del calendario.
  const referenceDate =
    resolvedManualBalance && !isBalanceOutdatedMonth
      ? resolvedManualBalance.referenceDate
      : todayISO;

  // 1. Gastos compartidos del mes (excluye privados y liquidaciones)
  const sharedMonthTxs = transactions.filter(
    (t) =>
      t.monthKey === monthKey &&
      !t.isPrivate &&
      !t.isSettlement &&
      t.category !== 'liquidacion'
  );

  // Plantillas ya materializadas este mes (aunque alguien cambiase el pagador al registrarla)
  const linkedRecurringIds = new Set<string>();
  for (const tx of sharedMonthTxs) {
    if (tx.recurringId) linkedRecurringIds.add(tx.recurringId);
  }

  // 2. Gastos compartidos pagados desde Cuenta común
  const commonTxs = sharedMonthTxs.filter((t) => t.paidBy === COMMON_ACCOUNT_ID);
  const registeredCommonTotal = roundCents(commonTxs.reduce((s, t) => s + t.amount, 0));
  const registeredCommonCount = commonTxs.length;

  let registeredToDateCents = 0;
  let registeredToDateCount = 0;
  let registeredAfterRefCents = 0;
  const scheduledFromFutureTxs: CommonAccountScheduledItem[] = [];
  let hasCustomSplitOverrides = false;

  for (const tx of commonTxs) {
    const cents = Math.round(roundCents(tx.amount) * 100);
    const txSplit = clampSplitPct(tx.splitPctA, safeDefaultSplit);
    if (Math.abs(txSplit - safeDefaultSplit) > 0.001) {
      hasCustomSplitOverrides = true;
    }
    if (tx.date <= referenceDate) {
      registeredToDateCents += cents;
      registeredToDateCount += 1;
    } else {
      registeredAfterRefCents += cents;
      scheduledFromFutureTxs.push({
        id: tx.id,
        concept: tx.concept,
        category: tx.category,
        amount: cents / 100,
        dueDate: tx.date,
        daysUntil: localDaysBetween(referenceDate, tx.date),
        isFromRecurring: Boolean(tx.recurringId),
        recurringId: tx.recurringId ?? null,
        splitPctA: txSplit,
        hasSplitOverride: Math.abs(txSplit - safeDefaultSplit) > 0.001,
      });
    }
  }

  // 3. Plantillas activas del mes (todas, para evitar doble conteo con presupuestos variables, y las de Cuenta común)
  const pendingAllRecsByCatCents = new Map<string, number>();
  const pendingCommonRecsByCatCents = new Map<string, number>();
  const pendingCommonRecurringItems: CommonAccountScheduledItem[] = [];

  for (const rec of recurring) {
    if (!rec.active) continue;
    if (linkedRecurringIds.has(rec.id)) continue;
    if (!isRecurringDueInMonth(rec, monthKey)) continue;

    const amountCents = Math.round(roundCents(Math.max(0, Number(rec.amount) || 0)) * 100);
    pendingAllRecsByCatCents.set(
      rec.category,
      (pendingAllRecsByCatCents.get(rec.category) ?? 0) + amountCents
    );

    if (rec.paidByDefault !== COMMON_ACCOUNT_ID) continue;

    pendingCommonRecsByCatCents.set(
      rec.category,
      (pendingCommonRecsByCatCents.get(rec.category) ?? 0) + amountCents
    );

    const dueDate = getRecurringDueDateForMonth(rec, monthKey);
    const hasOverride = rec.splitOverride !== null && rec.splitOverride !== undefined;
    const splitPctA = hasOverride
      ? clampSplitPct(rec.splitOverride, safeDefaultSplit)
      : safeDefaultSplit;
    if (hasOverride && Math.abs(splitPctA - safeDefaultSplit) > 0.001) {
      hasCustomSplitOverrides = true;
    }

    pendingCommonRecurringItems.push({
      id: `rec_${rec.id}_${monthKey}`,
      concept: rec.concept,
      category: rec.category,
      amount: amountCents / 100,
      dueDate,
      daysUntil: localDaysBetween(referenceDate, dueDate),
      isFromRecurring: true,
      recurringId: rec.id,
      splitPctA,
      hasSplitOverride: hasOverride,
    });
  }

  pendingCommonRecurringItems.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.concept.localeCompare(b.concept, 'es')
  );

  const pendingCommonRecurringTotal = roundCents(
    pendingCommonRecurringItems.reduce((s, it) => s + it.amount, 0)
  );

  // Separar pendientes de Cuenta común según referenceDate
  // - Si NO hay saldo manual del mes: las vencidas sin registrar en el mes actual también son cargos pendientes reales
  //   (si monthKey >= todayISO.slice(0,7)), pero cuando SÍ hay saldo manual con referenceDate,
  //   las anteriores a referenceDate se muestran aparte como "con fecha anterior al saldo" para no doble-restarlas silenciosamente.
  const unregisteredBeforeRefItems: CommonAccountScheduledItem[] = [];
  const futurePendingCommonItems: CommonAccountScheduledItem[] = [];

  for (const item of pendingCommonRecurringItems) {
    if (item.dueDate < referenceDate) {
      unregisteredBeforeRefItems.push(item);
    } else {
      futurePendingCommonItems.push(item);
    }
  }

  const unregisteredBeforeRefTotal = roundCents(
    unregisteredBeforeRefItems.reduce((s, it) => s + it.amount, 0)
  );

  // 4. Categorías variables seleccionadas para financiarse desde Cuenta común (sin doble conteo)
  const explicitLimits = extractExplicitBudgetLimits(options?.budget);
  const selectedCats = sanitizePlannedCommonCategories(options?.plannedCommonCategoryIds ?? []);

  const regAllByCatCents = new Map<string, number>();
  const regCommonByCatCents = new Map<string, number>();
  for (const tx of sharedMonthTxs) {
    const cents = Math.round(roundCents(tx.amount) * 100);
    regAllByCatCents.set(tx.category, (regAllByCatCents.get(tx.category) ?? 0) + cents);
    if (tx.paidBy === COMMON_ACCOUNT_ID) {
      regCommonByCatCents.set(tx.category, (regCommonByCatCents.get(tx.category) ?? 0) + cents);
    }
  }

  const plannedVariableRows: CommonAccountPlannedVariableRow[] = [];
  let plannedVariableMarginTotalCents = 0;

  for (const catId of selectedCats) {
    const resolved = registry.getMeta(catId);
    const hasExplicitBudget = explicitLimits.has(catId);
    const budgetLimit = hasExplicitBudget ? explicitLimits.get(catId)! : null;
    const budgetCents = budgetLimit !== null ? Math.round(budgetLimit * 100) : 0;

    const regAllCents = regAllByCatCents.get(catId) ?? 0;
    const regCommonCents = regCommonByCatCents.get(catId) ?? 0;
    const regIndCents = Math.max(0, regAllCents - regCommonCents);

    const pendAllCents = pendingAllRecsByCatCents.get(catId) ?? 0;
    const pendCommonCents = pendingCommonRecsByCatCents.get(catId) ?? 0;
    const pendIndCents = Math.max(0, pendAllCents - pendCommonCents);

    // Solo el margen variable NO consumido ni comprometido todavía (evita duplicar recurrentes y gastos ya registrados)
    const unconsumedMarginCents = hasExplicitBudget
      ? Math.max(0, budgetCents - (regAllCents + pendAllCents))
      : 0;

    plannedVariableMarginTotalCents += unconsumedMarginCents;

    plannedVariableRows.push({
      categoryId: catId,
      label: resolved.label,
      color: resolved.color,
      isArchived: resolved.archived,
      hasExplicitBudget,
      budgetLimit,
      registeredCommon: regCommonCents / 100,
      registeredIndividual: regIndCents / 100,
      pendingCommon: pendCommonCents / 100,
      pendingIndividual: pendIndCents / 100,
      unconsumedVariableMargin: unconsumedMarginCents / 100,
      categoryCommonTotal: (regCommonCents + pendCommonCents + unconsumedMarginCents) / 100,
    });
  }

  const missingBudgetCategories = plannedVariableRows.filter((row) => !row.hasExplicitBudget);
  const plannedVariableMarginTotal = plannedVariableMarginTotalCents / 100;

  // 5. Calendario de próximos 5 días vs resto del mes (a partir de referenceDate)
  const upcomingScheduled = [...scheduledFromFutureTxs, ...futurePendingCommonItems].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.concept.localeCompare(b.concept, 'es')
  );

  const next5DaysItems = upcomingScheduled.filter((it) => it.daysUntil >= 0 && it.daysUntil <= 5);
  const restOfMonthItems = upcomingScheduled.filter((it) => it.daysUntil > 5);
  const next5DaysTotal = roundCents(next5DaysItems.reduce((s, it) => s + it.amount, 0));
  const restOfMonthTotal = roundCents(restOfMonthItems.reduce((s, it) => s + it.amount, 0));

  // 6. Totales mensuales y necesidades futuras desde referenceDate
  const totalMonthlyNeed = roundCents(
    registeredCommonTotal + pendingCommonRecurringTotal + plannedVariableMarginTotal
  );

  // Importe previsto que debéis tener disponible desde referenceDate:
  // futuros movimientos ya registrados (> refDate) + plantillas pendientes (>= refDate) + margen variable restante
  const requiredAvailableTotal = roundCents(
    next5DaysTotal + restOfMonthTotal + plannedVariableMarginTotal
  );

  // 7. Reparto orientativo exacto al céntimo
  const monthlyShareInputs: Array<{ amount: number; splitPctA: number }> = [
    ...commonTxs.map((t) => ({
      amount: t.amount,
      splitPctA: clampSplitPct(t.splitPctA, safeDefaultSplit),
    })),
    ...pendingCommonRecurringItems.map((it) => ({
      amount: it.amount,
      splitPctA: it.splitPctA,
    })),
    ...(plannedVariableMarginTotal > 0
      ? [{ amount: plannedVariableMarginTotal, splitPctA: safeDefaultSplit }]
      : []),
  ];
  const monthlyShares = allocateExactMemberShares(monthlyShareInputs, safeDefaultSplit);

  const remainingShareInputs: Array<{ amount: number; splitPctA: number }> = [
    ...upcomingScheduled.map((it) => ({
      amount: it.amount,
      splitPctA: it.splitPctA,
    })),
    ...(plannedVariableMarginTotal > 0
      ? [{ amount: plannedVariableMarginTotal, splitPctA: safeDefaultSplit }]
      : []),
  ];
  const remainingShares = allocateExactMemberShares(remainingShareInputs, safeDefaultSplit);

  // 8. Comparación honesta con saldo disponible manual (si existe y pertenece al mes)
  let balanceStatus: CommonAccountRadarResult['balanceStatus'] = 'not_provided';
  let balanceAgeDays: number | null = null;
  let isBalanceStale = false;
  let shortfallAmount = 0;
  let marginAmount = 0;

  if (resolvedManualBalance !== null) {
    balanceAgeDays = localDaysBetween(resolvedManualBalance.referenceDate, todayISO);
    isBalanceStale = balanceAgeDays > 3 || balanceAgeDays < 0;

    if (isBalanceOutdatedMonth) {
      balanceStatus = 'outdated_month';
    } else if (resolvedManualBalance.amount < requiredAvailableTotal) {
      balanceStatus = 'shortfall';
      shortfallAmount = roundCents(requiredAvailableTotal - resolvedManualBalance.amount);
    } else {
      balanceStatus = 'covered';
      marginAmount = roundCents(resolvedManualBalance.amount - requiredAvailableTotal);
    }
  }

  // Reparto exacto del importe faltante proporcional al peso efectivo de las necesidades restantes
  const effectiveRemainingPctA =
    requiredAvailableTotal > 0
      ? (remainingShares.shareA / requiredAvailableTotal) * 100
      : safeDefaultSplit;
  const shortfallShares = splitAmountExactCents(shortfallAmount, effectiveRemainingPctA);

  return {
    monthKey,
    todayISO,
    referenceDate,
    registeredCommonTotal,
    registeredCommonCount,
    registeredToDateTotal: registeredToDateCents / 100,
    registeredToDateCount,
    registeredAfterReferenceTotal: registeredAfterRefCents / 100,
    pendingCommonRecurringTotal,
    pendingCommonRecurringItems,
    unregisteredBeforeRefItems,
    unregisteredBeforeRefTotal,
    plannedVariableRows,
    missingBudgetCategories,
    plannedVariableMarginTotal,
    totalMonthlyNeed,
    monthlyShareA: monthlyShares.shareA,
    monthlyShareB: monthlyShares.shareB,
    next5DaysItems,
    next5DaysTotal,
    restOfMonthItems,
    restOfMonthTotal,
    requiredAvailableTotal,
    orientativeShareA: remainingShares.shareA,
    orientativeShareB: remainingShares.shareB,
    defaultSplitPctA: safeDefaultSplit,
    hasCustomSplitOverrides,
    manualBalance: resolvedManualBalance,
    currentCommonBalance: resolvedManualBalance ? resolvedManualBalance.amount : null,
    balanceStatus,
    balanceAgeDays,
    isBalanceStale,
    isBalanceOutdatedMonth,
    shortfallAmount,
    shortfallShareA: shortfallShares.shareA,
    shortfallShareB: shortfallShares.shareB,
    marginAmount,
  };
}
