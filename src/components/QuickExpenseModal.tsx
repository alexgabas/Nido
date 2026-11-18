import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { getTodayLocalISO } from '../domain/finance';
import { EXPENSE_CATEGORY_LABELS } from '../domain/presets';
import type { ExpenseCategory, Transaction } from '../types/nido';

interface QuickExpenseModalProps {
  open: boolean;
  onClose: () => void;
  editingTx?: Transaction | null;
}

const QUICK_CATEGORIES: ExpenseCategory[] = [
  'supermercado',
  'alquiler',
  'luz',
  'agua',
  'gas',
  'internet',
  'ocio',
  'transporte',
  'otros',
];

export const QuickExpenseModal: React.FC<QuickExpenseModalProps> = ({
  open,
  onClose,
  editingTx = null,
}) => {
  const {
    householdId,
    currentUserProfile,
    memberA,
    memberB,
    effectiveSplitPctA,
    selectedMonthKey,
    monthClosures,
    uiMode,
    repo,
    showToast,
  } = useNido();

  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('supermercado');
  const [paidBy, setPaidBy] = useState<string>('cuenta_comun');
  const [date, setDate] = useState(getTodayLocalISO());
  const [splitPctA, setSplitPctA] = useState(effectiveSplitPctA);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingTx) {
      setAmount(String(editingTx.amount));
      setConcept(editingTx.concept);
      setCategory(editingTx.category === 'liquidacion' ? 'otros' : editingTx.category);
      setPaidBy(editingTx.paidBy);
      setDate(editingTx.date);
      setSplitPctA(editingTx.splitPctA);
      setNotes(editingTx.notes);
    } else {
      const today = getTodayLocalISO();
      const defaultDate = today.startsWith(selectedMonthKey) ? today : `${selectedMonthKey}-01`;
      setAmount('');
      setConcept('');
      setCategory('supermercado');
      setPaidBy(currentUserProfile?.uid || memberA?.uid || 'cuenta_comun');
      setDate(defaultDate);
      setSplitPctA(effectiveSplitPctA);
      setNotes('');
    }
  }, [open, editingTx, selectedMonthKey, currentUserProfile, memberA, effectiveSplitPctA]);

  if (!open) return null;

  const targetMonthKey = date.slice(0, 7);
  const isClosed = monthClosures.some((c) => c.monthKey === targetMonthKey);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const numeric = Number(amount.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Introduce un importe válido mayor que 0.');
      return;
    }
    const cleanConcept = concept.trim();
    if (!cleanConcept) {
      setError('Escribe un concepto breve (ej. Compra Bonpreu).');
      return;
    }
    if (isClosed) {
      setError(`El mes ${targetMonthKey} está cerrado. Desbloquéalo en Modo Avanzado para editar.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await repo.upsertTransaction(
        householdId,
        {
          id: editingTx?.id,
          monthKey: targetMonthKey,
          concept: cleanConcept,
          category,
          amount: Math.round(numeric * 100) / 100,
          date,
          paidBy,
          recurringId: editingTx?.recurringId ?? null,
          splitPctA,
          isSettlement: false,
          settlementTo: '',
          notes,
        },
        currentUserProfile
      );
      showToast(editingTx ? 'Gasto actualizado' : 'Gasto guardado');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el gasto.');
    } finally {
      setSaving(false);
    }
  };

  const nameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const nameB = memberB?.displayName?.split(' ')[0] || 'Pareja';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-expense-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 id="quick-expense-title" className="font-display text-lg font-bold">
            {editingTx ? 'Editar gasto' : 'Añadir gasto rápido'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tx-amount" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Importe (€)
              </label>
              <input
                id="tx-amount"
                type="text"
                inputMode="decimal"
                required
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xl font-bold focus:outline-2 focus:outline-[#0E5A64]"
              />
            </div>

            <div>
              <label htmlFor="tx-concept" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Concepto
              </label>
              <input
                id="tx-concept"
                type="text"
                maxLength={120}
                required
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej. Compra Bonpreu"
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-2 focus:outline-[#0E5A64]"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Categoría
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[])
                .filter((cat) => uiMode === 'avanzado' || QUICK_CATEGORIES.includes(cat))
                .map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`min-h-[40px] px-3 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                      category === cat
                        ? 'bg-[#0E5A64] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </button>
                ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Quién pagó
            </span>
            <div className="grid grid-cols-3 gap-2">
              {memberA && (
                <button
                  type="button"
                  onClick={() => setPaidBy(memberA.uid)}
                  className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border transition-colors truncate ${
                    paidBy === memberA.uid
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {nameA}
                </button>
              )}
              {memberB && (
                <button
                  type="button"
                  onClick={() => setPaidBy(memberB.uid)}
                  className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border transition-colors truncate ${
                    paidBy === memberB.uid
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {nameB}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPaidBy('cuenta_comun')}
                className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border transition-colors truncate ${
                  paidBy === 'cuenta_comun'
                    ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                Cuenta común
              </button>
            </div>
          </div>

          {uiMode === 'avanzado' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label htmlFor="tx-date" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Fecha
                </label>
                <input
                  id="tx-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label htmlFor="tx-split" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Reparto {nameA} (%)
                </label>
                <input
                  id="tx-split"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={splitPctA}
                  onChange={(e) => setSplitPctA(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="tx-notes" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Notas o enlace de ticket (sin subida de archivo)
                </label>
                <input
                  id="tx-notes"
                  type="text"
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional: nota o URL"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || isClosed}
            className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {saving ? 'Guardando...' : editingTx ? 'Guardar cambios' : 'Guardar gasto'}
          </button>
        </form>
      </div>
    </div>
  );
};
