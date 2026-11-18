import React, { useMemo } from 'react';
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
  PiggyBank,
  Scale,
  Wallet,
} from 'lucide-react';
import { DonutChart, MonthlyBarChart } from '../components/Charts';
import { useNido } from '../context/NidoContext';
import {
  calculateCoupleBalance,
  computeFurnitureSummary,
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
    memberA,
    memberB,
    currentMember,
    uiMode,
    setActiveTab,
    selectedMonthKey,
    setSelectedMonthKey,
    currentMonthBudget,
    recurring,
    recentTransactions,
    checklist,
    furnitureItems,
    goals,
    goalMovements,
    activity,
  } = useNido();

  const todayISO = getTodayLocalISO();
  const currentMonthKey = getCurrentMonthKeyLocal();

  const currentMonthTx = useMemo(
    () => recentTransactions.filter((t) => t.monthKey === currentMonthKey),
    [recentTransactions, currentMonthKey]
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
    () => getUpcomingChargesWithinDays(recurring, todayISO, 3, recentTransactions),
    [recurring, todayISO, recentTransactions]
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
          {currentMonthBudgetTotal > 0 && (
            <div className="space-y-2">
              <p className="text-base text-slate-600 dark:text-slate-300 tabular-nums">
                de {formatEUR(currentMonthBudgetTotal)} previstos
              </p>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    spendExceeded ? 'bg-[#DC4C3E]' : 'bg-[#0E5A64] dark:bg-[#2AA1AE]'
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
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
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
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
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

          {totalSavingsTarget > 0 && (
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
          )}
        </button>

        {/* Avisos en Inicio (Modo Sencillo) */}
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
                  <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
                  <span>
                    {alert.exceeded ? (
                      <>
                        Habéis superado el presupuesto de{' '}
                        <strong>{EXPENSE_CATEGORY_LABELS[alert.category]}</strong> (
                        {formatEUR(alert.spent)} de {formatEUR(alert.limit)}).
                      </>
                    ) : (
                      <>
                        Lleváis el <strong>{alert.pct} %</strong> del presupuesto de{' '}
                        <strong>{EXPENSE_CATEGORY_LABELS[alert.category]}</strong> (
                        {formatEUR(alert.spent)} de {formatEUR(alert.limit)}).
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
                    {charge.alreadyGenerated ? ' Ya está apuntado.' : ''}
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

        {/* Large Navigation Cards for Mudanza and Mensual */}
        <section aria-label="Accesos rápidos" className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
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
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  {pendingFurnitureCount} muebles por comprar · {pendingChecklistCount} tareas
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
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
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  {currentMonthExpenseCount} gastos apuntados este mes
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
          </button>
        </section>
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
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {household?.name} · {memberA?.displayName || 'Tú'}
            {memberB ? ` y ${memberB.displayName}` : ' (esperando pareja)'}
          </p>
        </div>
      </div>

      {/* 3 Big KPI Cards */}
      <section aria-label="Cifras principales" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setActiveTab('mensual')}
          className="text-left rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3 hover:border-[#0E5A64]/40 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">Gastado este mes</span>
            <Wallet className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
          </div>
          <p className="font-display text-3xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(balance.totalSpent)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
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
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">Quién debe a quién</span>
            <Scale
              className={`w-5 h-5 ${
                balance.owesDirection === 'peace'
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#DC4C3E]'
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
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">Ahorro total</span>
            <PiggyBank className="w-5 h-5 text-[#15803D] dark:text-[#4ADE80]" />
          </div>
          <p className="font-display text-3xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(totalSavings)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <span>{activeGoals.length} metas activas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
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
              className="text-xs font-semibold text-amber-900 dark:text-amber-200 hover:underline inline-flex items-center gap-1"
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
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatEUR(alert.spent)} de {formatEUR(alert.limit)}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums shrink-0 ${
                    alert.exceeded
                      ? 'bg-[#DC4C3E]/12 text-[#DC4C3E]'
                      : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
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
                    {formatDaysUntilLabel(charge.daysUntil)} ({formatDateES(charge.dueDate)}) ·{' '}
                    {charge.alreadyGenerated ? 'Ya generado' : 'Pendiente de generar'}
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
            className="text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline"
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
              className="text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline"
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
    </div>
  );
};
