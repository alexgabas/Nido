import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { formatEUR, formatMonthLabelES } from '../../domain/finance';
import { EXPENSE_CATEGORY_LABELS } from '../../domain/presets';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type { ExpenseCategory, MonthlyBudget } from '../../types/nido';

interface BudgetEditorModalProps {
  open: boolean;
  selectedMonthKey: string;
  budget: MonthlyBudget | null;
  activeFixedByCategory: Partial<Record<ExpenseCategory, number>>;
  onSave: (limits: MonthlyBudget['limits']) => Promise<void>;
  onClose: () => void;
}

const VARIABLE_CATS: ExpenseCategory[] = ['supermercado', 'transporte', 'ocio', 'otros'];

export const BudgetEditorModal: React.FC<BudgetEditorModalProps> = ({
  open,
  selectedMonthKey,
  budget,
  activeFixedByCategory,
  onSave,
  onClose,
}) => {
  const [draftLimits, setDraftLimits] = useState<Record<string, string>>({});
  const [budgetModalError, setBudgetModalError] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    if (!open) return;
    const draft: Record<string, string> = {};
    for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
      const val = budget?.limits?.[cat];
      draft[cat] = val !== undefined && val > 0 ? String(val) : '';
    }
    setDraftLimits(draft);
    setBudgetModalError(null);
  }, [open, budget]);

  if (!open) return null;

  const fixedCats = (Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).filter(
    (c) => !VARIABLE_CATS.includes(c)
  );
  const fixedCatsWithDraft = fixedCats.filter((c) => {
    const raw = (draftLimits[c] ?? '').trim();
    return raw !== '' && Number(raw.replace(',', '.')) > 0;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const limits: MonthlyBudget['limits'] = {};
    for (const [k, raw] of Object.entries(draftLimits)) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const n = Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setBudgetModalError(
          `El límite de ${EXPENSE_CATEGORY_LABELS[k as ExpenseCategory]} debe ser un número válido igual o mayor que 0.`
        );
        return;
      }
      if (n > 0) {
        limits[k as ExpenseCategory] = Math.round(n * 100) / 100;
      }
    }
    setSavingBudget(true);
    setBudgetModalError(null);
    try {
      await onSave(limits);
    } catch (err) {
      setBudgetModalError(
        toUserFriendlyErrorMessage(err, 'No se pudieron guardar los límites mensuales.')
      );
    } finally {
      setSavingBudget(false);
    }
  };

  const renderCatRow = (cat: ExpenseCategory) => {
    const fixedMonthly = activeFixedByCategory[cat] ?? 0;
    return (
      <div key={cat} className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={`bud-${cat}`} className="text-sm font-medium block">
            {EXPENSE_CATEGORY_LABELS[cat]}
          </label>
          {fixedMonthly > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Fijo activo: {formatEUR(fixedMonthly)}/mes
            </p>
          )}
        </div>
        <input
          id={`bud-${cat}`}
          type="text"
          inputMode="decimal"
          placeholder="Sin límite"
          value={draftLimits[cat] ?? ''}
          onChange={(e) => setDraftLimits((prev) => ({ ...prev, [cat]: e.target.value }))}
          className="w-32 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right shrink-0"
        />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-modal-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="budget-modal-title" className="font-display text-lg font-bold">
              Presupuestos de {formatMonthLabelES(selectedMonthKey)}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Pon límites sobre todo en gastos variables. Las categorías cubiertas solo por plantillas fijas no dan avisos salvo que se superen.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar editor de presupuestos"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {budgetModalError && (
          <div
            role="alert"
            className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs font-medium"
          >
            {budgetModalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Gastos variables (recomendado)
            </h3>
            <div className="space-y-2.5">{VARIABLE_CATS.map(renderCatRow)}</div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Suministros y gastos fijos (opcional)
              </h3>
              {fixedCatsWithDraft.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftLimits((prev) => {
                      const next = { ...prev };
                      for (const c of fixedCats) next[c] = '';
                      return next;
                    });
                  }}
                  className="min-h-[44px] px-2.5 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10"
                >
                  Quitar límites de fijos
                </button>
              )}
            </div>
            <div className="space-y-2.5">{fixedCats.map(renderCatRow)}</div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingBudget}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingBudget ? 'Guardando...' : 'Guardar límites'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
