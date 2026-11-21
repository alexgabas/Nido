import React, { useEffect, useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import {
  computeRecurringHistoricalAverage,
  formatEUR,
  inferSplitChoice,
  resolveSplitPctForChoice,
} from '../../domain/finance';
import {
  EXPENSE_CATEGORY_LABELS,
  FREQUENCY_LABELS,
} from '../../domain/presets';
import { isValidMonthKey } from '../../domain/recurrence';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type HouseholdMember,
  type RecurrenceFrequency,
  type RecurringExpense,
  type SplitPresetChoice,
  type Transaction,
} from '../../types/nido';

interface RecurringTemplateModalProps {
  open: boolean;
  editingRec: RecurringExpense | null;
  activateOnOpen: boolean;
  selectedMonthKey: string;
  transactions?: Transaction[];
  memberA: HouseholdMember | undefined;
  memberB: HouseholdMember | undefined;
  viewerIsMemberA: boolean;
  effectiveSplitPctA: number;
  onSave: (
    payload: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onDeleteRequest: (rec: RecurringExpense) => void;
  onClose: () => void;
}

export const RecurringTemplateModal: React.FC<RecurringTemplateModalProps> = ({
  open,
  editingRec,
  activateOnOpen,
  selectedMonthKey,
  transactions = [],
  memberA,
  memberB,
  viewerIsMemberA,
  effectiveSplitPctA,
  onSave,
  onDeleteRequest,
  onClose,
}) => {
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('alquiler');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('mensual');
  const [day, setDay] = useState('1');
  const [startMonth, setStartMonth] = useState('');
  const [paidBy, setPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [splitChoice, setSplitChoice] = useState<SplitPresetChoice>('segun_reparto');
  const [customSplitA, setCustomSplitA] = useState('50');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConcept(editingRec?.concept ?? '');
    setCategory(editingRec?.category ?? 'alquiler');
    setAmount(editingRec ? (editingRec.amount > 0 ? String(editingRec.amount) : '') : '');
    setFrequency(editingRec?.frequency ?? 'mensual');
    setDay(editingRec ? String(editingRec.dayOfMonth) : '1');
    if (editingRec?.startMonth && isValidMonthKey(editingRec.startMonth)) {
      setStartMonth(editingRec.startMonth);
    } else if (!editingRec || activateOnOpen) {
      setStartMonth(selectedMonthKey);
    } else {
      setStartMonth('');
    }
    setPaidBy(editingRec?.paidByDefault ?? COMMON_ACCOUNT_ID);
    if (editingRec && editingRec.splitOverride !== null && editingRec.splitOverride !== undefined) {
      const inferred = inferSplitChoice(
        editingRec.splitOverride,
        viewerIsMemberA,
        effectiveSplitPctA
      );
      setSplitChoice(inferred);
      setCustomSplitA(String(editingRec.splitOverride));
    } else {
      setSplitChoice('segun_reparto');
      setCustomSplitA(String(effectiveSplitPctA));
    }
    setActive(activateOnOpen ? true : editingRec ? editingRec.active : true);
    setError(null);
  }, [open, editingRec, activateOnOpen, selectedMonthKey, viewerIsMemberA, effectiveSplitPctA]);

  if (!open) return null;

  const shortNameA = (memberA?.displayName?.trim() || 'Persona A').split(' ')[0];
  const shortNameB = (memberB?.displayName?.trim() || 'Pareja').split(' ')[0];
  const numericDay = Number(day);
  const needsStartMonth = active && frequency !== 'mensual';
  const histAvg = editingRec
    ? computeRecurringHistoricalAverage(transactions, editingRec.id, 3)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanConcept = concept.trim();
    if (!cleanConcept) {
      setError('Escribe un concepto para la plantilla.');
      return;
    }
    const rawAmount = amount.trim();
    const parsedAmount = rawAmount === '' ? 0 : Number(rawAmount.replace(',', '.'));
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError('Introduce un importe válido igual o mayor que 0.');
      return;
    }
    if (active && parsedAmount <= 0) {
      setError('Introduce un importe mayor que 0 para activar esta plantilla.');
      return;
    }
    const parsedDay = Number(day);
    if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      setError('El día de cobro debe estar entre 1 y 31.');
      return;
    }
    const cleanStartMonth = startMonth.trim();
    if (cleanStartMonth !== '' && !isValidMonthKey(cleanStartMonth)) {
      setError('El mes de referencia debe tener el formato AAAA-MM.');
      return;
    }
    if (needsStartMonth && !isValidMonthKey(cleanStartMonth)) {
      setError('Elige el mes de inicio/referencia para calcular cuándo toca este gasto periódico.');
      return;
    }

    const splitOverride =
      paidBy === COMMON_ACCOUNT_ID || splitChoice === 'segun_reparto'
        ? null
        : resolveSplitPctForChoice(
            splitChoice,
            viewerIsMemberA,
            effectiveSplitPctA,
            Number(customSplitA.replace(',', '.')) || effectiveSplitPctA
          );

    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: editingRec?.id,
        concept: cleanConcept,
        category,
        amount: Math.round(parsedAmount * 100) / 100,
        frequency,
        dayOfMonth: parsedDay,
        startMonth: cleanStartMonth,
        splitOverride,
        paidByDefault: paidBy,
        active,
      });
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar la plantilla recurrente.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rec-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 id="rec-modal-title" className="font-display text-lg font-bold">
          {editingRec ? 'Editar plantilla recurrente' : 'Nueva plantilla recurrente'}
        </h2>
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs font-medium"
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="rec-concept" className="block text-xs font-medium mb-1">
              Concepto
            </label>
            <input
              id="rec-concept"
              type="text"
              required
              maxLength={120}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rec-category" className="block text-xs font-medium mb-1">
                Categoría
              </label>
              <select
                id="rec-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rec-amount" className="block text-xs font-medium mb-1">
                Importe (€)
              </label>
              <input
                id="rec-amount"
                type="text"
                inputMode="decimal"
                placeholder={active ? 'Ej: 850' : '0'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm"
              />
            </div>
          </div>
          {histAvg && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
              <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                {histAvg.sampleCount === 1
                  ? `Último recibo registrado: ${formatEUR(histAvg.average)}`
                  : `Media últimas ${histAvg.sampleCount} facturas: ${formatEUR(histAvg.average)}`}
              </span>
              <button
                type="button"
                onClick={() => setAmount(String(histAvg.average).replace('.', ','))}
                className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] font-bold hover:bg-[#0E5A64]/20"
              >
                Usar media
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rec-frequency" className="block text-xs font-medium mb-1">
                Frecuencia
              </label>
              <select
                id="rec-frequency"
                value={frequency}
                onChange={(e) => {
                  const nextFreq = e.target.value as RecurrenceFrequency;
                  setFrequency(nextFreq);
                  if (nextFreq !== 'mensual' && !startMonth && !editingRec) {
                    setStartMonth(selectedMonthKey);
                  }
                }}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rec-day" className="block text-xs font-medium mb-1">
                Día de cobro (1-31)
              </label>
              <input
                id="rec-day"
                type="number"
                min={1}
                max={31}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>
          {Number.isInteger(numericDay) && numericDay >= 29 && numericDay <= 31 && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2.5 py-1.5">
              En meses con menos días (como febrero o meses de 30 días), el cobro se ajustará automáticamente al último día del mes.
            </p>
          )}
          <div>
            <label htmlFor="rec-start-month" className="block text-xs font-medium mb-1">
              Mes de inicio / referencia {needsStartMonth ? '(obligatorio)' : '(opcional)'}
            </label>
            <input
              id="rec-start-month"
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {frequency === 'mensual'
                ? 'Si lo indicas, solo se incluirá a partir de ese mes.'
                : `Marca el mes base desde el que se repite (${FREQUENCY_LABELS[frequency].toLowerCase()}).`}
            </p>
            {needsStartMonth && !isValidMonthKey(startMonth) && (
              <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1 inline-flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Confirma este mes para saber qué meses toca generarlo y mostrarlo en el calendario.</span>
              </p>
            )}
          </div>
          <div>
            <label htmlFor="rec-paid-by" className="block text-xs font-medium mb-1">
              Pagado por defecto
            </label>
            <select
              id="rec-paid-by"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
              {memberA && <option value={memberA.uid}>{shortNameA}</option>}
              {memberB && <option value={memberB.uid}>{shortNameB}</option>}
            </select>
          </div>
          {paidBy === COMMON_ACCOUNT_ID ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Al pagarse desde Cuenta común se asume como gasto conjunto del hogar sin deuda entre miembros.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="rec-split-choice" className="block text-xs font-medium">
                Reparto de este gasto fijo
              </label>
              <select
                id="rec-split-choice"
                value={splitChoice}
                onChange={(e) => setSplitChoice(e.target.value as SplitPresetChoice)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="segun_reparto">
                  Según reparto del hogar ({effectiveSplitPctA}% /{' '}
                  {Math.round((100 - effectiveSplitPctA) * 10) / 10}%)
                </option>
                <option value="a_medias">A medias (50% / 50%)</option>
                <option value="solo_yo">
                  Lo asumo yo ({viewerIsMemberA ? shortNameA : shortNameB} · 100%)
                </option>
                <option value="solo_pareja">
                  Lo asume {viewerIsMemberA ? shortNameB : shortNameA} (100%)
                </option>
                <option value="personalizado">Personalizado</option>
              </select>
              {splitChoice === 'personalizado' && (
                <div className="flex items-center gap-2">
                  <label htmlFor="rec-custom-split" className="text-xs text-slate-600 dark:text-slate-300">
                    % para {shortNameA}:
                  </label>
                  <input
                    id="rec-custom-split"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={customSplitA}
                    onChange={(e) => setCustomSplitA(e.target.value)}
                    className="w-24 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-right"
                  />
                </div>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm pt-1">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 accent-[#0E5A64]"
            />
            <span>Plantilla activa (se incluye en previsiones y calendario)</span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {editingRec && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDeleteRequest(editingRec);
                  }}
                  className="min-h-[44px] px-3 rounded-xl text-[#B42318] dark:text-[#FCA5A5] text-xs font-semibold hover:bg-[#B42318]/10 inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar plantilla</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
