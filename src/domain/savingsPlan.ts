import {
  COMMON_ACCOUNT_ID,
  type GoalMovement,
  type HabitualSavingsPlan,
  type MonthlySavingsPlan,
  type SavingsGoal,
  type SavingsPlanAdjustmentKind,
  type SavingsPlanAllocation,
} from '../types/nido';
import type { CommonAccountRadarResult } from './commonAccountRadar';
import {
  clampSplitPct,
  computeGoalProgress,
  formatEUR,
  fromCents,
  getTodayLocalISO,
  roundCents,
  toCents,
} from './finance';
import { isValidMonthKey } from './recurrence';

export const MAX_SAVINGS_PLAN_ALLOCATIONS = 50;
export const SAVINGS_PLAN_RULE_ONE_LINER =
  'Reparte por orden de prioridad llenando cada meta hasta lo que le falta para su objetivo y pasando el sobrante a la siguiente.';

export type EffectiveSavingsPlanSource = 'saved' | 'habitual' | 'none';

export function sanitizeSavingsPlanAllocations(
  allocations: readonly SavingsPlanAllocation[] | null | undefined,
  goalsById?: ReadonlyMap<string, SavingsGoal>
): SavingsPlanAllocation[] {
  if (!Array.isArray(allocations)) return [];
  const seen = new Set<string>();
  const ordered = [...allocations].sort(
    (a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0)
  );
  const clean: SavingsPlanAllocation[] = [];

  for (const item of ordered) {
    if (clean.length >= MAX_SAVINGS_PLAN_ALLOCATIONS) break;
    const goalId = typeof item?.goalId === 'string' ? item.goalId.trim() : '';
    if (!goalId || !/^[a-zA-Z0-9_-]{1,128}$/.test(goalId) || seen.has(goalId)) continue;
    seen.add(goalId);

    const rawAmount = Number(item.plannedAmount);
    const plannedCents = Number.isFinite(rawAmount) && rawAmount >= 0 ? toCents(rawAmount) : 0;
    const snapshotRaw =
      typeof item.goalNameSnapshot === 'string' && item.goalNameSnapshot.trim()
        ? item.goalNameSnapshot.trim()
        : goalsById?.get(goalId)?.name?.trim() || '';
    const goalNameSnapshot = snapshotRaw ? snapshotRaw.slice(0, 80) : undefined;

    clean.push({
      goalId,
      plannedAmount: fromCents(plannedCents),
      priority: clean.length,
      ...(goalNameSnapshot ? { goalNameSnapshot } : {}),
    });
  }

  return clean;
}

export function sanitizeHabitualSavingsPlan(
  raw: unknown
): HabitualSavingsPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const amountNum = Number(r.monthlyAmount);
  if (!Number.isFinite(amountNum) || amountNum < 0) return null;

  const seen = new Set<string>();
  const priorityGoalIds: string[] = [];
  if (Array.isArray(r.priorityGoalIds)) {
    for (const rawId of r.priorityGoalIds) {
      if (priorityGoalIds.length >= MAX_SAVINGS_PLAN_ALLOCATIONS) break;
      if (typeof rawId !== 'string') continue;
      const cleanId = rawId.trim();
      if (!cleanId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId) || seen.has(cleanId)) continue;
      seen.add(cleanId);
      priorityGoalIds.push(cleanId);
    }
  }

  return {
    monthlyAmount: roundCents(amountNum),
    priorityGoalIds,
    updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy.slice(0, 128) : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 64) : '',
  };
}

export function getDefaultSelectableSavingsGoals(
  goals: readonly SavingsGoal[],
  movements: readonly GoalMovement[],
  refDateISO = getTodayLocalISO()
): SavingsGoal[] {
  const movArr = movements as GoalMovement[];
  return goals.filter((goal) => {
    if (goal.archived) return false;
    const progress = computeGoalProgress(goal, movArr, refDateISO);
    return !progress.isCompleted;
  });
}

function defaultGoalTypePriorityRank(goal: SavingsGoal): number {
  if (goal.type === 'emergencia') return 0;
  if (goal.type === 'ahorro_comun') return 1;
  return 2;
}

/**
 * Ordena las metas según:
 * 1) El orden de prioridad guardado en el plan habitual (si existe),
 * 2) En su defecto, el orden del último plan mensual guardado (si existe),
 * 3) Para las metas sin prioridad previa: Colchón de emergencia primero, luego Ahorro común, y después el resto.
 */
export function sortGoalsByHabitualPriority(
  goals: readonly SavingsGoal[],
  habitualPriorityIds?: readonly string[] | null,
  latestPlan?: MonthlySavingsPlan | null
): SavingsGoal[] {
  const explicitOrder = new Map<string, number>();
  if (habitualPriorityIds && habitualPriorityIds.length > 0) {
    habitualPriorityIds.forEach((id, idx) => {
      if (!explicitOrder.has(id)) explicitOrder.set(id, idx);
    });
  } else if (latestPlan && latestPlan.allocations.length > 0) {
    const sorted = sanitizeSavingsPlanAllocations(latestPlan.allocations);
    sorted.forEach((a, idx) => {
      if (!explicitOrder.has(a.goalId)) explicitOrder.set(a.goalId, idx);
    });
  }

  return [...goals].sort((a, b) => {
    const hasA = explicitOrder.has(a.id);
    const hasB = explicitOrder.has(b.id);
    if (hasA && hasB) {
      return (explicitOrder.get(a.id) as number) - (explicitOrder.get(b.id) as number);
    }
    if (hasA) return -1;
    if (hasB) return 1;
    const rankA = defaultGoalTypePriorityRank(a);
    const rankB = defaultGoalTypePriorityRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return 0;
  });
}

export type SavingsProposalStatus =
  | 'ok'
  | 'missing_target_amount'
  | 'no_selected_goals'
  | 'all_manual_or_completed';

export interface ProposedGoalAllocation {
  goalId: string;
  goalName: string;
  priority: number;
  hasTargetDate: boolean;
  hasTargetAmount: boolean;
  isCompleted: boolean;
  isArchived: boolean;
  remainingToTarget: number;
  /** Referencia informativa de cuota mensual por fecha objetivo (NO limita el reparto de llenado) */
  recommendedAmount: number | null;
  cappedDesiredAmount: number | null;
  proposedAmount: number;
  shortfallAmount: number;
  needsManualAmount: boolean;
  manualReason?: 'sin_objetivo';
}

export interface SavingsDistributionProposal {
  status: SavingsProposalStatus;
  targetAmount: number;
  totalAssigned: number;
  unassignedAmount: number;
  allocations: ProposedGoalAllocation[];
  underfunded: ProposedGoalAllocation[];
  manualOnlyGoals: ProposedGoalAllocation[];
  ruleExplanation: string;
  feedbackMessage: string;
}

/**
 * Propone un reparto determinista en céntimos enteros siguiendo la regla de llenado por prioridad:
 * - Recorre las metas seleccionadas en orden de prioridad.
 * - Salta metas archivadas o ya completadas (remaining <= 0).
 * - Si una meta tiene importe objetivo (`targetAmount > 0`), le asigna hasta lo que le falta
 *   para completarlo (`min(remaining, poolRestante)`), sin toparlo a la cuota mensual por fecha.
 *   El sobrante pasa a la siguiente meta de la lista.
 * - Las metas sin fecha objetivo SÍ reciben dinero si tienen `targetAmount > 0`.
 * - Si una meta no tiene importe objetivo (`targetAmount <= 0`), deja 0 € y explica que requiere importe manual.
 * - Si sobra dinero tras recorrer todas las metas elegibles, queda explícitamente en `unassignedAmount`.
 */
export function proposeHabitualFillDistribution(params: {
  targetAmount: number;
  orderedGoalIds: readonly string[];
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): SavingsDistributionProposal {
  const refDateISO = params.refDateISO || getTodayLocalISO();
  const targetCents = Math.max(0, toCents(Number(params.targetAmount) || 0));
  const goalsById = new Map(params.goals.map((g) => [g.id, g]));
  const movArr = params.movements as GoalMovement[];

  let remainingPoolCents = targetCents;
  let totalAssignedCents = 0;
  const seen = new Set<string>();
  const allocations: ProposedGoalAllocation[] = [];

  for (const rawId of params.orderedGoalIds) {
    const goalId = rawId.trim();
    if (!goalId || seen.has(goalId)) continue;
    const goal = goalsById.get(goalId);
    if (!goal) continue;
    seen.add(goalId);

    const progress = computeGoalProgress(goal, movArr, refDateISO);
    const hasTargetAmount = Number(goal.targetAmount) > 0;
    const hasTargetDate = Boolean(goal.targetDate && goal.targetDate.trim());
    const remainingCents = hasTargetAmount ? Math.max(0, toCents(progress.remaining)) : 0;
    const recommendedCents =
      hasTargetDate && hasTargetAmount && !progress.isCompleted && progress.monthlyNeeded !== null
        ? Math.max(0, toCents(progress.monthlyNeeded))
        : null;

    let cappedDesiredCents: number | null = null;
    let proposedCents = 0;
    let shortfallCents = 0;
    let needsManualAmount = false;
    let manualReason: 'sin_objetivo' | undefined = undefined;

    if (goal.archived || progress.isCompleted) {
      proposedCents = 0;
    } else if (!hasTargetAmount) {
      needsManualAmount = true;
      manualReason = 'sin_objetivo';
      proposedCents = 0;
    } else if (remainingCents > 0) {
      cappedDesiredCents = remainingCents;
      proposedCents = Math.min(remainingCents, remainingPoolCents);
      remainingPoolCents -= proposedCents;
      totalAssignedCents += proposedCents;
      shortfallCents = Math.max(0, remainingCents - proposedCents);
    }

    allocations.push({
      goalId: goal.id,
      goalName: goal.name,
      priority: allocations.length,
      hasTargetDate,
      hasTargetAmount,
      isCompleted: progress.isCompleted,
      isArchived: goal.archived,
      remainingToTarget: fromCents(remainingCents),
      recommendedAmount: recommendedCents !== null ? fromCents(recommendedCents) : null,
      cappedDesiredAmount: cappedDesiredCents !== null ? fromCents(cappedDesiredCents) : null,
      proposedAmount: fromCents(proposedCents),
      shortfallAmount: fromCents(shortfallCents),
      needsManualAmount,
      ...(manualReason ? { manualReason } : {}),
    });
  }

  const manualOnlyGoals = allocations.filter((a) => a.needsManualAmount);
  const totalAssigned = fromCents(totalAssignedCents);
  const unassignedAmount = fromCents(remainingPoolCents);
  const targetAmount = fromCents(targetCents);

  let status: SavingsProposalStatus = 'ok';
  let feedbackMessage = '';

  if (targetCents <= 0) {
    status = 'missing_target_amount';
    feedbackMessage =
      'Indica primero un importe mayor que 0 € en «Cuánto apartar» para calcular el reparto por prioridad.';
  } else if (allocations.length === 0) {
    status = 'no_selected_goals';
    feedbackMessage =
      'Marca al menos una meta activa para poder repartir el ahorro del mes.';
  } else if (totalAssignedCents === 0) {
    status = 'all_manual_or_completed';
    if (manualOnlyGoals.length > 0) {
      feedbackMessage = `No se ha asignado automáticamente porque ${manualOnlyGoals.map((g) => g.goalName).join(', ')} no ${manualOnlyGoals.length === 1 ? 'tiene importe objetivo' : 'tienen importe objetivo'}. Puedes añadirles un objetivo o escribir su importe a mano.`;
    } else {
      feedbackMessage =
        'Las metas seleccionadas ya están completadas o archivadas; los importes quedan sin asignar para que decidas manualmente.';
    }
  } else {
    const filledSummary = allocations
      .filter((a) => a.proposedAmount > 0)
      .map((a) => `${a.goalName}: ${formatEUR(a.proposedAmount)}`)
      .join(' · ');
    const parts = [`Reparto propuesto (${formatEUR(totalAssigned)}): ${filledSummary}.`];
    if (unassignedAmount > 0) {
      parts.push(`Quedan ${formatEUR(unassignedAmount)} sin asignar.`);
    }
    if (manualOnlyGoals.length > 0) {
      parts.push(
        `Sin importe objetivo (asignación manual): ${manualOnlyGoals.map((g) => g.goalName).join(', ')}.`
      );
    }
    feedbackMessage = parts.join(' ');
  }

  return {
    status,
    targetAmount,
    totalAssigned,
    unassignedAmount,
    allocations,
    underfunded: allocations.filter((a) => a.shortfallAmount > 0),
    manualOnlyGoals,
    ruleExplanation: SAVINGS_PLAN_RULE_ONE_LINER,
    feedbackMessage,
  };
}

/**
 * Alias principal de «Proponer reparto» que aplica la regla de llenado por prioridad.
 */
export function proposeMonthlySavingsDistribution(params: {
  targetAmount: number;
  orderedGoalIds: readonly string[];
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): SavingsDistributionProposal {
  return proposeHabitualFillDistribution(params);
}

/**
 * Construye una propuesta virtual (sin guardar en base de datos ni crear movimientos)
 * aplicando el plan habitual del hogar al mes seleccionado.
 */
export function buildVirtualPlanFromHabitual(params: {
  monthKey: string;
  habitualPlan: HabitualSavingsPlan;
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): {
  plan: MonthlySavingsPlan;
  proposal: SavingsDistributionProposal;
} {
  const refDateISO = params.refDateISO || getTodayLocalISO();
  const selectableGoals = getDefaultSelectableSavingsGoals(params.goals, params.movements, refDateISO);
  const orderedGoals = sortGoalsByHabitualPriority(
    selectableGoals,
    params.habitualPlan.priorityGoalIds,
    null
  );
  const proposal = proposeHabitualFillDistribution({
    targetAmount: params.habitualPlan.monthlyAmount,
    orderedGoalIds: orderedGoals.map((g) => g.id),
    goals: params.goals,
    movements: params.movements,
    refDateISO,
  });

  const allocations: SavingsPlanAllocation[] = proposal.allocations.map((a, idx) => ({
    goalId: a.goalId,
    plannedAmount: a.proposedAmount,
    priority: idx,
    goalNameSnapshot: a.goalName,
  }));

  return {
    proposal,
    plan: {
      monthKey: params.monthKey,
      targetAmount: proposal.targetAmount,
      allocations,
      updatedBy: params.habitualPlan.updatedBy,
      updatedAt: params.habitualPlan.updatedAt,
    },
  };
}

/**
 * Resuelve el plan efectivo para un mes concreto:
 * - Si existe un plan guardado para ese mes (`savingsPlans/{monthKey}`), lo respeta intacto (`source: 'saved'`).
 * - Si no existe plan guardado pero hay plan habitual configurado (> 0 €), genera la propuesta del plan habitual (`source: 'habitual'`).
 * - Si no hay ninguno, devuelve `source: 'none'`.
 * Nunca modifica ni reescribe meses pasados ni crea movimientos.
 */
export function resolveEffectiveMonthSavingsPlan(params: {
  monthKey: string;
  savedPlan: MonthlySavingsPlan | null | undefined;
  habitualPlan: HabitualSavingsPlan | null | undefined;
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): {
  source: EffectiveSavingsPlanSource;
  plan: MonthlySavingsPlan | null;
  habitualProposal: SavingsDistributionProposal | null;
} {
  if (params.savedPlan) {
    return {
      source: 'saved',
      plan: params.savedPlan,
      habitualProposal: null,
    };
  }
  if (params.habitualPlan && params.habitualPlan.monthlyAmount > 0) {
    const built = buildVirtualPlanFromHabitual({
      monthKey: params.monthKey,
      habitualPlan: params.habitualPlan,
      goals: params.goals,
      movements: params.movements,
      refDateISO: params.refDateISO,
    });
    return {
      source: 'habitual',
      plan: built.plan,
      habitualProposal: built.proposal,
    };
  }
  return {
    source: 'none',
    plan: null,
    habitualProposal: null,
  };
}

export interface ExtraSavingsGoalDiff {
  goalId: string;
  goalName: string;
  beforePlanned: number;
  extraAdded: number;
  afterPlanned: number;
}

export interface ExtraSavingsPlanResult {
  beforeTarget: number;
  extraAmount: number;
  afterTarget: number;
  extraAssigned: number;
  extraUnassigned: number;
  extraOverAllocated: number;
  mergedAllocations: SavingsPlanAllocation[];
  goalDiffs: ExtraSavingsGoalDiff[];
}

/**
 * Combina el plan base del mes (guardado o propuesta habitual) con un ahorro extra explícito,
 * repartiendo ÚNICAMENTE el extra entre las metas elegidas sin duplicar la base habitual.
 */
export function buildExtraSavingsPlan(params: {
  basePlan: MonthlySavingsPlan | null | undefined;
  extraAmount: number;
  extraAllocationsByGoalId: Readonly<Record<string, number>>;
  goals: readonly SavingsGoal[];
}): ExtraSavingsPlanResult {
  const goalsById = new Map(params.goals.map((g) => [g.id, g]));
  const baseTargetCents = params.basePlan ? Math.max(0, toCents(params.basePlan.targetAmount)) : 0;
  const extraAmountCents = Math.max(0, toCents(params.extraAmount));
  const afterTargetCents = baseTargetCents + extraAmountCents;

  const baseAllocs = params.basePlan
    ? sanitizeSavingsPlanAllocations(params.basePlan.allocations, goalsById)
    : [];
  const baseMap = new Map<string, SavingsPlanAllocation>();
  baseAllocs.forEach((a) => baseMap.set(a.goalId, a));

  const orderedIds: string[] = baseAllocs.map((a) => a.goalId);
  for (const [goalId, rawExtra] of Object.entries(params.extraAllocationsByGoalId)) {
    const cleanExtraCents = Math.max(0, toCents(Number(rawExtra) || 0));
    if (cleanExtraCents > 0 && !baseMap.has(goalId)) {
      orderedIds.push(goalId);
    }
  }

  let extraAssignedCents = 0;
  const mergedAllocations: SavingsPlanAllocation[] = [];
  const goalDiffs: ExtraSavingsGoalDiff[] = [];

  for (const goalId of orderedIds) {
    const baseAlloc = baseMap.get(goalId);
    const beforeCents = baseAlloc ? Math.max(0, toCents(baseAlloc.plannedAmount)) : 0;
    const addedCents = Math.max(0, toCents(Number(params.extraAllocationsByGoalId[goalId]) || 0));
    const afterCents = beforeCents + addedCents;
    extraAssignedCents += addedCents;

    const goalName =
      goalsById.get(goalId)?.name || baseAlloc?.goalNameSnapshot || 'Meta';

    mergedAllocations.push({
      goalId,
      plannedAmount: fromCents(afterCents),
      priority: mergedAllocations.length,
      goalNameSnapshot: goalName.slice(0, 80),
    });

    goalDiffs.push({
      goalId,
      goalName,
      beforePlanned: fromCents(beforeCents),
      extraAdded: fromCents(addedCents),
      afterPlanned: fromCents(afterCents),
    });
  }

  return {
    beforeTarget: fromCents(baseTargetCents),
    extraAmount: fromCents(extraAmountCents),
    afterTarget: fromCents(afterTargetCents),
    extraAssigned: fromCents(extraAssignedCents),
    extraUnassigned: fromCents(Math.max(0, extraAmountCents - extraAssignedCents)),
    extraOverAllocated: fromCents(Math.max(0, extraAssignedCents - extraAmountCents)),
    mergedAllocations,
    goalDiffs,
  };
}

export type PlannedGoalStatus =
  | 'sin_asignacion'
  | 'pendiente'
  | 'en_curso'
  | 'completado'
  | 'excedido';

export interface EvaluatedSavingsPlanRow {
  goalId: string;
  goalName: string;
  goalColor: string;
  priority: number;
  isArchived: boolean;
  isCompleted: boolean;
  isMissingGoal: boolean;
  hasTargetDate: boolean;
  plannedAmount: number;
  recommendedAmount: number | null;
  belowRecommendedBy: number;
  contributedAmount: number;
  withdrawnAmount: number;
  pendingAmount: number;
  excessAmount: number;
  progressPct: number;
  status: PlannedGoalStatus;
}

export interface UnplannedGoalMonthActivity {
  goalId: string;
  goalName: string;
  goalColor: string;
  isArchived: boolean;
  contributedAmount: number;
  withdrawnAmount: number;
}

export interface MonthlySavingsPlanEvaluation {
  monthKey: string;
  hasPlan: boolean;
  planSource: EffectiveSavingsPlanSource;
  adjustmentKind?: SavingsPlanAdjustmentKind;
  extraAmount?: number;
  targetAmount: number;
  totalAssigned: number;
  unassignedAmount: number;
  overAllocatedAmount: number;
  totalContributedPlanned: number;
  totalContributedAll: number;
  totalWithdrawnPlanned: number;
  totalWithdrawnAll: number;
  totalPending: number;
  totalExcess: number;
  rows: EvaluatedSavingsPlanRow[];
  rowsByGoalId: ReadonlyMap<string, EvaluatedSavingsPlanRow>;
  unplannedActivity: UnplannedGoalMonthActivity[];
  underfundedRows: EvaluatedSavingsPlanRow[];
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Evalúa el plan de ahorro de un mes frente a los movimientos reales de ese mes.
 * - Las aportaciones positivas (`amount > 0`) cuentan para "Aportado" (incluidas las anteriores a guardar el plan).
 * - Las retiradas (`amount < 0`) se suman por separado en `withdrawnAmount` y NO restan de "Aportado".
 * - Si una meta supera lo planificado, `pendingAmount` es 0 y el excedente se refleja en `excessAmount`.
 * - Las metas archivadas o borradas siguen siendo legibles en planes históricos.
 */
export function evaluateMonthlySavingsPlan(params: {
  monthKey: string;
  plan: MonthlySavingsPlan | null | undefined;
  planSource?: EffectiveSavingsPlanSource;
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): MonthlySavingsPlanEvaluation {
  const monthKey = isValidMonthKey(params.monthKey)
    ? params.monthKey
    : getTodayLocalISO().slice(0, 7);
  const refDateISO = params.refDateISO || getTodayLocalISO();
  const goalsById = new Map(params.goals.map((g) => [g.id, g]));
  const movArr = params.movements as GoalMovement[];

  // Aggregate real deposits and withdrawals strictly for `monthKey`
  const contributedCentsByGoal = new Map<string, number>();
  const withdrawnCentsByGoal = new Map<string, number>();
  let totalContributedAllCents = 0;
  let totalWithdrawnAllCents = 0;

  for (const m of movArr) {
    if (!m.date || m.date.slice(0, 7) !== monthKey) continue;
    const rawCents = toCents(Number(m.amount) || 0);
    if (rawCents > 0) {
      contributedCentsByGoal.set(m.goalId, (contributedCentsByGoal.get(m.goalId) ?? 0) + rawCents);
      totalContributedAllCents += rawCents;
    } else if (rawCents < 0) {
      const absCents = Math.abs(rawCents);
      withdrawnCentsByGoal.set(m.goalId, (withdrawnCentsByGoal.get(m.goalId) ?? 0) + absCents);
      totalWithdrawnAllCents += absCents;
    }
  }

  const plan = params.plan ?? null;
  const planSource: EffectiveSavingsPlanSource =
    params.planSource ?? (plan ? 'saved' : 'none');
  const targetCents = plan ? Math.max(0, toCents(Number(plan.targetAmount) || 0)) : 0;
  const cleanAllocations = plan ? sanitizeSavingsPlanAllocations(plan.allocations, goalsById) : [];

  const rows: EvaluatedSavingsPlanRow[] = [];
  const rowsByGoalId = new Map<string, EvaluatedSavingsPlanRow>();
  const plannedGoalIds = new Set<string>();

  let totalAssignedCents = 0;
  let totalContributedPlannedCents = 0;
  let totalWithdrawnPlannedCents = 0;
  let totalPendingCents = 0;
  let totalExcessCents = 0;

  for (const alloc of cleanAllocations) {
    plannedGoalIds.add(alloc.goalId);
    const goal = goalsById.get(alloc.goalId) ?? null;
    const progress = goal ? computeGoalProgress(goal, movArr, refDateISO) : null;

    const plannedCents = Math.max(0, toCents(alloc.plannedAmount));
    const contributedCents = contributedCentsByGoal.get(alloc.goalId) ?? 0;
    const withdrawnCents = withdrawnCentsByGoal.get(alloc.goalId) ?? 0;
    const pendingCents = Math.max(0, plannedCents - contributedCents);
    const excessCents = plannedCents > 0 ? Math.max(0, contributedCents - plannedCents) : 0;

    const hasTargetDate = Boolean(goal?.targetDate && goal.targetDate.trim());
    const recommendedCents =
      goal &&
      !goal.archived &&
      progress &&
      !progress.isCompleted &&
      hasTargetDate &&
      progress.monthlyNeeded !== null
        ? Math.min(
            Math.max(0, toCents(progress.monthlyNeeded)),
            Math.max(0, toCents(progress.remaining))
          )
        : null;
    const belowRecommendedCents =
      recommendedCents !== null && plannedCents < recommendedCents
        ? recommendedCents - plannedCents
        : 0;

    let status: PlannedGoalStatus = 'sin_asignacion';
    if (plannedCents === 0) {
      status = contributedCents > 0 ? 'completado' : 'sin_asignacion';
    } else if (excessCents > 0) {
      status = 'excedido';
    } else if (pendingCents === 0) {
      status = 'completado';
    } else if (contributedCents > 0) {
      status = 'en_curso';
    } else {
      status = 'pendiente';
    }

    const progressPct =
      plannedCents > 0
        ? Math.min(100, Math.round((contributedCents / plannedCents) * 1000) / 10)
        : 0;

    totalAssignedCents += plannedCents;
    totalContributedPlannedCents += contributedCents;
    totalWithdrawnPlannedCents += withdrawnCents;
    totalPendingCents += pendingCents;
    totalExcessCents += excessCents;

    const row: EvaluatedSavingsPlanRow = {
      goalId: alloc.goalId,
      goalName: goal?.name || alloc.goalNameSnapshot || 'Meta eliminada',
      goalColor: goal?.color || '#0E5A64',
      priority: alloc.priority,
      isArchived: Boolean(goal?.archived),
      isCompleted: Boolean(progress?.isCompleted),
      isMissingGoal: !goal,
      hasTargetDate,
      plannedAmount: fromCents(plannedCents),
      recommendedAmount: recommendedCents !== null ? fromCents(recommendedCents) : null,
      belowRecommendedBy: fromCents(belowRecommendedCents),
      contributedAmount: fromCents(contributedCents),
      withdrawnAmount: fromCents(withdrawnCents),
      pendingAmount: fromCents(pendingCents),
      excessAmount: fromCents(excessCents),
      progressPct,
      status,
    };

    rows.push(row);
    rowsByGoalId.set(row.goalId, row);
  }

  const unplannedGoalIds = new Set<string>();
  for (const gid of contributedCentsByGoal.keys()) {
    if (!plannedGoalIds.has(gid)) unplannedGoalIds.add(gid);
  }
  for (const gid of withdrawnCentsByGoal.keys()) {
    if (!plannedGoalIds.has(gid)) unplannedGoalIds.add(gid);
  }

  const unplannedActivity: UnplannedGoalMonthActivity[] = [];
  for (const gid of unplannedGoalIds) {
    const goal = goalsById.get(gid) ?? null;
    unplannedActivity.push({
      goalId: gid,
      goalName: goal?.name || 'Meta',
      goalColor: goal?.color || '#64748B',
      isArchived: Boolean(goal?.archived),
      contributedAmount: fromCents(contributedCentsByGoal.get(gid) ?? 0),
      withdrawnAmount: fromCents(withdrawnCentsByGoal.get(gid) ?? 0),
    });
  }
  unplannedActivity.sort(
    (a, b) => b.contributedAmount - a.contributedAmount || a.goalName.localeCompare(b.goalName)
  );

  const unassignedCents = Math.max(0, targetCents - totalAssignedCents);
  const overAllocatedCents = Math.max(0, totalAssignedCents - targetCents);

  return {
    monthKey,
    hasPlan: Boolean(plan),
    planSource,
    ...(plan?.adjustmentKind ? { adjustmentKind: plan.adjustmentKind } : {}),
    ...(typeof plan?.extraAmount === 'number' && plan.extraAmount > 0
      ? { extraAmount: roundCents(plan.extraAmount) }
      : {}),
    targetAmount: fromCents(targetCents),
    totalAssigned: fromCents(totalAssignedCents),
    unassignedAmount: fromCents(unassignedCents),
    overAllocatedAmount: fromCents(overAllocatedCents),
    totalContributedPlanned: fromCents(totalContributedPlannedCents),
    totalContributedAll: fromCents(totalContributedAllCents),
    totalWithdrawnPlanned: fromCents(totalWithdrawnPlannedCents),
    totalWithdrawnAll: fromCents(totalWithdrawnAllCents),
    totalPending: fromCents(totalPendingCents),
    totalExcess: fromCents(totalExcessCents),
    rows,
    rowsByGoalId,
    unplannedActivity,
    underfundedRows: rows.filter((r) => r.belowRecommendedBy > 0),
    updatedBy: plan?.updatedBy ?? null,
    updatedAt: plan?.updatedAt ?? null,
  };
}

export interface MonthlyHouseholdContributionsResult {
  monthKey: string;
  splitPctA: number;
  splitPctB: number;
  // Bloque A — Gastos de Cuenta común (NO es el presupuesto global ni "lo que falta ingresar")
  expenses: {
    total: number;
    shareA: number;
    shareB: number;
    registeredCommonTotal: number;
    pendingCommonRecurringTotal: number;
    plannedVariableMarginTotal: number;
    hasCustomSplitOverrides: boolean;
  };
  // Bloque B — Ahorro del mes (separado de gastos, nunca mezclado como deuda)
  savings: {
    planSource: EffectiveSavingsPlanSource;
    totalPlanned: number;
    shareA: number;
    shareB: number;
    assignedTotal: number;
    unassignedAmount: number;
    contributedTotal: number;
    contributedA: number;
    contributedB: number;
    contributedCommon: number;
    withdrawnTotal: number;
    withdrawnA: number;
    withdrawnB: number;
    withdrawnCommon: number;
    pendingA: number;
    pendingB: number;
  };
}

/**
 * Calcula las dos cifras mensuales separadas («Cuánto pone cada uno»):
 * A) Aportación prevista para gastos de Cuenta común (reutilizando computeCommonAccountRadar)
 * B) Aportación prevista para ahorro (reutilizando el plan de ahorro activo y goalMovements del mes)
 * Ambas reconcilian al céntimo exacto por separado (`shareA + shareB === total`),
 * nunca se fusionan en una única deuda ni en una transferencia obligatoria.
 */
export function computeMonthlyHouseholdContributions(params: {
  monthKey: string;
  commonAccountRadar: CommonAccountRadarResult;
  savingsEvaluation: MonthlySavingsPlanEvaluation;
  effectiveSplitPctA: number;
  goalMovements: readonly GoalMovement[];
  memberAUid: string;
  memberBUid: string;
}): MonthlyHouseholdContributionsResult {
  const splitPctA = clampSplitPct(params.effectiveSplitPctA, 50);
  const splitPctB = Math.round((100 - splitPctA) * 10) / 10;

  const savingsTargetCents = Math.max(0, toCents(params.savingsEvaluation.targetAmount));
  const savingsShareACents = Math.round((savingsTargetCents * splitPctA) / 100);
  const savingsShareBCents = savingsTargetCents - savingsShareACents;

  let contributedACents = 0;
  let contributedBCents = 0;
  let contributedCommonCents = 0;
  let withdrawnACents = 0;
  let withdrawnBCents = 0;
  let withdrawnCommonCents = 0;

  for (const m of params.goalMovements) {
    if (!m.date || m.date.slice(0, 7) !== params.monthKey) continue;
    const rawCents = toCents(Number(m.amount) || 0);
    if (rawCents > 0) {
      if (params.memberAUid && m.by === params.memberAUid) {
        contributedACents += rawCents;
      } else if (params.memberBUid && m.by === params.memberBUid) {
        contributedBCents += rawCents;
      } else if (m.by === COMMON_ACCOUNT_ID) {
        contributedCommonCents += rawCents;
      }
    } else if (rawCents < 0) {
      const absCents = Math.abs(rawCents);
      if (params.memberAUid && m.by === params.memberAUid) {
        withdrawnACents += absCents;
      } else if (params.memberBUid && m.by === params.memberBUid) {
        withdrawnBCents += absCents;
      } else if (m.by === COMMON_ACCOUNT_ID) {
        withdrawnCommonCents += absCents;
      }
    }
  }

  return {
    monthKey: params.monthKey,
    splitPctA,
    splitPctB,
    expenses: {
      total: params.commonAccountRadar.totalMonthlyNeed,
      shareA: params.commonAccountRadar.monthlyShareA,
      shareB: params.commonAccountRadar.monthlyShareB,
      registeredCommonTotal: params.commonAccountRadar.registeredCommonTotal,
      pendingCommonRecurringTotal: params.commonAccountRadar.pendingCommonRecurringTotal,
      plannedVariableMarginTotal: params.commonAccountRadar.plannedVariableMarginTotal,
      hasCustomSplitOverrides: params.commonAccountRadar.hasCustomSplitOverrides,
    },
    savings: {
      planSource: params.savingsEvaluation.planSource,
      totalPlanned: fromCents(savingsTargetCents),
      shareA: fromCents(savingsShareACents),
      shareB: fromCents(savingsShareBCents),
      assignedTotal: params.savingsEvaluation.totalAssigned,
      unassignedAmount: params.savingsEvaluation.unassignedAmount,
      contributedTotal: params.savingsEvaluation.totalContributedAll,
      contributedA: fromCents(contributedACents),
      contributedB: fromCents(contributedBCents),
      contributedCommon: fromCents(contributedCommonCents),
      withdrawnTotal: params.savingsEvaluation.totalWithdrawnAll,
      withdrawnA: fromCents(withdrawnACents),
      withdrawnB: fromCents(withdrawnBCents),
      withdrawnCommon: fromCents(withdrawnCommonCents),
      pendingA: fromCents(Math.max(0, savingsShareACents - contributedACents)),
      pendingB: fromCents(Math.max(0, savingsShareBCents - contributedBCents)),
    },
  };
}

export interface DraftAllocationItem {
  goalId: string;
  selected: boolean;
  amountInput: string;
  isHistoricalExtra: boolean; // archived or completed goal already stored in an existing plan
  goalNameSnapshot?: string;
}

export interface InitialPlanDraft {
  targetInput: string;
  items: DraftAllocationItem[];
}

export function formatDecimalInputES(amount: number): string {
  const clean = roundCents(Math.max(0, Number(amount) || 0));
  if (clean === 0) return '0';
  return Number.isInteger(clean) ? String(clean) : clean.toFixed(2).replace('.', ',');
}

export function parseNonNegativeAmountInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.replace(/\s+/g, '').replace('€', '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundCents(parsed);
}

/**
 * Construye el borrador inicial del editor para un mes:
 * - Si el mes ya tiene plan guardado, carga su importe objetivo y sus asignaciones en orden de prioridad.
 * - Si NO tiene plan guardado pero existe un plan habitual configurado (> 0 €), precarga la propuesta
 *   del plan habitual como punto de partida editable (sin guardarla automáticamente).
 * - Si NO tiene ni plan guardado ni plan habitual, deja `targetInput` vacío (nunca aplica la capacidad
 *   estimada automáticamente) y ordena las metas activas con Colchón primero y Ahorro común después.
 */
export function buildInitialSavingsPlanDraft(params: {
  existingPlan: MonthlySavingsPlan | null | undefined;
  habitualPlan?: HabitualSavingsPlan | null;
  allPlans: readonly MonthlySavingsPlan[];
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): InitialPlanDraft {
  const refDateISO = params.refDateISO || getTodayLocalISO();
  const selectableGoals = getDefaultSelectableSavingsGoals(params.goals, params.movements, refDateISO);
  const selectableIds = new Set(selectableGoals.map((g) => g.id));
  const goalsById = new Map(params.goals.map((g) => [g.id, g]));

  const latestPlan =
    [...params.allPlans].sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] ?? null;

  if (params.existingPlan) {
    const cleanAllocs = sanitizeSavingsPlanAllocations(params.existingPlan.allocations, goalsById);
    const seen = new Set<string>();
    const items: DraftAllocationItem[] = [];

    for (const alloc of cleanAllocs) {
      seen.add(alloc.goalId);
      const isSelectable = selectableIds.has(alloc.goalId);
      items.push({
        goalId: alloc.goalId,
        selected: true,
        amountInput: formatDecimalInputES(alloc.plannedAmount),
        isHistoricalExtra: !isSelectable,
        goalNameSnapshot: alloc.goalNameSnapshot || goalsById.get(alloc.goalId)?.name,
      });
    }

    const remainingOrdered = sortGoalsByHabitualPriority(
      selectableGoals.filter((g) => !seen.has(g.id)),
      params.habitualPlan?.priorityGoalIds,
      latestPlan
    );

    for (const g of remainingOrdered) {
      items.push({
        goalId: g.id,
        selected: false,
        amountInput: '0',
        isHistoricalExtra: false,
        goalNameSnapshot: g.name,
      });
    }

    return {
      targetInput: formatDecimalInputES(params.existingPlan.targetAmount),
      items,
    };
  }

  const orderedSelectable = sortGoalsByHabitualPriority(
    selectableGoals,
    params.habitualPlan?.priorityGoalIds,
    latestPlan
  );

  if (params.habitualPlan && params.habitualPlan.monthlyAmount > 0) {
    const proposal = proposeHabitualFillDistribution({
      targetAmount: params.habitualPlan.monthlyAmount,
      orderedGoalIds: orderedSelectable.map((g) => g.id),
      goals: params.goals,
      movements: params.movements,
      refDateISO,
    });
    const proposedById = new Map(proposal.allocations.map((a) => [a.goalId, a.proposedAmount]));
    return {
      targetInput: formatDecimalInputES(params.habitualPlan.monthlyAmount),
      items: orderedSelectable.map((g) => ({
        goalId: g.id,
        selected: true,
        amountInput: formatDecimalInputES(proposedById.get(g.id) ?? 0),
        isHistoricalExtra: false,
        goalNameSnapshot: g.name,
      })),
    };
  }

  return {
    targetInput: '',
    items: orderedSelectable.map((g) => ({
      goalId: g.id,
      selected: true,
      amountInput: '0',
      isHistoricalExtra: false,
      goalNameSnapshot: g.name,
    })),
  };
}
