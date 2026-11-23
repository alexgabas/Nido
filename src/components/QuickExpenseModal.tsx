import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Delete,
  Lock,
  Wallet,
  X,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { pickSimpleWizardCategories } from '../domain/categories';
import {
  clampSplitPct,
  computeRecurringHistoricalAverage,
  formatDateES,
  formatEUR,
  getTodayLocalISO,
  inferSplitChoice,
  resolveSplitPctForChoice,
} from '../domain/finance';
import { globalSearchSessionCache } from '../domain/globalSearch';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type ExpensePrefill,
  type SplitPresetChoice,
  type Transaction,
} from '../types/nido';
import { CategoryIcon } from './CategoryIcon';

interface QuickExpenseModalProps {
  open: boolean;
  onClose: () => void;
  editingTx?: Transaction | null;
  prefill?: ExpensePrefill | null;
  onSaved?: (() => Promise<void> | void) | null;
}

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'BACK'] as const;

const AVANZADO_SPLIT_OPTIONS: Array<{
  id: SplitPresetChoice;
  label: string;
  helper?: string;
}> = [
  { id: 'segun_reparto', label: 'Según reparto' },
  { id: 'a_medias', label: 'A medias' },
  {
    id: 'solo_yo',
    label: 'Lo pago y asumo yo (cuenta en el hogar)',
    helper: 'Lo ve tu pareja y suma al total del hogar, pero el 100 % te corresponde a ti.',
  },
  {
    id: 'solo_pareja',
    label: 'Solo mi pareja',
    helper: 'Suma al total del hogar, pero el 100 % corresponde a tu pareja.',
  },
  { id: 'personalizado', label: 'Personalizado' },
];

function getInitials(name: string | undefined): string {
  const clean = (name || 'U').trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export const QuickExpenseModal: React.FC<QuickExpenseModalProps> = ({
  open,
  onClose,
  editingTx = null,
  prefill = null,
  onSaved = null,
}) => {
  const {
    householdId,
    currentUserProfile,
    currentMember,
    memberA,
    memberB,
    effectiveSplitPctA,
    selectedMonthKey,
    monthClosures,
    recentTransactions,
    monthTransactions,
    categoryRegistry,
    uiMode,
    repo,
    showToast,
  } = useNido();

  const viewerIsMemberA = currentMember
    ? currentMember.role !== 'member_b'
    : !memberB || currentUserProfile?.uid !== memberB.uid;

  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [showAllSimpleCats, setShowAllSimpleCats] = useState(false);
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [conceptTouched, setConceptTouched] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('supermercado');
  const [paidBy, setPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [date, setDate] = useState(getTodayLocalISO());
  const [splitChoice, setSplitChoice] = useState<SplitPresetChoice>('segun_reparto');
  const [splitPctInput, setSplitPctInput] = useState(() => String(effectiveSplitPctA));
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const isSimpleWizard = uiMode === 'sencillo' && !editingTx;
  const isSimpleEdit = uiMode === 'sencillo' && Boolean(editingTx);

  const createdByPartner = Boolean(
    editingTx?.id &&
      editingTx.createdBy &&
      currentUserProfile?.uid &&
      editingTx.createdBy !== currentUserProfile.uid
  );

  const simpleWizardCats = useMemo(
    () => pickSimpleWizardCategories(categoryRegistry.activeCategories, recentTransactions, 8),
    [categoryRegistry.activeCategories, recentTransactions]
  );

  const editableCategories = useMemo(() => {
    const active = categoryRegistry.activeCategories;
    if (!category || active.some((c) => c.id === category)) return active;
    return [...active, categoryRegistry.getMeta(category)];
  }, [categoryRegistry, category]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setWizardStep(1);
    setShowAllSimpleCats(false);
    if (editingTx) {
      setConceptTouched(false);
      const clampedSplit = clampSplitPct(editingTx.splitPctA, effectiveSplitPctA);
      setAmount(String(editingTx.amount));
      setConcept(editingTx.concept);
      setCategory(editingTx.category === 'liquidacion' ? 'otros' : editingTx.category);
      setPaidBy(editingTx.paidBy === 'comun' ? COMMON_ACCOUNT_ID : editingTx.paidBy);
      setDate(editingTx.date);
      setSplitPctInput(String(clampedSplit));
      setSplitChoice(inferSplitChoice(clampedSplit, viewerIsMemberA, effectiveSplitPctA));
      setIsPrivate(Boolean(editingTx.isPrivate));
      setNotes(editingTx.notes);
    } else {
      const today = getTodayLocalISO();
      const validPrefillDate =
        prefill?.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : null;
      const defaultDate =
        validPrefillDate ??
        (uiMode === 'sencillo'
          ? today
          : today.startsWith(selectedMonthKey)
            ? today
            : `${selectedMonthKey}-01`);
      const defaultSplit =
        prefill?.splitPctA !== undefined
          ? clampSplitPct(prefill.splitPctA, effectiveSplitPctA)
          : clampSplitPct(effectiveSplitPctA, 50);
      const initialCategory = prefill?.category ?? 'supermercado';
      const initialConcept =
        prefill?.concept ??
        (uiMode === 'sencillo' ? categoryRegistry.getLabel(initialCategory) : '');
      setConceptTouched(Boolean(prefill?.concept));
      setAmount(prefill?.amount ? prefill.amount.trim().replace('.', ',') : '');
      setConcept(initialConcept);
      setCategory(initialCategory);
      setPaidBy(prefill?.paidBy || currentUserProfile?.uid || memberA?.uid || COMMON_ACCOUNT_ID);
      setDate(defaultDate);
      setSplitChoice(inferSplitChoice(defaultSplit, viewerIsMemberA, effectiveSplitPctA));
      setSplitPctInput(String(defaultSplit));
      setIsPrivate(false);
      setNotes(prefill?.notes ?? '');
    }
  }, [
    open,
    editingTx,
    prefill,
    selectedMonthKey,
    currentUserProfile,
    memberA,
    effectiveSplitPctA,
    uiMode,
    viewerIsMemberA,
    categoryRegistry,
  ]);

  const appendKeypadChar = (key: string) => {
    setError(null);
    setAmount((prev) => {
      if (key === 'BACK') {
        return prev.slice(0, -1);
      }
      if (key === ',') {
        if (prev.includes(',')) return prev;
        return prev === '' ? '0,' : `${prev},`;
      }
      if (prev.includes(',')) {
        const [, decimals] = prev.split(',');
        if (decimals !== undefined && decimals.length >= 2) return prev;
      }
      if (prev === '0') {
        return key === '0' ? '0' : key;
      }
      if (prev.replace(',', '').length >= 7) return prev;
      return `${prev}${key}`;
    });
  };

  useEffect(() => {
    if (!open || !isSimpleWizard || wizardStep !== 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        appendKeypadChar(e.key);
      } else if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        appendKeypadChar(',');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        appendKeypadChar('BACK');
      } else if (e.key === 'Enter') {
        const numeric = Number(amount.replace(',', '.'));
        if (Number.isFinite(numeric) && numeric > 0) {
          e.preventDefault();
          setWizardStep(2);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSimpleWizard, wizardStep, amount]);

  if (!open) return null;

  const validPrefillDate =
    prefill?.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : null;
  const targetDate = isSimpleWizard ? (validPrefillDate ?? getTodayLocalISO()) : date;
  const targetMonthKey = targetDate.slice(0, 7);
  const isTargetClosed = monthClosures.some((c) => c.monthKey === targetMonthKey);
  const isOriginClosed = Boolean(
    editingTx && monthClosures.some((c) => c.monthKey === editingTx.monthKey)
  );
  const isClosed = isTargetClosed || isOriginClosed;

  const numericAmount = Number(amount.replace(',', '.'));
  const hasValidAmount = Number.isFinite(numericAmount) && numericAmount > 0;
  const linkedRecurringId = editingTx?.recurringId ?? prefill?.recurringId ?? null;
  const recurringHistAvg = linkedRecurringId
    ? computeRecurringHistoricalAverage(
        [...recentTransactions, ...monthTransactions],
        linkedRecurringId,
        3
      )
    : null;

  const handleSelectSimpleCategory = (cat: ExpenseCategory) => {
    setCategory(cat);
    if (!conceptTouched || !concept.trim()) {
      setConcept(categoryRegistry.getLabel(cat));
    }
    setError(null);
    setWizardStep(3);
  };

  const handleSelectSplitChoice = (choice: SplitPresetChoice) => {
    setSplitChoice(choice);
    if (choice !== 'personalizado') {
      const resolved = resolveSplitPctForChoice(choice, viewerIsMemberA, effectiveSplitPctA);
      setSplitPctInput(String(resolved));
    }
  };

  const handleTogglePrivate = (nextPrivate: boolean) => {
    if (nextPrivate && createdByPartner) return;
    setIsPrivate(nextPrivate);
    if (nextPrivate && currentUserProfile) {
      setPaidBy(currentUserProfile.uid);
    }
  };

  const saveTransaction = async () => {
    if (!householdId || !currentUserProfile || savingRef.current) return;
    if (!hasValidAmount) {
      setError('Introduce un importe mayor que 0.');
      return;
    }
    const cleanConcept = concept.trim() || (isSimpleWizard ? categoryRegistry.getLabel(category) : '');
    if (!cleanConcept) {
      setError('Escribe un concepto breve (ej. Compra Bonpreu).');
      return;
    }
    if (isClosed) {
      setError(
        uiMode === 'sencillo'
          ? 'Este mes está cerrado y no admite cambios.'
          : `El mes ${isOriginClosed ? editingTx?.monthKey : targetMonthKey} está cerrado. Desbloquéalo antes para editar.`
      );
      return;
    }

    let safeSplitPctA = clampSplitPct(effectiveSplitPctA, 50);
    if (isPrivate) {
      safeSplitPctA = viewerIsMemberA ? 100 : 0;
    } else if (splitChoice === 'personalizado' && !isSimpleWizard && !isSimpleEdit) {
      const rawSplit = splitPctInput.trim().replace(',', '.');
      if (rawSplit === '') {
        setError('Introduce un porcentaje entre 0 % y 100 %.');
        return;
      }
      const numSplit = Number(rawSplit);
      if (!Number.isFinite(numSplit) || numSplit < 0 || numSplit > 100) {
        setError('El reparto debe estar entre 0 % y 100 %.');
        return;
      }
      safeSplitPctA = clampSplitPct(numSplit, effectiveSplitPctA);
    } else if (isSimpleWizard) {
      safeSplitPctA =
        prefill?.splitPctA !== undefined
          ? clampSplitPct(prefill.splitPctA, effectiveSplitPctA)
          : clampSplitPct(effectiveSplitPctA, 50);
    } else if (isSimpleEdit && editingTx) {
      safeSplitPctA = clampSplitPct(editingTx.splitPctA, effectiveSplitPctA);
    } else {
      safeSplitPctA = resolveSplitPctForChoice(
        splitChoice,
        viewerIsMemberA,
        effectiveSplitPctA,
        splitPctInput
      );
    }

    const safePaidBy = isPrivate ? (editingTx?.createdBy || currentUserProfile.uid) : paidBy;

    savingRef.current = true;
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
          amount: Math.round(numericAmount * 100) / 100,
          date: targetDate,
          paidBy: safePaidBy,
          recurringId: editingTx?.recurringId ?? prefill?.recurringId ?? null,
          splitPctA: safeSplitPctA,
          isSettlement: false,
          settlementTo: '',
          isPrivate,
          createdBy: editingTx?.createdBy || currentUserProfile.uid,
          notes: notes.trim(),
        },
        currentUserProfile
      );
      globalSearchSessionCache.invalidateHousehold(householdId);
      if (onSaved) {
        try {
          await onSaved();
        } catch {
          showToast('Gasto guardado, pero no se pudieron limpiar los artículos marcados.');
          onClose();
          return;
        }
      }
      showToast(editingTx ? 'Gasto actualizado' : 'Gasto guardado');
      onClose();
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar el gasto. Inténtalo de nuevo.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveTransaction();
  };

  const fullNameA = memberA?.displayName?.trim() || 'Alex';
  const fullNameB = memberB?.displayName?.trim() || 'Pareja';
  const shortNameA = fullNameA.split(' ')[0];
  const shortNameB = fullNameB.split(' ')[0];

  const previewSplitPctA = resolveSplitPctForChoice(
    splitChoice,
    viewerIsMemberA,
    effectiveSplitPctA,
    splitPctInput
  );
  const previewSplitPctB = Math.round((100 - previewSplitPctA) * 10) / 10;

  const activeSplitOption = AVANZADO_SPLIT_OPTIONS.find((o) => o.id === splitChoice);

  // ─── MODO SENCILLO: FULL-SCREEN 3-STEP WIZARD ──────────────────────────────
  if (isSimpleWizard) {
    const formattedAmountDisplay = amount ? `${amount} €` : '0 €';

    return (
      <div
        className="fixed inset-0 z-50 bg-[#F6F8F8] dark:bg-[#0B1316] text-[#0F1F24] dark:text-[#F0F5F6] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-expense-title"
      >
        {/* Top bar */}
        <header className="h-14 px-3 sm:px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] shrink-0">
          {wizardStep > 1 ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setWizardStep((s) => (s === 3 ? 2 : 1));
              }}
              className="min-h-[44px] px-2.5 rounded-xl flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Atrás</span>
            </button>
          ) : (
            <div className="w-16" />
          )}

          <div className="flex flex-col items-center">
            <span id="simple-expense-title" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Paso {wizardStep} de 3
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              {[1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 rounded-full transition-all ${
                    step <= wizardStep
                      ? 'w-6 bg-[#0E5A64] dark:bg-[#5EEAD4]'
                      : 'w-4 bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar asistente"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col justify-between max-w-md w-full mx-auto">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-4 py-3 text-sm font-medium"
            >
              {error}
            </div>
          )}

          {/* PASO 1: IMPORTE CON TECLADO NUMÉRICO GRANDE */}
          {wizardStep === 1 && (
            <div className="flex-1 flex flex-col justify-between gap-4">
              <div className="text-center pt-4 space-y-2">
                <p className="text-base font-semibold text-slate-600 dark:text-slate-300">
                  ¿Cuánto ha costado?
                </p>
                {notes.trim() && (
                  <p className="text-xs text-[#0E5A64] dark:text-[#5EEAD4] font-medium px-3">
                    {notes}
                  </p>
                )}
                <div
                  aria-live="polite"
                  className={`font-display text-5xl sm:text-6xl font-bold tabular-nums tracking-tight py-3 ${
                    amount ? 'text-[#0F1F24] dark:text-[#F0F5F6]' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {formattedAmountDisplay}
                </div>
                {recurringHistAvg && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(recurringHistAvg.average).replace('.', ','))}
                    className="min-h-[44px] px-3.5 rounded-xl border border-[#0E5A64]/35 bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-bold"
                  >
                    {recurringHistAvg.sampleCount === 1
                      ? `Último recibo: ${formatEUR(recurringHistAvg.average)} · Usar`
                      : `Media últimas ${recurringHistAvg.sampleCount} facturas: ${formatEUR(recurringHistAvg.average)} · Usar`}
                  </button>
                )}
              </div>

              <div className="space-y-4 pb-2">
                <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Teclado numérico">
                  {KEYPAD_KEYS.map((key) => {
                    const isBack = key === 'BACK';
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={isBack ? 'Borrar dígito' : key === ',' ? 'Coma decimal' : key}
                        onClick={() => appendKeypadChar(key)}
                        className="min-h-[58px] rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 text-2xl font-bold tabular-nums flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-[0.97] transition-all"
                      >
                        {isBack ? <Delete className="w-6 h-6 text-slate-600 dark:text-slate-300" /> : key}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={!hasValidAmount}
                  onClick={() => setWizardStep(2)}
                  className="w-full min-h-[54px] rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-base font-bold transition-colors"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}

          {/* PASO 2: CATEGORÍA (MÁXIMO 8 PRINCIPALES + MÁS CATEGORÍAS) */}
          {wizardStep === 2 && (
            <div className="flex-1 flex flex-col justify-between gap-4">
              <div className="space-y-4">
                <div className="text-center space-y-1">
                  <p className="font-mono-num text-lg font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                    {formatEUR(numericAmount)}
                  </p>
                  <h2 className="font-display text-2xl font-bold">¿En qué lo habéis gastado?</h2>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {simpleWizardCats.primaryCategories.map((item) => {
                    const active = category === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSimpleCategory(item.id)}
                        className={`relative min-h-[82px] p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                          active
                            ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] hover:border-[#0E5A64]/40'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <CategoryIcon icon={item.icon} className="w-7 h-7" />
                        <span className="text-sm font-bold text-center leading-tight line-clamp-2">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {simpleWizardCats.overflowCategories.length > 0 && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowAllSimpleCats((v) => !v)}
                      className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center justify-center gap-1.5"
                    >
                      <span>
                        {showAllSimpleCats
                          ? 'Ocultar otras categorías'
                          : `Más categorías (${simpleWizardCats.overflowCategories.length})`}
                      </span>
                      {showAllSimpleCats ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>

                    {showAllSimpleCats && (
                      <div className="grid grid-cols-2 gap-2.5">
                        {simpleWizardCats.overflowCategories.map((item) => {
                          const active = category === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleSelectSimpleCategory(item.id)}
                              className={`min-h-[54px] px-3 py-2.5 rounded-xl border flex items-center gap-2.5 text-left transition-all ${
                                active
                                  ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6]'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: item.color }}
                              />
                              <CategoryIcon icon={item.icon} className="w-4 h-4 shrink-0" />
                              <span className="text-xs font-bold truncate">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleSelectSimpleCategory(category)}
                className="w-full min-h-[54px] rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-base font-bold transition-colors"
              >
                Siguiente
              </button>
            </div>
          )}

          {/* PASO 3: QUIÉN PAGÓ + OPCIÓN SEGÚN REPARTO vs PRIVADO (SIN SOLO YO) */}
          {wizardStep === 3 && (
            <div className="flex-1 flex flex-col justify-between gap-5">
              <div className="space-y-4">
                <div className="text-center space-y-1">
                  <p className="font-mono-num text-lg font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                    {formatEUR(numericAmount)} · {categoryRegistry.getLabel(category)}
                  </p>
                  <h2 className="font-display text-2xl font-bold">
                    {isPrivate ? 'Gasto privado' : '¿Quién lo ha pagado?'}
                  </h2>
                </div>

                {!isPrivate && (
                  <div className="space-y-2.5">
                    {memberA && (
                      <button
                        type="button"
                        onClick={() => setPaidBy(memberA.uid)}
                        className={`w-full min-h-[64px] px-4 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                          paidBy === memberA.uid
                            ? 'border-[#0E5A64] bg-[#0E5A64]/10 dark:bg-[#0E5A64]/20'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {memberA.photoURL ? (
                            <img
                              src={memberA.photoURL}
                              alt={fullNameA}
                              className="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-[#0E5A64] text-white text-sm font-bold flex items-center justify-center shrink-0">
                              {getInitials(fullNameA)}
                            </span>
                          )}
                          <span className="text-base font-bold truncate">{fullNameA}</span>
                        </div>
                        {paidBy === memberA.uid && (
                          <Check className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
                        )}
                      </button>
                    )}

                    {memberB && (
                      <button
                        type="button"
                        onClick={() => setPaidBy(memberB.uid)}
                        className={`w-full min-h-[64px] px-4 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                          paidBy === memberB.uid
                            ? 'border-[#0E5A64] bg-[#0E5A64]/10 dark:bg-[#0E5A64]/20'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {memberB.photoURL ? (
                            <img
                              src={memberB.photoURL}
                              alt={fullNameB}
                              className="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-[#15803D] text-white text-sm font-bold flex items-center justify-center shrink-0">
                              {getInitials(fullNameB)}
                            </span>
                          )}
                          <span className="text-base font-bold truncate">{fullNameB}</span>
                        </div>
                        {paidBy === memberB.uid && (
                          <Check className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setPaidBy(COMMON_ACCOUNT_ID)}
                      className={`w-full min-h-[64px] px-4 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                        paidBy === COMMON_ACCOUNT_ID
                          ? 'border-[#0E5A64] bg-[#0E5A64]/10 dark:bg-[#0E5A64]/20'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
                          <Wallet className="w-5 h-5" />
                        </span>
                        <span className="text-base font-bold">Cuenta común</span>
                      </div>
                      {paidBy === COMMON_ACCOUNT_ID && (
                        <Check className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
                      )}
                    </button>
                  </div>
                )}

                {/* Modo Sencillo: SOLO "Según reparto" y "Privado (no lo ve mi pareja)" */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Tipo de gasto
                  </span>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleTogglePrivate(false);
                        handleSelectSplitChoice('segun_reparto');
                      }}
                      className={`min-h-[56px] p-3.5 rounded-2xl border text-left transition-colors ${
                        !isPrivate
                          ? 'border-[#0E5A64] bg-[#0E5A64]/10 dark:bg-[#0E5A64]/20'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                      }`}
                    >
                      <p className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                        Según reparto
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Se comparte entre los dos según vuestro reparto del hogar.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePrivate(true)}
                      className={`min-h-[56px] p-3.5 rounded-2xl border text-left transition-colors ${
                        isPrivate
                          ? 'border-[#0E5A64] bg-[#0E5A64]/10 dark:bg-[#0E5A64]/20'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025]'
                      }`}
                    >
                      <p className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6] flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Privado (no lo ve mi pareja)</span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Solo lo ves tú y no entra en el reparto ni en los totales del hogar.
                      </p>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="simple-tx-concept"
                    className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
                  >
                    Concepto (opcional)
                  </label>
                  <input
                    id="simple-tx-concept"
                    type="text"
                    maxLength={120}
                    value={concept}
                    onChange={(e) => {
                      setConceptTouched(true);
                      setConcept(e.target.value);
                    }}
                    placeholder={categoryRegistry.getLabel(category)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm font-medium"
                  />
                  {notes.trim() && (
                    <p className="text-xs text-[#0E5A64] dark:text-[#5EEAD4] mt-1.5">
                      Nota incluida: {notes}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {targetDate === getTodayLocalISO()
                      ? 'Se guardará con fecha de hoy.'
                      : `Se guardará con fecha ${formatDateES(targetDate)}.`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={saving || isClosed}
                onClick={() => void saveTransaction()}
                className="w-full min-h-[54px] rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-base font-bold transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar gasto'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── MODO SENCILLO: EDICIÓN SIMPLIFICADA (SIN SOLO YO, SIN % NI URL) ──────
  if (isSimpleEdit) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-edit-expense-title"
      >
        <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 id="simple-edit-expense-title" className="font-display text-lg font-bold">
              Editar gasto
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
                <label htmlFor="simple-edit-amount" className="block text-xs font-medium mb-1">
                  Importe (€)
                </label>
                <input
                  id="simple-edit-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xl font-bold"
                />
              </div>
              <div>
                <label htmlFor="simple-edit-concept" className="block text-xs font-medium mb-1">
                  Concepto
                </label>
                <input
                  id="simple-edit-concept"
                  type="text"
                  required
                  maxLength={120}
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
            {recurringHistAvg && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                  {recurringHistAvg.sampleCount === 1
                    ? `Último recibo de esta plantilla: ${formatEUR(recurringHistAvg.average)}`
                    : `Media últimas ${recurringHistAvg.sampleCount} facturas: ${formatEUR(recurringHistAvg.average)}`}
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(String(recurringHistAvg.average).replace('.', ','))}
                  className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] font-bold"
                >
                  Usar media
                </button>
              </div>
            )}

            <div>
              <label htmlFor="simple-edit-cat" className="block text-xs font-medium mb-1">
                Categoría
              </label>
              <select
                id="simple-edit-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {editableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                    {cat.archived ? ' (Archivada)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {!isPrivate && (
              <div>
                <span className="block text-xs font-medium mb-1.5">Quién pagó</span>
                <div className="grid grid-cols-3 gap-2">
                  {memberA && (
                    <button
                      type="button"
                      onClick={() => setPaidBy(memberA.uid)}
                      className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border truncate ${
                        paidBy === memberA.uid
                          ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {fullNameA}
                    </button>
                  )}
                  {memberB && (
                    <button
                      type="button"
                      onClick={() => setPaidBy(memberB.uid)}
                      className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border truncate ${
                        paidBy === memberB.uid
                          ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {fullNameB}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPaidBy(COMMON_ACCOUNT_ID)}
                    className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border truncate ${
                      paidBy === COMMON_ACCOUNT_ID
                        ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Cuenta común
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <span className="block text-xs font-medium">Tipo de gasto</span>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleTogglePrivate(false)}
                  className={`min-h-[52px] p-3 rounded-xl border text-left ${
                    !isPrivate
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-bold">Según reparto</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Visible para los dos y repartido según el acuerdo del hogar.
                  </p>
                </button>
                <button
                  type="button"
                  disabled={createdByPartner}
                  onClick={() => handleTogglePrivate(true)}
                  className={`min-h-[52px] p-3 rounded-xl border text-left ${
                    createdByPartner ? 'opacity-60 cursor-not-allowed' : ''
                  } ${
                    isPrivate
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-bold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Privado (no lo ve mi pareja)</span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {createdByPartner
                      ? 'Solo quien creó este gasto puede marcarlo como privado.'
                      : 'Solo visible para ti; excluido del reparto y las cuentas del hogar.'}
                  </p>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="simple-edit-date" className="block text-xs font-medium mb-1">
                Fecha
              </label>
              <input
                id="simple-edit-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={saving || isClosed}
              className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-bold"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── MODO AVANZADO: MODAL COMPLETO CON REPARTO PUNTUAL Y PRIVADO ───────────
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
            {editingTx ? 'Editar gasto' : 'Añadir gasto'}
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

          {recurringHistAvg && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
              <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                {recurringHistAvg.sampleCount === 1
                  ? `Último recibo registrado: ${formatEUR(recurringHistAvg.average)}`
                  : `Media últimas ${recurringHistAvg.sampleCount} facturas: ${formatEUR(recurringHistAvg.average)}`}
              </span>
              <button
                type="button"
                onClick={() => setAmount(String(recurringHistAvg.average).replace('.', ','))}
                className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] font-bold hover:bg-[#0E5A64]/20"
              >
                Usar media
              </button>
            </div>
          )}

          <div>
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Categoría
            </span>
            <div className="flex flex-wrap gap-1.5">
              {editableCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                    category === cat.id
                      ? 'bg-[#0E5A64] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span>
                    {cat.label}
                    {cat.archived ? ' (Archivada)' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Privado (no lo ve mi pareja) */}
          <label
            className={`min-h-[52px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between gap-3 ${
              createdByPartner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
                  Privado (no lo ve mi pareja)
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {createdByPartner
                    ? 'Solo quien creó este gasto puede marcarlo como privado.'
                    : 'Excluido del reparto, saldos, totales del hogar y exportaciones de tu pareja.'}
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={createdByPartner}
              checked={isPrivate}
              onChange={(e) => handleTogglePrivate(e.target.checked)}
              className="w-5 h-5 accent-[#0E5A64] shrink-0"
            />
          </label>

          {!isPrivate && (
            <>
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
                      {fullNameA}
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
                      {fullNameB}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPaidBy(COMMON_ACCOUNT_ID)}
                    className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold border transition-colors truncate ${
                      paidBy === COMMON_ACCOUNT_ID
                        ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    Cuenta común
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Reparto puntual de este gasto
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {shortNameA} {previewSplitPctA}% · {shortNameB} {previewSplitPctB}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AVANZADO_SPLIT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectSplitChoice(opt.id)}
                      className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
                        splitChoice === opt.id
                          ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {activeSplitOption?.helper ||
                    'Lo pago y asumo yo (cuenta en el hogar): lo ve tu pareja y suma al hogar, pero el 100 % te corresponde a ti.'}
                </p>
                {splitChoice === 'personalizado' && (
                  <div className="pt-1">
                    <label
                      htmlFor="tx-split"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Porcentaje para {shortNameA} (%)
                    </label>
                    <input
                      id="tx-split"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={splitPctInput}
                      onChange={(e) => setSplitPctInput(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
                    />
                  </div>
                )}
              </div>
            </>
          )}

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
              <label htmlFor="tx-notes" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Notas o enlace de ticket
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
