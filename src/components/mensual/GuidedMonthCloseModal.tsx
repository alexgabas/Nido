import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Copy,
  Lock,
  RotateCcw,
  Scale,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { CategoryTag } from '../CategoryTag';
import { useNido } from '../../context/NidoContext';
import { mergeMonthlyAndCustomBudgetLimits } from '../../domain/categories';
import {
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  roundCents,
  shiftMonthKey,
  type CoupleBalanceResult,
} from '../../domain/finance';
import {
  buildGuidedClosePendingItems,
  buildNextMonthBudgetCopyPlan,
  computeGuidedCloseReview,
  computeGuidedCloseSteps,
  deriveGuidedCloseInitialStep,
  type GuidedCloseStepId,
} from '../../domain/guidedMonthClose';
import type { MonthlyPlanSummary } from '../../domain/monthlyPlanning';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type {
  CustomCategory,
  HouseholdMember,
  MonthClosure,
  MonthlyBudget,
  RecurringExpense,
  Transaction,
  UiMode,
} from '../../types/nido';

interface GuidedMonthCloseModalProps {
  open: boolean;
  onClose: () => void;
  uiMode: UiMode;
  selectedMonthKey: string;
  isClosed: boolean;
  closure: MonthClosure | undefined;
  monthlyPlanSummary: MonthlyPlanSummary;
  monthTransactions: Transaction[];
  recentTransactions: Transaction[];
  recurring: RecurringExpense[];
  budget: MonthlyBudget | null;
  customCategories: CustomCategory[];
  balance: CoupleBalanceResult;
  secondPersonBalanceText: string;
  memberA: HouseholdMember | undefined;
  memberB: HouseholdMember | undefined;
  effectiveSplitPctA: number;
  closedMonthKeys: Set<string>;
  onRegisterSettlement: () => Promise<void>;
  onCloseMonth: () => Promise<void>;
  onAfterTransactionCreated?: () => void;
}

export const GuidedMonthCloseModal: React.FC<GuidedMonthCloseModalProps> = ({
  open,
  onClose,
  uiMode,
  selectedMonthKey,
  isClosed,
  closure,
  monthlyPlanSummary,
  monthTransactions,
  recentTransactions,
  recurring,
  budget,
  customCategories,
  balance,
  secondPersonBalanceText,
  memberA,
  memberB,
  effectiveSplitPctA,
  closedMonthKeys,
  onRegisterSettlement,
  onCloseMonth,
  onAfterTransactionCreated,
}) => {
  const { householdId, currentUserProfile, repo, showToast } = useNido();

  const steps = useMemo(() => computeGuidedCloseSteps(uiMode), [uiMode]);
  const nextMonthKey = useMemo(() => shiftMonthKey(selectedMonthKey, 1), [selectedMonthKey]);
  const nextMonthClosed = closedMonthKeys.has(nextMonthKey);

  const [activeStep, setActiveStep] = useState<GuidedCloseStepId>('pendientes');
  const [modalError, setModalError] = useState<string | null>(null);

  // Historial bajo demanda para sugerir la media de últimas facturas también en Modo Sencillo
  const [onDemandRecentTxs, setOnDemandRecentTxs] = useState<Transaction[]>([]);
  const viewerUid = currentUserProfile?.uid ?? '';
  const needOnDemandHistory =
    open && !isClosed && recentTransactions.length === 0 && Boolean(householdId) && Boolean(viewerUid);

  useEffect(() => {
    if (!needOnDemandHistory || !householdId || !viewerUid) {
      setOnDemandRecentTxs([]);
      return;
    }
    const minMonth = shiftMonthKey(selectedMonthKey, -11);
    return repo.subscribeTransactionsRecentMonths(
      householdId,
      viewerUid,
      minMonth,
      setOnDemandRecentTxs,
      () => {
        // Fallback silencioso: si falla el historial opcional, sugerimos el importe de la plantilla
      }
    );
  }, [needOnDemandHistory, householdId, viewerUid, selectedMonthKey, repo]);

  const effectiveHistoryTxs = useMemo(
    () => (recentTransactions.length > 0 ? recentTransactions : onDemandRecentTxs),
    [recentTransactions, onDemandRecentTxs]
  );

  // Paso 1: Pendientes + omitidos de este mes
  const pendingData = useMemo(
    () =>
      buildGuidedClosePendingItems({
        monthKey: selectedMonthKey,
        monthTransactions,
        recurring,
        historicalTransactions: effectiveHistoryTxs,
      }),
    [selectedMonthKey, monthTransactions, recurring, effectiveHistoryTxs]
  );

  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [busyRecurringId, setBusyRecurringId] = useState<string | null>(null);

  // Paso 2: Revisión (solo lectura)
  const reviewSummary = useMemo(
    () => computeGuidedCloseReview(monthlyPlanSummary),
    [monthlyPlanSummary]
  );

  // Paso 3: Liquidación
  const [settling, setSettling] = useState(false);

  // Paso 4: Presupuestos del mes siguiente
  const [nextMonthBudget, setNextMonthBudget] = useState<MonthlyBudget | null>(null);
  const [loadingNextBudget, setLoadingNextBudget] = useState(false);
  const [nextBudgetLoadedForKey, setNextBudgetLoadedForKey] = useState<string | null>(null);
  const [overwriteNextBudgets, setOverwriteNextBudgets] = useState(false);
  const [copyingBudgets, setCopyingBudgets] = useState(false);

  // Paso 5: Cierre
  const [closingMonth, setClosingMonth] = useState(false);

  const sourceHasBudgets = useMemo(
    () => Object.keys(budget?.limits ?? {}).length > 0,
    [budget]
  );

  const nextMonthHasBudgets = useMemo(
    () => Object.keys(nextMonthBudget?.limits ?? {}).length > 0,
    [nextMonthBudget]
  );

  const copyPlan = useMemo(
    () =>
      buildNextMonthBudgetCopyPlan({
        sourceBudget: budget,
        targetBudget: nextMonthBudget,
        customCategories,
        overwriteExisting: overwriteNextBudgets,
      }),
    [budget, nextMonthBudget, customCategories, overwriteNextBudgets]
  );

  const changesToApplyCount =
    copyPlan.toFill.length + (overwriteNextBudgets ? copyPlan.toOverwrite.length : 0);
  const preservedExistingCount =
    (overwriteNextBudgets ? 0 : copyPlan.toOverwrite.length) + copyPlan.unchanged.length;

  // Al abrir el asistente (o cambiar de mes/modo), derivar el paso inicial del estado real
  useEffect(() => {
    if (!open) return;
    setModalError(null);
    setOverwriteNextBudgets(false);
    setAmountDrafts({});
    const initial = deriveGuidedCloseInitialStep({
      uiMode,
      isClosed,
      pendingCount: pendingData.pending.length,
      balance,
      sourceHasBudgets,
    });
    setActiveStep(initial);
    // Solo al abrir o cambiar de mes/modo para no saltar mientras el usuario interactúa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedMonthKey, uiMode]);

  // Asegurar que activeStep existe si cambia el uiMode estando abierto
  useEffect(() => {
    if (!open) return;
    if (!steps.some((s) => s.id === activeStep)) {
      setActiveStep(steps[0].id);
    }
  }, [open, steps, activeStep]);

  // Cargar presupuesto del mes siguiente bajo demanda cuando estamos en Avanzado
  useEffect(() => {
    if (!open || isClosed || uiMode !== 'avanzado' || !householdId) {
      setLoadingNextBudget(false);
      return;
    }
    let cancelled = false;
    setLoadingNextBudget(true);
    setNextBudgetLoadedForKey(null);
    repo
      .fetchMonthBudgets(householdId, nextMonthKey)
      .then((res) => {
        if (cancelled) return;
        setNextMonthBudget(
          mergeMonthlyAndCustomBudgetLimits(res.systemBudget, res.categoryBudgets, nextMonthKey)
        );
        setNextBudgetLoadedForKey(nextMonthKey);
        setLoadingNextBudget(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setModalError(
          toUserFriendlyErrorMessage(
            err,
            'No se pudieron comprobar los presupuestos del mes siguiente.'
          )
        );
        setLoadingNextBudget(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isClosed, uiMode, householdId, nextMonthKey, repo]);

  // Limpiar caché de presupuesto siguiente al cerrar el modal o cambiar mes
  useEffect(() => {
    if (!open) {
      setNextBudgetLoadedForKey(null);
      setNextMonthBudget(null);
      setLoadingNextBudget(false);
    }
  }, [open, selectedMonthKey]);

  // Escape para cerrar modal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const monthLabel = formatMonthLabelES(selectedMonthKey);
  const nextMonthLabel = formatMonthLabelES(nextMonthKey);
  const shortNameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const shortNameB = memberB?.displayName?.split(' ')[0] || 'Pareja';

  const getDraftAmountValue = (recId: string, suggestedAmount: number): string => {
    if (Object.prototype.hasOwnProperty.call(amountDrafts, recId)) {
      return amountDrafts[recId];
    }
    return String(suggestedAmount);
  };

  const handleRegisterPending = async (rec: RecurringExpense, suggestedAmount: number) => {
    if (!householdId || !currentUserProfile || isClosed || busyRecurringId) return;
    const raw = getDraftAmountValue(rec.id, suggestedAmount).replace(',', '.').trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setModalError('Introduce un importe válido igual o superior a 0 €.');
      return;
    }
    setModalError(null);
    setBusyRecurringId(rec.id);
    try {
      const created = await repo.generateMonthTransactions(
        householdId,
        selectedMonthKey,
        [{ ...rec, amount: roundCents(parsed) }],
        effectiveSplitPctA,
        currentUserProfile
      );
      if (created > 0) {
        onAfterTransactionCreated?.();
        showToast(`Registrado "${rec.concept}" (${formatEUR(parsed)})`);
      } else {
        showToast(`"${rec.concept}" ya estaba registrado este mes`);
      }
    } catch (err) {
      setModalError(toUserFriendlyErrorMessage(err, 'No se pudo registrar el gasto previsto.'));
    } finally {
      setBusyRecurringId(null);
    }
  };

  const handleToggleSkip = async (rec: RecurringExpense, skipped: boolean) => {
    if (!householdId || !currentUserProfile || isClosed || busyRecurringId) return;
    setModalError(null);
    setBusyRecurringId(rec.id);
    try {
      await repo.setRecurringMonthSkipped(
        householdId,
        rec.id,
        selectedMonthKey,
        skipped,
        currentUserProfile
      );
      showToast(
        skipped
          ? `"${rec.concept}" omitido solo para ${monthLabel}`
          : `"${rec.concept}" restaurado en ${monthLabel}`
      );
    } catch (err) {
      setModalError(
        toUserFriendlyErrorMessage(err, 'No se pudo actualizar la omisión de esta plantilla.')
      );
    } finally {
      setBusyRecurringId(null);
    }
  };

  const handleSettlementClick = async () => {
    if (isClosed || settling || balance.owesDirection === 'peace' || !memberB) return;
    setModalError(null);
    setSettling(true);
    try {
      await onRegisterSettlement();
    } catch (err) {
      setModalError(toUserFriendlyErrorMessage(err, 'No se pudo registrar la liquidación.'));
    } finally {
      setSettling(false);
    }
  };

  const handleCopyNextMonthBudgets = async () => {
    if (
      !householdId ||
      !currentUserProfile ||
      isClosed ||
      nextMonthClosed ||
      copyingBudgets ||
      changesToApplyCount === 0
    ) {
      return;
    }
    setModalError(null);
    setCopyingBudgets(true);
    try {
      await repo.saveAllBudgets(
        householdId,
        nextMonthKey,
        copyPlan.mergedLimits,
        customCategories.map((c) => c.id),
        currentUserProfile
      );
      const refreshed = await repo.fetchMonthBudgets(householdId, nextMonthKey);
      setNextMonthBudget(
        mergeMonthlyAndCustomBudgetLimits(
          refreshed.systemBudget,
          refreshed.categoryBudgets,
          nextMonthKey
        )
      );
      setNextBudgetLoadedForKey(nextMonthKey);
      setOverwriteNextBudgets(false);
      onAfterTransactionCreated?.();
      showToast(
        `Presupuestos copiados a ${nextMonthLabel} (${changesToApplyCount} cat.)`
      );
    } catch (err) {
      setModalError(
        toUserFriendlyErrorMessage(err, 'No se pudieron copiar los presupuestos al mes siguiente.')
      );
    } finally {
      setCopyingBudgets(false);
    }
  };

  const handleConfirmCloseMonth = async () => {
    if (isClosed || closingMonth) return;
    setModalError(null);
    setClosingMonth(true);
    try {
      await onCloseMonth();
    } catch (err) {
      setModalError(toUserFriendlyErrorMessage(err, 'No se pudo cerrar el mes.'));
    } finally {
      setClosingMonth(false);
    }
  };

  const currentStepIndex = steps.findIndex((s) => s.id === activeStep);
  const canGoBack = currentStepIndex > 0;
  const canGoNext = currentStepIndex >= 0 && currentStepIndex < steps.length - 1;

  // ─── VISTA SOLO LECTURA CUANDO EL MES YA ESTÁ CERRADO ───────────────────────
  if (isClosed) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-close-title"
      >
        <div className="w-full sm:max-w-2xl max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <Lock className="w-3.5 h-3.5" />
                <span>Mes cerrado · Solo lectura</span>
              </div>
              <h2 id="guided-close-title" className="font-display text-lg font-bold truncate">
                Resumen de cierre · {monthLabel}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar resumen de cierre"
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 overflow-y-auto space-y-5">
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Gasto compartido</p>
                  <p className="font-mono-num text-base font-bold">
                    {formatEUR(closure?.totalSpent ?? monthlyPlanSummary.registeredTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Pagó {shortNameA}</p>
                  <p className="font-mono-num text-base font-bold">
                    {formatEUR(closure?.paidA ?? balance.paidA)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Pagó {shortNameB}</p>
                  <p className="font-mono-num text-base font-bold">
                    {formatEUR(closure?.paidB ?? balance.paidB)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Cuenta común</p>
                  <p className="font-mono-num text-base font-bold">
                    {formatEUR(closure?.paidComun ?? balance.paidComun)}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Saldo al cerrar: {closure?.settlementText || secondPersonBalanceText}
                </span>
                {closure?.closedAt && (
                  <span className="text-slate-500 dark:text-slate-400">
                    Cerrado el {formatDateES(closure.closedAt.slice(0, 10))}
                  </span>
                )}
              </div>
            </div>

            {reviewSummary.rows.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Presupuesto frente a gasto real
                </h3>
                <div className="space-y-2">
                  {reviewSummary.rows.map((item) => (
                    <div
                      key={item.row.categoryId}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <CategoryTag category={item.row.categoryId} size="xs" />
                      </div>
                      <div className="text-right font-mono-num text-xs shrink-0">
                        <span className="font-bold">{formatEUR(item.row.registered)}</span>
                        {item.row.budgetLimit !== null && (
                          <span className="text-slate-500 dark:text-slate-400">
                            {' '}
                            / {formatEUR(item.row.budgetLimit)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Este mes está bloqueado para evitar cambios accidentales. Si necesitas corregir algo,
              puedes desbloquearlo desde la barra superior en Modo Avanzado.
            </p>
          </div>

          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold hover:bg-[#0A464E]"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ASISTENTE GUIADO PARA MES ABIERTO ──────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-close-title"
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0E5A64] dark:text-[#5EEAD4]">
              Cierre de mes guiado · Paso {currentStepIndex + 1} de {steps.length}
            </p>
            <h2 id="guided-close-title" className="font-display text-lg font-bold truncate">
              Cerrar {monthLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar asistente de cierre de mes"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de pasos derivada del estado real */}
        <nav
          aria-label="Pasos del cierre de mes"
          className="px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 overflow-x-auto"
        >
          <ol className="flex items-center gap-1.5 min-w-max">
            {steps.map((step, idx) => {
              const isActive = step.id === activeStep;
              const isDoneDerived =
                (step.id === 'pendientes' && pendingData.pending.length === 0) ||
                (step.id === 'cuentas' && balance.owesDirection === 'peace') ||
                (step.id === 'proximo_mes' &&
                  nextBudgetLoadedForKey === nextMonthKey &&
                  (!sourceHasBudgets || copyPlan.toFill.length === 0));

              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setModalError(null);
                      setActiveStep(step.id);
                    }}
                    aria-current={isActive ? 'step' : undefined}
                    className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      isActive
                        ? 'bg-[#0E5A64] text-white'
                        : isDoneDerived
                          ? 'bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] hover:bg-[#15803D]/20'
                          : 'bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : isDoneDerived
                            ? 'bg-[#15803D] text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {isDoneDerived && !isActive ? <Check className="w-3 h-3" /> : idx + 1}
                    </span>
                    <span>{step.shortLabel}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Cuerpo scrollable */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {modalError && (
            <div
              role="alert"
              className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] px-4 py-3 text-xs font-medium flex items-center justify-between gap-2"
            >
              <span>{modalError}</span>
              <button
                type="button"
                onClick={() => setModalError(null)}
                className="min-h-[36px] px-2 font-semibold underline shrink-0"
              >
                Cerrar
              </button>
            </div>
          )}

          {/* ─── PASO 1: PENDIENTES ─────────────────────────────────────────── */}
          {activeStep === 'pendientes' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold">
                  1. Cargos previstos pendientes
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Confirma el importe real de las facturas que falten o indícanos si alguna no se
                  ha producido este mes. Tu plantilla seguirá activa para los próximos meses.
                </p>
              </div>

              {pendingData.pending.length === 0 ? (
                <div className="rounded-2xl bg-[#15803D]/8 dark:bg-[#15803D]/15 border border-[#15803D]/25 p-4 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#15803D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-[#14532D] dark:text-[#86EFAC]">
                      Todos los cargos previstos de {monthLabel} están revisados
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      No queda ninguna plantilla activa pendiente de registrar este mes.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-3" aria-label="Cargos previstos pendientes">
                  {pendingData.pending.map((item) => {
                    const isBusy = busyRecurringId === item.recurring.id;
                    const draftVal = getDraftAmountValue(item.recurring.id, item.suggestedAmount);
                    return (
                      <li
                        key={item.recurring.id}
                        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <p className="text-sm font-bold truncate">{item.recurring.concept}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <CategoryTag category={item.recurring.category} size="xs" />
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Previsto el {formatDateES(item.dueDate)}
                              </span>
                            </div>
                          </div>
                          {item.historicalAverage !== null ? (
                            <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]">
                              Media últimas {item.historicalSampleCount}:{' '}
                              {formatEUR(item.historicalAverage)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              Habitual: {formatEUR(item.templateAmount)}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
                          <div className="sm:w-36">
                            <label
                              htmlFor={`guided-amount-${item.recurring.id}`}
                              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                            >
                              Importe real (€)
                            </label>
                            <input
                              id={`guided-amount-${item.recurring.id}`}
                              type="text"
                              inputMode="decimal"
                              value={draftVal}
                              disabled={isBusy}
                              onChange={(e) =>
                                setAmountDrafts((prev) => ({
                                  ...prev,
                                  [item.recurring.id]: e.target.value,
                                }))
                              }
                              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm font-semibold"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 flex-1 sm:justify-end">
                            <button
                              type="button"
                              disabled={Boolean(busyRecurringId)}
                              onClick={() =>
                                void handleRegisterPending(item.recurring, item.suggestedAmount)
                              }
                              className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-xs font-semibold"
                            >
                              {isBusy ? 'Guardando...' : 'Registrar'}
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(busyRecurringId)}
                              onClick={() => void handleToggleSkip(item.recurring, true)}
                              className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-slate-700 dark:text-slate-200"
                            >
                              No se ha producido este mes
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {pendingData.skippedThisMonth.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Omitidos solo en {monthLabel} ({pendingData.skippedThisMonth.length})
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    No han generado ningún gasto este mes, pero sus plantillas siguen activas para
                    el mes siguiente.
                  </p>
                  <ul className="space-y-2">
                    {pendingData.skippedThisMonth.map((item) => (
                      <li
                        key={item.recurring.id}
                        className="flex items-center justify-between gap-2 text-xs bg-slate-50 dark:bg-slate-900/50 rounded-xl px-3 py-2"
                      >
                        <span className="font-medium truncate">{item.recurring.concept}</span>
                        <button
                          type="button"
                          disabled={Boolean(busyRecurringId)}
                          onClick={() => void handleToggleSkip(item.recurring, false)}
                          className="min-h-[44px] px-3 rounded-lg text-[#0E5A64] dark:text-[#5EEAD4] font-semibold inline-flex items-center gap-1 hover:bg-[#0E5A64]/10 shrink-0 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Deshacer</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ─── PASO 2: REVISIÓN (SOLO AVANZADO, SOLO LECTURA) ─────────────── */}
          {activeStep === 'revision' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold">
                  2. Revisión: presupuesto frente a gasto real
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Vista de solo lectura de gastos compartidos de {monthLabel} (sin liquidaciones ni
                  gastos privados). Las desviaciones relevantes aparecen destacadas primero.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Presupuesto configurado
                  </p>
                  <p className="font-mono-num text-lg font-bold mt-0.5">
                    {monthlyPlanSummary.hasAnyBudget
                      ? formatEUR(reviewSummary.totalBudget)
                      : 'Sin configurar'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Gasto real</p>
                  <p className="font-mono-num text-lg font-bold mt-0.5">
                    {formatEUR(reviewSummary.totalRegistered)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Desviación</p>
                  <p
                    className={`font-mono-num text-lg font-bold mt-0.5 ${
                      reviewSummary.totalDelta !== null && reviewSummary.totalDelta > 0
                        ? 'text-[#B42318] dark:text-[#FCA5A5]'
                        : reviewSummary.totalDelta !== null && reviewSummary.totalDelta < 0
                          ? 'text-[#15803D] dark:text-[#4ADE80]'
                          : ''
                    }`}
                  >
                    {reviewSummary.totalDelta === null
                      ? '—'
                      : `${reviewSummary.totalDelta > 0 ? '+' : ''}${formatEUR(reviewSummary.totalDelta)}`}
                  </p>
                </div>
              </div>

              {reviewSummary.rows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400">
                  No hay gastos compartidos ni presupuestos registrados en {monthLabel}.
                </div>
              ) : (
                <ul className="space-y-2.5" aria-label="Desglose presupuesto frente a real">
                  {reviewSummary.rows.map((item) => {
                    const isOver = item.deviationKind === 'over_budget';
                    const isUnbudgeted = item.deviationKind === 'unbudgeted';
                    const isUnderSig = item.deviationKind === 'under_significant';
                    return (
                      <li
                        key={item.row.categoryId}
                        className={`rounded-2xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                          isOver && item.isSignificant
                            ? 'border-[#B42318]/40 bg-[#B42318]/5 dark:bg-[#B42318]/10'
                            : isUnbudgeted && item.isSignificant
                              ? 'border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <CategoryTag category={item.row.categoryId} size="xs" />
                            {isOver && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#B42318] dark:text-[#FCA5A5]">
                                <TrendingUp className="w-3.5 h-3.5" />
                                <span>
                                  Supera en {formatEUR(Math.abs(item.delta ?? 0))}
                                  {item.deltaPct !== null ? ` (+${item.deltaPct}%)` : ''}
                                </span>
                              </span>
                            )}
                            {isUnbudgeted && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Sin presupuesto</span>
                              </span>
                            )}
                            {isUnderSig && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#15803D] dark:text-[#4ADE80]">
                                <TrendingDown className="w-3.5 h-3.5" />
                                <span>
                                  Bajo presupuesto ({formatEUR(item.delta ?? 0)}
                                  {item.deltaPct !== null ? `, ${item.deltaPct}%` : ''})
                                </span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-left sm:text-right font-mono-num text-xs shrink-0">
                          <p className="font-bold text-sm">{formatEUR(item.row.registered)}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {item.row.budgetLimit !== null
                              ? `Presupuesto: ${formatEUR(item.row.budgetLimit)}`
                              : 'Sin límite'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ─── PASO 3: CUENTAS ENTRE VOSOTROS ─────────────────────────────── */}
          {activeStep === 'cuentas' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold">
                  {uiMode === 'sencillo' ? '2.' : '3.'} Cuentas entre vosotros
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Saldo calculado con los gastos compartidos y liquidaciones registradas en{' '}
                  {monthLabel}. Este paso se puede omitir si preferís ajustar cuentas otro día.
                </p>
              </div>

              <div
                className={`rounded-2xl border p-4 space-y-3 ${
                  balance.owesDirection === 'peace'
                    ? 'border-[#15803D]/30 bg-[#15803D]/8 dark:bg-[#15803D]/15'
                    : 'border-[#0E5A64]/25 bg-[#0E5A64]/6 dark:bg-[#2AA1AE]/10'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      balance.owesDirection === 'peace'
                        ? 'bg-[#15803D] text-white'
                        : 'bg-[#0E5A64] text-white'
                    }`}
                  >
                    {balance.owesDirection === 'peace' ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <Scale className="w-5 h-5" />
                    )}
                  </span>
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-bold">{secondPersonBalanceText}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {shortNameA} pagó {formatEUR(balance.paidA)} (su parte:{' '}
                      {formatEUR(balance.shareA)}) · {shortNameB} pagó {formatEUR(balance.paidB)}{' '}
                      (su parte: {formatEUR(balance.shareB)})
                      {balance.paidComun > 0
                        ? ` · Cuenta común: ${formatEUR(balance.paidComun)}`
                        : ''}
                    </p>
                  </div>
                </div>

                {balance.owesDirection !== 'peace' && memberB && (
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={settling}
                      onClick={() => void handleSettlementClick()}
                      className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-xs font-semibold"
                    >
                      {settling
                        ? 'Registrando liquidación...'
                        : `Registrar liquidación (${formatEUR(balance.owesAmount)})`}
                    </button>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">
                      Se registrará como transferencia interna, sin sumarse al gasto del mes.
                    </span>
                  </div>
                )}

                {balance.owesDirection !== 'peace' && !memberB && (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Cuando se una tu pareja podrás registrar la liquidación directamente desde aquí.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ─── PASO 4: PRÓXIMO MES (SOLO AVANZADO) ────────────────────────── */}
          {activeStep === 'proximo_mes' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold">
                  4. Preparar presupuestos de {nextMonthLabel}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Puedes copiar los límites de {monthLabel} a {nextMonthLabel}. Por defecto nunca
                  sobrescribimos categorías que ya tengan presupuesto en {nextMonthLabel}.
                </p>
              </div>

              {loadingNextBudget ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400">
                  Comprobando presupuestos de {nextMonthLabel}...
                </div>
              ) : nextMonthClosed ? (
                <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>
                    {nextMonthLabel} ya está cerrado, así que sus presupuestos no se pueden
                    modificar.
                  </span>
                </div>
              ) : !sourceHasBudgets ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-600 dark:text-slate-400">
                  {monthLabel} no tiene presupuestos configurados para copiar. Puedes continuar al
                  cierre.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3.5">
                  <div className="space-y-1 text-xs">
                    {changesToApplyCount > 0 ? (
                      <p className="font-semibold text-slate-800 dark:text-slate-100">
                        Se copiarán {changesToApplyCount}{' '}
                        {changesToApplyCount === 1 ? 'categoría' : 'categorías'} a{' '}
                        {nextMonthLabel}.
                      </p>
                    ) : (
                      <p className="font-semibold text-[#15803D] dark:text-[#4ADE80] inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {nextMonthLabel} ya tiene cubiertas todas las categorías presupuestadas de{' '}
                          {monthLabel}.
                        </span>
                      </p>
                    )}

                    {preservedExistingCount > 0 && (
                      <p className="text-slate-600 dark:text-slate-400">
                        {preservedExistingCount}{' '}
                        {preservedExistingCount === 1
                          ? 'categoría ya tenía'
                          : 'categorías ya tenían'}{' '}
                        límite en {nextMonthLabel} y se conservarán intactas.
                      </p>
                    )}

                    {copyPlan.skippedArchived.length > 0 && (
                      <p className="text-slate-500 dark:text-slate-400">
                        {copyPlan.skippedArchived.length} archivadas se omiten al copiar.
                      </p>
                    )}
                  </div>

                  {nextMonthHasBudgets &&
                    (copyPlan.toOverwrite.length > 0 || overwriteNextBudgets) && (
                      <label className="flex items-start gap-2.5 text-xs cursor-pointer min-h-[44px] py-1">
                        <input
                          type="checkbox"
                          checked={overwriteNextBudgets}
                          onChange={(e) => setOverwriteNextBudgets(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded accent-[#0E5A64]"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          Sobrescribir también los {copyPlan.toOverwrite.length} límites distintos ya
                          configurados en {nextMonthLabel}
                        </span>
                      </label>
                    )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={copyingBudgets || changesToApplyCount === 0}
                      onClick={() => void handleCopyNextMonthBudgets()}
                      className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Copy className="w-4 h-4" />
                      <span>
                        {copyingBudgets
                          ? 'Copiando presupuestos...'
                          : `Copiar presupuestos a ${nextMonthLabel}`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── PASO 5: CERRAR MES ─────────────────────────────────────────── */}
          {activeStep === 'cerrar' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-base font-bold">
                  {uiMode === 'sencillo' ? '3.' : '5.'} Confirmar cierre de {monthLabel}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Revisa el resumen final antes de confirmar. Nada se cerrará hasta que pulses el
                  botón.
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">
                    Gasto compartido registrado
                  </span>
                  <span className="font-mono-num font-bold text-sm">
                    {formatEUR(monthlyPlanSummary.registeredTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">
                    Cargos previstos pendientes
                  </span>
                  <span className="font-semibold">
                    {pendingData.pending.length === 0
                      ? 'Ninguno'
                      : `${pendingData.pending.length} sin registrar`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Cuentas entre vosotros</span>
                  <span className="font-semibold text-right">{secondPersonBalanceText}</span>
                </div>
              </div>

              {pendingData.pending.length > 0 && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/25 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Todavía quedan {pendingData.pending.length} cargos previstos sin registrar ni
                    omitir en el paso 1. Puedes volver atrás o cerrar igualmente.
                  </span>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-semibold inline-flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                  <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                  <span>¿Qué quedará bloqueado al cerrar {monthLabel}?</span>
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li>No se podrán añadir, editar ni eliminar gastos o liquidaciones de {monthLabel}.</li>
                  <li>Los presupuestos y omisiones de plantillas de {monthLabel} quedarán congelados.</li>
                  <li>
                    Se guardará la foto del saldo final. Si necesitas corregirlo más adelante,
                    podrás desbloquear el mes en Modo Avanzado.
                  </li>
                </ul>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  disabled={closingMonth}
                  onClick={() => void handleConfirmCloseMonth()}
                  className="w-full sm:w-auto min-h-[48px] px-6 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <CalendarCheck2 className="w-4 h-4" />
                  <span>
                    {closingMonth ? 'Cerrando mes...' : `Confirmar y cerrar ${monthLabel}`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pie con navegación entre pasos */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (canGoBack) {
                setModalError(null);
                setActiveStep(steps[currentStepIndex - 1].id);
              } else {
                onClose();
              }
            }}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {canGoBack ? (
              <>
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </>
            ) : (
              <span>Seguir después</span>
            )}
          </button>

          <div className="flex items-center gap-2">
            {canGoBack && (
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-3 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              >
                Salir
              </button>
            )}
            {canGoNext && (
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setActiveStep(steps[currentStepIndex + 1].id);
                }}
                className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
