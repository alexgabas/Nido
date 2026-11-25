import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Info,
  Lock,
  Minus,
  RefreshCw,
  Settings2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  LONG_MONTH_LABELS_ES,
  SHORT_MONTH_LABELS_ES,
  type AnnualBalanceResult,
  type AnnualCategoryRow,
  type AnnualMonthRow,
  type AnnualNonMonthlyReceipt,
} from '../../domain/annualBalance';
import { formatDateES, formatEUR, formatMonthLabelES, formatPctES } from '../../domain/finance';
import type { RecurrenceFrequency, RecurringExpense, UiMode } from '../../types/nido';
import { CategoryTag } from '../CategoryTag';
import { DonutChart, MonthlyBarChart, type BarDatum, type DonutSlice } from '../Charts';

interface AnnualBalanceSectionProps {
  uiMode: UiMode;
  selectedYear: number;
  availableYears: number[];
  balance: AnnualBalanceResult | null;
  loading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  memberLabel: (uid: string) => string;
  onSelectYear: (year: number) => void;
  onRefresh: () => void;
  onBackToMonth: () => void;
  onJumpToMonth: (monthKey: string) => void;
  onJumpToCategory: (monthKey: string, categoryId: string) => void;
  onConfigureRecurring?: (rec: RecurringExpense) => void;
}

const FREQ_LABELS: Record<Exclude<RecurrenceFrequency, 'mensual'>, string> = {
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  anual: 'Anual',
};

function formatSignedEUR(value: number): string {
  if (Math.abs(value) < 0.005) return formatEUR(0);
  return `${value > 0 ? '+' : '−'}${formatEUR(Math.abs(value))}`;
}

function formatMonthShortWithYear(monthKey: string): string {
  const [y, mStr] = monthKey.split('-');
  const idx = Number(mStr) - 1;
  const label = SHORT_MONTH_LABELS_ES[idx] ?? mStr;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${y}`;
}

function renderMonthStatusBadge(row: AnnualMonthRow) {
  if (row.status === 'cerrado') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0E5A64]/12 dark:bg-[#5EEAD4]/15 text-[#0E5A64] dark:text-[#5EEAD4] text-[11px] font-semibold">
        <Lock className="w-3 h-3" aria-hidden="true" />
        <span>Mes cerrado</span>
      </span>
    );
  }
  if (row.status === 'abierto') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
        <CircleDot className="w-3 h-3" aria-hidden="true" />
        <span>{row.isCurrentMonth ? 'Mes abierto (en curso)' : 'Mes abierto'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px] font-medium">
      <Minus className="w-3 h-3" aria-hidden="true" />
      <span>Sin datos</span>
    </span>
  );
}

function buildDonutSlices(categories: AnnualCategoryRow[], maxSlices: number): DonutSlice[] {
  const positive = categories.filter((c) => c.totalSpent > 0);
  if (positive.length <= maxSlices) {
    return positive.map((c) => ({
      label: c.isArchived ? `${c.label} (archivada)` : c.label,
      value: c.totalSpent,
      color: c.color,
      icon: c.icon,
    }));
  }
  const top = positive.slice(0, maxSlices - 1);
  const rest = positive.slice(maxSlices - 1);
  const restTotal = Math.round(rest.reduce((s, c) => s + c.totalSpent, 0) * 100) / 100;
  return [
    ...top.map((c) => ({
      label: c.isArchived ? `${c.label} (archivada)` : c.label,
      value: c.totalSpent,
      color: c.color,
      icon: c.icon,
    })),
    {
      label: `Otras (${rest.length})`,
      value: restTotal,
      color: '#94A3B8',
    },
  ];
}

export const AnnualBalanceSection: React.FC<AnnualBalanceSectionProps> = ({
  uiMode,
  selectedYear,
  availableYears,
  balance,
  loading,
  error,
  lastLoadedAt,
  memberLabel,
  onSelectYear,
  onRefresh,
  onBackToMonth,
  onJumpToMonth,
  onJumpToCategory,
  onConfigureRecurring,
}) => {
  const minYear = useMemo(
    () => Math.min(selectedYear - 1, ...availableYears, new Date().getFullYear() - 1),
    [selectedYear, availableYears]
  );
  const maxYear = useMemo(
    () => Math.max(selectedYear, ...availableYears, new Date().getFullYear() + 1),
    [selectedYear, availableYears]
  );

  const yearOptions = useMemo(() => {
    const set = new Set<number>([...availableYears, selectedYear]);
    return Array.from(set).sort((a, b) => b - a);
  }, [availableYears, selectedYear]);

  const barData: BarDatum[] = useMemo(() => {
    if (!balance) return [];
    const peakKey = balance.peakMonth?.monthKey ?? null;
    return balance.months.map((m) => ({
      label: m.shortLabel,
      value: m.spent,
      highlight: m.monthKey === peakKey && m.spent > 0,
    }));
  }, [balance]);

  const donutSlices = useMemo(
    () => (balance ? buildDonutSlices(balance.categories, uiMode === 'sencillo' ? 6 : 8) : []),
    [balance, uiMode]
  );

  const loadedTimeLabel = useMemo(() => {
    if (!lastLoadedAt) return null;
    try {
      return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(
        new Date(lastLoadedAt)
      );
    } catch {
      return null;
    }
  }, [lastLoadedAt]);

  const renderNonMonthlyCard = (compact: boolean) => {
    if (!balance) return null;
    const { nonMonthlyReceipts } = balance;
    const hasAnything =
      nonMonthlyReceipts.occurrences.length > 0 || nonMonthlyReceipts.unanchoredTemplates.length > 0;

    return (
      <section
        aria-label={`Recibos no mensuales de ${selectedYear}`}
        className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-bold flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" aria-hidden="true" />
              <span>Recibos no mensuales ({selectedYear})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bimestrales, trimestrales y anuales de plantillas activas. Distingue previsto y
              registrado sin duplicar recibos vinculados.
            </p>
          </div>
          {hasAnything && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-[#0E5A64]/10 dark:bg-[#5EEAD4]/15 text-[#0E5A64] dark:text-[#5EEAD4] font-semibold tabular-nums">
                Previstos: {formatEUR(nonMonthlyReceipts.plannedTotal)} (
                {nonMonthlyReceipts.plannedOccurrences.length})
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[#15803D]/12 dark:bg-[#4ADE80]/15 text-[#15803D] dark:text-[#4ADE80] font-semibold tabular-nums">
                Registrados: {formatEUR(nonMonthlyReceipts.registeredTotal)} (
                {nonMonthlyReceipts.registeredOccurrences.length})
              </span>
            </div>
          )}
        </div>

        {nonMonthlyReceipts.unanchoredTemplates.length > 0 && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/25 p-3.5 space-y-2.5 text-xs text-amber-950 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {nonMonthlyReceipts.unanchoredTemplates.length === 1
                    ? 'Hay 1 plantilla periódica sin mes de inicio configurado'
                    : `Hay ${nonMonthlyReceipts.unanchoredTemplates.length} plantillas periódicas sin mes de inicio configurado`}
                </p>
                <p className="text-amber-900/90 dark:text-amber-200/90">
                  No inventamos fechas de vencimiento. Configura su mes de referencia para incluirla
                  en el calendario anual.
                </p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {nonMonthlyReceipts.unanchoredTemplates.map((rec) => (
                <li
                  key={rec.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 dark:bg-slate-900/60 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-semibold truncate">{rec.concept}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/50">
                      {rec.frequency !== 'mensual' ? FREQ_LABELS[rec.frequency] : rec.frequency}
                    </span>
                    <span className="font-mono-num text-slate-700 dark:text-slate-300">
                      {formatEUR(rec.amount)}
                    </span>
                  </div>
                  {onConfigureRecurring && uiMode === 'avanzado' ? (
                    <button
                      type="button"
                      onClick={() => onConfigureRecurring(rec)}
                      className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                    >
                      <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Configurar fecha</span>
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
                      Configurable en Mensual (Modo Avanzado → Plantillas)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {nonMonthlyReceipts.occurrences.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No hay recibos bimestrales, trimestrales ni anuales programados ni registrados en{' '}
            {selectedYear}.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(compact
              ? nonMonthlyReceipts.occurrences.slice(0, 6)
              : nonMonthlyReceipts.occurrences
            ).map((occ: AnnualNonMonthlyReceipt) => (
              <li
                key={occ.id}
                className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryTag category={occ.category} size="xs" />
                    <span className="text-sm font-bold truncate">{occ.concept}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                      {FREQ_LABELS[occ.frequency]}
                    </span>
                    {occ.status === 'registrado' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#15803D]/12 dark:bg-[#4ADE80]/15 text-[#15803D] dark:text-[#4ADE80] text-[11px] font-semibold">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        <span>Registrado</span>
                      </span>
                    ) : occ.isPastDue ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        <span>Previsto (vencido)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0E5A64]/10 dark:bg-[#5EEAD4]/15 text-[#0E5A64] dark:text-[#5EEAD4] text-[11px] font-semibold">
                        <CalendarClock className="w-3 h-3" aria-hidden="true" />
                        <span>Previsto</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {occ.status === 'registrado' ? 'Registrado el' : 'Vencimiento previsto'}{' '}
                    <strong>{formatDateES(occ.dueDate)}</strong> ·{' '}
                    {occ.status === 'registrado' ? 'Pagó' : 'Pagador previsto'}{' '}
                    {memberLabel(occ.paidBy)}
                    {occ.status === 'registrado' &&
                    Math.abs(occ.amount - occ.templateAmount) >= 0.01
                      ? ` · Orientativo plantilla: ${formatEUR(occ.templateAmount)}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <span className="font-mono-num text-sm font-bold">{formatEUR(occ.amount)}</span>
                  <button
                    type="button"
                    onClick={() => onJumpToMonth(occ.monthKey)}
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1"
                  >
                    <span>Ver mes</span>
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {compact && nonMonthlyReceipts.occurrences.length > 6 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mostrando 6 de {nonMonthlyReceipts.occurrences.length} recibos no mensuales del año.
            Cambia a Modo Avanzado para ver el detalle completo.
          </p>
        )}

        {nonMonthlyReceipts.skippedInYearCount > 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {nonMonthlyReceipts.skippedInYearCount === 1
              ? '1 vencimiento no mensual fue marcado como «No se ha producido este mes» y no se incluye en previstos.'
              : `${nonMonthlyReceipts.skippedInYearCount} vencimientos no mensuales fueron marcados como «No se ha producido este mes» y no se incluyen en previstos.`}
          </p>
        )}
      </section>
    );
  };

  // ─── Cabecera común (Sencillo y Avanzado) ───────────────────────────────────
  const headerBar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBackToMonth}
          className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Volver al mes</span>
        </button>
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
            Balance anual {selectedYear}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {uiMode === 'sencillo'
              ? 'Resumen del gasto compartido del hogar'
              : 'Evolución mensual, presupuestos, comparativa interanual y recibos periódicos'}
            {loadedTimeLabel ? ` · Actualizado ${loadedTimeLabel}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]"
          role="group"
          aria-label="Selector de año"
        >
          <button
            type="button"
            aria-label="Año anterior"
            disabled={selectedYear <= minYear}
            onClick={() => onSelectYear(selectedYear - 1)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 rounded-l-xl disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <label htmlFor="annual-balance-year-select" className="sr-only">
            Año del balance
          </label>
          <select
            id="annual-balance-year-select"
            value={selectedYear}
            onChange={(e) => onSelectYear(Number(e.target.value))}
            className="min-h-[44px] px-2.5 bg-transparent text-sm font-bold tabular-nums focus:outline-none"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y} className="bg-white dark:bg-[#132025]">
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Año siguiente"
            disabled={selectedYear >= maxYear}
            onClick={() => onSelectYear(selectedYear + 1)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 rounded-r-xl disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Actualizar</span>
        </button>
      </div>
    </div>
  );

  // ─── Estados de carga y error ───────────────────────────────────────────────
  if (loading && !balance) {
    return (
      <div className={uiMode === 'sencillo' ? 'space-y-5 max-w-2xl mx-auto' : 'space-y-6'}>
        {headerBar}
        <div
          role="status"
          className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2"
        >
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#0E5A64] dark:text-[#5EEAD4]" />
          <p className="text-sm font-semibold">Calculando balance anual de {selectedYear}...</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Consultando únicamente gastos compartidos y presupuestos del hogar.
          </p>
        </div>
      </div>
    );
  }

  if (error && !balance) {
    return (
      <div className={uiMode === 'sencillo' ? 'space-y-5 max-w-2xl mx-auto' : 'space-y-6'}>
        {headerBar}
        <div
          role="alert"
          className="rounded-2xl bg-[#B42318]/10 border border-[#B42318]/30 p-5 flex flex-wrap items-center justify-between gap-3 text-sm text-[#B42318] dark:text-[#FCA5A5]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] text-white text-xs font-semibold"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!balance) return null;

  // ─── MODO SENCILLO: RESUMEN REDUCIDO ────────────────────────────────────────
  if (uiMode === 'sencillo') {
    const monthsWithActivityOrClosed = balance.months.filter((m) => m.status !== 'sin_datos');

    return (
      <div className="space-y-5 max-w-2xl mx-auto" aria-label={`Balance anual ${selectedYear}`}>
        {headerBar}

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] px-4 py-3 text-xs font-medium"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Gasto compartido en {selectedYear}
            </p>
            <p className="font-display text-3xl font-bold tabular-nums">
              {formatEUR(balance.totalSharedSpent)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {balance.totalSharedCount}{' '}
              {balance.totalSharedCount === 1 ? 'gasto registrado' : 'gastos registrados'} ·{' '}
              {balance.closedMonthsCount} cerrados, {balance.openMonthsWithDataCount} abiertos,{' '}
              {balance.noDataMonthsCount} sin datos.
            </p>
          </section>

          <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Coste de un mes habitual
            </p>
            <p className="font-display text-3xl font-bold tabular-nums">
              {balance.averageMonthlySpent !== null
                ? formatEUR(balance.averageMonthlySpent)
                : 'Sin media'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {balance.monthsInAverageCount > 0
                ? `Media de ${balance.monthsInAverageCount} ${
                    balance.monthsInAverageCount === 1 ? 'mes completo' : 'meses completos'
                  } con datos.`
                : 'Aún no hay meses completos con cobertura en este año.'}
              {balance.currentMonthExcludedFromAverage
                ? ` ${LONG_MONTH_LABELS_ES[Number(balance.currentMonthKey.slice(5, 7)) - 1]} (abierto) no entra aún.`
                : ''}
            </p>
          </section>
        </div>

        {/* Presupuesto compacto en Sencillo */}
        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">Frente al presupuesto</h2>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {balance.budgetSummary.coverage === 'complete'
                ? 'Presupuesto completo'
                : balance.budgetSummary.coverage === 'partial'
                  ? 'Presupuesto parcial'
                  : 'Sin presupuesto'}
            </span>
          </div>
          {balance.budgetSummary.coverage === 'none' ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No hay presupuestos configurados en {selectedYear}.
            </p>
          ) : (
            <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <p className="tabular-nums">
                En las categorías con presupuesto lleváis{' '}
                <strong>{formatEUR(balance.budgetSummary.budgetedSpentTotal)}</strong> frente a{' '}
                <strong>{formatEUR(balance.budgetSummary.configuredBudgetTotal)}</strong>{' '}
                presupuestados (
                <strong>{formatSignedEUR(balance.budgetSummary.comparableDeviation ?? 0)}</strong>
                {balance.budgetSummary.comparableDeviationPct !== null
                  ? `, ${balance.budgetSummary.comparableDeviationPct > 0 ? '+' : ''}${formatPctES(balance.budgetSummary.comparableDeviationPct)}`
                  : ''}
                ).
              </p>
              {balance.budgetSummary.coverage === 'partial' && (
                <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                  Además hay {formatEUR(balance.budgetSummary.unbudgetedSpentTotal)} en meses o
                  categorías sin presupuesto configurado.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Evolución mensual */}
        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold">Gasto por mes</h2>
            {balance.peakMonth && (
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Pico: {balance.peakMonth.longLabel} ({formatEUR(balance.peakMonth.spent)})
              </span>
            )}
          </div>
          <MonthlyBarChart data={barData} />
          {monthsWithActivityOrClosed.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {monthsWithActivityOrClosed.map((m) => (
                <button
                  key={m.monthKey}
                  type="button"
                  onClick={() => onJumpToMonth(m.monthKey)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                >
                  <span className="capitalize">{m.shortLabel}</span>
                  <span className="font-mono-num text-slate-600 dark:text-slate-300">
                    {formatEUR(m.spent)}
                  </span>
                  {m.isClosed && (
                    <Lock className="w-3 h-3 text-[#0E5A64] dark:text-[#5EEAD4]" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Categorías */}
        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="font-display text-base font-bold">En qué se ha ido el gasto</h2>
          <DonutChart
            slices={donutSlices}
            centerLabel={`Total ${selectedYear}`}
            centerValue={formatEUR(balance.totalSharedSpent)}
          />
          {balance.categories.filter((c) => c.totalSpent > 0).length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
              {balance.categories
                .filter((c) => c.totalSpent > 0)
                .slice(0, 5)
                .map((c) => {
                  const jumpMonth = c.peakMonthKey ?? c.latestMonthKey;
                  if (!jumpMonth) return null;
                  return (
                    <button
                      key={c.categoryId}
                      type="button"
                      onClick={() => onJumpToCategory(jumpMonth, c.categoryId)}
                      className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                    >
                      <span>{c.label}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
                    </button>
                  );
                })}
            </div>
          )}
        </section>

        {renderNonMonthlyCard(true)}

        <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">
          Calculado sobre gastos compartidos registrados y presupuestos de {selectedYear}. Excluye
          gastos privados, liquidaciones, metas de ahorro y gastos iniciales de Mudanza.
        </p>
      </div>
    );
  }

  // ─── MODO AVANZADO: VISTA COMPLETA ──────────────────────────────────────────
  const { budgetSummary, yoyComparison } = balance;

  return (
    <div className="space-y-6" aria-label={`Balance anual ${selectedYear}`}>
      {headerBar}

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] px-4 py-3 text-xs font-medium flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64] text-white font-semibold"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Nota transparente de origen de cifras */}
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p>
            El estado de cada mes («Mes cerrado») procede de los cierres guardados; el detalle por
            mes y categoría se calcula sobre los movimientos compartidos y presupuestos actuales
            (los cierres no guardan desglose congelado por categoría). Excluye gastos privados,
            liquidaciones, aportaciones/retiradas de metas y Mudanza.
          </p>
          {balance.hasClosureSnapshotDiscrepancy && (
            <p className="text-amber-800 dark:text-amber-300 font-medium">
              Aviso: al menos un mes cerrado tiene un total de snapshot ligeramente distinto a la
              suma actual de movimientos compartidos; revisa el indicador en la tabla mensual.
            </p>
          )}
        </div>
      </div>

      {/* 4 KPIs principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Total compartido */}
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Gasto compartido {selectedYear}
          </p>
          <p className="font-display text-2xl sm:text-3xl font-bold tabular-nums">
            {formatEUR(balance.totalSharedSpent)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {balance.totalSharedCount}{' '}
            {balance.totalSharedCount === 1 ? 'movimiento' : 'movimientos'} ·{' '}
            {balance.closedMonthsCount} cerrados · {balance.openMonthsWithDataCount} abiertos ·{' '}
            {balance.noDataMonthsCount} sin datos
          </p>
          {balance.closedZeroMonthsCount > 0 && (
            <p className="text-[11px] text-[#0E5A64] dark:text-[#5EEAD4]">
              Incluye {balance.closedZeroMonthsCount}{' '}
              {balance.closedZeroMonthsCount === 1
                ? 'mes cerrado con 0,00 €'
                : 'meses cerrados con 0,00 €'}
              .
            </p>
          )}
        </section>

        {/* KPI 2: Media mensual */}
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Media mensual habitual
          </p>
          <p className="font-display text-2xl sm:text-3xl font-bold tabular-nums">
            {balance.averageMonthlySpent !== null
              ? formatEUR(balance.averageMonthlySpent)
              : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {balance.monthsInAverageCount > 0
              ? `Sobre ${balance.monthsInAverageCount} ${
                  balance.monthsInAverageCount === 1
                    ? 'mes completo con cobertura'
                    : 'meses completos con cobertura'
                }.`
              : 'Sin meses completos con cobertura en este año.'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {balance.currentMonthExcludedFromAverage
              ? `${LONG_MONTH_LABELS_ES[Number(balance.currentMonthKey.slice(5, 7)) - 1]} (en curso, abierto) y los meses «Sin datos» no entran en la media.`
              : 'Los meses «Sin datos» no se convierten en 0 €.'}
          </p>
        </section>

        {/* KPI 3: Frente al presupuesto */}
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Frente al presupuesto
            </p>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                budgetSummary.coverage === 'complete'
                  ? 'bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80]'
                  : budgetSummary.coverage === 'partial'
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {budgetSummary.coverage === 'complete'
                ? 'Presupuesto completo'
                : budgetSummary.coverage === 'partial'
                  ? 'Presupuesto parcial'
                  : 'Sin presupuesto'}
            </span>
          </div>
          {budgetSummary.coverage === 'none' ? (
            <>
              <p className="font-display text-xl font-bold text-slate-500 dark:text-slate-400">
                Sin presupuesto
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No hay límites configurados en ningún mes de {selectedYear}.
              </p>
            </>
          ) : (
            <>
              <p
                className={`font-display text-2xl sm:text-3xl font-bold tabular-nums ${
                  (budgetSummary.comparableDeviation ?? 0) > 0
                    ? 'text-[#B42318] dark:text-[#FCA5A5]'
                    : (budgetSummary.comparableDeviation ?? 0) < 0
                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                      : ''
                }`}
              >
                {formatSignedEUR(budgetSummary.comparableDeviation ?? 0)}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                Solo parte con presupuesto: {formatEUR(budgetSummary.budgetedSpentTotal)} vs{' '}
                {formatEUR(budgetSummary.configuredBudgetTotal)}
                {budgetSummary.comparableDeviationPct !== null
                  ? ` (${budgetSummary.comparableDeviationPct > 0 ? '+' : ''}${formatPctES(budgetSummary.comparableDeviationPct)})`
                  : ''}
              </p>
              {budgetSummary.coverage === 'partial' && (
                <p className="text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                  +{formatEUR(budgetSummary.unbudgetedSpentTotal)} en categorías/meses sin límite
                  (fuera de la desviación).
                </p>
              )}
            </>
          )}
        </section>

        {/* KPI 4: Comparativa con año anterior */}
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Vs {yoyComparison.prevYear} ({yoyComparison.spanLabel})
            </p>
            {yoyComparison.isIncompletePeriod && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300">
                Incompleto
              </span>
            )}
          </div>
          {!yoyComparison.hasSufficientData ? (
            <>
              <p className="font-display text-xl font-bold text-slate-500 dark:text-slate-400">
                Sin comparativa
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No hay datos suficientes en {yoyComparison.prevYear} para el tramo{' '}
                {yoyComparison.spanLabel}.
              </p>
            </>
          ) : (
            <>
              <p
                className={`font-display text-2xl sm:text-3xl font-bold tabular-nums inline-flex items-center gap-1.5 ${
                  yoyComparison.deltaAmount > 0
                    ? 'text-[#B42318] dark:text-[#FCA5A5]'
                    : yoyComparison.deltaAmount < 0
                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                      : ''
                }`}
              >
                {yoyComparison.deltaAmount > 0 ? (
                  <TrendingUp className="w-5 h-5" aria-hidden="true" />
                ) : yoyComparison.deltaAmount < 0 ? (
                  <TrendingDown className="w-5 h-5" aria-hidden="true" />
                ) : null}
                <span>{formatSignedEUR(yoyComparison.deltaAmount)}</span>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                {formatEUR(yoyComparison.currentSpanSpent)} frente a{' '}
                {formatEUR(yoyComparison.prevSpanSpent)} en {yoyComparison.prevYear}
                {yoyComparison.deltaPct !== null
                  ? ` (${yoyComparison.deltaPct > 0 ? '+' : ''}${formatPctES(yoyComparison.deltaPct)})`
                  : ' (sin %: base 0 €)'}
              </p>
              {yoyComparison.incompleteReason && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {yoyComparison.incompleteReason}.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* Evolución mensual */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">Evolución mensual ({selectedYear})</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Gasto compartido registrado frente al presupuesto de cada mes (sin mezclar previsiones).
            </p>
          </div>
          {balance.peakMonth && (
            <button
              type="button"
              onClick={() => onJumpToMonth(balance.peakMonth!.monthKey)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span>
                Mes más alto: {balance.peakMonth.longLabel} ({formatEUR(balance.peakMonth.spent)})
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            </button>
          )}
        </div>

        <MonthlyBarChart data={barData} />

        {/* Vista móvil de meses */}
        <div className="grid grid-cols-1 gap-2.5 md:hidden">
          {balance.months.map((m) => (
            <div
              key={m.monthKey}
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{m.longLabel}</span>
                  {renderMonthStatusBadge(m)}
                </div>
                <span className="font-mono-num text-sm font-bold">
                  {m.status === 'sin_datos' ? '—' : formatEUR(m.spent)}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {m.includedInAverage
                    ? 'Incluido en la media'
                    : m.isCurrentMonth && !m.isClosed
                      ? 'En curso (fuera de media)'
                      : 'Fuera de media'}
                </span>
                <span>
                  {m.budgetCoverage === 'none'
                    ? 'Sin presupuesto'
                    : m.budgetCoverage === 'partial'
                      ? `Presupuesto parcial: ${formatEUR(m.budgetedSpent)} / ${formatEUR(m.budgetTotal ?? 0)}`
                      : `Presupuesto: ${formatEUR(m.budgetTotal ?? 0)}`}
                </span>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onJumpToMonth(m.monthKey)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1"
                >
                  <span>Abrir {m.longLabel}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Vista escritorio de meses */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-3 font-semibold">Mes</th>
                <th className="py-2 pr-3 font-semibold">Estado</th>
                <th className="py-2 pr-3 font-semibold text-right">Gasto compartido</th>
                <th className="py-2 pr-3 font-semibold text-right">Presupuesto</th>
                <th className="py-2 pr-3 font-semibold text-right">Desviación comparable</th>
                <th className="py-2 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {balance.months.map((m) => (
                <tr key={m.monthKey} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <td className="py-2.5 pr-3 font-semibold">
                    <div>{m.longLabel}</div>
                    <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                      {m.includedInAverage
                        ? 'En media'
                        : m.isCurrentMonth && !m.isClosed
                          ? 'En curso · fuera de media'
                          : 'Fuera de media'}
                      {m.closureDiffersFromTransactions && m.closureSnapshotTotal !== null
                        ? ` · Snapshot: ${formatEUR(m.closureSnapshotTotal)}`
                        : ''}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">{renderMonthStatusBadge(m)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono-num font-bold">
                    {m.status === 'sin_datos' ? (
                      <span className="text-slate-400 font-normal">—</span>
                    ) : (
                      formatEUR(m.spent)
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {m.budgetCoverage === 'none' ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Sin presupuesto
                      </span>
                    ) : (
                      <div>
                        <span className="font-mono-num">{formatEUR(m.budgetTotal ?? 0)}</span>
                        {m.budgetCoverage === 'partial' && (
                          <div className="text-[11px] text-amber-800 dark:text-amber-300">
                            Parcial ({formatEUR(m.budgetedSpent)} cubiertos)
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {m.comparableDeviation === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span
                        className={`font-mono-num font-semibold ${
                          m.comparableDeviation > 0
                            ? 'text-[#B42318] dark:text-[#FCA5A5]'
                            : m.comparableDeviation < 0
                              ? 'text-[#15803D] dark:text-[#4ADE80]'
                              : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {formatSignedEUR(m.comparableDeviation)}
                        {m.comparableDeviationPct !== null
                          ? ` (${m.comparableDeviationPct > 0 ? '+' : ''}${formatPctES(m.comparableDeviationPct)})`
                          : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onJumpToMonth(m.monthKey)}
                      className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1"
                    >
                      <span>Ver mes</span>
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Desglose por categoría y dónde ha subido más */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">
              Desglose por categoría ({selectedYear})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Conserva categorías archivadas con histórico. Haz clic en un mes o en «Ver» para
              filtrar directamente en Mensual.
            </p>
          </div>
          {balance.archivedCategoriesWithActivityCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {balance.archivedCategoriesWithActivityCount}{' '}
                {balance.archivedCategoriesWithActivityCount === 1
                  ? 'categoría archivada en el histórico'
                  : 'categorías archivadas en el histórico'}
              </span>
            </span>
          )}
        </div>

        <DonutChart
          slices={donutSlices}
          centerLabel={`Total ${selectedYear}`}
          centerValue={formatEUR(balance.totalSharedSpent)}
        />

        {/* Mayores subidas / picos */}
        {balance.topRisingCategories.length > 0 && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#B42318] dark:text-[#FCA5A5]" aria-hidden="true" />
              <span>
                {balance.topRisingCategories[0].basis === 'yoy'
                  ? `Categorías que más han subido frente a ${yoyComparison.prevYear} (${yoyComparison.spanLabel})`
                  : `Mayores picos puntuales en ${selectedYear} (sin base en ${yoyComparison.prevYear})`}
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {balance.topRisingCategories.map((item) => (
                <div
                  key={item.categoryId}
                  className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CategoryTag category={item.categoryId} size="xs" />
                      {item.isArchived && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          Archivada
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] tabular-nums">
                      {formatSignedEUR(item.deltaAmount)}
                      {item.deltaPct !== null
                        ? ` (+${formatPctES(item.deltaPct)})`
                        : item.basis === 'yoy'
                          ? ` (sin gasto en ${yoyComparison.prevYear})`
                          : ''}
                    </p>
                    {item.peakMonthKey && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        Pico en {formatMonthLabelES(item.peakMonthKey)}:{' '}
                        {formatEUR(item.peakMonthAmount)}
                      </p>
                    )}
                  </div>
                  {item.peakMonthKey && (
                    <button
                      type="button"
                      onClick={() => onJumpToCategory(item.peakMonthKey!, item.categoryId)}
                      className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 shrink-0"
                    >
                      Ver pico
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {balance.categories.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No hay gastos compartidos ni presupuestos registrados en {selectedYear}.
          </p>
        ) : (
          <>
            {/* Móvil categorías */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {balance.categories.map((cat) => {
                const jumpMonth = cat.peakMonthKey ?? cat.latestMonthKey;
                return (
                  <div
                    key={cat.categoryId}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <CategoryTag category={cat.categoryId} size="xs" />
                        {cat.isArchived && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                            Archivada
                          </span>
                        )}
                      </div>
                      <span className="font-mono-num text-sm font-bold">
                        {formatEUR(cat.totalSpent)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 tabular-nums">
                      <p>
                        Peso: {formatPctES(cat.sharePct)}
                        {cat.peakMonthKey
                          ? ` · Pico: ${formatMonthShortWithYear(cat.peakMonthKey)} (${formatEUR(cat.peakMonthAmount)})`
                          : ''}
                      </p>
                      <p>
                        {cat.budgetCoverage === 'none'
                          ? 'Sin presupuesto'
                          : cat.budgetCoverage === 'partial'
                            ? `Presupuesto parcial: ${formatEUR(cat.budgetedSpent)} / ${formatEUR(cat.budgetTotal ?? 0)} (+${formatEUR(cat.unbudgetedSpent)} sin límite)`
                            : `Presupuesto: ${formatEUR(cat.budgetedSpent)} / ${formatEUR(cat.budgetTotal ?? 0)} (${formatSignedEUR(cat.comparableDeviation ?? 0)})`}
                      </p>
                      {yoyComparison.hasSufficientData && cat.yoyDelta !== null && (
                        <p>
                          Vs {yoyComparison.prevYear}: {formatSignedEUR(cat.yoyDelta)}
                          {cat.yoyDeltaPct !== null
                            ? ` (${cat.yoyDeltaPct > 0 ? '+' : ''}${formatPctES(cat.yoyDeltaPct)})`
                            : cat.prevYearSpanSpent === 0 && cat.totalSpent > 0
                              ? ' (sin base)'
                              : ''}
                        </p>
                      )}
                    </div>
                    {jumpMonth && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onJumpToCategory(jumpMonth, cat.categoryId)}
                          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1"
                        >
                          <span>Ver en Mensual</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Escritorio categorías */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Categoría</th>
                    <th className="py-2 pr-3 font-semibold text-right">Gasto {selectedYear}</th>
                    <th className="py-2 pr-3 font-semibold">Mes pico</th>
                    <th className="py-2 pr-3 font-semibold text-right">Presupuesto vs real</th>
                    {yoyComparison.hasSufficientData && (
                      <th className="py-2 pr-3 font-semibold text-right">
                        Vs {yoyComparison.prevYear}
                      </th>
                    )}
                    <th className="py-2 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {balance.categories.map((cat) => {
                    const jumpMonth = cat.peakMonthKey ?? cat.latestMonthKey;
                    return (
                      <tr
                        key={cat.categoryId}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CategoryTag category={cat.categoryId} size="xs" />
                            {cat.isArchived && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                                Archivada
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          <div className="font-mono-num font-bold">{formatEUR(cat.totalSpent)}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatPctES(cat.sharePct)} · {cat.transactionCount} mov.
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-xs tabular-nums">
                          {cat.peakMonthKey ? (
                            <button
                              type="button"
                              onClick={() => onJumpToCategory(cat.peakMonthKey!, cat.categoryId)}
                              className="text-left hover:underline text-[#0E5A64] dark:text-[#5EEAD4] font-medium"
                            >
                              {formatMonthShortWithYear(cat.peakMonthKey)} (
                              {formatEUR(cat.peakMonthAmount)})
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {cat.budgetCoverage === 'none' ? (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              Sin presupuesto
                            </span>
                          ) : (
                            <div>
                              <div className="text-xs">
                                <span className="font-mono-num font-semibold">
                                  {formatEUR(cat.budgetedSpent)}
                                </span>{' '}
                                / {formatEUR(cat.budgetTotal ?? 0)}
                              </div>
                              <div
                                className={`text-[11px] font-semibold ${
                                  (cat.comparableDeviation ?? 0) > 0
                                    ? 'text-[#B42318] dark:text-[#FCA5A5]'
                                    : (cat.comparableDeviation ?? 0) < 0
                                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                                      : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {cat.budgetCoverage === 'partial' ? 'Parcial · ' : ''}
                                {formatSignedEUR(cat.comparableDeviation ?? 0)}
                                {cat.comparableDeviationPct !== null
                                  ? ` (${cat.comparableDeviationPct > 0 ? '+' : ''}${formatPctES(cat.comparableDeviationPct)})`
                                  : ''}
                              </div>
                              {cat.budgetCoverage === 'partial' && (
                                <div className="text-[10px] text-amber-800 dark:text-amber-300">
                                  +{formatEUR(cat.unbudgetedSpent)} en meses sin límite
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        {yoyComparison.hasSufficientData && (
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {cat.yoyDelta === null ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <div>
                                <div
                                  className={`font-mono-num text-xs font-semibold ${
                                    cat.yoyDelta > 0
                                      ? 'text-[#B42318] dark:text-[#FCA5A5]'
                                      : cat.yoyDelta < 0
                                        ? 'text-[#15803D] dark:text-[#4ADE80]'
                                        : 'text-slate-500'
                                  }`}
                                >
                                  {formatSignedEUR(cat.yoyDelta)}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {cat.yoyDeltaPct !== null
                                    ? `${cat.yoyDeltaPct > 0 ? '+' : ''}${formatPctES(cat.yoyDeltaPct)}`
                                    : cat.prevYearSpanSpent === 0 && cat.totalSpent > 0
                                      ? 'Nuevo (base 0 €)'
                                      : '—'}
                                </div>
                              </div>
                            )}
                          </td>
                        )}
                        <td className="py-2.5 text-right">
                          {jumpMonth ? (
                            <button
                              type="button"
                              onClick={() => onJumpToCategory(jumpMonth, cat.categoryId)}
                              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1"
                            >
                              <span>Ver</span>
                              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Recibos no mensuales */}
      {renderNonMonthlyCard(false)}
    </div>
  );
};
