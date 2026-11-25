import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  Landmark,
  Lock,
  Pencil,
  Repeat,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { computeCommonAccountRadar } from '../../domain/commonAccountRadar';
import { formatDateES, formatEUR, getTodayLocalISO } from '../../domain/finance';
import { useNido } from '../../context/NidoContext';
import { CategoryTag } from '../CategoryTag';
import type {
  CommonAccountManualBalance,
  MonthlyBudget,
  RecurringExpense,
  Transaction,
  UiMode,
} from '../../types/nido';

interface CommonAccountRadarCardProps {
  monthKey: string;
  transactions: Transaction[];
  recurring: RecurringExpense[];
  budget: MonthlyBudget | null;
  uiMode: UiMode;
  isClosed: boolean;
  effectiveSplitPctA: number;
  shortNameA: string;
  shortNameB: string;
  hasPartner: boolean;
  plannedCategoryIds: string[];
  manualBalance: CommonAccountManualBalance | null;
  memberLabel: (uid: string) => string;
  onSavePlannedCategories: (categoryIds: string[]) => Promise<void>;
  onSaveManualBalance: (balance: { amount: number; referenceDate: string } | null) => Promise<void>;
  onOpenBudgetEditor?: () => void;
  onScrollToTemplates?: () => void;
}

export const CommonAccountRadarCard: React.FC<CommonAccountRadarCardProps> = ({
  monthKey,
  transactions,
  recurring,
  budget,
  uiMode,
  isClosed,
  effectiveSplitPctA,
  shortNameA,
  shortNameB,
  hasPartner,
  plannedCategoryIds,
  manualBalance,
  memberLabel,
  onSavePlannedCategories,
  onSaveManualBalance,
  onOpenBudgetEditor,
  onScrollToTemplates,
}) => {
  const { categoryRegistry } = useNido();
  const todayISO = getTodayLocalISO();

  // Panel de edición de saldo manual disponible
  const [balanceEditorOpen, setBalanceEditorOpen] = useState(false);
  const [balanceAmountInput, setBalanceAmountInput] = useState('');
  const [balanceDateInput, setBalanceDateInput] = useState(todayISO);
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceFormError, setBalanceFormError] = useState<string | null>(null);

  // Panel de selección de categorías variables financiadas desde Cuenta común
  const [categoriesPanelOpen, setCategoriesPanelOpen] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // Paneles colapsables informativos
  const [showSplitInfo, setShowSplitInfo] = useState(false);
  const [showSimpleDetails, setShowSimpleDetails] = useState(false);

  const radar = useMemo(
    () =>
      computeCommonAccountRadar(monthKey, transactions, recurring, effectiveSplitPctA, {
        todayISO,
        manualBalance,
        budget,
        plannedCommonCategoryIds: plannedCategoryIds,
        categoryRegistry,
      }),
    [
      monthKey,
      transactions,
      recurring,
      effectiveSplitPctA,
      todayISO,
      manualBalance,
      budget,
      plannedCategoryIds,
      categoryRegistry,
    ]
  );

  // Opciones de categorías elegibles para planificación variable en Cuenta común
  const selectableCategories = useMemo(() => {
    const selectedSet = new Set(plannedCategoryIds);
    const active = categoryRegistry.activeCategories.filter((c) => c.id !== 'liquidacion');
    const activeIds = new Set(active.map((c) => c.id));
    const extras = plannedCategoryIds
      .filter((id) => !activeIds.has(id) && id !== 'liquidacion')
      .map((id) => categoryRegistry.getMeta(id));
    return [...active, ...extras].map((c) => ({
      ...c,
      selected: selectedSet.has(c.id),
      hasBudget:
        budget?.limits !== undefined &&
        Object.prototype.hasOwnProperty.call(budget.limits, c.id) &&
        typeof budget.limits[c.id] === 'number' &&
        Number.isFinite(budget.limits[c.id]) &&
        (budget.limits[c.id] ?? -1) >= 0,
      budgetLimit:
        budget?.limits !== undefined &&
        Object.prototype.hasOwnProperty.call(budget.limits, c.id)
          ? (budget.limits[c.id] ?? null)
          : null,
    }));
  }, [categoryRegistry, plannedCategoryIds, budget]);

  const openBalanceEditor = () => {
    if (isClosed) return;
    setBalanceFormError(null);
    if (manualBalance) {
      setBalanceAmountInput(String(manualBalance.amount).replace('.', ','));
      setBalanceDateInput(manualBalance.referenceDate);
    } else {
      setBalanceAmountInput('');
      setBalanceDateInput(todayISO);
    }
    setBalanceEditorOpen(true);
  };

  const handleSaveBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isClosed) return;
    const trimmed = balanceAmountInput.trim().replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed) || parsed < 0) {
      setBalanceFormError('Introduce un importe válido igual o mayor que 0 €.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(balanceDateInput)) {
      setBalanceFormError('Selecciona una fecha de referencia válida.');
      return;
    }
    setSavingBalance(true);
    setBalanceFormError(null);
    try {
      await onSaveManualBalance({ amount: parsed, referenceDate: balanceDateInput });
      setBalanceEditorOpen(false);
    } catch (err) {
      setBalanceFormError(
        err instanceof Error ? err.message : 'No se pudo guardar el saldo disponible.'
      );
    } finally {
      setSavingBalance(false);
    }
  };

  const handleClearManualBalance = async () => {
    if (isClosed) return;
    setSavingBalance(true);
    setBalanceFormError(null);
    try {
      await onSaveManualBalance(null);
      setBalanceEditorOpen(false);
      setBalanceAmountInput('');
    } catch (err) {
      setBalanceFormError(
        err instanceof Error ? err.message : 'No se pudo quitar el saldo disponible.'
      );
    } finally {
      setSavingBalance(false);
    }
  };

  const handleTogglePlannedCategory = async (catId: string) => {
    if (isClosed || savingCategories) return;
    setSavingCategories(true);
    setCategoriesError(null);
    const exists = plannedCategoryIds.includes(catId);
    const next = exists
      ? plannedCategoryIds.filter((id) => id !== catId)
      : [...plannedCategoryIds, catId];
    try {
      await onSavePlannedCategories(next);
    } catch (err) {
      setCategoriesError(
        err instanceof Error ? err.message : 'No se pudo actualizar la selección de categorías.'
      );
    } finally {
      setSavingCategories(false);
    }
  };

  const formatDaysBadge = (days: number) => {
    if (days <= 0) return 'Hoy';
    if (days === 1) return 'Mañana';
    return `En ${days} días`;
  };

  const splitPctB = Math.round((100 - radar.defaultSplitPctA) * 10) / 10;

  // Formulario reutilizable para editar o quitar saldo manual disponible (con fecha de referencia)
  const manualBalanceEditorForm = (
    <form
      onSubmit={(e) => void handleSaveBalanceSubmit(e)}
      className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Saldo disponible de Cuenta común (€)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={balanceAmountInput}
            onChange={(e) => setBalanceAmountInput(e.target.value)}
            placeholder="Ej. 450,00"
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-sm font-semibold tabular-nums"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Fecha de referencia del saldo
          </span>
          <input
            type="date"
            value={balanceDateInput}
            onChange={(e) => setBalanceDateInput(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0B1417] text-sm font-semibold"
          />
        </label>
      </div>
      {balanceFormError && (
        <p className="text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5]">
          {balanceFormError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={savingBalance}
          className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold disabled:opacity-50"
        >
          {savingBalance ? 'Guardando...' : 'Guardar saldo'}
        </button>
        {manualBalance && (
          <button
            type="button"
            disabled={savingBalance}
            onClick={() => void handleClearManualBalance()}
            className="min-h-[44px] px-3.5 rounded-xl border border-red-200 dark:border-red-900/60 text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Quitar saldo</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setBalanceEditorOpen(false)}
          className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  );

  // Bloque de estado del saldo manual (compartido entre Sencillo y Avanzado)
  const manualBalanceStatusBlock = (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
            {radar.manualBalance
              ? `Saldo disponible de Cuenta común: ${formatEUR(radar.manualBalance.amount)}`
              : 'Saldo disponible de Cuenta común (opcional)'}
          </p>
          {radar.manualBalance ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Referencia: {formatDateES(radar.manualBalance.referenceDate)}
              {radar.manualBalance.updatedBy
                ? ` · Actualizado por ${memberLabel(radar.manualBalance.updatedBy)}`
                : ''}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Importe previsto que debéis tener disponible desde hoy:{' '}
              <strong className="tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                {formatEUR(radar.requiredAvailableTotal)}
              </strong>
            </p>
          )}
        </div>

        {!isClosed && !balanceEditorOpen && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={openBalanceEditor}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{radar.manualBalance ? 'Actualizar' : 'Indicar saldo'}</span>
            </button>
            {radar.manualBalance && (
              <button
                type="button"
                disabled={savingBalance}
                onClick={() => void handleClearManualBalance()}
                aria-label="Quitar saldo disponible"
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-slate-500 hover:text-[#B42318] flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {radar.manualBalance && radar.isBalanceOutdatedMonth && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3 py-2 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p>
            El saldo guardado corresponde a otra fecha ({formatDateES(radar.manualBalance.referenceDate)}
            ). Para comparar este mes sin datos engañosos, actualiza el saldo a una fecha de este mes
            o usa el importe previsto ({formatEUR(radar.requiredAvailableTotal)}).
          </p>
        </div>
      )}

      {radar.manualBalance && !radar.isBalanceOutdatedMonth && radar.isBalanceStale && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3 py-2 text-[11px] text-amber-950 dark:text-amber-200 flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p>
            Saldo con fecha {formatDateES(radar.manualBalance.referenceDate)}
            {radar.balanceAgeDays !== null && radar.balanceAgeDays > 0
              ? ` (hace ${radar.balanceAgeDays} días)`
              : ''}
            . Actualízalo si ha habido movimientos recientes en el banco.
          </p>
        </div>
      )}

      {radar.balanceStatus === 'shortfall' && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 p-3 space-y-1">
          <p className="text-xs font-bold text-[#B42318] dark:text-[#FCA5A5] flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Faltarían aproximadamente {formatEUR(radar.shortfallAmount)} para cubrir lo previsto
              desde el {formatDateES(radar.referenceDate)} ({formatEUR(radar.requiredAvailableTotal)})
            </span>
          </p>
          {hasPartner && radar.shortfallAmount > 0 && (
            <p className="text-xs text-slate-700 dark:text-slate-300 tabular-nums">
              Aportación orientativa para cubrir esa diferencia:{' '}
              <strong>
                {shortNameA} {formatEUR(radar.shortfallShareA)}
              </strong>{' '}
              ·{' '}
              <strong>
                {shortNameB} {formatEUR(radar.shortfallShareB)}
              </strong>
            </p>
          )}
        </div>
      )}

      {radar.balanceStatus === 'covered' && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 p-3 flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#15803D] dark:text-[#4ADE80]" />
          <p>
            Saldo suficiente para las previsiones desde el {formatDateES(radar.referenceDate)} (
            {formatEUR(radar.requiredAvailableTotal)}). Margen estimado:{' '}
            <strong className="tabular-nums">{formatEUR(radar.marginAmount)}</strong>.
          </p>
        </div>
      )}

      {radar.manualBalance &&
        !radar.isBalanceOutdatedMonth &&
        radar.unregisteredBeforeRefItems.length > 0 && (
          <div className="rounded-lg bg-amber-50/90 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 p-2.5 text-[11px] text-amber-950 dark:text-amber-200 space-y-1">
            <p className="font-semibold">
              Hay {radar.unregisteredBeforeRefItems.length}{' '}
              {radar.unregisteredBeforeRefItems.length === 1
                ? 'cargo previsto con fecha anterior al saldo'
                : 'cargos previstos con fecha anterior al saldo'}{' '}
              ({formatEUR(radar.unregisteredBeforeRefTotal)}) aún sin registrar:
            </p>
            <p>
              {radar.unregisteredBeforeRefItems
                .map((it) => `${it.concept} (${formatDateES(it.dueDate)}, ${formatEUR(it.amount)})`)
                .join(' · ')}
              . Si aún no se han cobrado en el banco, súmalos al importe necesario.
            </p>
          </div>
        )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {radar.manualBalance
          ? `No se vuelven a restar los gastos registrados hasta el ${formatDateES(radar.referenceDate)}. Como Nido no consulta el banco, comprueba si algún movimiento reciente aún no se ha cargado en la cuenta. El ahorro y las huchas no se suman aquí.`
          : 'Sin saldo introducido mostramos el importe previsto que debéis tener disponible. El ahorro y las huchas nunca se cuentan como dinero disponible en la Cuenta común.'}
      </p>
    </div>
  );

  // ─── MODO SENCILLO ──────────────────────────────────────────────────────────
  if (uiMode === 'sencillo') {
    if (
      radar.totalMonthlyNeed === 0 &&
      !radar.manualBalance &&
      plannedCategoryIds.length === 0
    ) {
      return null;
    }

    return (
      <section
        aria-label="Previsión de Cuenta común"
        className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-10 h-10 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold">Cuenta común este mes</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Previsión y aportación orientativa
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-base text-[#0F1F24] dark:text-[#F0F5F6] leading-snug">
            Para la Cuenta común habéis previsto{' '}
            <strong className="font-display text-xl text-[#0E5A64] dark:text-[#5EEAD4] tabular-nums">
              {formatEUR(radar.totalMonthlyNeed)}
            </strong>{' '}
            este mes.
          </p>

          <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            Ya registrados en Cuenta común: {formatEUR(radar.registeredCommonTotal)} · Pendientes:{' '}
            {formatEUR(radar.pendingCommonRecurringTotal)}
            {radar.plannedVariableMarginTotal > 0
              ? ` · Margen variable planificado: ${formatEUR(radar.plannedVariableMarginTotal)}`
              : ''}
          </p>

          {hasPartner && radar.totalMonthlyNeed > 0 && (
            <p className="text-sm text-slate-700 dark:text-slate-200 tabular-nums pt-0.5">
              Aportación orientativa del mes:{' '}
              <strong>
                {shortNameA} {formatEUR(radar.monthlyShareA)}
              </strong>{' '}
              ·{' '}
              <strong>
                {shortNameB} {formatEUR(radar.monthlyShareB)}
              </strong>
            </p>
          )}
        </div>

        {radar.next5DaysItems.length > 0 && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3.5 space-y-1.5">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 shrink-0" />
              <span>
                Próximos 5 días: {formatEUR(radar.next5DaysTotal)} ({radar.next5DaysItems.length}{' '}
                {radar.next5DaysItems.length === 1 ? 'cargo' : 'cargos'})
              </span>
            </p>
            <ul className="space-y-1 text-xs text-amber-950 dark:text-amber-100">
              {radar.next5DaysItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {it.concept} ({formatDaysBadge(it.daysUntil)})
                  </span>
                  <span className="font-bold tabular-nums shrink-0">{formatEUR(it.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSimpleDetails((v) => !v)}
            aria-expanded={showSimpleDetails}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <span>
              {showSimpleDetails
                ? 'Ocultar saldo y detalle'
                : radar.manualBalance
                  ? 'Ver saldo disponible y detalle'
                  : 'Comprobar con saldo disponible'}
            </span>
            {showSimpleDetails ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {showSimpleDetails && (
          <div className="space-y-3 pt-1">
            {manualBalanceStatusBlock}
            {balanceEditorOpen && manualBalanceEditorForm}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Las aportaciones orientativas no crean deudas ni transferencias automáticas.
            </p>
          </div>
        )}
      </section>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <section
      aria-label="Radar y aportaciones a la Cuenta común"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold">
              Aportaciones y radar de Cuenta común
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Necesidad prevista del mes, categorías variables planificadas y vencimientos sin
              duplicar importes.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategoriesPanelOpen((v) => !v)}
            aria-expanded={categoriesPanelOpen}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>
              Categorías variables ({plannedCategoryIds.length})
            </span>
          </button>
          {onScrollToTemplates && (
            <button
              type="button"
              onClick={onScrollToTemplates}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Ver plantillas</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 métricas principales de Cuenta común */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3 space-y-0.5">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Registrado en Cuenta común
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(radar.registeredCommonTotal)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {radar.registeredCommonCount}{' '}
            {radar.registeredCommonCount === 1 ? 'gasto registrado' : 'gastos registrados'}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3 space-y-0.5">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Cargos previstos pendientes
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(radar.pendingCommonRecurringTotal)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {radar.pendingCommonRecurringItems.length}{' '}
            {radar.pendingCommonRecurringItems.length === 1
              ? 'recibo pendiente'
              : 'recibos pendientes'}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3 space-y-0.5">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Margen variable planificado
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(radar.plannedVariableMarginTotal)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {plannedCategoryIds.length === 0
              ? 'Ninguna categoría variable elegida'
              : `${plannedCategoryIds.length} ${plannedCategoryIds.length === 1 ? 'categoría elegida' : 'categorías elegidas'}`}
          </p>
        </div>

        <div className="rounded-xl bg-[#0E5A64]/6 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/25 p-3 space-y-0.5">
          <p className="text-[11px] font-semibold text-[#0E5A64] dark:text-[#5EEAD4]">
            Necesidad mensual total
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
            {formatEUR(radar.totalMonthlyNeed)}
          </p>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            Disponible desde {formatDateES(radar.referenceDate)}:{' '}
            {formatEUR(radar.requiredAvailableTotal)}
          </p>
        </div>
      </div>

      {/* Aportación orientativa por miembro + explicación */}
      {radar.totalMonthlyNeed > 0 && (
        <div className="rounded-xl bg-[#0E5A64]/5 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/20 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                Aportación orientativa del mes a la Cuenta común
              </p>
              {hasPartner ? (
                <p className="text-sm font-semibold text-[#0F1F24] dark:text-[#F0F5F6] tabular-nums">
                  {shortNameA}: <strong>{formatEUR(radar.monthlyShareA)}</strong> · {shortNameB}:{' '}
                  <strong>{formatEUR(radar.monthlyShareB)}</strong>
                </p>
              ) : (
                <p className="text-sm font-semibold text-[#0F1F24] dark:text-[#F0F5F6] tabular-nums">
                  Total previsto: <strong>{formatEUR(radar.totalMonthlyNeed)}</strong>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowSplitInfo((v) => !v)}
              aria-expanded={showSplitInfo}
              className="min-h-[44px] px-2.5 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10 inline-flex items-center gap-1"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Cómo se reparte</span>
            </button>
          </div>

          {showSplitInfo && (
            <div className="pt-2 border-t border-[#0E5A64]/15 text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <p>
                Reparto base del hogar: {shortNameA} {radar.defaultSplitPctA}% · {shortNameB}{' '}
                {splitPctB}%.
                {radar.hasCustomSplitOverrides
                  ? ' Se respetan los repartos específicos configurados en cada movimiento o plantilla de Cuenta común.'
                  : ' Aplicado a todos los cargos y margen variable de Cuenta común.'}
              </p>
              <p>
                El redondeo se reconcilia al céntimo exacto ({formatEUR(radar.monthlyShareA)} +{' '}
                {formatEUR(radar.monthlyShareB)} = {formatEUR(radar.totalMonthlyNeed)}).
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Esta aportación es solo orientativa: no genera deudas entre vosotros, no liquida
                saldos históricos ni realiza transferencias.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Selector de categorías variables financiadas desde Cuenta común */}
      {categoriesPanelOpen && (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                Categorías variables planificadas desde la Cuenta común
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Elige qué presupuestos variables (p. ej. Supermercado) queréis cubrir con la Cuenta
                común. Solo sirve para planificar; no cambia quién pagó gastos existentes.
              </p>
            </div>
            {!isClosed && onOpenBudgetEditor && (
              <button
                type="button"
                onClick={onOpenBudgetEditor}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Ajustar presupuestos</span>
              </button>
            )}
          </div>

          {isClosed && (
            <div className="rounded-lg bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>Mes cerrado: la planificación es de solo lectura en este mes.</span>
            </div>
          )}

          {categoriesError && (
            <p className="text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5]">
              {categoriesError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {selectableCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                disabled={isClosed || savingCategories}
                onClick={() => void handleTogglePlannedCategory(cat.id)}
                aria-pressed={cat.selected}
                className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                  cat.selected
                    ? 'bg-[#0E5A64] text-white border-[#0E5A64]'
                    : 'bg-white dark:bg-[#132025] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#0E5A64]/50'
                }`}
              >
                {cat.selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                <span>{cat.label}</span>
                {cat.hasBudget && cat.budgetLimit !== null && (
                  <span
                    className={`text-[10px] tabular-nums ${
                      cat.selected ? 'text-white/80' : 'text-slate-400'
                    }`}
                  >
                    ({formatEUR(cat.budgetLimit)})
                  </span>
                )}
              </button>
            ))}
          </div>

          {radar.plannedVariableRows.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Cómo suma cada categoría elegida (sin duplicar gastos ni recibos):
              </p>
              <ul className="space-y-1.5 text-xs">
                {radar.plannedVariableRows.map((row) => (
                  <li
                    key={row.categoryId}
                    className="flex flex-wrap items-center justify-between gap-2 py-1"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <CategoryTag category={row.categoryId} size="xs" />
                      {!row.hasExplicitBudget ? (
                        <span className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                          Sin presupuesto este mes (0,00 € de margen)
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          Presup. {formatEUR(row.budgetLimit!)}
                          {row.registeredIndividual > 0
                            ? ` · ya pagado individual: ${formatEUR(row.registeredIndividual)}`
                            : ''}
                          {row.pendingCommon > 0
                            ? ` · recibos Cuenta común: ${formatEUR(row.pendingCommon)}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6] shrink-0">
                      +{formatEUR(row.unconsumedVariableMargin)} margen
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Aviso si hay categorías elegidas sin presupuesto este mes (cuando el panel está cerrado) */}
      {!categoriesPanelOpen && radar.missingBudgetCategories.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950 dark:text-amber-200">
          <p>
            {radar.missingBudgetCategories.map((c) => c.label).join(', ')}{' '}
            {radar.missingBudgetCategories.length === 1
              ? 'está marcada para Cuenta común pero no tiene presupuesto configurado este mes.'
              : 'están marcadas para Cuenta común pero no tienen presupuesto configurado este mes.'}
          </p>
          {!isClosed && onOpenBudgetEditor && (
            <button
              type="button"
              onClick={onOpenBudgetEditor}
              className="min-h-[44px] px-3 rounded-lg font-bold underline"
            >
              Ajustar presupuestos
            </button>
          )}
        </div>
      )}

      {/* Saldo disponible opcional de Cuenta común */}
      {manualBalanceStatusBlock}
      {balanceEditorOpen && manualBalanceEditorForm}

      {/* Próximos 5 días vs Resto del mes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Próximos 5 días</span>
            </h3>
            <span className="text-xs font-bold tabular-nums">
              {formatEUR(radar.next5DaysTotal)}
            </span>
          </div>
          {radar.next5DaysItems.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sin cargos de Cuenta común en los próximos 5 días.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {radar.next5DaysItems.map((it) => (
                <li key={it.id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CategoryTag category={it.category} size="xs" />
                      <span className="font-semibold truncate">{it.concept}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatDateES(it.dueDate)} · {formatDaysBadge(it.daysUntil)}
                      {it.hasSplitOverride ? ` · Reparto ${it.splitPctA}/${Math.round((100 - it.splitPctA) * 10) / 10}` : ''}
                    </p>
                  </div>
                  <span className="font-bold tabular-nums shrink-0">{formatEUR(it.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Resto del mes
            </h3>
            <span className="text-xs font-bold tabular-nums">
              {formatEUR(radar.restOfMonthTotal)}
            </span>
          </div>
          {radar.restOfMonthItems.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sin más cargos de Cuenta común previstos para el resto del mes.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {radar.restOfMonthItems.map((it) => (
                <li key={it.id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CategoryTag category={it.category} size="xs" />
                      <span className="font-semibold truncate">{it.concept}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatDateES(it.dueDate)}
                      {it.hasSplitOverride ? ` · Reparto ${it.splitPctA}/${Math.round((100 - it.splitPctA) * 10) / 10}` : ''}
                    </p>
                  </div>
                  <span className="font-bold tabular-nums shrink-0">{formatEUR(it.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};
