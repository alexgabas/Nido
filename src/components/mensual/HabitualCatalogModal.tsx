import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { formatEUR, formatMonthLabelES } from '../../domain/finance';
import {
  EXPENSE_CATEGORY_LABELS,
  findMatchingRecurringForPreset,
  FREQUENCY_LABELS,
  RECURRING_CATALOG_GROUPS,
  RECURRING_CATALOG_PRESETS,
  VARIABLE_BUDGET_SUGGESTIONS,
  type RecurringCatalogPreset,
} from '../../domain/presets';
import { isSystemExpenseCategory } from '../../domain/categories';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type { MonthlyBudget, RecurringExpense } from '../../types/nido';

interface HabitualCatalogModalProps {
  open: boolean;
  selectedMonthKey: string;
  isClosed: boolean;
  recurring: RecurringExpense[];
  budget: MonthlyBudget | null;
  onSave: (
    presetsToAdd: RecurringCatalogPreset[],
    nextLimits: MonthlyBudget['limits'],
    budgetChanged: boolean
  ) => Promise<void>;
  onClose: () => void;
}

export const HabitualCatalogModal: React.FC<HabitualCatalogModalProps> = ({
  open,
  selectedMonthKey,
  isClosed,
  recurring,
  budget,
  onSave,
  onClose,
}) => {
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [selectedVariableIds, setSelectedVariableIds] = useState<Set<string>>(new Set());
  const [habitualVarBudgets, setHabitualVarBudgets] = useState<Record<string, string>>({});
  const [habitualError, setHabitualError] = useState<string | null>(null);
  const [savingHabitual, setSavingHabitual] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedCatalogIds(new Set());
    setSelectedVariableIds(new Set());
    const initBudgets: Record<string, string> = {};
    for (const cat of ['supermercado', 'transporte', 'ocio', 'otros'] as const) {
      const existingLimit = budget?.limits?.[cat];
      initBudgets[cat] = existingLimit && existingLimit > 0 ? String(existingLimit) : '';
    }
    setHabitualVarBudgets(initBudgets);
    setHabitualError(null);
  }, [open, budget]);

  if (!open) return null;

  const missingPresets = RECURRING_CATALOG_PRESETS.filter(
    (p) => !findMatchingRecurringForPreset(p, recurring)
  );
  const otrosItems = VARIABLE_BUDGET_SUGGESTIONS.filter((v) => v.category === 'otros');
  const existingOtros = budget?.limits?.otros;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const presetsToAdd = RECURRING_CATALOG_PRESETS.filter((p) => selectedCatalogIds.has(p.id));
    const nextLimits: MonthlyBudget['limits'] = {};
    if (budget?.limits) {
      for (const [k, v] of Object.entries(budget.limits)) {
        if (isSystemExpenseCategory(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          nextLimits[k] = v;
        }
      }
    }
    let budgetChanged = false;

    if (!isClosed) {
      for (const cat of ['supermercado', 'transporte', 'ocio', 'otros'] as const) {
        const raw = (habitualVarBudgets[cat] ?? '').trim();
        if (raw === '') continue;
        const parsed = Number(raw.replace(',', '.'));
        if (!Number.isFinite(parsed) || parsed < 0) {
          setHabitualError(
            `El presupuesto para ${EXPENSE_CATEGORY_LABELS[cat]} debe ser un número válido.`
          );
          return;
        }
        if (parsed > 0) {
          const rounded = Math.round(parsed * 100) / 100;
          if (nextLimits[cat] !== rounded) {
            nextLimits[cat] = rounded;
            budgetChanged = true;
          }
        }
      }
    }

    if (presetsToAdd.length === 0 && !budgetChanged) {
      setHabitualError(
        'Marca al menos un gasto habitual disponible o introduce un presupuesto orientativo mayor que 0.'
      );
      return;
    }

    setSavingHabitual(true);
    setHabitualError(null);
    try {
      await onSave(presetsToAdd, nextLimits, budgetChanged);
    } catch (err) {
      setHabitualError(
        toUserFriendlyErrorMessage(err, 'No se pudieron guardar los gastos habituales.')
      );
    } finally {
      setSavingHabitual(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="habitual-modal-title"
    >
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="habitual-modal-title" className="font-display text-lg font-bold">
              Añadir gastos habituales
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Las plantillas marcadas se añadirán pendientes de configurar (0 €, inactivas) para que pongáis vuestro importe real cuando queráis.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar catálogo de gastos habituales"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {habitualError && (
          <div
            role="alert"
            className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs font-medium"
          >
            {habitualError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Plantillas periódicas ({missingPresets.length} disponibles)
              </h3>
              {missingPresets.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedCatalogIds.size === missingPresets.length) {
                      setSelectedCatalogIds(new Set());
                    } else {
                      setSelectedCatalogIds(new Set(missingPresets.map((p) => p.id)));
                    }
                  }}
                  className="min-h-[44px] px-3 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10"
                >
                  {selectedCatalogIds.size === missingPresets.length
                    ? 'Desmarcar todas'
                    : 'Seleccionar disponibles'}
                </button>
              )}
            </div>

            {RECURRING_CATALOG_GROUPS.map((group) => {
              const items = RECURRING_CATALOG_PRESETS.filter((p) => p.group === group);
              return (
                <div key={group} className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">{group}</h4>
                  <div className="space-y-1.5">
                    {items.map((preset) => {
                      const existing = findMatchingRecurringForPreset(preset, recurring);
                      const checked = existing ? true : selectedCatalogIds.has(preset.id);
                      return (
                        <label
                          key={preset.id}
                          className={`flex items-start gap-3 rounded-xl border p-3 min-h-[44px] ${
                            existing
                              ? 'border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 opacity-75'
                              : 'border-slate-200 dark:border-slate-700 cursor-pointer hover:border-[#0E5A64]/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={Boolean(existing)}
                            checked={checked}
                            onChange={(ev) => {
                              setSelectedCatalogIds((prev) => {
                                const next = new Set(prev);
                                if (ev.target.checked) next.add(preset.id);
                                else next.delete(preset.id);
                                return next;
                              });
                            }}
                            className="w-4 h-4 mt-0.5 accent-[#0E5A64]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="text-sm font-semibold">{preset.concept}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {FREQUENCY_LABELS[preset.frequency]}
                                </span>
                                {existing && (
                                  <span className="px-2 py-0.5 rounded-md bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] text-[10px] font-bold">
                                    Ya añadido
                                  </span>
                                )}
                              </div>
                            </div>
                            {preset.hint && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {preset.hint}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Otras partidas que conviene recordar
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Reserva un presupuesto y registra las compras cuando se produzcan. No crean cobros periódicos.
              </p>
              {isClosed && (
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  {formatMonthLabelES(selectedMonthKey)} está cerrado: solo se añadirán las plantillas seleccionadas arriba.
                </p>
              )}
            </div>

            {(['supermercado', 'transporte', 'ocio'] as const).map((cat) => {
              const item = VARIABLE_BUDGET_SUGGESTIONS.find((v) => v.category === cat);
              if (!item) return null;
              const existingLimit = budget?.limits?.[cat];
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.concept}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Categoría {EXPENSE_CATEGORY_LABELS[cat]}
                      {existingLimit && existingLimit > 0
                        ? ` · Presupuesto actual: ${formatEUR(existingLimit)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label htmlFor={`hab-bud-${cat}`} className="sr-only">
                      Presupuesto mensual para {EXPENSE_CATEGORY_LABELS[cat]}
                    </label>
                    <input
                      id={`hab-bud-${cat}`}
                      type="text"
                      inputMode="decimal"
                      disabled={isClosed}
                      placeholder="Sin límite (€)"
                      value={habitualVarBudgets[cat] ?? ''}
                      onChange={(ev) =>
                        setHabitualVarBudgets((prev) => ({ ...prev, [cat]: ev.target.value }))
                      }
                      className="w-32 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right disabled:opacity-50"
                    />
                  </div>
                </div>
              );
            })}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Presupuesto conjunto para Otros</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Marca qué partidas quieres tener en mente para este mes (se agrupan en el límite único de «Otros»).
                    {existingOtros && existingOtros > 0 ? ` Actual: ${formatEUR(existingOtros)}.` : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  <label htmlFor="hab-bud-otros" className="sr-only">
                    Presupuesto mensual para Otros
                  </label>
                  <input
                    id="hab-bud-otros"
                    type="text"
                    inputMode="decimal"
                    disabled={isClosed}
                    placeholder="Sin límite (€)"
                    value={habitualVarBudgets.otros ?? ''}
                    onChange={(ev) =>
                      setHabitualVarBudgets((prev) => ({
                        ...prev,
                        otros: ev.target.value,
                      }))
                    }
                    className="w-32 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                {otrosItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 min-h-[44px] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedVariableIds.has(item.id)}
                      onChange={(ev) => {
                        setSelectedVariableIds((prev) => {
                          const next = new Set(prev);
                          if (ev.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        });
                      }}
                      className="w-4 h-4 accent-[#0E5A64]"
                    />
                    <span>{item.concept}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingHabitual}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingHabitual ? 'Guardando...' : 'Añadir seleccionados'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
