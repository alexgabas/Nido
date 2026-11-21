import React from 'react';
import { Lock, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { formatDateES, formatEUR, formatMonthLabelES } from '../../domain/finance';
import { TRANSACTION_CATEGORY_LABELS } from '../../domain/presets';
import type { Transaction, TransactionCategory } from '../../types/nido';

interface GlobalSearchSectionProps {
  open: boolean;
  cachedHistory: Transaction[] | null;
  historyLoading: boolean;
  historyError: string | null;
  globalText: string;
  globalAmount: string;
  globalCategory: TransactionCategory | 'todas';
  globalLimit: number;
  hasGlobalCriteria: boolean;
  globalResults: Transaction[];
  globalTotalAmount: number;
  closedMonthKeys: Set<string>;
  memberLabel: (uid: string) => string;
  onRefresh: () => void;
  onTextChange: (val: string) => void;
  onAmountChange: (val: string) => void;
  onCategoryChange: (val: TransactionCategory | 'todas') => void;
  onClearCriteria: () => void;
  onShowMore: () => void;
  onClose: () => void;
  onGoToMonth: (monthKey: string) => void;
  onEditTx: (tx: Transaction) => void;
  onDeleteTx: (tx: Transaction) => void;
}

export const GlobalSearchSection: React.FC<GlobalSearchSectionProps> = ({
  open,
  cachedHistory,
  historyLoading,
  historyError,
  globalText,
  globalAmount,
  globalCategory,
  globalLimit,
  hasGlobalCriteria,
  globalResults,
  globalTotalAmount,
  closedMonthKeys,
  memberLabel,
  onRefresh,
  onTextChange,
  onAmountChange,
  onCategoryChange,
  onClearCriteria,
  onShowMore,
  onClose,
  onGoToMonth,
  onEditTx,
  onDeleteTx,
}) => {
  if (!open) return null;

  return (
    <section
      aria-label="Búsqueda global de gastos"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-[#0E5A64]/35 dark:border-[#5EEAD4]/30 p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold">
            Búsqueda global en todo el historial
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {historyLoading
              ? 'Cargando historial completo...'
              : cachedHistory
                ? `${cachedHistory.length} movimientos en caché de esta sesión. Busca por texto, importe o categoría.`
                : 'Pulsa Actualizar para cargar todo el historial bajo demanda.'}
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
            placeholder="Ej. Bonpreu, fianza, cena..."
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
            onChange={(e) => onCategoryChange(e.target.value as TransactionCategory | 'todas')}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
          >
            <option value="todas">Todas las categorías</option>
            {(Object.keys(TRANSACTION_CATEGORY_LABELS) as TransactionCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {TRANSACTION_CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!hasGlobalCriteria ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Escribe un texto, un importe o elige una categoría para buscar en todos tus meses.
        </p>
      ) : globalResults.length === 0 ? (
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300 py-3">
          No se encontraron gastos que coincidan con esos criterios.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
            {globalResults.length} resultado{globalResults.length === 1 ? '' : 's'} · Suma de gastos:{' '}
            <strong className="text-[#0E5A64] dark:text-[#5EEAD4]">
              {formatEUR(globalTotalAmount)}
            </strong>
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[360px] overflow-y-auto">
            {globalResults.slice(0, globalLimit).map((tx) => {
              const rowClosed = closedMonthKeys.has(tx.monthKey);
              return (
                <li
                  key={tx.id}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
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
                      {TRANSACTION_CATEGORY_LABELS[tx.category]} ·{' '}
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
            })}
          </ul>
          {globalResults.length > globalLimit && (
            <button
              type="button"
              onClick={onShowMore}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Mostrar más ({globalResults.length - globalLimit} restantes)
            </button>
          )}
        </div>
      )}
    </section>
  );
};
