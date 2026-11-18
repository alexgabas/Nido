import React, { useMemo } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  History,
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
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  formatMonthShortES,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  getUpcomingCharges,
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
    uiMode,
    toggleUiMode,
    setActiveTab,
    recurring,
    recentTransactions,
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

  const totalSavings = useMemo(() => {
    const activeGoalIds = new Set(goals.filter((g) => !g.archived).map((g) => g.id));
    const total = goalMovements
      .filter((m) => activeGoalIds.has(m.goalId))
      .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    return roundCents(Math.max(0, total));
  }, [goals, goalMovements]);

  const upcomingCharges = useMemo(
    () => getUpcomingCharges(recurring, todayISO, 3),
    [recurring, todayISO]
  );

  const last12MonthsBars = useMemo(() => {
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      keys.push(shiftMonthKey(currentMonthKey, -i));
    }
    const sums = new Map<string, number>();
    for (const tx of recentTransactions) {
      if (tx.isSettlement || tx.category === 'liquidacion') continue;
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
      if (tx.isSettlement || tx.category === 'liquidacion') continue;
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

  return (
    <div className="space-y-6">
      {/* Header row with Sencillo/Avanzado toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            Resumen de {formatMonthLabelES(currentMonthKey)}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {household?.name} · {memberA?.displayName?.split(' ')[0] || 'Tú'}
            {memberB ? ` y ${memberB.displayName.split(' ')[0]}` : ' (esperando pareja)'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void toggleUiMode()}
          className="self-start sm:self-auto min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          Vista: {uiMode === 'sencillo' ? 'Modo Sencillo' : 'Modo Avanzado'} · Cambiar
        </button>
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
            <span>Ver desglose mensual</span>
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
            <span>{goals.filter((g) => !g.archived).length} metas activas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </button>
      </section>

      {/* Next 3 Upcoming Charges (Always visible in Sencillo & Avanzado) */}
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
            {upcomingCharges.map((charge) => (
              <div
                key={charge.recurringId}
                className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{charge.concept}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDateES(charge.dueDate)} · {EXPENSE_CATEGORY_LABELS[charge.category]}
                  </p>
                </div>
                <span className="font-mono-num text-sm font-bold shrink-0">
                  {formatEUR(charge.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Advanced Mode Analytics & History */}
      {uiMode === 'avanzado' && (
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
      )}
    </div>
  );
};
