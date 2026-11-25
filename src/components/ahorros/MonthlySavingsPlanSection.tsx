import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  PiggyBank,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  computeGoalProgress,
  formatEUR,
  formatMonthLabelES,
  fromCents,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  roundCents,
  shiftMonthKey,
  toCents,
} from '../../domain/finance';
import {
  buildExtraSavingsPlan,
  buildInitialSavingsPlanDraft,
  formatDecimalInputES,
  getDefaultSelectableSavingsGoals,
  parseNonNegativeAmountInput,
  proposeHabitualFillDistribution,
  SAVINGS_PLAN_RULE_ONE_LINER,
  sortGoalsByHabitualPriority,
  type DraftAllocationItem,
  type MonthlySavingsPlanEvaluation,
} from '../../domain/savingsPlan';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type {
  GoalMovement,
  HabitualSavingsPlan,
  MonthlySavingsPlan,
  SavingsGoal,
  SavingsPlanAdjustmentKind,
  SavingsPlanAllocation,
  UiMode,
} from '../../types/nido';

interface MonthlySavingsPlanSectionProps {
  uiMode: UiMode;
  planMonthKey: string;
  onChangeMonthKey: (mk: string) => void;
  goals: SavingsGoal[];
  goalsLoaded: boolean;
  goalMovements: GoalMovement[];
  savingsPlans: MonthlySavingsPlan[];
  savingsPlansLoading: boolean;
  savingsPlansError: string | null;
  habitualPlan: HabitualSavingsPlan | null | undefined;
  evaluation: MonthlySavingsPlanEvaluation;
  effectivePlan: MonthlySavingsPlan | null;
  effectiveSplitPctA: number;
  shortNameA: string;
  shortNameB: string;
  hasPartner: boolean;
  savingsCapacityRef: number;
  hasIncomeConfigured: boolean;
  editorOpen: boolean;
  onSetEditorOpen: (open: boolean) => void;
  onSavePlan: (payload: {
    monthKey: string;
    targetAmount: number;
    allocations: SavingsPlanAllocation[];
    adjustmentKind?: SavingsPlanAdjustmentKind;
    extraAmount?: number;
  }) => Promise<void>;
  onDeletePlan: (monthKey: string) => Promise<void>;
  onSaveHabitualPlan: (
    plan: { monthlyAmount: number; priorityGoalIds: string[] } | null
  ) => Promise<void>;
  onContributePending: (goal: SavingsGoal, pendingAmount: number, monthKey: string) => void;
}

type ActivePanelMode = 'none' | 'month_editor' | 'extra_editor' | 'habitual_editor';

const STATUS_BADGES: Record<
  MonthlySavingsPlanEvaluation['rows'][number]['status'],
  { label: string; className: string }
> = {
  sin_asignacion: {
    label: 'Sin importe',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  pendiente: {
    label: 'Pendiente',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  },
  en_curso: {
    label: 'En curso',
    className: 'bg-[#0E5A64]/12 text-[#0E5A64] dark:bg-[#2AA1AE]/20 dark:text-[#5EEAD4]',
  },
  completado: {
    label: 'Completado',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  excedido: {
    label: 'Superado',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
};

function classifyActionError(err: unknown, fallback: string): string {
  const friendly = toUserFriendlyErrorMessage(err, fallback);
  const raw = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (raw.includes('permission-denied') || raw.includes('missing or insufficient permissions')) {
    return 'Error de permisos en Firestore: tu cuenta no tiene permisos para guardar este plan o algún campo no cumple las reglas de seguridad.';
  }
  return friendly;
}

export const MonthlySavingsPlanSection: React.FC<MonthlySavingsPlanSectionProps> = ({
  uiMode,
  planMonthKey,
  onChangeMonthKey,
  goals,
  goalsLoaded,
  goalMovements,
  savingsPlans,
  savingsPlansLoading,
  savingsPlansError,
  habitualPlan,
  evaluation,
  effectivePlan,
  effectiveSplitPctA,
  shortNameA,
  shortNameB,
  hasPartner,
  savingsCapacityRef,
  hasIncomeConfigured,
  editorOpen,
  onSetEditorOpen,
  onSavePlan,
  onDeletePlan,
  onSaveHabitualPlan,
  onContributePending,
}) => {
  const todayISO = getTodayLocalISO();
  const currentMonthKey = getCurrentMonthKeyLocal();
  const nextMonthKey = shiftMonthKey(currentMonthKey, 1);

  const existingSavedPlan = useMemo(
    () => savingsPlans.find((p) => p.monthKey === planMonthKey) ?? null,
    [savingsPlans, planMonthKey]
  );

  const goalsById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  // Panel activo dentro de la sección: sincronizamos `editorOpen` externo con `month_editor`
  const [subPanel, setSubPanel] = useState<'none' | 'extra_editor' | 'habitual_editor'>('none');
  const activePanel: ActivePanelMode = editorOpen ? 'month_editor' : subPanel;

  const editorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const draftDirtyRef = useRef(false);

  // ── Estado del editor mensual («Ajustar este mes» / «Planificar ahorro del mes») ──
  const [targetInput, setTargetInput] = useState('');
  const [draftItems, setDraftItems] = useState<DraftAllocationItem[]>([]);
  const [proposalFeedback, setProposalFeedback] = useState<{
    tone: 'info' | 'warning' | 'success';
    text: string;
  } | null>(null);
  const [monthSaveError, setMonthSaveError] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);

  // ── Estado de «Añadir ahorro extra» ──
  const [extraAmountInput, setExtraAmountInput] = useState('');
  const [extraByGoalInput, setExtraByGoalInput] = useState<Record<string, string>>({});
  const [extraSaveError, setExtraSaveError] = useState<string | null>(null);
  const [savingExtra, setSavingExtra] = useState(false);

  // ── Estado de «Editar plan habitual» ──
  const [habitualAmountInput, setHabitualAmountInput] = useState('');
  const [habitualGoalOrder, setHabitualGoalOrder] = useState<string[]>([]);
  const [habitualSaveError, setHabitualSaveError] = useState<string | null>(null);
  const [savingHabitual, setSavingHabitual] = useState(false);

  // ── Confirmaciones ──
  const [confirmRevertOpen, setConfirmRevertOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Hidratación robusta del borrador mensual (incluye rehidratación si `goals` llega después de abrir el editor)
  useEffect(() => {
    if (!editorOpen) {
      draftDirtyRef.current = false;
      return;
    }
    if (draftDirtyRef.current && draftItems.length > 0) return;

    const draft = buildInitialSavingsPlanDraft({
      existingPlan: existingSavedPlan,
      habitualPlan,
      allPlans: savingsPlans,
      goals,
      movements: goalMovements,
      refDateISO: todayISO,
    });
    setTargetInput(draft.targetInput);
    setDraftItems(draft.items);
    setProposalFeedback(null);
    setMonthSaveError(null);
  }, [
    editorOpen,
    planMonthKey,
    existingSavedPlan,
    habitualPlan,
    goals,
    goalsLoaded,
    goalMovements,
    savingsPlans,
    todayISO,
  ]);

  // Al cambiar de mes mientras el editor está abierto, resetea el dirty flag para cargar el mes nuevo
  useEffect(() => {
    draftDirtyRef.current = false;
  }, [planMonthKey]);

  // Foco accesible al abrir el editor mensual (evita la sensación de «botón que no hace nada»)
  useEffect(() => {
    if (editorOpen && editorHeadingRef.current) {
      editorHeadingRef.current.focus({ preventScroll: true });
    }
  }, [editorOpen]);

  const openMonthEditor = () => {
    setSubPanel('none');
    setDeleteError(null);
    draftDirtyRef.current = false;
    onSetEditorOpen(true);
  };

  const closeAllEditors = () => {
    onSetEditorOpen(false);
    setSubPanel('none');
    setMonthSaveError(null);
    setExtraSaveError(null);
    setHabitualSaveError(null);
  };

  const openExtraEditor = () => {
    onSetEditorOpen(false);
    setDeleteError(null);
    setExtraAmountInput('');
    setExtraByGoalInput({});
    setExtraSaveError(null);
    setSubPanel('extra_editor');
  };

  const openHabitualEditor = () => {
    onSetEditorOpen(false);
    setDeleteError(null);
    const selectable = getDefaultSelectableSavingsGoals(goals, goalMovements, todayISO);
    const ordered = sortGoalsByHabitualPriority(
      selectable,
      habitualPlan?.priorityGoalIds,
      savingsPlans[0] ?? null
    );
    setHabitualAmountInput(
      habitualPlan && habitualPlan.monthlyAmount > 0
        ? formatDecimalInputES(habitualPlan.monthlyAmount)
        : ''
    );
    setHabitualGoalOrder(ordered.map((g) => g.id));
    setHabitualSaveError(null);
    setSubPanel('habitual_editor');
  };

  // ── Cálculos en vivo del editor mensual ──
  const draftTargetAmount = parseNonNegativeAmountInput(targetInput);
  const selectedDraftItems = useMemo(() => draftItems.filter((it) => it.selected), [draftItems]);
  const draftTotalAssigned = useMemo(() => {
    let cents = 0;
    for (const it of selectedDraftItems) {
      cents += toCents(parseNonNegativeAmountInput(it.amountInput));
    }
    return fromCents(cents);
  }, [selectedDraftItems]);
  const draftUnassigned = roundCents(Math.max(0, draftTargetAmount - draftTotalAssigned));
  const draftOverAllocated = roundCents(Math.max(0, draftTotalAssigned - draftTargetAmount));

  const draftShareACents = Math.round((toCents(draftTargetAmount) * effectiveSplitPctA) / 100);
  const draftShareA = fromCents(draftShareACents);
  const draftShareB = fromCents(toCents(draftTargetAmount) - draftShareACents);

  const handleToggleDraftGoal = (goalId: string) => {
    draftDirtyRef.current = true;
    setDraftItems((prev) =>
      prev.map((it) =>
        it.goalId === goalId
          ? { ...it, selected: !it.selected, amountInput: !it.selected ? it.amountInput : '0' }
          : it
      )
    );
    setProposalFeedback(null);
  };

  const handleMoveDraftGoal = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftItems.length) return;
    draftDirtyRef.current = true;
    setDraftItems((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, moved);
      return copy;
    });
    setProposalFeedback(null);
  };

  const handleChangeDraftAmount = (goalId: string, val: string) => {
    draftDirtyRef.current = true;
    setDraftItems((prev) =>
      prev.map((it) => (it.goalId === goalId ? { ...it, amountInput: val } : it))
    );
    setProposalFeedback(null);
  };

  const handleProposeDistribution = () => {
    setMonthSaveError(null);
    const orderedIds = draftItems.filter((it) => it.selected).map((it) => it.goalId);
    const proposal = proposeHabitualFillDistribution({
      targetAmount: draftTargetAmount,
      orderedGoalIds: orderedIds,
      goals,
      movements: goalMovements,
      refDateISO: todayISO,
    });

    if (proposal.status === 'missing_target_amount' || proposal.status === 'no_selected_goals') {
      setProposalFeedback({ tone: 'warning', text: proposal.feedbackMessage });
      return;
    }

    if (proposal.status === 'all_manual_or_completed') {
      setProposalFeedback({ tone: 'warning', text: proposal.feedbackMessage });
      return;
    }

    const byId = new Map(proposal.allocations.map((a) => [a.goalId, a.proposedAmount]));
    let anyChanged = false;
    const nextItems = draftItems.map((it) => {
      if (!it.selected) return it;
      const proposed = byId.get(it.goalId) ?? 0;
      const current = parseNonNegativeAmountInput(it.amountInput);
      if (toCents(proposed) !== toCents(current)) {
        anyChanged = true;
      }
      return { ...it, amountInput: formatDecimalInputES(proposed) };
    });

    draftDirtyRef.current = true;
    setDraftItems(nextItems);

    if (!anyChanged) {
      setProposalFeedback({
        tone: 'info',
        text: `La propuesta por prioridad ya coincide con los importes actuales del borrador (${proposal.feedbackMessage})`,
      });
    } else {
      setProposalFeedback({
        tone: 'success',
        text: proposal.feedbackMessage,
      });
    }
  };

  const handleSubmitMonthPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setMonthSaveError(null);
    if (draftTargetAmount <= 0 && draftTotalAssigned > 0) {
      setMonthSaveError(
        'Indica primero un importe mensual total mayor o igual que la suma asignada a tus metas.'
      );
      return;
    }
    if (draftOverAllocated > 0) {
      setMonthSaveError(
        `Has asignado ${formatEUR(draftTotalAssigned)}, que supera en ${formatEUR(draftOverAllocated)} el total a apartar (${formatEUR(draftTargetAmount)}). Ajusta el total o los importes.`
      );
      return;
    }
    const allocations: SavingsPlanAllocation[] = selectedDraftItems.map((it, idx) => ({
      goalId: it.goalId,
      plannedAmount: parseNonNegativeAmountInput(it.amountInput),
      priority: idx,
      goalNameSnapshot: goalsById.get(it.goalId)?.name || it.goalNameSnapshot || 'Meta',
    }));

    setSavingMonth(true);
    try {
      await onSavePlan({
        monthKey: planMonthKey,
        targetAmount: draftTargetAmount,
        allocations,
        adjustmentKind: 'ajuste',
      });
      draftDirtyRef.current = false;
      onSetEditorOpen(false);
    } catch (err) {
      // NUNCA cerramos el editor si falla el guardado: conservamos el borrador y mostramos el motivo exacto.
      setMonthSaveError(
        classifyActionError(err, 'No se pudo guardar el plan de ahorro de este mes.')
      );
    } finally {
      setSavingMonth(false);
    }
  };

  // ── Cálculos en vivo de «Añadir ahorro extra» ──
  const extraGoalsList = useMemo(() => {
    const selectable = getDefaultSelectableSavingsGoals(goals, goalMovements, todayISO);
    return sortGoalsByHabitualPriority(
      selectable,
      habitualPlan?.priorityGoalIds,
      existingSavedPlan ?? savingsPlans[0] ?? null
    );
  }, [goals, goalMovements, todayISO, habitualPlan, existingSavedPlan, savingsPlans]);

  const parsedExtraAmount = parseNonNegativeAmountInput(extraAmountInput);
  const parsedExtraMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [gid, raw] of Object.entries(extraByGoalInput)) {
      const val = parseNonNegativeAmountInput(raw);
      if (val > 0) map[gid] = val;
    }
    return map;
  }, [extraByGoalInput]);

  const extraPreview = useMemo(
    () =>
      buildExtraSavingsPlan({
        basePlan: effectivePlan,
        extraAmount: parsedExtraAmount,
        extraAllocationsByGoalId: parsedExtraMap,
        goals,
      }),
    [effectivePlan, parsedExtraAmount, parsedExtraMap, goals]
  );

  const beforeShareACents = Math.round((toCents(extraPreview.beforeTarget) * effectiveSplitPctA) / 100);
  const beforeShareA = fromCents(beforeShareACents);
  const beforeShareB = fromCents(toCents(extraPreview.beforeTarget) - beforeShareACents);
  const afterShareACents = Math.round((toCents(extraPreview.afterTarget) * effectiveSplitPctA) / 100);
  const afterShareA = fromCents(afterShareACents);
  const afterShareB = fromCents(toCents(extraPreview.afterTarget) - afterShareACents);

  const handleAssignExtraToSingleGoal = (goalId: string) => {
    if (parsedExtraAmount <= 0) return;
    setExtraByGoalInput({ [goalId]: formatDecimalInputES(parsedExtraAmount) });
    setExtraSaveError(null);
  };

  const handleSubmitExtraPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setExtraSaveError(null);
    if (parsedExtraAmount <= 0) {
      setExtraSaveError('Indica un importe extra mayor que 0 €.');
      return;
    }
    if (extraPreview.extraOverAllocated > 0) {
      setExtraSaveError(
        `Has repartido ${formatEUR(extraPreview.extraAssigned)} de extra, que supera el importe extra de ${formatEUR(parsedExtraAmount)}.`
      );
      return;
    }
    setSavingExtra(true);
    try {
      const prevExtra =
        existingSavedPlan?.adjustmentKind === 'extra' && existingSavedPlan.extraAmount
          ? existingSavedPlan.extraAmount
          : 0;
      await onSavePlan({
        monthKey: planMonthKey,
        targetAmount: extraPreview.afterTarget,
        allocations: extraPreview.mergedAllocations,
        adjustmentKind: 'extra',
        extraAmount: roundCents(prevExtra + parsedExtraAmount),
      });
      setSubPanel('none');
    } catch (err) {
      setExtraSaveError(
        classifyActionError(err, 'No se pudo guardar el ahorro extra de este mes.')
      );
    } finally {
      setSavingExtra(false);
    }
  };

  // ── Cálculos en vivo de «Editar plan habitual» ──
  const habitualTargetAmount = parseNonNegativeAmountInput(habitualAmountInput);
  const habitualPreviewProposal = useMemo(
    () =>
      proposeHabitualFillDistribution({
        targetAmount: habitualTargetAmount,
        orderedGoalIds: habitualGoalOrder,
        goals,
        movements: goalMovements,
        refDateISO: todayISO,
      }),
    [habitualTargetAmount, habitualGoalOrder, goals, goalMovements, todayISO]
  );

  const handleMoveHabitualGoal = (index: number, direction: -1 | 1) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= habitualGoalOrder.length) return;
    setHabitualGoalOrder((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, moved);
      return copy;
    });
  };

  const handleSubmitHabitualPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setHabitualSaveError(null);
    setSavingHabitual(true);
    try {
      await onSaveHabitualPlan({
        monthlyAmount: habitualTargetAmount,
        priorityGoalIds: habitualGoalOrder,
      });
      setSubPanel('none');
    } catch (err) {
      setHabitualSaveError(
        classifyActionError(err, 'No se pudo guardar el plan de ahorro habitual.')
      );
    } finally {
      setSavingHabitual(false);
    }
  };

  const handleConfirmDeleteMonthPlan = async () => {
    setDeletingPlan(true);
    setDeleteError(null);
    try {
      await onDeletePlan(planMonthKey);
      setConfirmRevertOpen(false);
      onSetEditorOpen(false);
      setSubPanel('none');
    } catch (err) {
      setDeleteError(classifyActionError(err, 'No se pudo eliminar el plan guardado de este mes.'));
      setConfirmRevertOpen(false);
    } finally {
      setDeletingPlan(false);
    }
  };

  const monthLabel = formatMonthLabelES(planMonthKey);
  const hasHabitualConfigured = Boolean(habitualPlan && habitualPlan.monthlyAmount > 0);
  const hasSavedMonthOverride = Boolean(existingSavedPlan);

  return (
    <section
      id="savings-plan-section"
      aria-label="Plan de ahorro mensual"
      data-testid="monthly-savings-plan-section"
      className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      {/* Cabecera + selector de mes */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="w-10 h-10 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                A qué metas va · {monthLabel}
              </h2>
              {evaluation.planSource === 'saved' && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#0E5A64]/12 text-[#0E5A64] dark:bg-[#2AA1AE]/20 dark:text-[#5EEAD4]">
                  {evaluation.adjustmentKind === 'extra' && evaluation.extraAmount
                    ? `Plan guardado (+${formatEUR(evaluation.extraAmount)} extra)`
                    : 'Plan guardado para este mes'}
                </span>
              )}
              {evaluation.planSource === 'habitual' && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                  Propuesta del plan habitual
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {evaluation.planSource === 'habitual'
                ? 'Aplicado automáticamente desde vuestro plan habitual (llenado por prioridad) sin crear movimientos.'
                : evaluation.planSource === 'saved'
                  ? 'Ajuste específico guardado para este mes. El plan habitual y otros meses no cambian.'
                  : 'Decide cuánto apartar y a qué metas va. Guardar el plan nunca mueve dinero real.'}
            </p>
          </div>
        </div>

        {/* Selector de mes */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => onChangeMonthKey(shiftMonthKey(planMonthKey, -1))}
              aria-label="Mes anterior del plan de ahorro"
              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2.5 text-xs font-bold tabular-nums capitalize">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => onChangeMonthKey(shiftMonthKey(planMonthKey, 1))}
              aria-label="Mes siguiente del plan de ahorro"
              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {planMonthKey !== currentMonthKey && (
            <button
              type="button"
              onClick={() => onChangeMonthKey(currentMonthKey)}
              className="min-h-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Este mes
            </button>
          )}
          {planMonthKey !== nextMonthKey && (
            <button
              type="button"
              onClick={() => onChangeMonthKey(nextMonthKey)}
              className="min-h-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Próximo mes</span>
            </button>
          )}
        </div>
      </div>

      {/* Estado de carga o error de carga/permisos en savingsPlans (sin bloquear abrir el editor) */}
      {savingsPlansLoading && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Sincronizando planes de ahorro...
        </p>
      )}
      {savingsPlansError && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3.5 py-2.5 text-xs text-[#B42318] dark:text-[#FCA5A5] flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            No se pudieron leer los planes guardados ({savingsPlansError}). Puedes seguir abriendo el
            editor o reintentar al guardar.
          </span>
        </div>
      )}
      {deleteError && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3.5 py-2.5 text-xs text-[#B42318] dark:text-[#FCA5A5] flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{deleteError}</span>
        </div>
      )}

      {/* Barra de acciones principales (Sencillo + Avanzado) */}
      {activePanel === 'none' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openMonthEditor}
            data-testid="open-month-savings-editor-btn"
            className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Pencil className="w-4 h-4" />
            <span>
              {evaluation.hasPlan ? 'Ajustar este mes' : 'Planificar ahorro del mes'}
            </span>
          </button>

          <button
            type="button"
            onClick={openExtraEditor}
            data-testid="open-extra-savings-btn"
            className="min-h-[44px] px-4 rounded-xl border border-[#0E5A64]/35 bg-[#0E5A64]/6 hover:bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir ahorro extra</span>
          </button>

          <button
            type="button"
            onClick={openHabitualEditor}
            data-testid="open-habitual-plan-btn"
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>
              {hasHabitualConfigured
                ? `Editar plan habitual (${formatEUR(habitualPlan!.monthlyAmount)}/mes)`
                : 'Editar plan habitual'}
            </span>
          </button>

          {hasSavedMonthOverride && (
            <button
              type="button"
              onClick={() => setConfirmRevertOpen(true)}
              data-testid="revert-month-plan-btn"
              className="min-h-[44px] px-3.5 rounded-xl border border-red-200 dark:border-red-900/60 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1.5"
            >
              {hasHabitualConfigured ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Volver al plan habitual</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar plan del mes</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* ─── PANEL 1: EDITOR DE PLAN HABITUAL (Bloque 4) ────────────────────── */}
      {activePanel === 'habitual_editor' && (
        <form
          onSubmit={(e) => void handleSubmitHabitualPlan(e)}
          data-testid="habitual-plan-editor"
          className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold">
                Plan de ahorro habitual (todos los meses)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configúralo una sola vez: Nido aplica esta propuesta a cada mes sin plan guardado
                (llenando por orden de prioridad) sin tocar meses pasados ni crear movimientos.
              </p>
            </div>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="habitual-savings-amount" className="block text-xs font-semibold">
              Importe mensual habitual para ahorrar (€)
            </label>
            <input
              id="habitual-savings-amount"
              type="text"
              inputMode="decimal"
              value={habitualAmountInput}
              onChange={(e) => setHabitualAmountInput(e.target.value)}
              placeholder="Ej. 300"
              className="w-full sm:w-64 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-base font-bold tabular-nums"
            />
            {hasIncomeConfigured && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                Referencia informativa (no automática): capacidad de ahorro estimada{' '}
                <strong>{formatEUR(savingsCapacityRef)}/mes</strong>.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Orden de prioridad de metas (llenado secuencial)
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {SAVINGS_PLAN_RULE_ONE_LINER} Las metas sin fecha objetivo también reciben dinero si
              tienen un objetivo en euros.
            </p>

            {habitualGoalOrder.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No hay metas activas pendientes de completar.
              </p>
            ) : (
              <div className="space-y-1.5">
                {habitualGoalOrder.map((gid, idx) => {
                  const goal = goalsById.get(gid);
                  if (!goal) return null;
                  const allocPreview = habitualPreviewProposal.allocations.find(
                    (a) => a.goalId === gid
                  );
                  return (
                    <div
                      key={gid}
                      className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 px-3 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                            #{idx + 1}
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: goal.color || '#0E5A64' }}
                          />
                          <span className="text-sm font-bold truncate">{goal.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums pl-5">
                          {allocPreview?.needsManualAmount
                            ? 'Sin importe objetivo · requiere asignación manual en cada mes'
                            : `Faltan ${formatEUR(allocPreview?.remainingToTarget ?? 0)} para el objetivo · Propuesta: ${formatEUR(allocPreview?.proposedAmount ?? 0)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveHabitualGoal(idx, -1)}
                          aria-label={`Subir prioridad de ${goal.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === habitualGoalOrder.length - 1}
                          onClick={() => handleMoveHabitualGoal(idx, 1)}
                          aria-label={`Bajar prioridad de ${goal.name}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-30"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {habitualTargetAmount > 0 && (
            <div className="rounded-xl bg-white dark:bg-[#132025] border border-[#0E5A64]/20 p-3 text-xs space-y-1 tabular-nums">
              <p className="font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                Vista previa de llenado con {formatEUR(habitualTargetAmount)}/mes:
              </p>
              <p className="text-slate-700 dark:text-slate-200">
                {habitualPreviewProposal.feedbackMessage}
              </p>
            </div>
          )}

          {habitualSaveError && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2.5 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5]"
            >
              {habitualSaveError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={savingHabitual}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingHabitual ? 'Guardando...' : 'Guardar plan habitual'}
            </button>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* ─── PANEL 2: AÑADIR AHORRO EXTRA (Bloque 5) ────────────────────────── */}
      {activePanel === 'extra_editor' && (
        <form
          onSubmit={(e) => void handleSubmitExtraPlan(e)}
          data-testid="extra-savings-editor"
          className="rounded-2xl bg-[#0E5A64]/5 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/25 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold">
                Añadir ahorro extra en {monthLabel}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Se suma encima de la base de este mes ({formatEUR(extraPreview.beforeTarget)}) sin
                modificar vuestro plan habitual ni duplicar la base.
              </p>
            </div>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="extra-savings-amount" className="block text-xs font-semibold">
              Importe extra a añadir solo en {monthLabel} (€)
            </label>
            <input
              id="extra-savings-amount"
              type="text"
              inputMode="decimal"
              value={extraAmountInput}
              onChange={(e) => {
                setExtraAmountInput(e.target.value);
                setExtraSaveError(null);
              }}
              placeholder="Ej. 200"
              className="w-full sm:w-64 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-base font-bold tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
              ¿A qué metas va ÚNICAMENTE este extra?
            </p>
            <div className="space-y-2">
              {extraGoalsList.map((goal) => {
                const baseAlloc = extraPreview.goalDiffs.find((d) => d.goalId === goal.id);
                return (
                  <div
                    key={goal.id}
                    className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{goal.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        Base actual: {formatEUR(baseAlloc?.beforePlanned ?? 0)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {parsedExtraAmount > 0 && (
                        <button
                          type="button"
                          onClick={() => handleAssignExtraToSingleGoal(goal.id)}
                          className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10"
                        >
                          Todo el extra
                        </button>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Extra para ${goal.name} (€)`}
                        value={extraByGoalInput[goal.id] ?? ''}
                        onChange={(e) => {
                          setExtraByGoalInput((prev) => ({ ...prev, [goal.id]: e.target.value }));
                          setExtraSaveError(null);
                        }}
                        placeholder="0"
                        className="w-28 min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-sm font-bold text-right tabular-nums"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Vista previa Antes -> Después */}
          <div
            data-testid="extra-before-after-preview"
            className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 text-xs tabular-nums"
          >
            <p className="font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
              Comparativa Antes → Después ({monthLabel})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-2.5 space-y-0.5">
                <p className="text-[11px] text-slate-500">Total ahorro del mes</p>
                <p className="font-bold text-sm">
                  {formatEUR(extraPreview.beforeTarget)} →{' '}
                  <span className="text-[#0E5A64] dark:text-[#5EEAD4]">
                    {formatEUR(extraPreview.afterTarget)}
                  </span>
                </p>
              </div>
              {hasPartner && (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-2.5 space-y-0.5">
                  <p className="text-[11px] text-slate-500">Aportación prevista por persona</p>
                  <p className="font-semibold">
                    {shortNameA}: {formatEUR(beforeShareA)} →{' '}
                    <strong>{formatEUR(afterShareA)}</strong>
                  </p>
                  <p className="font-semibold">
                    {shortNameB}: {formatEUR(beforeShareB)} →{' '}
                    <strong>{formatEUR(afterShareB)}</strong>
                  </p>
                </div>
              )}
            </div>

            {extraPreview.goalDiffs.some((d) => d.afterPlanned > 0) && (
              <ul className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                {extraPreview.goalDiffs
                  .filter((d) => d.afterPlanned > 0)
                  .map((d) => (
                    <li key={d.goalId} className="flex justify-between gap-2">
                      <span className="truncate">{d.goalName}</span>
                      <span>
                        {formatEUR(d.beforePlanned)}
                        {d.extraAdded > 0 ? (
                          <strong className="text-[#0E5A64] dark:text-[#5EEAD4]">
                            {' '}
                            +{formatEUR(d.extraAdded)} = {formatEUR(d.afterPlanned)}
                          </strong>
                        ) : (
                          ` (sin cambio)`
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            )}

            {extraPreview.extraUnassigned > 0 && parsedExtraAmount > 0 && (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Quedan {formatEUR(extraPreview.extraUnassigned)} del extra sin asignar a una meta.
              </p>
            )}
          </div>

          {extraSaveError && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2.5 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5]"
            >
              {extraSaveError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={savingExtra}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingExtra ? 'Guardando...' : 'Guardar ahorro extra'}
            </button>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* ─── PANEL 3: EDITOR MENSUAL («Planificar / Ajustar este mes») ─────── */}
      {activePanel === 'month_editor' && (
        <form
          onSubmit={(e) => void handleSubmitMonthPlan(e)}
          data-testid="month-savings-plan-editor"
          className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3
                ref={editorHeadingRef}
                tabIndex={-1}
                className="font-display text-sm sm:text-base font-bold focus:outline-none"
              >
                {hasSavedMonthOverride
                  ? `Ajustar ahorro de ${monthLabel}`
                  : `Planificar ahorro de ${monthLabel}`}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solo modifica este mes ({monthLabel}). No altera tu plan habitual ni meses
                anteriores, y no registra movimientos bancarios.
              </p>
            </div>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div className="space-y-1">
              <label htmlFor="savings-plan-target" className="block text-xs font-semibold">
                Cuánto apartar en {monthLabel} (€)
              </label>
              <input
                id="savings-plan-target"
                type="text"
                inputMode="decimal"
                value={targetInput}
                onChange={(e) => {
                  draftDirtyRef.current = true;
                  setTargetInput(e.target.value);
                  setMonthSaveError(null);
                }}
                placeholder="Ej. 300"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-base font-bold tabular-nums"
              />
              {hasIncomeConfigured && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Referencia (no se aplica sola): capacidad estimada{' '}
                  <strong>{formatEUR(savingsCapacityRef)}/mes</strong>.
                </p>
              )}
            </div>

            <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-500">Asignado a metas</span>
                <strong className={draftOverAllocated > 0 ? 'text-[#B42318]' : ''}>
                  {formatEUR(draftTotalAssigned)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sin asignar</span>
                <strong>{formatEUR(draftUnassigned)}</strong>
              </div>
              {hasPartner && draftTargetAmount > 0 && (
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                  Aportación prevista ahorro: {shortNameA}{' '}
                  <strong>{formatEUR(draftShareA)}</strong> · {shortNameB}{' '}
                  <strong>{formatEUR(draftShareB)}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Botón «Proponer reparto» — siempre habilitado con diagnóstico claro si falta algún dato */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xl">
              {SAVINGS_PLAN_RULE_ONE_LINER}
            </p>
            <button
              type="button"
              onClick={handleProposeDistribution}
              data-testid="propose-savings-distribution-btn"
              className="min-h-[44px] px-4 rounded-xl border border-[#0E5A64] bg-[#0E5A64]/10 hover:bg-[#0E5A64]/18 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              <span>Proponer reparto</span>
            </button>
          </div>

          {/* Feedback explícito y siempre visible de «Proponer reparto» */}
          {proposalFeedback && (
            <div
              role="status"
              data-testid="proposal-feedback-banner"
              className={`rounded-xl px-3.5 py-2.5 text-xs flex items-start gap-2 border ${
                proposalFeedback.tone === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-200'
                  : proposalFeedback.tone === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                    : 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-950 dark:text-sky-200'
              }`}
            >
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{proposalFeedback.text}</span>
            </div>
          )}

          {/* Lista editable de metas en orden de prioridad */}
          <div className="space-y-2">
            {!goalsLoaded && draftItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Cargando metas...</p>
            ) : draftItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No tienes metas activas pendientes de completar. Crea una meta en esta pantalla para
                asignarle ahorro.
              </p>
            ) : (
              draftItems.map((it, idx) => {
                const goal = goalsById.get(it.goalId);
                const progress = goal ? computeGoalProgress(goal, goalMovements, todayISO) : null;
                const hasTargetAmount = goal ? goal.targetAmount > 0 : false;
                const label = goal?.name || it.goalNameSnapshot || 'Meta';
                return (
                  <div
                    key={it.goalId}
                    className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2.5 transition-colors ${
                      it.selected
                        ? 'bg-white dark:bg-[#132025] border-slate-200 dark:border-slate-700'
                        : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${label} en el plan`}
                        checked={it.selected}
                        onChange={() => handleToggleDraftGoal(it.goalId)}
                        className="w-5 h-5 mt-0.5 accent-[#0E5A64] shrink-0"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                            #{idx + 1}
                          </span>
                          <span className="text-sm font-bold truncate">{label}</span>
                          {it.isHistoricalExtra && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              Histórica
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {!goal
                            ? 'Meta eliminada'
                            : !hasTargetAmount
                              ? 'Sin importe objetivo · asignación manual'
                              : progress?.isCompleted
                                ? 'Meta completada'
                                : `Faltan ${formatEUR(progress?.remaining ?? 0)}${
                                    progress?.monthlyNeeded
                                      ? ` · Ref. fecha: ${formatEUR(progress.monthlyNeeded)}/mes`
                                      : ' · Sin fecha límite'
                                  }`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveDraftGoal(idx, -1)}
                        aria-label={`Subir ${label}`}
                        className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === draftItems.length - 1}
                        onClick={() => handleMoveDraftGoal(idx, 1)}
                        aria-label={`Bajar ${label}`}
                        className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!it.selected}
                        aria-label={`Importe mensual para ${label} (€)`}
                        value={it.amountInput}
                        onChange={(e) => handleChangeDraftAmount(it.goalId, e.target.value)}
                        className="w-24 min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-sm font-bold text-right tabular-nums disabled:opacity-40"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {monthSaveError && (
            <div
              role="alert"
              data-testid="month-plan-save-error"
              className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3.5 py-2.5 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{monthSaveError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={savingMonth}
              data-testid="save-month-savings-plan-btn"
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingMonth ? 'Guardando...' : `Guardar plan de ${monthLabel}`}
            </button>
            <button
              type="button"
              onClick={closeAllEditors}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* ─── VISTA RESUMEN Y SEGUIMIENTO DE METAS DEL MES ───────────────────── */}
      {evaluation.hasPlan ? (
        <div className="space-y-3">
          {/* Métricas rápidas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500">Previsto este mes</p>
              <p className="font-display text-base font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                {formatEUR(evaluation.targetAmount)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500">Aportado este mes</p>
              <p className="font-display text-base font-bold text-[#15803D] dark:text-[#4ADE80]">
                {formatEUR(evaluation.totalContributedAll)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500">Pendiente en metas</p>
              <p className="font-display text-base font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                {formatEUR(evaluation.totalPending)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3">
              <p className="text-[11px] text-slate-500">Sin asignar</p>
              <p className="font-display text-base font-bold text-slate-700 dark:text-slate-200">
                {formatEUR(evaluation.unassignedAmount)}
              </p>
            </div>
          </div>

          {/* Filas por meta */}
          {evaluation.rows.length > 0 && (
            <div className="space-y-2">
              {evaluation.rows.map((row) => {
                const badge = STATUS_BADGES[row.status];
                const goalObj = goalsById.get(row.goalId);
                return (
                  <div
                    key={row.goalId}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E191D] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: row.goalColor }}
                        />
                        <span className="font-semibold text-sm truncate">{row.goalName}</span>
                        {row.isArchived && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Archivada
                          </span>
                        )}
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold tabular-nums">
                          {formatEUR(row.contributedAmount)} / {formatEUR(row.plannedAmount)}
                        </span>
                        {goalObj && !goalObj.archived && row.pendingAmount > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              onContributePending(goalObj, row.pendingAmount, planMonthKey)
                            }
                            className="min-h-[40px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold"
                          >
                            Aportar pendiente ({formatEUR(row.pendingAmount)})
                          </button>
                        )}
                        {row.pendingAmount === 0 && row.plannedAmount > 0 && (
                          <CheckCircle2 className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80]" />
                        )}
                      </div>
                    </div>

                    {row.plannedAmount > 0 && (
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, row.progressPct)}%`,
                            backgroundColor: row.goalColor,
                          }}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>
                        {row.excessAmount > 0
                          ? `Superado en +${formatEUR(row.excessAmount)}`
                          : row.pendingAmount > 0
                            ? `Faltan ${formatEUR(row.pendingAmount)}`
                            : row.plannedAmount > 0
                              ? 'Objetivo mensual cumplido'
                              : 'Sin asignación este mes'}
                        {uiMode === 'avanzado' && row.recommendedAmount !== null
                          ? ` · Ref. por fecha: ${formatEUR(row.recommendedAmount)}/mes`
                          : ''}
                      </span>
                      {row.withdrawnAmount > 0 && (
                        <span className="text-[#B42318] dark:text-[#FCA5A5]">
                          Retirado este mes: −{formatEUR(row.withdrawnAmount)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actividad no planificada en el mes */}
          {evaluation.unplannedActivity.length > 0 && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                Otras aportaciones en {monthLabel} fuera del plan:
              </p>
              <ul className="space-y-0.5 text-slate-600 dark:text-slate-300 tabular-nums">
                {evaluation.unplannedActivity.map((u) => (
                  <li key={u.goalId} className="flex justify-between gap-2">
                    <span>{u.goalName}</span>
                    <span>
                      +{formatEUR(u.contributedAmount)}
                      {u.withdrawnAmount > 0 ? ` · −${formatEUR(u.withdrawnAmount)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        activePanel === 'none' && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <p className="font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
              Todavía no hay un plan de ahorro para {monthLabel}.
            </p>
            <p>
              Puedes crear un <strong>plan habitual</strong> (se aplica automáticamente cada mes por
              orden de prioridad) o pulsar <strong>«Planificar ahorro del mes»</strong> para decidir
              cuánto apartar solo en {monthLabel}.
            </p>
          </div>
        )
      )}

      {/* Diálogo de confirmación para «Volver al plan habitual» / «Eliminar plan del mes» */}
      <ConfirmDialog
        open={confirmRevertOpen}
        title={
          hasHabitualConfigured
            ? `¿Volver al plan habitual en ${monthLabel}?`
            : `¿Eliminar el plan guardado de ${monthLabel}?`
        }
        description={
          hasHabitualConfigured
            ? `Se quitará el ajuste específico de ${monthLabel} y volverá a aplicarse la propuesta de vuestro plan habitual (${formatEUR(habitualPlan!.monthlyAmount)}/mes). Las aportaciones reales registradas en vuestras huchas nunca se borran.`
            : `Se eliminará la planificación de ${monthLabel}. Las aportaciones reales registradas en vuestras huchas nunca se borran.`
        }
        confirmLabel={
          deletingPlan
            ? 'Quitando...'
            : hasHabitualConfigured
              ? 'Volver al plan habitual'
              : 'Eliminar plan'
        }
        destructive
        onConfirm={() => void handleConfirmDeleteMonthPlan()}
        onCancel={() => setConfirmRevertOpen(false)}
      />
    </section>
  );
};
