import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  History,
  Package,
  PackageCheck,
  Pencil,
  PiggyBank,
  Scale,
  Share2,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react';
import { DonutChart, MonthlyBarChart } from '../components/Charts';
import { ONBOARDING_SEEN_KEY, OnboardingWalkthrough } from '../components/OnboardingWalkthrough';
import { ShoppingListSection } from '../components/ShoppingListSection';
import { useNido } from '../context/NidoContext';
import {
  calculateCoupleBalance,
  computeFurnitureSummary,
  computeSavingsCapacity,
  formatCoupleBalanceSecondPerson,
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  formatMonthShortES,
  getBudgetThresholdAlerts,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  getUpcomingCharges,
  getUpcomingChargesWithinDays,
  localDaysBetween,
  roundCents,
  shiftMonthKey,
} from '../domain/finance';
import { EXPENSE_CATEGORY_LABELS } from '../domain/presets';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import type { ExpenseCategory } from '../types/nido';

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  alquiler: '#0E5A64',
  supermercado: '#15803D',
  luz: '#D97706',
  agua: '#0284C7',
  gas: '#EA580C',
  internet: '#4F46E5',
  movil: '#7C3AED',
  suscripciones: '#DB2777',
  seguros: '#0F766E',
  comunidad: '#475569',
  transporte: '#2563EB',
  ocio: '#DC4C3E',
  otros: '#64748B',
};

export const InicioView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentMember,
    currentUserProfile,
    isDemoMode,
    uiMode,
    setActiveTab,
    selectedMonthKey,
    setSelectedMonthKey,
    currentMonthBudget,
    recurring,
    currentMonthTransactions,
    recentTransactions,
    monthClosures,
    checklist,
    furnitureItems,
    goals,
    goalMovements,
    shoppingItems,
    activity,
    repo,
    showToast,
  } = useNido();

  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [draftIncomeA, setDraftIncomeA] = useState('');
  const [draftIncomeB, setDraftIncomeB] = useState('');
  const [savingIncomes, setSavingIncomes] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  useEffect(() => {
    if (isDemoMode || !household?.id) return;
    try {
      const seen = window.localStorage.getItem(ONBOARDING_SEEN_KEY);
      if (!seen) {
        setWalkthroughOpen(true);
      }
    } catch {
      // Ignore storage errors
    }
  }, [isDemoMode, household?.id]);

  const handleShareInvite = async () => {
    if (!household?.inviteCode) return;
    const text = `Únete a "${household.name}" en Nido con el código: ${household.inviteCode}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Invitación a ${household.name} en Nido`,
          text,
          url: window.location.origin,
        });
        showToast('Código compartido');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(household.inviteCode);
      showToast(`Código ${household.inviteCode} copiado`);
    } catch {
      showToast(`Código: ${household.inviteCode}`);
    }
  };

  const todayISO = getTodayLocalISO();
  const currentMonthKey = getCurrentMonthKeyLocal();

  const currentMonthTx = useMemo(
    () =>
      uiMode === 'sencillo'
        ? currentMonthTransactions
        : recentTransactions.filter((t) => t.monthKey === currentMonthKey),
    [uiMode, currentMonthTransactions, recentTransactions, currentMonthKey]
  );

  const balance = useMemo(
    () => calculateCoupleBalance(currentMonthTx, memberA, memberB),
    [currentMonthTx, memberA, memberB]
  );

  const secondPersonBalanceText = useMemo(
    () => formatCoupleBalanceSecondPerson(balance, currentMember, memberA, memberB),
    [balance, currentMember, memberA, memberB]
  );

  const activeGoals = useMemo(() => goals.filter((g) => !g.archived), [goals]);

  const totalSavings = useMemo(() => {
    const activeGoalIds = new Set(activeGoals.map((g) => g.id));
    const total = goalMovements
      .filter((m) => activeGoalIds.has(m.goalId))
      .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    return roundCents(Math.max(0, total));
  }, [activeGoals, goalMovements]);

  const totalSavingsTarget = useMemo(
    () => roundCents(activeGoals.reduce((sum, g) => sum + Math.max(0, Number(g.targetAmount) || 0), 0)),
    [activeGoals]
  );

  const savingsBarPct =
    totalSavingsTarget > 0 ? Math.min(100, Math.round((totalSavings / totalSavingsTarget) * 100)) : 0;

  // Monthly planned budget total (always uses current month's budget)
  const currentMonthBudgetTotal = useMemo(() => {
    if (!currentMonthBudget || currentMonthBudget.monthKey !== currentMonthKey) return 0;
    return roundCents(
      Object.values(currentMonthBudget.limits ?? {}).reduce(
        (sum, v) => sum + Math.max(0, Number(v) || 0),
        0
      )
    );
  }, [currentMonthBudget, currentMonthKey]);

  const spendBarPct =
    currentMonthBudgetTotal > 0
      ? Math.min(100, Math.round((balance.totalSpent / currentMonthBudgetTotal) * 100))
      : 0;

  const upcomingCharges = useMemo(
    () => getUpcomingCharges(recurring, todayISO, 3),
    [recurring, todayISO]
  );

  const budgetAlerts = useMemo(
    () => getBudgetThresholdAlerts(currentMonthTx, currentMonthBudget, 80),
    [currentMonthTx, currentMonthBudget]
  );

  const upcoming3Days = useMemo(
    () => getUpcomingChargesWithinDays(recurring, todayISO, 3, currentMonthTx),
    [recurring, todayISO, currentMonthTx]
  );

  const hasAlerts = budgetAlerts.length > 0 || upcoming3Days.length > 0;

  const formatDaysUntilLabel = (days: number) => {
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Mañana';
    return `En ${days} días`;
  };

  const last12MonthsBars = useMemo(() => {
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      keys.push(shiftMonthKey(currentMonthKey, -i));
    }
    const sums = new Map<string, number>();
    for (const tx of recentTransactions) {
      if (tx.isPrivate || tx.isSettlement || tx.category === 'liquidacion') continue;
      sums.set(tx.monthKey, (sums.get(tx.monthKey) ?? 0) + tx.amount);
    }
    return keys.map((mk) => ({
      label: formatMonthShortES(mk),
      value: roundCents(sums.get(mk) ?? 0),
      highlight: mk === currentMonthKey,
    }));
  }, [recentTransactions, currentMonthKey]);

  const categoryDonutSlices = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const tx of currentMonthTx) {
      if (tx.isPrivate || tx.isSettlement || tx.category === 'liquidacion') continue;
      const cat = tx.category as ExpenseCategory;
      map.set(cat, (map.get(cat) ?? 0) + tx.amount);
    }
    return Array.from(map.entries())
      .map(([cat, value]) => ({
        label: EXPENSE_CATEGORY_LABELS[cat] || cat,
        value: roundCents(value),
        color: CATEGORY_COLORS[cat] || '#64748B',
      }))
      .sort((a, b) => b.value - a.value);
  }, [currentMonthTx]);

  const furnitureSummary = useMemo(
    () => computeFurnitureSummary(furnitureItems),
    [furnitureItems]
  );

  const pendingFurnitureCount = useMemo(
    () => furnitureItems.filter((f) => f.status === 'pendiente' || f.status === 'en_carrito').length,
    [furnitureItems]
  );
  const pendingChecklistCount = useMemo(
    () => checklist.filter((c) => !c.done).length,
    [checklist]
  );
  const currentMonthExpenseCount = useMemo(
    () => currentMonthTx.filter((t) => !t.isPrivate && !t.isSettlement).length,
    [currentMonthTx]
  );

  const savingsCapacity = useMemo(
    () =>
      household
        ? computeSavingsCapacity(household.settings, recurring, {
            transactions: recentTransactions,
            monthClosures,
            currentMonthKey,
            budget: currentMonthBudget,
          })
        : {
            incomeA: 0,
            incomeB: 0,
            totalIncome: 0,
            activeFixedMonthly: 0,
            historyAvg3Months: 0,
            historyMonthsUsed: 0,
            hasHistory: false,
            variableBudgetsMonthly: 0,
            habitualSpend: 0,
            fixedMonthly: 0,
            variableMonthly: 0,
            capacity: 0,
            hasIncomeConfigured: false,
          },
    [household, recurring, recentTransactions, monthClosures, currentMonthKey, currentMonthBudget]
  );

  const pendingShoppingCount = useMemo(
    () => shoppingItems.filter((item) => !item.done).length,
    [shoppingItems]
  );

  const openIncomeModal = () => {
    setDraftIncomeA(household?.settings.incomeA ? String(household.settings.incomeA) : '');
    setDraftIncomeB(household?.settings.incomeB ? String(household.settings.incomeB) : '');
    setIncomeError(null);
    setIncomeModalOpen(true);
  };

  const handleSaveIncomes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!household || !householdId || !currentUserProfile) return;
    const incA = Math.max(0, Number(draftIncomeA.replace(',', '.')) || 0);
    const incB = Math.max(0, Number(draftIncomeB.replace(',', '.')) || 0);
    setSavingIncomes(true);
    setIncomeError(null);
    try {
      await repo.updateSettings(
        householdId,
        {
          ...household.settings,
          incomeA: roundCents(incA),
          incomeB: roundCents(incB),
        },
        currentUserProfile,
        `Actualizó ingresos mensuales (${formatEUR(incA)} / ${formatEUR(incB)})`
      );
      setIncomeModalOpen(false);
      showToast('Ingresos guardados');
    } catch (err) {
      setIncomeError(toUserFriendlyErrorMessage(err, 'No se pudieron guardar los ingresos.'));
    } finally {
      setSavingIncomes(false);
    }
  };

  const shortNameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const shortNameB = memberB?.displayName?.split(' ')[0] || 'Pareja';

  const incomeModal = incomeModalOpen && (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="income-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <h2 id="income-modal-title" className="font-display text-lg font-bold">
          Ingresos netos mensuales
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Sirven para calcular cuánto os sobra al mes después de los gastos fijos.
        </p>
        {incomeError && (
          <div role="alert" className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs">
            {incomeError}
          </div>
        )}
        <form onSubmit={handleSaveIncomes} className="space-y-3">
          <div>
            <label htmlFor="inicio-inc-a" className="block text-xs font-medium mb-1">
              Ingresos mensuales · {shortNameA} (€)
            </label>
            <input
              id="inicio-inc-a"
              type="text"
              inputMode="decimal"
              value={draftIncomeA}
              onChange={(e) => setDraftIncomeA(e.target.value)}
              placeholder="0"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-base font-semibold"
            />
          </div>
          <div>
            <label htmlFor="inicio-inc-b" className="block text-xs font-medium mb-1">
              Ingresos mensuales · {shortNameB} (€)
            </label>
            <input
              id="inicio-inc-b"
              type="text"
              inputMode="decimal"
              value={draftIncomeB}
              onChange={(e) => setDraftIncomeB(e.target.value)}
              placeholder="0"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-base font-semibold"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIncomeModalOpen(false)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingIncomes}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingIncomes ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const partnerMissingBanner = members.length < 2 && Boolean(household?.inviteCode) && (
    <section
      aria-label="Invitar a tu pareja"
      className="rounded-3xl bg-[#0E5A64]/8 dark:bg-[#2AA1AE]/12 border border-[#0E5A64]/25 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-[#0E5A64] text-white flex items-center justify-center shrink-0">
          <Users className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
            Tu pareja aún no se ha unido
          </p>
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Código del hogar:{' '}
            <strong className="font-mono tracking-widest text-[#0E5A64] dark:text-[#5EEAD4]">
              {household?.inviteCode}
            </strong>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setWalkthroughOpen(true)}
          className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Cómo funciona
        </button>
        <button
          type="button"
          onClick={() => void handleShareInvite()}
          className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold inline-flex items-center gap-1.5"
        >
          <Share2 className="w-4 h-4" />
          <span>Compartir código</span>
        </button>
      </div>
    </section>
  );

  // ─── MODO SENCILLO ──────────────────────────────────────────────────────────
  if (uiMode === 'sencillo') {
    const viewerName = currentMember?.displayName?.trim() || memberA?.displayName?.trim() || '';
    const spendExceeded = currentMonthBudgetTotal > 0 && balance.totalSpent > currentMonthBudgetTotal;

    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0E5A64] dark:text-[#5EEAD4]">
            {household?.name || 'Nuestro hogar'} · {formatMonthLabelES(currentMonthKey)}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            {viewerName ? `Hola, ${viewerName}` : 'Resumen del hogar'}
          </h1>
        </header>

        {partnerMissingBanner}

        {/* Hero 1: Natural-language monthly spend */}
        <section
          aria-label="Gasto del mes"
          className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-3"
        >
          <p className="font-display text-2xl sm:text-3xl font-bold leading-snug text-[#0F1F24] dark:text-[#F0F5F6]">
            Este mes lleváis{' '}
            <span className="tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
              {formatEUR(balance.totalSpent)}
            </span>{' '}
            gastados
          </p>
          {currentMonthExpenseCount === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Todavía no habéis apuntado gastos este mes. Pulsa el botón + de abajo para empezar.
            </p>
          )}
          {currentMonthBudgetTotal > 0 && (
            <div className="space-y-2">
              <p className="text-base text-slate-600 dark:text-slate-300 tabular-nums">
                de {formatEUR(currentMonthBudgetTotal)} previstos
              </p>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    spendExceeded ? 'bg-[#B42318]' : 'bg-[#0E5A64] dark:bg-[#2AA1AE]'
                  }`}
                  style={{ width: `${spendBarPct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Hero 2: Natural-language balance between partners */}
        <section
          aria-label="Saldo entre vosotros"
          className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Cuentas entre vosotros
            </p>
            <p
              className={`font-display text-2xl sm:text-3xl font-bold leading-tight ${
                balance.owesDirection === 'peace'
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#0F1F24] dark:text-[#F0F5F6]'
              }`}
            >
              {secondPersonBalanceText}
            </p>
          </div>
          <span
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
              balance.owesDirection === 'peace'
                ? 'bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80]'
                : 'bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
            }`}
          >
            {balance.owesDirection === 'peace' ? (
              <CheckCircle2 className="w-6 h-6" />
            ) : (
              <Scale className="w-6 h-6" />
            )}
          </span>
        </section>

        {/* Hero 3: Total savings bar */}
        <button
          type="button"
          onClick={() => setActiveTab('ahorros')}
          className="w-full text-left rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-3 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Vuestro ahorro total
              </p>
              <p className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-[#15803D] dark:text-[#4ADE80]">
                {formatEUR(totalSavings)}
              </p>
            </div>
            <span className="w-11 h-11 rounded-2xl bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] flex items-center justify-center shrink-0">
              <PiggyBank className="w-6 h-6" />
            </span>
          </div>

          {activeGoals.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sin metas de ahorro aún · Pulsa para ver tus huchas
            </p>
          ) : (
            totalSavingsTarget > 0 && (
              <div className="space-y-1.5">
                <div className="h-3.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#15803D] dark:bg-[#4ADE80] transition-all duration-500"
                    style={{ width: `${savingsBarPct}%` }}
                  />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 tabular-nums">
                  de {formatEUR(totalSavingsTarget)} en vuestras metas
                </p>
              </div>
            )
          )}
        </button>

        {/* Capacidad de ahorro (Modo Sencillo: una sola frase clara) */}
        <section
          aria-label="Capacidad de ahorro mensual"
          className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-3"
        >
          <p className="text-base sm:text-lg font-display font-bold leading-snug">
            {!savingsCapacity.hasIncomeConfigured ? (
              'Añade vuestros ingresos para ver cuánto os sobra al mes'
            ) : savingsCapacity.capacity > 0 ? (
              <>
                Os sobran unos{' '}
                <span className="tabular-nums text-[#15803D] dark:text-[#4ADE80]">
                  {formatEUR(savingsCapacity.capacity)}
                </span>{' '}
                al mes
              </>
            ) : (
              <span className="text-[#B42318] dark:text-[#FCA5A5]">Este mes vais justos</span>
            )}
          </p>
          <button
            type="button"
            onClick={openIncomeModal}
            aria-label={savingsCapacity.hasIncomeConfigured ? 'Editar ingresos' : 'Añadir ingresos'}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 shrink-0 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{savingsCapacity.hasIncomeConfigured ? 'Editar' : 'Añadir'}</span>
          </button>
        </section>

        {/* Avisos en Inicio (Modo Sencillo, sin porcentajes técnicos) */}
        {hasAlerts && (
          <section
            aria-label="Avisos importantes"
            className="rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-5 space-y-3"
          >
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <Bell className="w-5 h-5 shrink-0" />
              <h2 className="font-display text-base font-bold">Avisos</h2>
            </div>

            <ul className="space-y-2.5 text-sm text-amber-950 dark:text-amber-100">
              {budgetAlerts.map((alert) => (
                <li key={alert.category} className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-800 dark:text-amber-300 shrink-0 mt-0.5" />
                  <span>
                    {alert.exceeded ? (
                      <>
                        Os habéis pasado en{' '}
                        <strong>{EXPENSE_CATEGORY_LABELS[alert.category]}</strong> por{' '}
                        <span className="tabular-nums font-semibold">
                          {formatEUR(alert.overAmount)}
                        </span>
                      </>
                    ) : alert.atLimit ? (
                      <>
                        Habéis llegado al límite en{' '}
                        <strong>{EXPENSE_CATEGORY_LABELS[alert.category]}</strong>
                      </>
                    ) : (
                      <>
                        Estáis cerca del límite en{' '}
                        <strong>{EXPENSE_CATEGORY_LABELS[alert.category]}</strong>
                      </>
                    )}
                  </span>
                </li>
              ))}
              {upcoming3Days.map((charge) => (
                <li key={charge.recurringId} className="flex items-start gap-2">
                  <CalendarClock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
                  <span>
                    <strong>{formatDaysUntilLabel(charge.daysUntil)}</strong> toca pagar{' '}
                    <strong>{charge.concept}</strong> ({formatEUR(charge.amount)}).
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => {
                if (selectedMonthKey !== currentMonthKey) setSelectedMonthKey(currentMonthKey);
                setActiveTab('mensual');
              }}
              className="min-h-[44px] px-4 rounded-xl bg-white dark:bg-[#132025] border border-amber-300 dark:border-amber-700 text-xs font-bold text-amber-900 dark:text-amber-200 inline-flex items-center gap-1.5"
            >
              <span>Revisar en Mensual</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </section>
        )}

        {/* Large Navigation Cards for Shopping, Mudanza and Mensual */}
        <section aria-label="Accesos rápidos" className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          <button
            type="button"
            onClick={() => setShoppingOpen(true)}
            className="sm:col-span-2 min-h-[88px] rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4 text-left hover:border-[#0E5A64]/40 active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-12 h-12 rounded-2xl bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] flex items-center justify-center shrink-0">
                <ShoppingCart className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">Lista de la compra</h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  {pendingShoppingCount > 0
                    ? `${pendingShoppingCount} artículo${pendingShoppingCount === 1 ? '' : 's'} por comprar`
                    : 'Lista vacía · Pulsa para añadir'}
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('mudanza')}
            className="min-h-[96px] rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4 text-left hover:border-[#0E5A64]/40 active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
                <Package className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">Mudanza</h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  {pendingFurnitureCount} muebles por comprar · {pendingChecklistCount} tareas
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (selectedMonthKey !== currentMonthKey) setSelectedMonthKey(currentMonthKey);
              setActiveTab('mensual');
            }}
            className="min-h-[96px] rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4 text-left hover:border-[#0E5A64]/40 active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
                <CalendarDays className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">Mensual</h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  {currentMonthExpenseCount} gastos apuntados este mes
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
          </button>
        </section>

        <ShoppingListSection open={shoppingOpen} onClose={() => setShoppingOpen(false)} />
        {incomeModal}
        <OnboardingWalkthrough
          open={walkthroughOpen}
          onClose={() => setWalkthroughOpen(false)}
          inviteCode={household?.inviteCode}
          householdName={household?.name}
        />
      </div>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            Resumen de {formatMonthLabelES(currentMonthKey)}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {household?.name} · {memberA?.displayName || 'Tú'}
            {memberB ? ` y ${memberB.displayName}` : ' (esperando pareja)'}
          </p>
        </div>
      </div>

      {partnerMissingBanner}

      {/* 3 Big KPI Cards */}
      <section aria-label="Cifras principales" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setActiveTab('mensual')}
          className="text-left rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
            <span className="text-sm font-medium">Gastado este mes</span>
            <Wallet className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
          </div>
          <p className="font-display text-3xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(balance.totalSpent)}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
            <span>
              {currentMonthBudgetTotal > 0
                ? `Presupuesto: ${formatEUR(currentMonthBudgetTotal)}`
                : 'Ver desglose mensual'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mensual')}
          className="text-left rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
            <span className="text-sm font-medium">Quién debe a quién</span>
            <Scale
              className={`w-5 h-5 ${
                balance.owesDirection === 'peace'
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#B42318] dark:text-[#FCA5A5]'
              }`}
            />
          </div>
          <p
            className={`font-display text-2xl sm:text-3xl font-bold tabular-nums ${
              balance.owesDirection === 'peace'
                ? 'text-[#15803D] dark:text-[#4ADE80]'
                : 'text-[#0F1F24] dark:text-[#F0F5F6]'
            }`}
          >
            {balance.owesDirection === 'peace'
              ? 'Estáis en paz'
              : formatEUR(balance.owesAmount)}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {balance.owesDirection === 'peace'
              ? 'Sin saldo pendiente este mes'
              : balance.summaryText}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ahorros')}
          className="text-left rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
            <span className="text-sm font-medium">Ahorro total</span>
            <PiggyBank className="w-5 h-5 text-[#15803D] dark:text-[#4ADE80]" />
          </div>
          <p className="font-display text-3xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(totalSavings)}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
            <span>{activeGoals.length} metas activas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </button>
      </section>

      {/* Capacidad de ahorro & Lista de la compra (Modo Avanzado) */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Capacidad de ahorro mensual
            </p>
            <p
              className={`font-display text-2xl font-bold tabular-nums ${
                savingsCapacity.capacity >= 0
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#B42318] dark:text-[#FCA5A5]'
              }`}
            >
              {savingsCapacity.hasIncomeConfigured ? formatEUR(savingsCapacity.capacity) : 'Sin ingresos'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              Ingresos {formatEUR(savingsCapacity.totalIncome)} − gasto habitual{' '}
              {formatEUR(savingsCapacity.habitualSpend)} (fijos{' '}
              {formatEUR(savingsCapacity.fixedMonthly)} + variables{' '}
              {formatEUR(savingsCapacity.variableMonthly)})
            </p>
          </div>
          <button
            type="button"
            onClick={openIncomeModal}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{savingsCapacity.hasIncomeConfigured ? 'Editar ingresos' : 'Añadir ingresos'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShoppingOpen(true)}
          className="text-left rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] flex items-center justify-center shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-bold">Lista de la compra</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pendingShoppingCount > 0
                  ? `${pendingShoppingCount} pendiente${pendingShoppingCount === 1 ? '' : 's'} · Convertir en gasto de supermercado`
                  : 'Sin artículos pendientes · Abrir lista compartida'}
              </p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
        </button>
      </section>

      {/* Avisos en Inicio (Modo Avanzado) */}
      {hasAlerts && (
        <section
          aria-label="Avisos del mes"
          className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <Bell className="w-5 h-5 shrink-0" />
              <h2 className="font-display text-base font-bold">Avisos</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedMonthKey !== currentMonthKey) setSelectedMonthKey(currentMonthKey);
                setActiveTab('mensual');
              }}
              className="min-h-[44px] px-2 -mr-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:underline inline-flex items-center gap-1"
            >
              <span>Ir a Mensual</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {budgetAlerts.map((alert) => (
              <div
                key={alert.category}
                className="rounded-xl bg-white dark:bg-[#132025] border border-amber-200/80 dark:border-amber-800/60 px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">
                    Presupuesto · {EXPENSE_CATEGORY_LABELS[alert.category]}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    {formatEUR(alert.spent)} de {formatEUR(alert.limit)}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums shrink-0 ${
                    alert.exceeded
                      ? 'bg-[#B42318]/12 text-[#B42318] dark:text-[#FCA5A5]'
                      : 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {alert.pct} %
                </span>
              </div>
            ))}

            {upcoming3Days.map((charge) => (
              <div
                key={charge.recurringId}
                className="rounded-xl bg-white dark:bg-[#132025] border border-amber-200/80 dark:border-amber-800/60 px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{charge.concept}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDaysUntilLabel(charge.daysUntil)} ({formatDateES(charge.dueDate)}) · Pendiente de generar
                  </p>
                </div>
                <span className="font-mono-num text-xs font-bold shrink-0">
                  {formatEUR(charge.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Charges */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <h2 className="font-display text-base font-bold">Próximos 3 cargos previstos</h2>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('mensual')}
            className="min-h-[44px] px-2 -mr-2 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline inline-flex items-center"
          >
            Ver calendario
          </button>
        </div>

        {upcomingCharges.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
            No hay plantillas recurrentes activas. Añade alquiler o suministros en la pestaña Mensual.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {upcomingCharges.map((charge) => {
              const daysUntil = localDaysBetween(todayISO, charge.dueDate);
              const isSoon = Number.isFinite(daysUntil) && daysUntil >= 0 && daysUntil <= 3;
              return (
                <div
                  key={charge.recurringId}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{charge.concept}</p>
                      {isSoon && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[11px] font-semibold shrink-0">
                          {formatDaysUntilLabel(daysUntil)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateES(charge.dueDate)} · {EXPENSE_CATEGORY_LABELS[charge.category]}
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-bold shrink-0">
                    {formatEUR(charge.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Advanced Analytics & History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <h2 className="font-display text-base font-bold">Evolución últimos 12 meses</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Gasto mensual total excluyendo liquidaciones entre vosotros.
          </p>
          <MonthlyBarChart data={last12MonthsBars} />
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="font-display text-base font-bold">Gasto por categoría este mes</h2>
          <DonutChart
            slices={categoryDonutSlices}
            centerLabel="Total mes"
            centerValue={formatEUR(balance.totalSpent)}
          />
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <h2 className="font-display text-base font-bold">Progreso de mudanza</h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('mudanza')}
              className="min-h-[44px] px-2 -mr-2 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline inline-flex items-center"
            >
              Abrir mudanza
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">
                Mobiliario completado ({furnitureSummary.boughtCount} de {furnitureSummary.totalCount})
              </span>
              <span className="font-bold tabular-nums">{furnitureSummary.boughtPct}%</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-[#0E5A64] dark:bg-[#2AA1AE] rounded-full transition-all duration-500"
                style={{ width: `${furnitureSummary.boughtPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-slate-500 dark:text-slate-400">Pendiente mobiliario</p>
                <p className="text-base font-bold tabular-nums mt-0.5">
                  {formatEUR(furnitureSummary.totalPending)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-slate-500 dark:text-slate-400">En carrito IKEA</p>
                <p className="text-base font-bold tabular-nums mt-0.5">
                  {formatEUR(furnitureSummary.totalCart)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <h2 className="font-display text-base font-bold">Últimos 10 cambios</h2>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Sin actividad registrada todavía.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
              {activity.slice(0, 10).map((entry) => (
                <li key={entry.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-2.5 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[#0F1F24] dark:text-[#F0F5F6]">
                      <span className="font-semibold">{entry.actorName}</span> · {entry.summary}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {formatDateES(entry.timestamp.slice(0, 10))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ShoppingListSection open={shoppingOpen} onClose={() => setShoppingOpen(false)} />
      {incomeModal}
      <OnboardingWalkthrough
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
        inviteCode={household?.inviteCode}
        householdName={household?.name}
        onGoToAjustes={() => setActiveTab('ajustes')}
      />
    </div>
  );
};
