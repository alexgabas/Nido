import React from 'react';
import { ArrowUpRight, Lock, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import { formatDateES, formatEUR, formatMonthLabelES } from '../../domain/finance';
import type {
  ExtendedGlobalSearchSummary,
  GlobalSearchOrigin,
} from '../../domain/globalSearch';
import { INITIAL_COST_CATEGORY_LABELS } from '../../domain/presets';
import {
  COMMON_ACCOUNT_ID,
  SYSTEM_INITIAL_COST_CATEGORIES,
  type HouseholdMember,
  type Transaction,
} from '../../types/nido';

interface GlobalSearchSectionProps {
  open: boolean;
  cachedMonthlyCount: number | null;
  cachedMovingCount: number | null;
  historyLoading: boolean;
  historyError: string | null;
  globalOrigin: GlobalSearchOrigin;
  globalPayer: string;
  globalText: string;
  globalAmount: string;
  globalCategory: string;
  globalLimit: number;
  hasGlobalCriteria: boolean;
  summary: ExtendedGlobalSearchSummary;
  closedMonthKeys: Set<string>;
  memberA: HouseholdMember | null | undefined;
  memberB: HouseholdMember | null | undefined;
  memberLabel: (uid: string) => string;
  onRefresh: () => void;
  onOriginChange: (val: GlobalSearchOrigin) => void;
  onPayerChange: (val: string) => void;
  onTextChange: (val: string) => void;
  onAmountChange: (val: string) => void;
  onCategoryChange: (val: string) => void;
  onClearCriteria: () => void;
  onShowMore: () => void;
  onClose: () => void;
  onGoToMonth: (monthKey: string) => void;
  onGoToMudanza: () => void;
  onEditTx: (tx: Transaction) => void;
  onDeleteTx: (tx: Transaction) => void;
}

const ORIGIN_OPTIONS: ReadonlyArray<{ id: GlobalSearchOrigin; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'mensual', label: 'Mensual' },
  { id: 'mudanza', label: 'Mudanza' },
];

export const GlobalSearchSection: React.FC<GlobalSearchSectionProps> = ({
  open,
  cachedMonthlyCount,
  cachedMovingCount,
  historyLoading,
  historyError,
  globalOrigin,
  globalPayer,
  globalText,
  globalAmount,
  globalCategory,
  globalLimit,
  hasGlobalCriteria,
  summary,
  closedMonthKeys,
  memberA,
  memberB,
  memberLabel,
  onRefresh,
  onOriginChange,
  onPayerChange,
  onTextChange,
  onAmountChange,
  onCategoryChange,
  onClearCriteria,
  onShowMore,
  onClose,
  onGoToMonth,
  onGoToMudanza,
  onEditTx,
  onDeleteTx,
}) => {
  const { categoryRegistry } = useNido();
  if (!open) return null;

  const isLoaded = cachedMonthlyCount !== null && cachedMovingCount !== null;
  const movingOnlyCategories = SYSTEM_INITIAL_COST_CATEGORIES.filter(
    (id) => !categoryRegistry.allKnownCategories.some((c) => c.id === id)
  );

  const resolveCostCategoryLabel = (catId: string): string =>
    INITIAL_COST_CATEGORY_LABELS[catId] || categoryRegistry.getLabel(catId);

  return (
    <section
      aria-label="Búsqueda global de gastos"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-[#0E5A64]/35 dark:border-[#5EEAD4]/30 p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold">
            Búsqueda global (Mensual y Mudanza)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {historyLoading
              ? 'Cargando historial de mensual y mudanza...'
              : isLoaded
                ? `${cachedMonthlyCount} movimientos mensuales y ${cachedMovingCount} gastos de mudanza en caché de esta sesión.`
                : 'Pulsa Actualizar para cargar el historial bajo demanda.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={historyLoading}
            onClick={onRefresh}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          {hasGlobalCriteria && (
            <button
              type="button"
              onClick={onClearCriteria}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Limpiar
            </button>
          )}
          <button
            type="button"
            aria-label="Cerrar búsqueda global"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {historyError && (
        <div
          role="alert"
          className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs"
        >
          {historyError}
        </div>
      )}

      {/* Origen + Pagador */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
        <div>
          <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Origen
          </span>
          <div
            role="group"
            aria-label="Filtrar por origen del gasto"
            className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-[#F6F8F8] dark:bg-slate-900"
          >
            {ORIGIN_OPTIONS.map((opt) => {
              const active = globalOrigin === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onOriginChange(opt.id)}
                  className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-white dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="sm:flex-1 sm:max-w-xs">
          <label
            htmlFor="global-search-payer"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1"
          >
            Pagador
          </label>
          <select
            id="global-search-payer"
            value={globalPayer}
            onChange={(e) => onPayerChange(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
          >
            <option value="todos">Todos los pagadores</option>
            <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
            {memberA && <option value={memberA.uid}>{memberA.displayName}</option>}
            {memberB && <option value={memberB.uid}>{memberB.displayName}</option>}
          </select>
        </div>
      </div>

      {/* Texto + Importe + Categoría */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <div className="sm:col-span-5">
          <label
            htmlFor="global-search-text"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1"
          >
            Texto (concepto, nota o categoría)
          </label>
          <input
            id="global-search-text"
            type="search"
            value={globalText}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Ej. Bonpreu, fianza, cerrajero, cena..."
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 text-xs sm:text-sm"
          />
        </div>
        <div className="sm:col-span-3">
          <label
            htmlFor="global-search-amount"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1"
          >
            Importe (€)
          </label>
          <input
            id="global-search-amount"
            type="text"
            inputMode="decimal"
            value={globalAmount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="Ej. 142,60"
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 font-mono-num text-xs sm:text-sm"
          />
        </div>
        <div className="sm:col-span-4">
          <label
            htmlFor="global-search-cat"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1"
          >
            Categoría
          </label>
          <select
            id="global-search-cat"
            value={globalCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
          >
            <option value="todas">Todas las categorías</option>
            <optgroup label="Gastos mensuales">
              {categoryRegistry.allKnownCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.archived ? `${cat.label} (Archivada)` : cat.label}
                </option>
              ))}
              <option value="liquidacion">Liquidación</option>
            </optgroup>
            <optgroup label="Gastos de mudanza">
              {movingOnlyCategories.map((catId) => (
                <option key={catId} value={catId}>
                  {INITIAL_COST_CATEGORY_LABELS[catId] || catId}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {!hasGlobalCriteria ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Elige un origen, un pagador, una categoría o escribe un texto o importe para buscar en
          Mensual y Mudanza.
        </p>
      ) : summary.items.length === 0 ? (
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300 py-3">
          No se encontraron registros que coincidan con esos criterios.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Subtotales separados por origen (nunca suma mixta ambigua) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
              {summary.items.length} resultado{summary.items.length === 1 ? '' : 's'}
            </span>
            {summary.monthlyCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] font-semibold tabular-nums">
                <span>Mensual ({summary.monthlyCount}):</span>
                <strong>{formatEUR(summary.monthlyExpenseTotal)}</strong>
              </span>
            )}
            {summary.movingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 font-semibold tabular-nums">
                <span>Mudanza ({summary.movingCount}):</span>
                <strong>{formatEUR(summary.movingTotal)}</strong>
                {summary.movingPendingTotal > 0 && (
                  <span className="text-[11px] font-normal">
                    ({formatEUR(summary.movingPaidTotal)} pagado ·{' '}
                    {formatEUR(summary.movingPendingTotal)} pend.)
                  </span>
                )}
              </span>
            )}
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[380px] overflow-y-auto">
            {summary.items.slice(0, globalLimit).map((record) => {
              if (record.kind === 'mensual') {
                const tx = record.tx;
                const rowClosed = closedMonthKeys.has(tx.monthKey);
                return (
                  <li
                    key={`mensual:${tx.id}`}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4] text-[10px] font-bold uppercase tracking-wide">
                          Mensual
                        </span>
                        <span className="font-semibold text-sm">{tx.concept}</span>
                        {tx.isPrivate && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            <Lock className="w-3 h-3" />
                            <span>Privado</span>
                          </span>
                        )}
                        {rowClosed && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                            <Lock className="w-3 h-3" />
                            <span>Mes cerrado</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDateES(tx.date)} ({formatMonthLabelES(tx.monthKey)}) ·{' '}
                        {categoryRegistry.getLabel(tx.category)} ·{' '}
                        {tx.isPrivate ? 'Privado' : memberLabel(tx.paidBy)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0">
                      <span className="font-mono-num text-sm font-bold mr-1">
                        {formatEUR(tx.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onGoToMonth(tx.monthKey)}
                        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Ir al mes
                      </button>
                      {!rowClosed && !tx.isSettlement && (
                        <button
                          type="button"
                          aria-label={`Editar ${tx.concept}`}
                          onClick={() => onEditTx(tx)}
                          className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {!rowClosed && (
                        <button
                          type="button"
                          aria-label={`Eliminar ${tx.concept}`}
                          onClick={() => onDeleteTx(tx)}
                          className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              }

              const cost = record.cost;
              return (
                <li
                  key={`mudanza:${cost.id}`}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-[10px] font-bold uppercase tracking-wide">
                        Mudanza
                      </span>
                      <span className="font-semibold text-sm">{cost.concept}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          cost.status === 'pagado'
                            ? 'bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80]'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {cost.status === 'pagado' ? 'Pagado' : 'Pendiente'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {cost.dueDate ? `${formatDateES(cost.dueDate)} · ` : ''}
                      {resolveCostCategoryLabel(cost.category)} · {memberLabel(cost.paidBy)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0">
                    <span className="font-mono-num text-sm font-bold mr-1">
                      {formatEUR(cost.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={onGoToMudanza}
                      className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                    >
                      <span>Ver en Mudanza</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {summary.items.length > globalLimit && (
            <button
              type="button"
              onClick={onShowMore}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Mostrar más ({summary.items.length - globalLimit} restantes)
            </button>
          )}
        </div>
      )}
    </section>
  );
};
