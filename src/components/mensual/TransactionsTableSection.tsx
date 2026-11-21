import React, { useState } from 'react';
import { ArrowUpDown, Check, Lock, Pencil, Search, Trash2, X } from 'lucide-react';
import { CategoryTag } from '../CategoryTag';
import { clampSplitPct, formatDateES, formatEUR, formatMonthLabelES } from '../../domain/finance';
import { EXPENSE_CATEGORY_LABELS, TRANSACTION_CATEGORY_LABELS } from '../../domain/presets';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type HouseholdMember,
  type Transaction,
  type TransactionCategory,
} from '../../types/nido';

export type TxSortField = 'date' | 'concept' | 'category' | 'amount';

interface TransactionsTableSectionProps {
  selectedMonthKey: string;
  monthTransactionsCount: number;
  filteredTransactions: Transaction[];
  isClosed: boolean;
  txSearch: string;
  categoryFilter: TransactionCategory | 'todas';
  payerFilter: string;
  selectedTxIds: Set<string>;
  memberA: HouseholdMember | undefined;
  memberB: HouseholdMember | undefined;
  effectiveSplitPctA: number;
  memberLabel: (uid: string) => string;
  onTxSearchChange: (val: string) => void;
  onCategoryFilterChange: (val: TransactionCategory | 'todas') => void;
  onPayerFilterChange: (val: string) => void;
  onSortClick: (field: TxSortField) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onToggleSelectOne: (id: string, checked: boolean) => void;
  onBulkDeleteRequest: () => void;
  onSaveInlineEdit: (
    tx: Transaction,
    updates: {
      concept: string;
      category: ExpenseCategory;
      paidBy: string;
      splitPctA: number;
      amount: number;
    }
  ) => Promise<boolean>;
  onOpenEditModal: (tx: Transaction) => void;
  onDeleteRequest: (tx: Transaction) => void;
}

export const TransactionsTableSection: React.FC<TransactionsTableSectionProps> = ({
  selectedMonthKey,
  monthTransactionsCount,
  filteredTransactions,
  isClosed,
  txSearch,
  categoryFilter,
  payerFilter,
  selectedTxIds,
  memberA,
  memberB,
  effectiveSplitPctA,
  memberLabel,
  onTxSearchChange,
  onCategoryFilterChange,
  onPayerFilterChange,
  onSortClick,
  onToggleSelectAll,
  onToggleSelectOne,
  onBulkDeleteRequest,
  onSaveInlineEdit,
  onOpenEditModal,
  onDeleteRequest,
}) => {
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineConcept, setInlineConcept] = useState('');
  const [inlineCategory, setInlineCategory] = useState<ExpenseCategory>('supermercado');
  const [inlinePaidBy, setInlinePaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [inlineSplitPct, setInlineSplitPct] = useState('50');
  const [inlineAmount, setInlineAmount] = useState('');

  const fullNameA = memberA?.displayName?.trim() || 'Persona A';
  const fullNameB = memberB?.displayName?.trim() || 'Pareja';
  const shortNameA = fullNameA.split(' ')[0];
  const shortNameB = fullNameB.split(' ')[0];

  const allVisibleSelected =
    !isClosed &&
    filteredTransactions.length > 0 &&
    filteredTransactions.every((t) => selectedTxIds.has(t.id));

  const startInlineEdit = (tx: Transaction) => {
    if (isClosed || tx.isSettlement) return;
    setInlineEditId(tx.id);
    setInlineConcept(tx.concept);
    setInlineCategory(tx.category === 'liquidacion' ? 'otros' : tx.category);
    setInlinePaidBy(tx.paidBy === 'comun' ? COMMON_ACCOUNT_ID : tx.paidBy);
    setInlineSplitPct(String(clampSplitPct(tx.splitPctA, effectiveSplitPctA)));
    setInlineAmount(String(tx.amount));
  };

  const handleSaveInline = async (tx: Transaction) => {
    const numericAmt = Number(inlineAmount.replace(',', '.'));
    const ok = await onSaveInlineEdit(tx, {
      concept: inlineConcept,
      category: inlineCategory,
      paidBy: tx.isPrivate ? tx.paidBy : inlinePaidBy,
      splitPctA: tx.isPrivate
        ? tx.splitPctA
        : clampSplitPct(inlineSplitPct, effectiveSplitPctA),
      amount: numericAmt,
    });
    if (ok) {
      setInlineEditId(null);
    }
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4 min-w-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold">
          Tabla de movimientos ({filteredTransactions.length} de {monthTransactionsCount})
        </h2>

        {!isClosed && selectedTxIds.size > 0 && (
          <button
            type="button"
            onClick={onBulkDeleteRequest}
            className="min-h-[44px] px-3.5 rounded-xl bg-[#B42318] hover:bg-[#912018] text-white text-xs font-semibold flex items-center gap-1.5 self-start md:self-auto"
          >
            <Trash2 className="w-4 h-4" />
            <span>Eliminar seleccionados ({selectedTxIds.size})</span>
          </button>
        )}
      </div>

      {/* Search & Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <div className="sm:col-span-6 relative">
          <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar movimientos"
            value={txSearch}
            onChange={(e) => onTxSearchChange(e.target.value)}
            placeholder="Buscar por concepto, categoría o nota..."
            className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 text-xs sm:text-sm"
          />
        </div>
        <div className="sm:col-span-3">
          <select
            aria-label="Filtrar por categoría"
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value as TransactionCategory | 'todas')}
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
        <div className="sm:col-span-3">
          <select
            aria-label="Filtrar por pagador"
            value={payerFilter}
            onChange={(e) => onPayerFilterChange(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
          >
            <option value="todos">Todos los pagadores</option>
            {memberA && <option value={memberA.uid}>{fullNameA}</option>}
            {memberB && <option value={memberB.uid}>{fullNameB}</option>}
            <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
          </select>
        </div>
      </div>

      {filteredTransactions.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <p className="text-sm font-semibold">
            {monthTransactionsCount === 0
              ? `No hay gastos en ${formatMonthLabelES(selectedMonthKey)}`
              : 'Ningún movimiento coincide con los filtros'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {monthTransactionsCount === 0
              ? 'Pulsa «Añadir gasto» o genera los gastos fijos desde vuestras plantillas.'
              : 'Prueba a limpiar la búsqueda o cambiar los filtros.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                {!isClosed && (
                  <th className="py-2.5 pr-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos los movimientos visibles"
                      checked={allVisibleSelected}
                      onChange={(e) => onToggleSelectAll(e.target.checked)}
                      className="w-4 h-4 accent-[#0E5A64]"
                    />
                  </th>
                )}
                <th className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSortClick('date')}
                    className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                  >
                    <span>Fecha</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSortClick('concept')}
                    className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                  >
                    <span>Concepto</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSortClick('category')}
                    className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                  >
                    <span>Categoría</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-1.5 pr-3 font-semibold">Pagó</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Reparto</th>
                <th className="py-1.5 pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => onSortClick('amount')}
                    className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                  >
                    <span>Importe</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                {!isClosed && <th className="py-2.5 text-right font-semibold">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTransactions.map((tx) => {
                const isInline = !isClosed && inlineEditId === tx.id;
                const isSelected = selectedTxIds.has(tx.id);
                return (
                  <tr
                    key={tx.id}
                    className={isSelected ? 'bg-[#0E5A64]/5 dark:bg-[#0E5A64]/15' : undefined}
                  >
                    {!isClosed && (
                      <td className="py-2.5 pr-2 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${tx.concept}`}
                          checked={isSelected}
                          onChange={(e) => onToggleSelectOne(tx.id, e.target.checked)}
                          className="w-4 h-4 accent-[#0E5A64]"
                        />
                      </td>
                    )}

                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {formatDateES(tx.date)}
                    </td>

                    <td className="py-2.5 pr-3 min-w-[150px]">
                      {isInline ? (
                        <input
                          type="text"
                          aria-label="Editar concepto en línea"
                          value={inlineConcept}
                          onChange={(e) => setInlineConcept(e.target.value)}
                          className="w-full min-h-[44px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                        />
                      ) : (
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold">
                              {tx.concept}
                              {tx.isSettlement ? ' · Liquidación' : ''}
                            </p>
                            {tx.isPrivate && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                <Lock className="w-2.5 h-2.5" />
                                <span>Privado</span>
                              </span>
                            )}
                          </div>
                          {tx.notes && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                              {tx.notes}
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {isInline ? (
                        <select
                          aria-label="Editar categoría en línea"
                          value={inlineCategory}
                          onChange={(e) => setInlineCategory(e.target.value as ExpenseCategory)}
                          className="min-h-[44px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                            <option key={cat} value={cat}>
                              {EXPENSE_CATEGORY_LABELS[cat]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <CategoryTag category={tx.category} size="xs" />
                      )}
                    </td>

                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {isInline && !tx.isPrivate ? (
                        <select
                          aria-label="Editar pagador en línea"
                          value={inlinePaidBy}
                          onChange={(e) => setInlinePaidBy(e.target.value)}
                          className="min-h-[44px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {memberA && <option value={memberA.uid}>{shortNameA}</option>}
                          {memberB && <option value={memberB.uid}>{shortNameB}</option>}
                          <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
                        </select>
                      ) : (
                        <span>{tx.isPrivate ? 'Solo tú' : memberLabel(tx.paidBy)}</span>
                      )}
                    </td>

                    <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">
                      {isInline && !tx.isPrivate ? (
                        <input
                          type="number"
                          aria-label="Editar reparto en línea (%)"
                          min={0}
                          max={100}
                          step={0.5}
                          value={inlineSplitPct}
                          onChange={(e) => setInlineSplitPct(e.target.value)}
                          className="w-16 min-h-[44px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-right"
                        />
                      ) : tx.isPrivate || tx.paidBy === COMMON_ACCOUNT_ID || tx.paidBy === 'comun' ? (
                        <span className="text-slate-500 dark:text-slate-400">—</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          {tx.splitPctA}/{Math.round((100 - tx.splitPctA) * 10) / 10}%
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                      {isInline ? (
                        <input
                          type="text"
                          aria-label="Editar importe en línea"
                          inputMode="decimal"
                          value={inlineAmount}
                          onChange={(e) => setInlineAmount(e.target.value)}
                          className="w-24 min-h-[44px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xs text-right font-bold"
                        />
                      ) : (
                        <span
                          className={`font-mono-num font-bold ${
                            tx.isSettlement ? 'text-[#15803D] dark:text-[#4ADE80]' : ''
                          }`}
                        >
                          {formatEUR(tx.amount)}
                        </span>
                      )}
                    </td>

                    {!isClosed && (
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {isInline ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="Guardar edición en línea"
                              onClick={() => void handleSaveInline(tx)}
                              className="min-h-[44px] min-w-[44px] rounded-lg bg-[#0E5A64] text-white inline-flex items-center justify-center"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancelar edición en línea"
                              onClick={() => setInlineEditId(null)}
                              className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-300 dark:border-slate-700 inline-flex items-center justify-center"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {!tx.isSettlement && (
                              <>
                                <button
                                  type="button"
                                  aria-label={`Editar ${tx.concept}`}
                                  title="Editar gasto"
                                  onClick={() => {
                                    setInlineEditId(null);
                                    onOpenEditModal(tx);
                                  }}
                                  className="min-h-[44px] min-w-[44px] rounded-lg inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Edición rápida en línea de ${tx.concept}`}
                                  title="Edición rápida en línea"
                                  onClick={() => startInlineEdit(tx)}
                                  className="min-h-[44px] px-2.5 rounded-lg inline-flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  Rápido
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              aria-label={`Eliminar ${tx.concept}`}
                              onClick={() => onDeleteRequest(tx)}
                              className="min-h-[44px] min-w-[44px] rounded-lg inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
