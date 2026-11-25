import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeGoalProgress,
  formatEUR,
  formatMonthLabelES,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  roundCents,
  shiftMonthKey,
  type SavingsCapacityResult,
} from '../../domain/finance';
import {
  buildInitialSavingsPlanDraft,
  formatDecimalInputES,
  parseNonNegativeAmountInput,
  proposeMonthlySavingsDistribution,
  SAVINGS_PLAN_RULE_ONE_LINER,
  type DraftAllocationItem,
  type MonthlySavingsPlanEvaluation,
  type SavingsDistributionProposal,
} from '../../domain/savingsPlan';
import { usePwaUpdateBlock } from '../../services/pwaUpdateGuard';
import type {
  GoalMovement,
  MonthlySavingsPlan,
  SavingsGoal,
  SavingsPlanAllocation,
  UiMode,
} from '../../types/nido';

interface MonthlySavingsPlanSectionProps {
  uiMode: UiMode;
  planMonthKey: string;
  onChangeMonthKey: (nextMonthKey: string) => void;
  evaluation: MonthlySavingsPlanEvaluation;
  existingPlan: MonthlySavingsPlan | null;
  allPlans: MonthlySavingsPlan[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];
  savingsCapacity: SavingsCapacityResult | null;
  editorOpen: boolean;
  onSetEditorOpen: (open: boolean) => void;
  saving: boolean;
  onSavePlan: (payload: {
    monthKey: string;
    targetAmount: number;
    allocations: SavingsPlanAllocation[];
  }) => Promise<void>;
  onDeletePlan: (monthKey: string) => Promise<void>;
  onContributePending: (goal: SavingsGoal, pendingAmount: number) => void;
}

export const MonthlySavingsPlanSection: React.FC<MonthlySavingsPlanSectionProps> = ({
  uiMode,
  planMonthKey,
  onChangeMonthKey,
  evaluation,
  existingPlan,
  allPlans,
  goals,
  goalMovements,
  savingsCapacity,
  editorOpen,
  onSetEditorOpen,
  saving,
  onSavePlan,
  onDeletePlan,
  onContributePending,
}) => {
  const todayISO = getTodayLocalISO();
  const currentMonthKey = getCurrentMonthKeyLocal();
  const monthLabel = formatMonthLabelES(planMonthKey);

  // Sencillo detail drawer/panel toggle (independent of editor)
  const [sencilloDetailOpen, setSencilloDetailOpen] = useState(false);

  // Editor draft state
  const [targetInput, setTargetInput] = useState('');
  const [draftItems, setDraftItems] = useState<DraftAllocationItem[]>([]);
  const [lastProposal, setLastProposal] = useState<SavingsDistributionProposal | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  usePwaUpdateBlock(editorOpen, 'edit');

  const goalsById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const progressByGoalId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeGoalProgress>>();
    for (const g of goals) {
      map.set(g.id, computeGoalProgress(g, goalMovements, todayISO));
    }
    return map;
  }, [goals, goalMovements, todayISO]);

  // Reset editor draft whenever editor opens or selected month changes
  useEffect(() => {
    if (!editorOpen) {
      setLastProposal(null);
      setConfirmDeleteOpen(false);
      return;
    }
    const initial = buildInitialSavingsPlanDraft({
      existingPlan,
      allPlans,
      goals,
      movements: goalMovements,
      refDateISO: todayISO,
    });
    setTargetInput(initial.targetInput);
    setDraftItems(initial.items);
    setLastProposal(null);
    setConfirmDeleteOpen(false);
  }, [editorOpen, planMonthKey, existingPlan]); // intentionally only re-init on open or month/saved plan switch

  const openEditor = () => {
    if (uiMode === 'sencillo') {
      setSencilloDetailOpen(true);
    }
    onSetEditorOpen(true);
  };

  const handleToggleItem = (goalId: string) => {
    setDraftItems((prev) =>
      prev.map((item) =>
        item.goalId === goalId ? { ...item, selected: !item.selected } : item
      )
    );
    setLastProposal(null);
  };

  const handleAmountChange = (goalId: string, value: string) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.goalId === goalId ? { ...item, amountInput: value } : item))
    );
  };

  const handleMovePriority = (index: number, direction: -1 | 1) => {
    setDraftItems((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, moved);
      return copy;
    });
    setLastProposal(null);
  };

  const draftTargetAmount = useMemo(
    () => parseNonNegativeAmountInput(targetInput),
    [targetInput]
  );

  const selectedDraftItems = useMemo(
    () => draftItems.filter((item) => item.selected),
    [draftItems]
  );

  const draftTotals = useMemo(() => {
    let assignedCents = 0;
    const underfunded: Array<{ goalId: string; goalName: string; recommended: number; planned: number; missing: number }> = [];

    for (const item of selectedDraftItems) {
      const planned = parseNonNegativeAmountInput(item.amountInput);
      const plannedCents = Math.round(planned * 100);
      assignedCents += plannedCents;

      const goal = goalsById.get(item.goalId);
      const prog = progressByGoalId.get(item.goalId);
      if (
        goal &&
        !goal.archived &&
        prog &&
        !prog.isCompleted &&
        goal.targetDate &&
        prog.monthlyNeeded !== null
      ) {
        const desired = roundCents(Math.min(prog.monthlyNeeded, prog.remaining));
        const missing = roundCents(desired - planned);
        if (missing > 0) {
          underfunded.push({
            goalId: goal.id,
            goalName: goal.name,
            recommended: desired,
            planned,
            missing,
          });
        }
      }
    }

    const targetCents = Math.round(draftTargetAmount * 100);
    const unassignedCents = Math.max(0, targetCents - assignedCents);
    const overAllocatedCents = Math.max(0, assignedCents - targetCents);

    return {
      totalAssigned: assignedCents / 100,
      unassigned: unassignedCents / 100,
      overAllocated: overAllocatedCents / 100,
      underfunded,
    };
  }, [selectedDraftItems, draftTargetAmount, goalsById, progressByGoalId]);

  const handleProposeDistribution = () => {
    const orderedIds = selectedDraftItems.map((i) => i.goalId);
    const proposal = proposeMonthlySavingsDistribution({
      targetAmount: draftTargetAmount,
      orderedGoalIds: orderedIds,
      goals,
      movements: goalMovements,
      refDateISO: todayISO,
    });
    const proposedMap = new Map(proposal.allocations.map((a) => [a.goalId, a.proposedAmount]));
    setDraftItems((prev) =>
      prev.map((item) => {
        if (!item.selected) return item;
        if (!proposedMap.has(item.goalId)) return item;
        const val = proposedMap.get(item.goalId) ?? 0;
        return { ...item, amountInput: formatDecimalInputES(val) };
      })
    );
    setLastProposal(proposal);
  };

  const handleSubmitPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const allocations: SavingsPlanAllocation[] = selectedDraftItems.map((item, idx) => {
      const goal = goalsById.get(item.goalId);
      return {
        goalId: item.goalId,
        plannedAmount: parseNonNegativeAmountInput(item.amountInput),
        priority: idx,
        ...(goal?.name || item.goalNameSnapshot
          ? { goalNameSnapshot: (goal?.name || item.goalNameSnapshot || '').slice(0, 80) }
          : {}),
      };
    });
    await onSavePlan({
      monthKey: planMonthKey,
      targetAmount: draftTargetAmount,
      allocations,
    });
    onSetEditorOpen(false);
  };

  const handleConfirmDelete = async () => {
    await onDeletePlan(planMonthKey);
    setConfirmDeleteOpen(false);
    onSetEditorOpen(false);
  };

  const historicalMonths = useMemo(
    () => allPlans.map((p) => p.monthKey).sort((a, b) => b.localeCompare(a)),
    [allPlans]
  );

  // Shared month navigation header
  const monthNavigator = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50">
        <button
          type="button"
          aria-label="Mes anterior del plan de ahorro"
          onClick={() => onChangeMonthKey(shiftMonthKey(planMonthKey, -1))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-l-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-2.5 text-xs sm:text-sm font-semibold capitalize whitespace-nowrap flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
          <span>{monthLabel}</span>
        </span>
        <button
          type="button"
          aria-label="Mes siguiente del plan de ahorro"
          onClick={() => onChangeMonthKey(shiftMonthKey(planMonthKey, 1))}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-r-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {planMonthKey !== currentMonthKey && (
        <button
          type="button"
          onClick={() => onChangeMonthKey(currentMonthKey)}
          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Mes actual
        </button>
      )}
    </div>
  );

  // Shared editor form (used in Avanzado and inside Sencillo detail panel)
  const editorForm = (
    <form
      onSubmit={(e) => void handleSubmitPlan(e)}
      aria-label={`Editor del plan de ahorro de ${monthLabel}`}
      className="rounded-2xl border border-[#0E5A64]/30 dark:border-[#5EEAD4]/25 bg-slate-50/70 dark:bg-slate-900/40 p-4 sm:p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold">
            Planificar el ahorro de {monthLabel}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            Indica cuánto queréis apartar, ordena prioridades y ajusta cada meta.
          </p>
        </div>
        <button
          type="button"
          aria-label="Cerrar editor del plan de ahorro"
          onClick={() => onSetEditorOpen(false)}
          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Manual reserve amount + secondary capacity reference */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-6 space-y-1">
          <label
            htmlFor="savings-plan-target-amount"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            ¿Cuánto queremos apartar este mes? (€)
          </label>
          <input
            id="savings-plan-target-amount"
            type="text"
            inputMode="decimal"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder="Ej. 250,00"
            className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-lg font-bold"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Importe manual (0 € es válido). No te obliga a repartirlo todo.
          </p>
        </div>

        <div className="md:col-span-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-[#132025] p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
            <Info className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
            <span>Referencia orientativa (no se aplica sola)</span>
          </div>
          {savingsCapacity?.hasIncomeConfigured ? (
            <p className="text-slate-600 dark:text-slate-300 tabular-nums">
              Capacidad de ahorro estimada por Nido:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {formatEUR(savingsCapacity.capacity)}/mes
              </strong>
              . Es solo una referencia según ingresos y gasto habitual, no dinero disponible en cuenta.
            </p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">
              Configura vuestros ingresos en Ajustes si quieres ver una referencia orientativa de capacidad mensual.
            </p>
          )}
        </div>
      </div>

      {/* Proponer reparto action + 1-line rule */}
      <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
            {SAVINGS_PLAN_RULE_ONE_LINER}
          </p>
          <button
            type="button"
            disabled={selectedDraftItems.length === 0}
            onClick={handleProposeDistribution}
            className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64]/10 hover:bg-[#0E5A64]/18 text-[#0E5A64] dark:text-[#5EEAD4] border border-[#0E5A64]/30 dark:border-[#5EEAD4]/30 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>Proponer reparto</span>
          </button>
        </div>
        {lastProposal && (
          <p role="status" className="text-xs font-medium text-[#0E5A64] dark:text-[#5EEAD4] tabular-nums">
            Propuesta aplicada al borrador: {formatEUR(lastProposal.totalAssigned)} repartidos
            {lastProposal.unassignedAmount > 0
              ? ` · ${formatEUR(lastProposal.unassignedAmount)} sin asignar.`
              : '.'}{' '}
            Puedes modificar cualquier importe antes de guardar.
          </p>
        )}
      </div>

      {/* Goal selection, priority order & manual amounts */}
      {draftItems.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] p-4 text-xs text-slate-500 dark:text-slate-400">
          No hay metas activas pendientes de completar para incluir en este plan.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Metas y orden de prioridad (las archivadas y completadas no se incluyen por defecto)</span>
            <span className="tabular-nums font-semibold">
              {selectedDraftItems.length} seleccionada{selectedDraftItems.length === 1 ? '' : 's'}
            </span>
          </div>

          <ul className="space-y-2">
            {draftItems.map((item, idx) => {
              const goal = goalsById.get(item.goalId);
              const prog = progressByGoalId.get(item.goalId);
              const goalName = goal?.name || item.goalNameSnapshot || 'Meta eliminada';
              const hasDate = Boolean(goal?.targetDate && goal.targetDate.trim());
              const recommended =
                goal && !goal.archived && prog && !prog.isCompleted && hasDate && prog.monthlyNeeded !== null
                  ? roundCents(Math.min(prog.monthlyNeeded, prog.remaining))
                  : null;
              const currentManual = parseNonNegativeAmountInput(item.amountInput);
              const shortBy =
                item.selected && recommended !== null && currentManual < recommended
                  ? roundCents(recommended - currentManual)
                  : 0;

              return (
                <li
                  key={item.goalId}
                  className={`rounded-xl border p-3 transition-colors ${
                    item.selected
                      ? 'bg-white dark:bg-[#132025] border-slate-200 dark:border-slate-700'
                      : 'bg-slate-100/70 dark:bg-slate-900/30 border-slate-200/70 dark:border-slate-800 opacity-75'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 flex-1 min-w-0">
                      <label className="min-h-[44px] min-w-[44px] -ml-1 flex items-center justify-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => handleToggleItem(item.goalId)}
                          aria-label={`Incluir ${goalName} en el plan`}
                          className="w-5 h-5 rounded accent-[#0E5A64]"
                        />
                      </label>

                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold tabular-nums shrink-0">
                        {idx + 1}.º
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-sm truncate">{goalName}</span>
                          {goal?.archived && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                              <Archive className="w-3 h-3" />
                              Archivada
                            </span>
                          )}
                          {!goal && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold">
                              Eliminada
                            </span>
                          )}
                          {prog?.isCompleted && (
                            <span className="px-2 py-0.5 rounded-md bg-[#15803D]/15 text-[#15803D] dark:text-[#4ADE80] text-[11px] font-semibold">
                              Completada
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                          {recommended !== null ? (
                            <>
                              Cuota recomendada: <strong>{formatEUR(recommended)}/mes</strong>
                              {prog ? ` · Faltan ${formatEUR(prog.remaining)}` : ''}
                            </>
                          ) : !hasDate && goal && !goal.archived && !prog?.isCompleted ? (
                            <>
                              Sin fecha objetivo · importe manual
                              {prog && prog.remaining > 0 ? ` · Faltan ${formatEUR(prog.remaining)}` : ''}
                            </>
                          ) : prog ? (
                            <>Acumulado: {formatEUR(prog.savedAmount)}</>
                          ) : (
                            <>Asignación histórica conservada</>
                          )}
                        </p>
                        {shortBy > 0 && (
                          <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 tabular-nums mt-0.5">
                            Por debajo de lo recomendado en {formatEUR(shortBy)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 pl-10 sm:pl-0">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          aria-label={`Subir prioridad de ${goalName}`}
                          onClick={() => handleMovePriority(idx, -1)}
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === draftItems.length - 1}
                          aria-label={`Bajar prioridad de ${goalName}`}
                          onClick={() => handleMovePriority(idx, 1)}
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="w-32">
                        <label className="sr-only" htmlFor={`plan-amt-${item.goalId}`}>
                          Importe planificado para {goalName} (€)
                        </label>
                        <input
                          id={`plan-amt-${item.goalId}`}
                          type="text"
                          inputMode="decimal"
                          disabled={!item.selected}
                          value={item.amountInput}
                          onChange={(e) => handleAmountChange(item.goalId, e.target.value)}
                          placeholder="0,00"
                          className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm font-bold text-right disabled:opacity-50"
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Live distribution totals */}
      <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
        <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm tabular-nums">
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">A apartar</span>
            <strong className="font-mono-num">{formatEUR(draftTargetAmount)}</strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Total asignado</span>
            <strong className="font-mono-num text-[#0E5A64] dark:text-[#5EEAD4]">
              {formatEUR(draftTotals.totalAssigned)}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {draftTotals.overAllocated > 0 ? 'Exceso asignado' : 'Sin asignar'}
            </span>
            <strong
              className={`font-mono-num ${
                draftTotals.overAllocated > 0
                  ? 'text-[#B42318] dark:text-[#FCA5A5]'
                  : 'text-slate-800 dark:text-slate-100'
              }`}
            >
              {draftTotals.overAllocated > 0
                ? `+${formatEUR(draftTotals.overAllocated)}`
                : formatEUR(draftTotals.unassigned)}
            </strong>
          </div>
        </div>

        {draftTotals.overAllocated > 0 && (
          <p className="text-xs text-[#B42318] dark:text-[#FCA5A5] flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Has asignado {formatEUR(draftTotals.overAllocated)} más que el importe indicado a apartar. Puedes subir «¿Cuánto queremos apartar?» o ajustar alguna meta.
            </span>
          </p>
        )}

        {draftTotals.underfunded.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Metas por debajo de su cuota recomendada:</span>
            </p>
            <ul className="list-disc pl-5 space-y-0.5 tabular-nums">
              {draftTotals.underfunded.map((u) => (
                <li key={u.goalId}>
                  <strong>{u.goalName}</strong>: {formatEUR(u.planned)} de {formatEUR(u.recommended)} (faltan {formatEUR(u.missing)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Guardar el plan no crea movimientos, transferencias ni deudas ni cambia tu ahorro real.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          {existingPlan && !confirmDeleteOpen && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirmDeleteOpen(true)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] inline-flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar plan de este mes</span>
            </button>
          )}
          {existingPlan && confirmDeleteOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5]">
                ¿Eliminar solo el plan? (No borra aportaciones)
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-3 rounded-xl bg-[#B42318] text-white text-xs font-semibold"
              >
                Sí, eliminar plan
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmDeleteOpen(false)}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                No
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            disabled={saving}
            onClick={() => onSetEditorOpen(false)}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-semibold"
          >
            {saving ? 'Guardando...' : 'Guardar plan'}
          </button>
        </div>
      </div>
    </form>
  );

  // Per-goal evaluation rows list (shared between Avanzado and Sencillo detail panel)
  const evaluationRowsList = (
    <div className="space-y-2.5">
      {evaluation.rows.map((row) => {
        const liveGoal = goalsById.get(row.goalId) ?? null;
        const canContribute = Boolean(liveGoal && !liveGoal.archived && row.pendingAmount > 0);
        return (
          <div
            key={row.goalId}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5 space-y-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[11px] font-bold tabular-nums">
                    {row.priority + 1}.º
                  </span>
                  <span className="font-semibold text-sm">{row.goalName}</span>
                  {row.isArchived && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      <Archive className="w-3 h-3" />
                      Archivada
                    </span>
                  )}
                  {row.isMissingGoal && (
                    <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold">
                      Meta eliminada
                    </span>
                  )}
                  {row.status === 'completado' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#15803D] dark:text-[#4ADE80]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Plan cubierto
                    </span>
                  )}
                  {row.status === 'excedido' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#15803D] dark:text-[#4ADE80]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      +{formatEUR(row.excessAmount)} sobre lo planificado
                    </span>
                  )}
                </div>
                {uiMode === 'avanzado' && row.belowRecommendedBy > 0 && (
                  <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 tabular-nums mt-0.5">
                    Por debajo de la cuota recomendada ({formatEUR(row.recommendedAmount ?? 0)}) en{' '}
                    {formatEUR(row.belowRecommendedBy)}
                  </p>
                )}
              </div>

              {canContribute && liveGoal && (
                <button
                  type="button"
                  onClick={() => onContributePending(liveGoal, row.pendingAmount)}
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  <span>Aportar pendiente ({formatEUR(row.pendingAmount)})</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Planificado</span>
                <strong className="font-mono-num">{formatEUR(row.plannedAmount)}</strong>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Aportado</span>
                <strong className="font-mono-num text-[#15803D] dark:text-[#4ADE80]">
                  {formatEUR(row.contributedAmount)}
                </strong>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Pendiente de aportar
                </span>
                <strong className="font-mono-num">{formatEUR(row.pendingAmount)}</strong>
              </div>
            </div>

            {row.plannedAmount > 0 && (
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${row.progressPct}%`,
                    backgroundColor:
                      row.status === 'completado' || row.status === 'excedido'
                        ? '#15803D'
                        : row.goalColor || '#0E5A64',
                  }}
                />
              </div>
            )}

            {row.withdrawnAmount > 0 && (
              <p className="text-xs font-medium text-[#B42318] dark:text-[#FCA5A5] tabular-nums">
                Retirado este mes: {formatEUR(row.withdrawnAmount)} (mostrado aparte; no resta de lo aportado al evaluar el plan)
              </p>
            )}
          </div>
        );
      })}

      {evaluation.unplannedActivity.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] p-3 text-xs space-y-1">
          <p className="font-semibold text-slate-600 dark:text-slate-300">
            Movimientos reales del mes en metas fuera de este plan
          </p>
          <ul className="space-y-0.5 text-slate-600 dark:text-slate-300 tabular-nums">
            {evaluation.unplannedActivity.map((item) => (
              <li key={item.goalId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {item.goalName}
                  {item.isArchived ? ' (archivada)' : ''}
                </span>
                <span className="font-mono-num">
                  {item.contributedAmount > 0 ? `Aportado: ${formatEUR(item.contributedAmount)}` : ''}
                  {item.contributedAmount > 0 && item.withdrawnAmount > 0 ? ' · ' : ''}
                  {item.withdrawnAmount > 0 ? `Retirado: ${formatEUR(item.withdrawnAmount)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // ─── MODO SENCILLO: TARJETA RESUMEN + ACCESO AL DETALLE ────────────────────
  if (uiMode === 'sencillo') {
    return (
      <section
        id="savings-plan-section"
        aria-label="Plan de ahorro del mes"
        className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">Plan de ahorro del mes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Decide cuánto apartar y sigue lo que ya habéis aportado.
            </p>
          </div>
          {monthNavigator}
        </div>

        {evaluation.hasPlan ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3.5 tabular-nums">
              <div>
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Planificado
                </span>
                <strong className="font-display text-xl font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                  {formatEUR(evaluation.totalAssigned)}
                </strong>
                {evaluation.unassignedAmount > 0 && (
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    +{formatEUR(evaluation.unassignedAmount)} sin asignar
                  </span>
                )}
              </div>
              <div>
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Aportado este mes
                </span>
                <strong className="font-display text-xl font-bold text-[#15803D] dark:text-[#4ADE80]">
                  {formatEUR(evaluation.totalContributedPlanned)}
                </strong>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Pendiente de aportar
                </span>
                <strong className="font-display text-xl font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                  {formatEUR(evaluation.totalPending)}
                </strong>
              </div>
            </div>

            {evaluation.totalWithdrawnAll > 0 && (
              <p className="text-xs font-medium text-[#B42318] dark:text-[#FCA5A5] tabular-nums">
                Retirado este mes: {formatEUR(evaluation.totalWithdrawnAll)} (se muestra aparte de lo aportado).
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSencilloDetailOpen((prev) => !prev)}
                className="flex-1 min-h-[46px] px-4 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>{sencilloDetailOpen ? 'Ocultar detalle' : 'Ver detalle del plan'}</span>
              </button>
              <button
                type="button"
                onClick={openEditor}
                className="min-h-[46px] px-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Pencil className="w-4 h-4" />
                <span>Ajustar plan</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 tabular-nums">
              Aún no hay plan guardado para <span className="capitalize font-semibold">{monthLabel}</span>.
              {evaluation.totalContributedAll > 0
                ? ` Ya lleváis ${formatEUR(evaluation.totalContributedAll)} aportados este mes; contarán automáticamente si creáis el plan.`
                : ''}
            </p>
            {evaluation.totalWithdrawnAll > 0 && (
              <p className="text-xs font-medium text-[#B42318] dark:text-[#FCA5A5] tabular-nums">
                Retirado este mes: {formatEUR(evaluation.totalWithdrawnAll)}.
              </p>
            )}
            <button
              type="button"
              onClick={openEditor}
              className="w-full min-h-[48px] px-4 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Planificar el ahorro del mes</span>
            </button>
          </div>
        )}

        {sencilloDetailOpen && !editorOpen && evaluation.hasPlan && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
            {evaluationRowsList}
          </div>
        )}

        {editorOpen && editorForm}
      </section>
    );
  }

  // ─── MODO AVANZADO: EDITOR COMPLETO, PRIORIDADES Y DESVIACIONES ────────────
  return (
    <section
      id="savings-plan-section"
      aria-label="Plan de ahorro mensual"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-display text-base sm:text-lg font-bold">Plan de ahorro del mes</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Organiza prioridades y compara lo planificado frente a las aportaciones reales del mes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {monthNavigator}
          {!editorOpen && (
            <button
              type="button"
              onClick={openEditor}
              className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
            >
              {existingPlan ? <Pencil className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              <span>{existingPlan ? 'Editar plan' : 'Planificar el ahorro del mes'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick switch to saved historical months when > 1 */}
      {historicalMonths.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Planes guardados:</span>
          {historicalMonths.slice(0, 6).map((mk) => (
            <button
              key={mk}
              type="button"
              onClick={() => onChangeMonthKey(mk)}
              className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold capitalize ${
                mk === planMonthKey
                  ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {formatMonthLabelES(mk)}
            </button>
          ))}
        </div>
      )}

      {editorOpen && editorForm}

      {!editorOpen && evaluation.hasPlan && (
        <div className="space-y-4">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 tabular-nums">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 p-3">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Reservado para el mes
              </span>
              <strong className="font-mono-num text-lg font-bold">
                {formatEUR(evaluation.targetAmount)}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 p-3">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Planificado en metas
              </span>
              <strong className="font-mono-num text-lg font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                {formatEUR(evaluation.totalAssigned)}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 p-3">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                {evaluation.overAllocatedAmount > 0 ? 'Exceso asignado' : 'Sin asignar'}
              </span>
              <strong
                className={`font-mono-num text-lg font-bold ${
                  evaluation.overAllocatedAmount > 0 ? 'text-[#B42318] dark:text-[#FCA5A5]' : ''
                }`}
              >
                {evaluation.overAllocatedAmount > 0
                  ? `+${formatEUR(evaluation.overAllocatedAmount)}`
                  : formatEUR(evaluation.unassignedAmount)}
              </strong>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 p-3">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Aportado real
              </span>
              <strong className="font-mono-num text-lg font-bold text-[#15803D] dark:text-[#4ADE80]">
                {formatEUR(evaluation.totalContributedPlanned)}
              </strong>
              {evaluation.totalExcess > 0 && (
                <span className="block text-[11px] font-medium text-[#15803D] dark:text-[#4ADE80]">
                  +{formatEUR(evaluation.totalExcess)} sobre plan
                </span>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 p-3 col-span-2 lg:col-span-1">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Pendiente de aportar
              </span>
              <strong className="font-mono-num text-lg font-bold">
                {formatEUR(evaluation.totalPending)}
              </strong>
            </div>
          </div>

          {evaluation.totalWithdrawnAll > 0 && (
            <div className="rounded-xl bg-red-50/70 dark:bg-red-950/25 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-xs text-[#B42318] dark:text-[#FCA5A5] tabular-nums">
              <strong>Retirado en {monthLabel}: {formatEUR(evaluation.totalWithdrawnAll)}</strong>. Las retiradas se muestran aparte para no distorsionar lo aportado frente al plan.
            </div>
          )}

          {evaluation.underfundedRows.length > 0 && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 tabular-nums">
              <span className="font-semibold">Desviación frente a cuotas recomendadas: </span>
              {evaluation.underfundedRows
                .map((r) => `${r.goalName} (-${formatEUR(r.belowRecommendedBy)})`)
                .join(' · ')}
            </div>
          )}

          {evaluationRowsList}
        </div>
      )}

      {!editorOpen && !evaluation.hasPlan && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300 space-y-1.5">
          <p>
            No hay ningún plan de ahorro guardado para{' '}
            <span className="capitalize font-semibold">{monthLabel}</span>. Pulsa{' '}
            <strong>«Planificar el ahorro del mes»</strong> para decidir cuánto apartar, priorizar metas y proponer un reparto.
          </p>
          {evaluation.totalContributedAll > 0 && (
            <p className="text-xs text-[#15803D] dark:text-[#4ADE80] font-medium tabular-nums">
              Aportaciones reales ya registradas en {monthLabel}: {formatEUR(evaluation.totalContributedAll)} (contarán automáticamente en cuanto guardes el plan).
            </p>
          )}
          {evaluation.totalWithdrawnAll > 0 && (
            <p className="text-xs text-[#B42318] dark:text-[#FCA5A5] font-medium tabular-nums">
              Retiradas registradas en {monthLabel}: {formatEUR(evaluation.totalWithdrawnAll)}.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
