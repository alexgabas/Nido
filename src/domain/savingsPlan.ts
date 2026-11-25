import type {
  GoalMovement,
  MonthlySavingsPlan,
  SavingsGoal,
  SavingsPlanAllocation,
} from '../types/nido';
import { computeGoalProgress, getTodayLocalISO, roundCents } from './finance';
import { isValidMonthKey } from './recurrence';

export const MAX_SAVINGS_PLAN_ALLOCATIONS = 50;
export const SAVINGS_PLAN_RULE_ONE_LINER =
  'Reparte por orden de prioridad hasta cubrir la cuota recomendada (o lo que falte de cada meta), sin inventar cuotas para metas sin fecha ni mover sobrantes.';

function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function sanitizeSavingsPlanAllocations(
  allocations: readonly SavingsPlanAllocation[] | null | undefined,
  goalsById?: ReadonlyMap<string, SavingsGoal>
): SavingsPlanAllocation[] {
  if (!Array.isArray(allocations)) return [];
  const seen = new Set<string>();
  const ordered = [...allocations].sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
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

export interface ProposedGoalAllocation {
  goalId: string;
  goalName: string;
  priority: number;
  hasTargetDate: boolean;
  remainingToTarget: number;
  recommendedAmount: number | null;
  cappedDesiredAmount: number | null;
  proposedAmount: number;
  shortfallAmount: number;
  needsManualAmount: boolean;
}

export interface SavingsDistributionProposal {
  targetAmount: number;
  totalAssigned: number;
  unassignedAmount: number;
  allocations: ProposedGoalAllocation[];
  underfunded: ProposedGoalAllocation[];
  ruleExplanation: string;
}

/**
 * Propone un reparto determinista en céntimos enteros siguiendo el orden de prioridad elegido:
 * - Recorre las metas en orden de prioridad.
 * - Si la meta tiene fecha objetivo (cuota recomendada), asigna hasta
 *   min(cuotaRecomendada, loQueFaltaParaElObjetivo, restanteDelPlan).
 * - Si la meta NO tiene fecha objetivo, asigna 0 € (nunca inventa cuota) y la marca para importe manual.
 * - Si sobra dinero tras recorrer todas las metas, queda en `unassignedAmount` ("Sin asignar").
 */
export function proposeMonthlySavingsDistribution(params: {
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
    const remainingCents = Math.max(0, toCents(progress.remaining));
    const hasTargetDate = Boolean(goal.targetDate && goal.targetDate.trim());
    const recommendedCents =
      hasTargetDate && !progress.isCompleted && progress.monthlyNeeded !== null
        ? Math.max(0, toCents(progress.monthlyNeeded))
        : null;

    let cappedDesiredCents: number | null = null;
    let proposedCents = 0;
    let shortfallCents = 0;
    let needsManualAmount = false;

    if (recommendedCents !== null && remainingCents > 0) {
      cappedDesiredCents = Math.min(recommendedCents, remainingCents);
      proposedCents = Math.min(cappedDesiredCents, remainingPoolCents);
      remainingPoolCents -= proposedCents;
      totalAssignedCents += proposedCents;
      shortfallCents = Math.max(0, cappedDesiredCents - proposedCents);
    } else if (!hasTargetDate && !progress.isCompleted) {
      needsManualAmount = true;
    }

    allocations.push({
      goalId: goal.id,
      goalName: goal.name,
      priority: allocations.length,
      hasTargetDate,
      remainingToTarget: fromCents(remainingCents),
      recommendedAmount: recommendedCents !== null ? fromCents(recommendedCents) : null,
      cappedDesiredAmount: cappedDesiredCents !== null ? fromCents(cappedDesiredCents) : null,
      proposedAmount: fromCents(proposedCents),
      shortfallAmount: fromCents(shortfallCents),
      needsManualAmount,
    });
  }

  return {
    targetAmount: fromCents(targetCents),
    totalAssigned: fromCents(totalAssignedCents),
    unassignedAmount: fromCents(remainingPoolCents),
    allocations,
    underfunded: allocations.filter((a) => a.shortfallAmount > 0),
    ruleExplanation: SAVINGS_PLAN_RULE_ONE_LINER,
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
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): MonthlySavingsPlanEvaluation {
  const monthKey = isValidMonthKey(params.monthKey) ? params.monthKey : getTodayLocalISO().slice(0, 7);
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
      goal && !goal.archived && progress && !progress.isCompleted && hasTargetDate && progress.monthlyNeeded !== null
        ? Math.min(Math.max(0, toCents(progress.monthlyNeeded)), Math.max(0, toCents(progress.remaining)))
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
      plannedCents > 0 ? Math.min(100, Math.round((contributedCents / plannedCents) * 1000) / 10) : 0;

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

  // Unplanned activity in monthKey (goals that had deposits or withdrawals in this month but aren't in the plan)
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
  unplannedActivity.sort((a, b) => b.contributedAmount - a.contributedAmount || a.goalName.localeCompare(b.goalName));

  const unassignedCents = Math.max(0, targetCents - totalAssignedCents);
  const overAllocatedCents = Math.max(0, totalAssignedCents - targetCents);

  return {
    monthKey,
    hasPlan: Boolean(plan),
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
 * - Si el mes ya tiene plan guardado, carga su importe objetivo y sus asignaciones en orden de prioridad
 *   (preservando metas archivadas/completadas que ya estuvieran en ese plan) y añade detrás las metas
 *   activas no completadas restantes como no seleccionadas.
 * - Si NO tiene plan, deja `targetInput` vacío (nunca aplica automáticamente la capacidad estimada),
 *   y preselecciona únicamente metas activas y no completadas, ordenadas según la prioridad del plan más
 *   reciente si existe.
 */
export function buildInitialSavingsPlanDraft(params: {
  existingPlan: MonthlySavingsPlan | null | undefined;
  allPlans: readonly MonthlySavingsPlan[];
  goals: readonly SavingsGoal[];
  movements: readonly GoalMovement[];
  refDateISO?: string;
}): InitialPlanDraft {
  const refDateISO = params.refDateISO || getTodayLocalISO();
  const selectableGoals = getDefaultSelectableSavingsGoals(params.goals, params.movements, refDateISO);
  const selectableIds = new Set(selectableGoals.map((g) => g.id));
  const goalsById = new Map(params.goals.map((g) => [g.id, g]));

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

    for (const g of selectableGoals) {
      if (seen.has(g.id)) continue;
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

  // No existing plan for this month: inherit priority order from latest saved plan (if any), never auto-fill amounts
  const latestPlan = [...params.allPlans].sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] ?? null;
  const priorityIndex = new Map<string, number>();
  if (latestPlan) {
    const sorted = sanitizeSavingsPlanAllocations(latestPlan.allocations, goalsById);
    sorted.forEach((a, idx) => priorityIndex.set(a.goalId, idx));
  }

  const orderedSelectable = [...selectableGoals].sort((a, b) => {
    const pa = priorityIndex.has(a.id) ? (priorityIndex.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const pb = priorityIndex.has(b.id) ? (priorityIndex.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return 0;
  });

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
