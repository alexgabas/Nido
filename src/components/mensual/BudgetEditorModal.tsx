import React, { useEffect, useMemo, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import {
  mergeMonthlyAndCustomBudgetLimits,
  planCopyPreviousMonthBudgets,
} from '../../domain/categories';
import { formatEUR, formatMonthLabelES, shiftMonthKey } from '../../domain/finance';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import {
  SYSTEM_EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type MonthlyBudget,
} from '../../types/nido';

interface BudgetEditorModalProps {
  open: boolean;
  selectedMonthKey: string;
  isClosed?: boolean;
  budget: MonthlyBudget | null;
  activeFixedByCategory: Partial<Record<ExpenseCategory, number>>;
  onSave: (limits: Record<string, number>) => Promise<void>;
  onClose: () => void;
}

const VARIABLE_CATS: readonly string[] = ['supermercado', 'transporte', 'ocio', 'otros'];

function parseDraftToLimitsMap(draft: Record<string, string>): Record<string, number> {
  const parsed: Record<string, number> = {};
  for (const [k, raw] of Object.entries(draft)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) {
      parsed[k] = Math.round(n * 100) / 100;
    }
  }
  return parsed;
}

export const BudgetEditorModal: React.FC<BudgetEditorModalProps> = ({
  open,
  selectedMonthKey,
  isClosed = false,
  budget,
  activeFixedByCategory,
  onSave,
  onClose,
}) => {
  const { householdId, repo, customCategories, categoryRegistry } = useNido();
  const [draftLimits, setDraftLimits] = useState<Record<string, string>>({});
  const [budgetModalError, setBudgetModalError] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);

  // Copy from previous month state
  const prevMonthKey = useMemo(() => shiftMonthKey(selectedMonthKey, -1), [selectedMonthKey]);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [prevCopyError, setPrevCopyError] = useState<string | null>(null);
  const [prevLimitsFetched, setPrevLimitsFetched] = useState<Record<string, number> | null>(null);
  const [prevCopyEmpty, setPrevCopyEmpty] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [copyAppliedNotice, setCopyAppliedNotice] = useState<string | null>(null);

  const editableCustomCats = useMemo(
    () =>
      categoryRegistry.allKnownCategories.filter(
        (c) =>
          !c.isSystem &&
          (!c.archived ||
            (budget?.limits !== undefined &&
              Object.prototype.hasOwnProperty.call(budget.limits, c.id)))
      ),
    [categoryRegistry.allKnownCategories, budget]
  );

  useEffect(() => {
    if (!open) return;
    const draft: Record<string, string> = {};
    for (const cat of SYSTEM_EXPENSE_CATEGORIES) {
      const hasVal =
        budget?.limits !== undefined && Object.prototype.hasOwnProperty.call(budget.limits, cat);
      const val = hasVal ? budget?.limits?.[cat] : undefined;
      draft[cat] = typeof val === 'number' && Number.isFinite(val) && val >= 0 ? String(val) : '';
    }
    for (const cat of editableCustomCats) {
      const hasVal =
        budget?.limits !== undefined &&
        Object.prototype.hasOwnProperty.call(budget.limits, cat.id);
      const val = hasVal ? budget?.limits?.[cat.id] : undefined;
      draft[cat.id] =
        typeof val === 'number' && Number.isFinite(val) && val >= 0 ? String(val) : '';
    }
    setDraftLimits(draft);
    setBudgetModalError(null);
    setPrevCopyError(null);
    setPrevLimitsFetched(null);
    setPrevCopyEmpty(false);
    setOverwriteExisting(false);
    setCopyAppliedNotice(null);
  }, [open, budget, editableCustomCats]);

  const currentDraftNumeric = useMemo(() => parseDraftToLimitsMap(draftLimits), [draftLimits]);

  const copyPlan = useMemo(() => {
    if (!prevLimitsFetched) return null;
    return planCopyPreviousMonthBudgets({
      prevLimits: prevLimitsFetched,
      currentLimits: currentDraftNumeric,
      customCategories,
      overwriteExisting,
    });
  }, [prevLimitsFetched, currentDraftNumeric, customCategories, overwriteExisting]);

  if (!open) return null;

  const fixedCats = SYSTEM_EXPENSE_CATEGORIES.filter((c) => !VARIABLE_CATS.includes(c));
  const fixedCatsWithDraft = fixedCats.filter((c) => {
    const raw = (draftLimits[c] ?? '').trim();
    if (raw === '') return false;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n >= 0;
  });

  const handleLoadPreviousMonth = async () => {
    if (isClosed || !householdId) return;
    setLoadingPrev(true);
    setPrevCopyError(null);
    setPrevCopyEmpty(false);
    setCopyAppliedNotice(null);
    setOverwriteExisting(false);
    try {
      const { systemBudget, categoryBudgets } = await repo.fetchMonthBudgets(
        householdId,
        prevMonthKey
      );
      const mergedPrev = mergeMonthlyAndCustomBudgetLimits(
        systemBudget,
        categoryBudgets,
        prevMonthKey
      );
      const prevLimits: Record<string, number> = {};
      if (mergedPrev?.limits) {
        for (const [k, v] of Object.entries(mergedPrev.limits)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            prevLimits[k] = v;
          }
        }
      }
      const plan = planCopyPreviousMonthBudgets({
        prevLimits,
        currentLimits: currentDraftNumeric,
        customCategories,
        overwriteExisting: false,
      });
      if (!plan.hasPreviousBudgets) {
        setPrevLimitsFetched(null);
        setPrevCopyEmpty(true);
      } else {
        setPrevLimitsFetched(prevLimits);
      }
    } catch (err) {
      setPrevCopyError(
        toUserFriendlyErrorMessage(
          err,
          `No se pudieron consultar los presupuestos de ${formatMonthLabelES(prevMonthKey)}.`
        )
      );
    } finally {
      setLoadingPrev(false);
    }
  };

  const handleApplyCopyPlan = () => {
    if (!copyPlan || isClosed) return;
    const appliedCount =
      copyPlan.toFill.length + (overwriteExisting ? copyPlan.toOverwrite.length : 0);
    setDraftLimits((prev) => {
      const next = { ...prev };
      for (const entry of copyPlan.toFill) {
        next[entry.categoryId] = String(entry.limit);
      }
      if (overwriteExisting) {
        for (const entry of copyPlan.toOverwrite) {
          next[entry.categoryId] = String(entry.limit);
        }
      }
      return next;
    });
    setPrevLimitsFetched(null);
    setOverwriteExisting(false);
    if (appliedCount > 0) {
      setCopyAppliedNotice(
        `Copiados ${appliedCount} ${
          appliedCount === 1 ? 'límite' : 'límites'
        } de ${formatMonthLabelES(prevMonthKey)} al borrador. Revisa los importes y pulsa «Guardar límites».`
      );
    } else {
      setCopyAppliedNotice(
        'No había categorías nuevas para rellenar. Los límites actuales se mantienen sin cambios.'
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isClosed) {
      setBudgetModalError('Este mes está cerrado. Desbloquéalo antes de editar los presupuestos.');
      return;
    }
    const limits: Record<string, number> = {};
    for (const [k, raw] of Object.entries(draftLimits)) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const n = Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        setBudgetModalError(
          `El límite de ${categoryRegistry.getLabel(k)} debe ser un número válido igual o mayor que 0.`
        );
        return;
      }
      limits[k] = Math.round(n * 100) / 100;
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

  const renderCatRow = (catId: string, label: string, archived = false) => {
    const fixedMonthly = activeFixedByCategory[catId] ?? 0;
    return (
      <div key={catId} className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={`bud-${catId}`} className="text-sm font-medium block">
            {label}
            {archived ? ' (Archivada)' : ''}
          </label>
          {fixedMonthly > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Fijo activo: {formatEUR(fixedMonthly)}/mes
            </p>
          )}
        </div>
        <input
          id={`bud-${catId}`}
          type="text"
          inputMode="decimal"
          placeholder="Sin límite"
          disabled={isClosed}
          value={draftLimits[catId] ?? ''}
          onChange={(e) => setDraftLimits((prev) => ({ ...prev, [catId]: e.target.value }))}
          className="w-32 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right shrink-0 disabled:opacity-50"
        />
      </div>
    );
  };

  const canApplyCopy =
    Boolean(copyPlan) &&
    (copyPlan!.toFill.length > 0 || (overwriteExisting && copyPlan!.toOverwrite.length > 0));

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
              Pon límites sobre todo en gastos variables. Dejar vacío significa sin límite; 0 €
              indica límite explícito de cero.
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

        {isClosed && (
          <div
            role="status"
            className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200"
          >
            Este mes está cerrado. No se pueden modificar ni copiar presupuestos mientras siga
            cerrado.
          </div>
        )}

        {!isClosed && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Reutilizar mes anterior
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Solo copia límites de presupuesto de {formatMonthLabelES(prevMonthKey)}, nunca
                  gastos ni cierres.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingPrev || savingBudget}
                onClick={() => void handleLoadPreviousMonth()}
                className="min-h-[44px] px-3.5 rounded-xl border border-[#0E5A64]/30 dark:border-[#5EEAD4]/30 bg-white dark:bg-[#132025] text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] flex items-center gap-1.5 disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{loadingPrev ? 'Consultando...' : 'Copiar del mes anterior'}</span>
              </button>
            </div>

            {prevCopyError && (
              <div
                role="alert"
                className="rounded-lg bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-2.5 text-xs font-medium"
              >
                {prevCopyError}
              </div>
            )}

            {prevCopyEmpty && (
              <div className="rounded-lg bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-300">
                No hay presupuestos guardados en {formatMonthLabelES(prevMonthKey)}. Puedes definir
                los límites manualmente para este mes.
              </div>
            )}

            {copyAppliedNotice && (
              <div
                role="status"
                className="rounded-lg bg-[#15803D]/10 text-[#15803D] dark:text-[#4ADE80] p-2.5 text-xs font-medium"
              >
                {copyAppliedNotice}
              </div>
            )}

            {copyPlan && (
              <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-700 p-3.5 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    Vista previa desde {formatMonthLabelES(prevMonthKey)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPrevLimitsFetched(null);
                      setOverwriteExisting(false);
                    }}
                    className="min-h-[36px] px-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Descartar
                  </button>
                </div>

                {copyPlan.toFill.length > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium text-[#15803D] dark:text-[#4ADE80]">
                      Se rellenarán {copyPlan.toFill.length}{' '}
                      {copyPlan.toFill.length === 1 ? 'categoría vacía' : 'categorías vacías'}:
                    </p>
                    <ul className="space-y-0.5 text-slate-700 dark:text-slate-300 pl-3 list-disc">
                      {copyPlan.toFill.map((entry) => (
                        <li key={entry.categoryId}>
                          {categoryRegistry.getLabel(entry.categoryId)}:{' '}
                          <span className="font-mono-num font-semibold">
                            {formatEUR(entry.limit)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-slate-600 dark:text-slate-400">
                    No hay categorías vacías nuevas que rellenar desde {formatMonthLabelES(prevMonthKey)}.
                  </p>
                )}

                {copyPlan.toOverwrite.length > 0 && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 p-2.5 space-y-2">
                    <p className="text-amber-900 dark:text-amber-200 font-medium">
                      {copyPlan.toOverwrite.length}{' '}
                      {copyPlan.toOverwrite.length === 1
                        ? 'categoría ya tiene límite distinto'
                        : 'categorías ya tienen límite distinto'}{' '}
                      este mes (no se sobrescriben por defecto):
                    </p>
                    <ul className="space-y-0.5 text-amber-900/90 dark:text-amber-200/90 pl-3 list-disc">
                      {copyPlan.toOverwrite.map((entry) => (
                        <li key={entry.categoryId}>
                          {categoryRegistry.getLabel(entry.categoryId)}: actual{' '}
                          <span className="font-mono-num">
                            {formatEUR(entry.previousCurrentLimit ?? 0)}
                          </span>{' '}
                          → anterior{' '}
                          <span className="font-mono-num font-semibold">
                            {formatEUR(entry.limit)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 pt-1 cursor-pointer min-h-[44px] py-1">
                      <input
                        type="checkbox"
                        checked={overwriteExisting}
                        onChange={(e) => setOverwriteExisting(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded accent-[#0E5A64]"
                      />
                      <span className="text-amber-950 dark:text-amber-100 font-semibold">
                        Confirmo sobrescribir también los límites ya existentes (
                        {copyPlan.toOverwrite.length})
                      </span>
                    </label>
                  </div>
                )}

                {copyPlan.unchanged.length > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {copyPlan.unchanged.length}{' '}
                    {copyPlan.unchanged.length === 1
                      ? 'categoría ya tenía el mismo límite.'
                      : 'categorías ya tenían el mismo límite.'}
                  </p>
                )}

                {copyPlan.skippedArchived.length > 0 && (
                  <div className="rounded-lg bg-slate-100 dark:bg-slate-800/70 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                    <p className="font-semibold">
                      Omitidas por estar archivadas (no se crean presupuestos nuevos):
                    </p>
                    <p>
                      {copyPlan.skippedArchived
                        .map((s) => `${s.name} (${formatEUR(s.prevLimit)})`)
                        .join(', ')}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!canApplyCopy}
                    onClick={handleApplyCopyPlan}
                    className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] text-white text-xs font-semibold disabled:opacity-40"
                  >
                    {overwriteExisting && copyPlan.toOverwrite.length > 0
                      ? `Confirmar y aplicar (${copyPlan.toFill.length + copyPlan.toOverwrite.length})`
                      : `Aplicar vacíos (${copyPlan.toFill.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
            <div className="space-y-2.5">
              {VARIABLE_CATS.map((catId) => renderCatRow(catId, categoryRegistry.getLabel(catId)))}
            </div>
          </div>

          {editableCustomCats.length > 0 && (
            <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Categorías personalizadas
              </h3>
              <div className="space-y-2.5">
                {editableCustomCats.map((cat) => renderCatRow(cat.id, cat.label, cat.archived))}
              </div>
            </div>
          )}

          <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Suministros y gastos fijos (opcional)
              </h3>
              {!isClosed && fixedCatsWithDraft.length > 0 && (
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
            <div className="space-y-2.5">
              {fixedCats.map((catId) => renderCatRow(catId, categoryRegistry.getLabel(catId)))}
            </div>
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
              disabled={savingBudget || isClosed}
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
