import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Lock,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { BankCsvImportModal } from '../components/BankCsvImportModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QuickExpenseModal } from '../components/QuickExpenseModal';
import { useNido } from '../context/NidoContext';
import { downloadTextFile, generateSpanishCSV } from '../domain/backup';
import {
  calculateCoupleBalance,
  clampSplitPct,
  computeBudgetProgress,
  computeCategoryComparison,
  daysInMonth,
  filterGlobalTransactions,
  findMissingRecurringForMonth,
  formatCoupleBalanceSecondPerson,
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  formatPctES,
  getTodayLocalISO,
  monthlyEquivalent,
  roundCents,
  shiftMonthKey,
  type ComparisonDirection,
} from '../domain/finance';
import {
  EXPENSE_CATEGORY_LABELS,
  FREQUENCY_LABELS,
  TRANSACTION_CATEGORY_LABELS,
} from '../domain/presets';
import { exportNidoPDF } from '../services/pdfExport';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type MonthlyBudget,
  type RecurrenceFrequency,
  type RecurringExpense,
  type Transaction,
  type TransactionCategory,
} from '../types/nido';

type TxSortField = 'date' | 'concept' | 'category' | 'amount';

export const MensualView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentMember,
    currentUserProfile,
    effectiveSplitPctA,
    selectedMonthKey,
    setSelectedMonthKey,
    uiMode,
    recurring,
    monthTransactions,
    recentTransactions,
    budget,
    monthClosures,
    repo,
    showToast,
    scheduleUndo,
  } = useNido();

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Avanzado: Search, filters, sorting, inline edit, multi-select bulk delete
  const [txSearch, setTxSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<TransactionCategory | 'todas'>('todas');
  const [payerFilter, setPayerFilter] = useState<string>('todos');
  const [sortField, setSortField] = useState<TxSortField>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Avanzado: Global search on demand (no permanent listener; cached in session)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [cachedHistory, setCachedHistory] = useState<Transaction[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [globalText, setGlobalText] = useState('');
  const [globalAmount, setGlobalAmount] = useState('');
  const [globalCategory, setGlobalCategory] = useState<TransactionCategory | 'todas'>('todas');
  const [globalLimit, setGlobalLimit] = useState(40);

  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteTx, setConfirmBulkDeleteTx] = useState(false);

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineConcept, setInlineConcept] = useState('');
  const [inlineCategory, setInlineCategory] = useState<ExpenseCategory>('supermercado');
  const [inlinePaidBy, setInlinePaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [inlineSplitPct, setInlineSplitPct] = useState('50');
  const [inlineAmount, setInlineAmount] = useState('');

  // Recurring modal
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<RecurringExpense | null>(null);
  const [recConcept, setRecConcept] = useState('');
  const [recCategory, setRecCategory] = useState<ExpenseCategory>('alquiler');
  const [recAmount, setRecAmount] = useState('');
  const [recFrequency, setRecFrequency] = useState<RecurrenceFrequency>('mensual');
  const [recDay, setRecDay] = useState('1');
  const [recPaidBy, setRecPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [recActive, setRecActive] = useState(true);

  // Budget modal
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [draftLimits, setDraftLimits] = useState<Record<string, string>>({});

  // Confirm dialogs
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'tx'; item: Transaction }
    | { kind: 'rec'; item: RecurringExpense }
    | null
  >(null);
  const [confirmCloseMonth, setConfirmCloseMonth] = useState(false);

  const closure = monthClosures.find((c) => c.monthKey === selectedMonthKey) ?? null;
  const isClosed = Boolean(closure);

  const closedMonthKeys = useMemo(
    () => new Set(monthClosures.map((c) => c.monthKey)),
    [monthClosures]
  );
  const closedMonthKeysRef = useRef<Set<string>>(closedMonthKeys);
  useEffect(() => {
    closedMonthKeysRef.current = closedMonthKeys;
  }, [closedMonthKeys]);

  // Reset selections and inline edit if month changes or becomes closed
  useEffect(() => {
    setSelectedTxIds(new Set());
    setInlineEditId(null);
  }, [selectedMonthKey, isClosed]);

  const balance = useMemo(
    () => calculateCoupleBalance(monthTransactions, memberA, memberB),
    [monthTransactions, memberA, memberB]
  );

  const personalMonthTotal = useMemo(
    () =>
      roundCents(
        monthTransactions
          .filter((t) => t.isPrivate && !t.isSettlement)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
      ),
    [monthTransactions]
  );

  const secondPersonBalanceText = useMemo(
    () => formatCoupleBalanceSecondPerson(balance, currentMember, memberA, memberB),
    [balance, currentMember, memberA, memberB]
  );

  const budgetProgress = useMemo(
    () => computeBudgetProgress(monthTransactions, budget),
    [monthTransactions, budget]
  );

  const missingRecurring = useMemo(
    () => findMissingRecurringForMonth(recurring, monthTransactions, selectedMonthKey),
    [recurring, monthTransactions, selectedMonthKey]
  );

  // Reset session history cache if household or user changes
  useEffect(() => {
    setCachedHistory(null);
    setHistoryError(null);
  }, [householdId, currentUserProfile?.uid]);

  const loadHistoryOnDemand = async (force = false) => {
    if (!householdId || !currentUserProfile) return;
    if (cachedHistory !== null && !force) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const rows = await repo.fetchAllTransactions(householdId, currentUserProfile.uid);
      setCachedHistory(rows);
    } catch (err) {
      setHistoryError(
        toUserFriendlyErrorMessage(err, 'No se pudo cargar el historial de movimientos.')
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const hasGlobalCriteria =
    globalText.trim() !== '' || globalAmount.trim() !== '' || globalCategory !== 'todas';

  const globalResults = useMemo(() => {
    if (uiMode !== 'avanzado' || !globalSearchOpen || !cachedHistory) return [];
    return filterGlobalTransactions(cachedHistory, {
      text: globalText,
      amountQuery: globalAmount,
      category: globalCategory,
    });
  }, [uiMode, globalSearchOpen, cachedHistory, globalText, globalAmount, globalCategory]);

  const globalTotalAmount = useMemo(
    () =>
      roundCents(
        globalResults
          .filter((t) => !t.isSettlement)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
      ),
    [globalResults]
  );

  const comparisonSourceTransactions = useMemo(() => {
    const map = new Map<string, Transaction>();
    if (cachedHistory) {
      for (const tx of cachedHistory) map.set(tx.id, tx);
    }
    for (const tx of recentTransactions) map.set(tx.id, tx);
    for (const tx of monthTransactions) map.set(tx.id, tx);
    return Array.from(map.values());
  }, [cachedHistory, recentTransactions, monthTransactions]);

  const categoryComparison = useMemo(() => {
    if (uiMode !== 'avanzado') return { activePriorMonths: 0, rows: [] };
    return computeCategoryComparison(comparisonSourceTransactions, selectedMonthKey);
  }, [uiMode, comparisonSourceTransactions, selectedMonthKey]);

  const filteredAndSortedTransactions = useMemo(() => {
    if (uiMode === 'sencillo') return monthTransactions;
    const q = txSearch.trim().toLowerCase();
    const filtered = monthTransactions.filter((tx) => {
      if (categoryFilter !== 'todas' && tx.category !== categoryFilter) return false;
      if (payerFilter !== 'todos' && tx.paidBy !== payerFilter) return false;
      if (q) {
        const hay = `${tx.concept} ${tx.notes} ${TRANSACTION_CATEGORY_LABELS[tx.category]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'concept') cmp = a.concept.localeCompare(b.concept, 'es');
      else if (sortField === 'category') {
        cmp = TRANSACTION_CATEGORY_LABELS[a.category].localeCompare(
          TRANSACTION_CATEGORY_LABELS[b.category],
          'es'
        );
      } else {
        cmp = a.amount - b.amount;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [uiMode, monthTransactions, txSearch, categoryFilter, payerFilter, sortField, sortAsc]);

  const fullNameA = memberA?.displayName?.trim() || 'Persona A';
  const fullNameB = memberB?.displayName?.trim() || 'Pareja';
  const shortNameA = fullNameA.split(' ')[0];
  const shortNameB = fullNameB.split(' ')[0];

  const memberLabel = (uid: string) => {
    if (uid === COMMON_ACCOUNT_ID || uid === 'comun') return 'Cuenta común';
    return members.find((m) => m.uid === uid)?.displayName?.trim() || 'Pareja';
  };

  const handleSortClick = (field: TxSortField) => {
    if (sortField === field) setSortAsc((prev) => !prev);
    else {
      setSortField(field);
      setSortAsc(field === 'concept' || field === 'category');
    }
  };

  const startInlineEdit = (tx: Transaction) => {
    if (isClosed || tx.isSettlement) return;
    setInlineEditId(tx.id);
    setInlineConcept(tx.concept);
    setInlineCategory(tx.category === 'liquidacion' ? 'otros' : tx.category);
    setInlinePaidBy(tx.paidBy === 'comun' ? COMMON_ACCOUNT_ID : tx.paidBy);
    setInlineSplitPct(String(clampSplitPct(tx.splitPctA, effectiveSplitPctA)));
    setInlineAmount(String(tx.amount));
  };

  const handleSaveInlineEdit = async (tx: Transaction) => {
    if (!householdId || !currentUserProfile || isClosed) return;
    const numericAmt = Number(inlineAmount.replace(',', '.'));
    if (!Number.isFinite(numericAmt) || numericAmt <= 0 || !inlineConcept.trim()) {
      showToast('Introduce un concepto e importe válido mayor que 0.');
      return;
    }
    const splitVal = tx.isPrivate ? tx.splitPctA : clampSplitPct(inlineSplitPct, effectiveSplitPctA);
    const safePaidBy = tx.isPrivate ? tx.paidBy : inlinePaidBy;
    try {
      await repo.upsertTransaction(
        householdId,
        {
          ...tx,
          concept: inlineConcept.trim(),
          category: inlineCategory,
          paidBy: safePaidBy,
          splitPctA: splitVal,
          amount: Math.round(numericAmt * 100) / 100,
        },
        currentUserProfile
      );
      setInlineEditId(null);
      setCachedHistory(null);
      if (globalSearchOpen) void loadHistoryOnDemand(true);
      showToast('Gasto actualizado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el gasto.'));
    }
  };

  const handleConfirmBulkDeleteTx = async () => {
    if (!householdId || !currentUserProfile) return;
    setConfirmBulkDeleteTx(false);
    if (isClosed) {
      showToast('No puedes eliminar movimientos de un mes cerrado.');
      return;
    }
    const deletable = monthTransactions
      .filter((tx) => selectedTxIds.has(tx.id) && !closedMonthKeys.has(tx.monthKey))
      .map((tx) => ({ id: tx.id, concept: tx.concept, isPrivate: tx.isPrivate }));
    if (deletable.length === 0) return;

    try {
      await repo.deleteTransactionsBulk(householdId, deletable, currentUserProfile);
      setSelectedTxIds(new Set());
      setCachedHistory(null);
      if (globalSearchOpen) void loadHistoryOnDemand(true);
      showToast(`Eliminados ${deletable.length} movimientos`);
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudieron eliminar los movimientos.'));
    }
  };

  const handleGenerateFromTemplates = async () => {
    if (!householdId || !currentUserProfile || isClosed) return;
    if (missingRecurring.length === 0) {
      showToast('Todas las plantillas de este mes ya están generadas');
      return;
    }
    const count = await repo.generateMonthTransactions(
      householdId,
      selectedMonthKey,
      missingRecurring,
      effectiveSplitPctA,
      currentUserProfile
    );
    showToast(`Generados ${count} gastos desde plantillas`);
  };

  const handleRegisterSettlement = async () => {
    if (!householdId || !currentUserProfile || !memberA || !memberB || balance.owesDirection === 'peace') {
      return;
    }
    const payerUid = balance.owesDirection === 'b_owes_a' ? memberB.uid : memberA.uid;
    const receiverUid = balance.owesDirection === 'b_owes_a' ? memberA.uid : memberB.uid;
    const today = getTodayLocalISO();
    const txDate = today.startsWith(selectedMonthKey)
      ? today
      : `${selectedMonthKey}-${String(daysInMonth(selectedMonthKey)).padStart(2, '0')}`;

    await repo.upsertTransaction(
      householdId,
      {
        monthKey: selectedMonthKey,
        concept: `Liquidación ${formatMonthLabelES(selectedMonthKey)}`,
        category: 'liquidacion',
        amount: balance.owesAmount,
        date: txDate,
        paidBy: payerUid,
        recurringId: null,
        splitPctA: effectiveSplitPctA,
        isSettlement: true,
        settlementTo: receiverUid,
        isPrivate: false,
        createdBy: currentUserProfile.uid,
        notes: 'Liquidación de saldo entre pareja',
      },
      currentUserProfile
    );
    showToast('Liquidación registrada');
  };

  const handleCloseMonth = async () => {
    if (!householdId || !currentUserProfile) return;
    setConfirmCloseMonth(false);
    await repo.closeMonth(
      householdId,
      {
        monthKey: selectedMonthKey,
        totalSpent: balance.totalSpent,
        paidA: balance.paidA,
        paidB: balance.paidB,
        paidComun: balance.paidComun,
        shareA: balance.shareA,
        shareB: balance.shareB,
        balanceA: balance.balanceA,
        settlementText: balance.summaryText,
        closedBy: currentUserProfile.uid,
      },
      currentUserProfile
    );
    showToast(`Mes ${selectedMonthKey} cerrado`);
  };

  const openRecModal = (rec: RecurringExpense | null) => {
    setEditingRec(rec);
    setRecConcept(rec?.concept ?? '');
    setRecCategory(rec?.category ?? 'alquiler');
    setRecAmount(rec ? String(rec.amount) : '');
    setRecFrequency(rec?.frequency ?? 'mensual');
    setRecDay(rec ? String(rec.dayOfMonth) : '1');
    setRecPaidBy(rec?.paidByDefault ?? COMMON_ACCOUNT_ID);
    setRecActive(rec?.active ?? true);
    setRecModalOpen(true);
  };

  const handleSaveRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const amt = Math.max(0, Number(recAmount.replace(',', '.')) || 0);
    const day = Math.max(1, Math.min(31, Math.round(Number(recDay) || 1)));
    await repo.upsertRecurring(
      householdId,
      {
        id: editingRec?.id,
        concept: recConcept.trim(),
        category: recCategory,
        amount: Math.round(amt * 100) / 100,
        frequency: recFrequency,
        dayOfMonth: day,
        splitOverride: editingRec?.splitOverride ?? null,
        paidByDefault: recPaidBy,
        active: recActive,
      },
      currentUserProfile
    );
    setRecModalOpen(false);
    showToast('Plantilla recurrente guardada');
  };

  const openBudgetEditor = () => {
    const draft: Record<string, string> = {};
    for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
      const val = budget?.limits?.[cat];
      draft[cat] = val !== undefined ? String(val) : '';
    }
    setDraftLimits(draft);
    setBudgetModalOpen(true);
  };

  const handleSaveBudgets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const limits: MonthlyBudget['limits'] = {};
    for (const [k, raw] of Object.entries(draftLimits)) {
      const n = Number(raw.replace(',', '.'));
      if (Number.isFinite(n) && n > 0) {
        limits[k as ExpenseCategory] = Math.round(n * 100) / 100;
      }
    }
    await repo.saveBudget(householdId, selectedMonthKey, limits, currentUserProfile);
    setBudgetModalOpen(false);
    showToast('Presupuesto mensual actualizado');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !householdId || !currentUserProfile) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.kind === 'tx') {
      const backup = { ...target.item };
      if (closedMonthKeysRef.current.has(backup.monthKey)) {
        showToast('No puedes eliminar un gasto de un mes cerrado.');
        return;
      }
      await repo.deleteTransaction(householdId, backup.id, backup.concept, currentUserProfile, {
        isPrivate: backup.isPrivate,
      });
      setCachedHistory(null);
      if (globalSearchOpen) void loadHistoryOnDemand(true);
      scheduleUndo(`Eliminado "${backup.concept}"`, async () => {
        if (closedMonthKeysRef.current.has(backup.monthKey)) {
          showToast('No se puede deshacer: el mes está cerrado.');
          return;
        }
        await repo.restoreTransaction(householdId, backup, currentUserProfile);
        setCachedHistory(null);
        if (globalSearchOpen) void loadHistoryOnDemand(true);
      });
    } else {
      await repo.deleteRecurring(householdId, target.item.id, target.item.concept, currentUserProfile);
      showToast('Plantilla eliminada');
    }
  };

  const handleExportCSV = () => {
    const csv = generateSpanishCSV(
      ['Fecha', 'Concepto', 'Categoría', 'Pagó', 'Reparto A (%)', 'Tipo', 'Importe (€)'],
      monthTransactions.map((t) => [
        formatDateES(t.date),
        t.concept,
        TRANSACTION_CATEGORY_LABELS[t.category],
        memberLabel(t.paidBy),
        t.isPrivate ? 'Personal' : t.splitPctA,
        t.isPrivate ? 'Personal' : t.isSettlement ? 'Liquidación' : 'Gasto',
        t.amount,
      ])
    );
    downloadTextFile(`nido-mensual-${selectedMonthKey}.csv`, csv, 'text/csv;charset=utf-8;');
    showToast('CSV mensual descargado');
  };

  const handleExportPDF = () => {
    if (!household) return;
    const fromDate = `${selectedMonthKey}-01`;
    const toDate = `${selectedMonthKey}-${String(daysInMonth(selectedMonthKey)).padStart(2, '0')}`;
    exportNidoPDF({
      scope: 'mensual',
      household,
      members,
      fromDate,
      toDate,
      transactions: monthTransactions,
      initialCosts: [],
      items: [],
      goals: [],
      goalMovements: [],
    });
    showToast('PDF mensual descargado');
  };

  const statusBadge = (status: 'sin_limite' | 'verde' | 'ambar' | 'rojo') => {
    switch (status) {
      case 'verde':
        return { bar: 'bg-[#15803D]', text: 'text-[#15803D] dark:text-[#4ADE80]', label: 'En presupuesto' };
      case 'ambar':
        return { bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-300', label: 'Cerca del límite' };
      case 'rojo':
        return { bar: 'bg-[#B42318]', text: 'text-[#B42318] dark:text-[#FCA5A5]', label: 'Superado' };
      default:
        return { bar: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', label: 'Sin límite' };
    }
  };

  // ─── MODO SENCILLO: LISTA LIMPIA SIN CIERRE, PLANTILLAS, PRESUPUESTOS NI % ──
  if (uiMode === 'sencillo') {
    const simpleList = monthTransactions.filter((t) => !t.isSettlement);

    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setSelectedMonthKey(shiftMonthKey(selectedMonthKey, -1))}
            className="min-h-[46px] min-w-[46px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-center">
            {formatMonthLabelES(selectedMonthKey)}
          </h1>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setSelectedMonthKey(shiftMonthKey(selectedMonthKey, 1))}
            className="min-h-[46px] min-w-[46px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {isClosed && (
          <div className="rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-2.5 text-sm">
            <Lock className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Este mes ya está cerrado y no se puede cambiar.</span>
          </div>
        )}

        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Total gastado:{' '}
            <strong className="font-display text-lg text-[#0F1F24] dark:text-[#F0F5F6] tabular-nums">
              {formatEUR(balance.totalSpent)}
            </strong>
          </p>
          <p
            className={`font-display text-xl font-bold ${
              balance.owesDirection === 'peace'
                ? 'text-[#15803D] dark:text-[#4ADE80]'
                : 'text-[#0E5A64] dark:text-[#5EEAD4]'
            }`}
          >
            {secondPersonBalanceText}
          </p>
          {personalMonthTotal > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Además llevas {formatEUR(personalMonthTotal)} en gastos personales (solo visibles para ti).
            </p>
          )}
        </section>

        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <h2 className="font-display text-base font-bold">
            Gastos ({simpleList.length})
          </h2>

          {simpleList.length === 0 ? (
            <div className="py-8 text-center space-y-1.5">
              <p className="text-base font-bold">No hay gastos en este mes</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Pulsa el botón + de abajo para apuntar el primero.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {simpleList.map((tx) => (
                <li key={tx.id} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-bold truncate">{tx.concept}</p>
                      {tx.isPrivate && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                          <Lock className="w-3 h-3" />
                          <span>Privado</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {EXPENSE_CATEGORY_LABELS[tx.category === 'liquidacion' ? 'otros' : tx.category]}
                      {tx.isPrivate ? ' · No lo ve tu pareja' : ` · Pagó ${memberLabel(tx.paidBy)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="font-mono-num text-base font-bold mr-1">
                      {formatEUR(tx.amount)}
                    </span>
                    {!isClosed && (
                      <>
                        <button
                          type="button"
                          aria-label={`Editar ${tx.concept}`}
                          onClick={() => {
                            setEditingTx(tx);
                            setTxModalOpen(true);
                          }}
                          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${tx.concept}`}
                          onClick={() => setDeleteTarget({ kind: 'tx', item: tx })}
                          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <QuickExpenseModal
          open={txModalOpen}
          onClose={() => {
            setTxModalOpen(false);
            setEditingTx(null);
          }}
          editingTx={editingTx}
        />

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Eliminar gasto"
          description={`Vas a eliminar "${deleteTarget?.kind === 'tx' ? deleteTarget.item.concept : ''}". Podrás deshacerlo durante 5 segundos.`}
          confirmLabel="Eliminar"
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  // ─── MODO AVANZADO: TABLA CON ORDENACIÓN, FILTROS, BÚSQUEDA, EDICIÓN EN LÍNEA Y BORRADO MASIVO ─
  const allVisibleSelected =
    !isClosed &&
    filteredAndSortedTransactions.length > 0 &&
    filteredAndSortedTransactions.every((t) => selectedTxIds.has(t.id));

  return (
    <div className="space-y-6">
      {/* Header & Month selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setSelectedMonthKey(shiftMonthKey(selectedMonthKey, -1))}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="px-2">
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
              {formatMonthLabelES(selectedMonthKey)}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reparto vigente: {shortNameA} {effectiveSplitPctA}% · {shortNameB}{' '}
              {Math.round((100 - effectiveSplitPctA) * 10) / 10}%
            </p>
          </div>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setSelectedMonthKey(shiftMonthKey(selectedMonthKey, 1))}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !globalSearchOpen;
              setGlobalSearchOpen(next);
              if (next) void loadHistoryOnDemand(false);
            }}
            className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              globalSearchOpen
                ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Búsqueda global</span>
          </button>
          <button
            type="button"
            onClick={() => setCsvImportOpen(true)}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Upload className="w-4 h-4" />
            <span>Importar CSV banco</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>PDF</span>
          </button>
          {!isClosed ? (
            <button
              type="button"
              onClick={() => setConfirmCloseMonth(true)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Lock className="w-4 h-4" />
              <span>Cerrar mes</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                householdId &&
                currentUserProfile &&
                void repo.reopenMonth(householdId, selectedMonthKey, currentUserProfile)
              }
              className="min-h-[44px] px-3.5 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5"
            >
              <Unlock className="w-4 h-4" />
              <span>Desbloquear mes</span>
            </button>
          )}
        </div>
      </div>

      {/* Global Search across all history (Modo Avanzado, bajo demanda) */}
      {globalSearchOpen && (
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
                onClick={() => void loadHistoryOnDemand(true)}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
                <span>Actualizar</span>
              </button>
              {hasGlobalCriteria && (
                <button
                  type="button"
                  onClick={() => {
                    setGlobalText('');
                    setGlobalAmount('');
                    setGlobalCategory('todas');
                  }}
                  className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
                aria-label="Cerrar búsqueda global"
                onClick={() => setGlobalSearchOpen(false)}
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {historyError && (
            <div role="alert" className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs">
              {historyError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-5">
              <label htmlFor="global-search-text" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Texto (concepto, nota o categoría)
              </label>
              <input
                id="global-search-text"
                type="search"
                value={globalText}
                onChange={(e) => {
                  setGlobalText(e.target.value);
                  setGlobalLimit(40);
                }}
                placeholder="Ej. Bonpreu, fianza, cena..."
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 text-xs sm:text-sm"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="global-search-amount" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Importe (€)
              </label>
              <input
                id="global-search-amount"
                type="text"
                inputMode="decimal"
                value={globalAmount}
                onChange={(e) => {
                  setGlobalAmount(e.target.value);
                  setGlobalLimit(40);
                }}
                placeholder="Ej. 142,60"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 font-mono-num text-xs sm:text-sm"
              />
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="global-search-cat" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Categoría
              </label>
              <select
                id="global-search-cat"
                value={globalCategory}
                onChange={(e) => {
                  setGlobalCategory(e.target.value as TransactionCategory | 'todas');
                  setGlobalLimit(40);
                }}
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
                <strong className="text-[#0E5A64] dark:text-[#5EEAD4]">{formatEUR(globalTotalAmount)}</strong>
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
                          onClick={() => setSelectedMonthKey(tx.monthKey)}
                          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Ir al mes
                        </button>
                        {!rowClosed && !tx.isSettlement && (
                          <button
                            type="button"
                            aria-label={`Editar ${tx.concept}`}
                            onClick={() => {
                              setEditingTx(tx);
                              setTxModalOpen(true);
                            }}
                            className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {!rowClosed && (
                          <button
                            type="button"
                            aria-label={`Eliminar ${tx.concept}`}
                            onClick={() => setDeleteTarget({ kind: 'tx', item: tx })}
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
                  onClick={() => setGlobalLimit((n) => n + 40)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  Mostrar más ({globalResults.length - globalLimit} restantes)
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {isClosed && closure && (
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-2.5 text-sm">
          <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
          <span>
            <strong>Mes cerrado.</strong> Foto guardada: {closure.settlementText} (Total{' '}
            {formatEUR(closure.totalSpent)}). Edición y borrado masivo bloqueados hasta desbloquear.
          </span>
        </div>
      )}

      {/* Couple Balance + Action Card */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Scale className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <span>SALDO ENTRE PAREJA</span>
            </div>
            <p
              className={`font-display text-2xl sm:text-3xl font-bold ${
                balance.owesDirection === 'peace'
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#0F1F24] dark:text-[#F0F5F6]'
              }`}
            >
              {balance.summaryText}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Total mes: {formatEUR(balance.totalSpent)} · {shortNameA} pagó {formatEUR(balance.paidA)}{' '}
              (corresponde {formatEUR(balance.shareA)}) · {shortNameB} pagó {formatEUR(balance.paidB)}{' '}
              (corresponde {formatEUR(balance.shareB)})
              {balance.paidComun > 0 ? ` · Cuenta común: ${formatEUR(balance.paidComun)}` : ''}
            </p>
            {personalMonthTotal > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Incluye {formatEUR(personalMonthTotal)} en gastos personales tuyos (excluidos del saldo y totales del hogar).
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {balance.owesDirection !== 'peace' && memberB && !isClosed && (
              <button
                type="button"
                onClick={() => void handleRegisterSettlement()}
                className="min-h-[44px] px-4 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Registrar liquidación</span>
              </button>
            )}
            {!isClosed && (
              <button
                type="button"
                onClick={() => {
                  setEditingTx(null);
                  setTxModalOpen(true);
                }}
                className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir gasto</span>
              </button>
            )}
          </div>
        </div>

        {!isClosed && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {missingRecurring.length > 0
                ? `Hay ${missingRecurring.length} gastos recurrentes pendientes de generar este mes.`
                : 'Todas las plantillas recurrentes activas de este mes ya están generadas.'}
            </p>
            <button
              type="button"
              onClick={() => void handleGenerateFromTemplates()}
              className="min-h-[44px] px-4 rounded-xl border border-[#0E5A64] text-[#0E5A64] dark:text-[#5EEAD4] dark:border-[#5EEAD4] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#0E5A64]/5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Generar gastos del mes desde plantillas</span>
            </button>
          </div>
        )}
      </section>

      {/* Transactions Table (Full width for dense inspection) */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4 min-w-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">
            Tabla de movimientos ({filteredAndSortedTransactions.length} de {monthTransactions.length})
          </h2>

          {!isClosed && selectedTxIds.size > 0 && (
            <button
              type="button"
              onClick={() => setConfirmBulkDeleteTx(true)}
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
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Buscar por concepto, categoría o nota..."
              className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 text-xs sm:text-sm"
            />
          </div>
          <div className="sm:col-span-3">
            <select
              aria-label="Filtrar por categoría"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as TransactionCategory | 'todas')}
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
              onChange={(e) => setPayerFilter(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
            >
              <option value="todos">Todos los pagadores</option>
              {memberA && <option value={memberA.uid}>{fullNameA}</option>}
              {memberB && <option value={memberB.uid}>{fullNameB}</option>}
              <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
            </select>
          </div>
        </div>

        {filteredAndSortedTransactions.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm font-semibold">
              {monthTransactions.length === 0
                ? `No hay gastos en ${formatMonthLabelES(selectedMonthKey)}`
                : 'Ningún movimiento coincide con los filtros'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {monthTransactions.length === 0
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
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTxIds(new Set(filteredAndSortedTransactions.map((t) => t.id)));
                          } else {
                            setSelectedTxIds(new Set());
                          }
                        }}
                        className="w-4 h-4 accent-[#0E5A64]"
                      />
                    </th>
                  )}
                  <th className="py-1.5 pr-3">
                    <button
                      type="button"
                      onClick={() => handleSortClick('date')}
                      className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                    >
                      <span>Fecha</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-1.5 pr-3">
                    <button
                      type="button"
                      onClick={() => handleSortClick('concept')}
                      className="min-h-[44px] inline-flex items-center gap-1 font-semibold hover:text-[#0F1F24] dark:hover:text-white"
                    >
                      <span>Concepto</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-1.5 pr-3">
                    <button
                      type="button"
                      onClick={() => handleSortClick('category')}
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
                      onClick={() => handleSortClick('amount')}
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
                {filteredAndSortedTransactions.map((tx) => {
                  const isInline = inlineEditId === tx.id;
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
                            onChange={(e) => {
                              setSelectedTxIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(tx.id);
                                else next.delete(tx.id);
                                return next;
                              });
                            }}
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
                          <span className="text-slate-600 dark:text-slate-300">
                            {TRANSACTION_CATEGORY_LABELS[tx.category]}
                          </span>
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
                                onClick={() => void handleSaveInlineEdit(tx)}
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
                                      setEditingTx(tx);
                                      setTxModalOpen(true);
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
                                onClick={() => setDeleteTarget({ kind: 'tx', item: tx })}
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

      {/* Budget vs Real + Recurring Templates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Presupuesto vs real</h2>
            {!isClosed && (
              <button
                type="button"
                onClick={openBudgetEditor}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Editar límites</span>
              </button>
            )}
          </div>

          {budgetProgress.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Define límites mensuales por categoría para activar el semáforo de control.
            </p>
          ) : (
            <div className="space-y-3.5">
              {budgetProgress.map((bp) => {
                const badge = statusBadge(bp.status);
                const barWidth = bp.limit > 0 ? Math.min(100, bp.pct) : 0;
                return (
                  <div key={bp.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {EXPENSE_CATEGORY_LABELS[bp.category]}
                      </span>
                      <span className="tabular-nums">
                        <strong>{formatEUR(bp.spent)}</strong>
                        {bp.limit > 0 ? ` / ${formatEUR(bp.limit)}` : ''}
                      </span>
                    </div>
                    {bp.limit > 0 && (
                      <>
                        <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${badge.bar}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className={`font-medium ${badge.text}`}>{badge.label}</span>
                          <span className="tabular-nums text-slate-500 dark:text-slate-400">{bp.pct}%</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <h2 className="font-display text-base font-bold">Plantillas y calendario</h2>
            </div>
            <button
              type="button"
              onClick={() => openRecModal(null)}
              className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Plantilla</span>
            </button>
          </div>

          {recurring.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Añade alquiler, luz, agua o seguros para generar el mes en un toque.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {recurring.map((rec) => {
                const equiv = monthlyEquivalent(rec.amount, rec.frequency);
                return (
                  <li key={rec.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${!rec.active ? 'opacity-50' : ''}`}>
                        Día {rec.dayOfMonth} · {rec.concept}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {FREQUENCY_LABELS[rec.frequency]} · {memberLabel(rec.paidByDefault)}
                        {rec.frequency !== 'mensual' ? ` · Equiv. mensual: ${formatEUR(equiv)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono-num text-xs font-bold">{formatEUR(rec.amount)}</span>
                      <button
                        type="button"
                        aria-label={`Editar plantilla ${rec.concept}`}
                        onClick={() => openRecModal(rec)}
                        className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar plantilla ${rec.concept}`}
                        onClick={() => setDeleteTarget({ kind: 'rec', item: rec })}
                        className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Category Comparison: Current vs Previous & 6-Month Average (Modo Avanzado) */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">Comparativa por categoría</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatMonthLabelES(selectedMonthKey)} frente a{' '}
              {formatMonthLabelES(shiftMonthKey(selectedMonthKey, -1))} y media de{' '}
              {categoryComparison.activePriorMonths > 0
                ? `${categoryComparison.activePriorMonths} ${
                    categoryComparison.activePriorMonths === 1 ? 'mes previo' : 'meses previos'
                  } (máx. 6)`
                : '6 meses'}
              . Excluye gastos personales y liquidaciones.
            </p>
          </div>
        </div>

        {categoryComparison.rows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No hay gastos compartidos en este periodo para comparar categorías.
          </p>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="grid grid-cols-1 gap-3 md:hidden">
              {categoryComparison.rows.map((row) => {
                const renderDeltaChip = (
                  pct: number | null,
                  dir: ComparisonDirection,
                  hasBaseline: boolean
                ) => {
                  if (!hasBaseline) {
                    return <span className="text-[11px] text-slate-500 dark:text-slate-400">Sin datos</span>;
                  }
                  const color =
                    dir === 'up'
                      ? 'text-[#B42318] dark:text-[#FCA5A5]'
                      : dir === 'down'
                        ? 'text-[#15803D] dark:text-[#4ADE80]'
                        : 'text-slate-500 dark:text-slate-400';
                  return (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${color}`}>
                      {dir === 'up' ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : dir === 'down' ? (
                        <TrendingDown className="w-3.5 h-3.5" />
                      ) : (
                        <Minus className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '='}{' '}
                        {pct === null
                          ? 'Nuevo'
                          : `${pct > 0 ? '+' : ''}${formatPctES(pct)}`}
                      </span>
                    </span>
                  );
                };

                return (
                  <div
                    key={row.category}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{EXPENSE_CATEGORY_LABELS[row.category]}</span>
                      <span className="font-mono-num text-sm font-bold">{formatEUR(row.current)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Ant. ({formatEUR(row.prev)})
                        </p>
                        {renderDeltaChip(row.vsPrevPct, row.vsPrevDir, true)}
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Media 6m ({formatEUR(row.avg6)})
                        </p>
                        {renderDeltaChip(
                          row.vsAvg6Pct,
                          row.vsAvg6Dir,
                          categoryComparison.activePriorMonths > 0
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Categoría</th>
                    <th className="py-2 pr-3 font-semibold text-right">Este mes</th>
                    <th className="py-2 pr-3 font-semibold text-right">Mes anterior</th>
                    <th className="py-2 pr-3 font-semibold text-right">Vs anterior</th>
                    <th className="py-2 pr-3 font-semibold text-right">Media 6 m.</th>
                    <th className="py-2 font-semibold text-right">Vs media 6 m.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {categoryComparison.rows.map((row) => {
                    const renderDeltaCell = (
                      pct: number | null,
                      dir: ComparisonDirection,
                      hasBaseline: boolean
                    ) => {
                      if (!hasBaseline) {
                        return <span className="text-xs text-slate-500 dark:text-slate-400">Sin datos</span>;
                      }
                      const color =
                        dir === 'up'
                          ? 'text-[#B42318] dark:text-[#FCA5A5]'
                          : dir === 'down'
                            ? 'text-[#15803D] dark:text-[#4ADE80]'
                            : 'text-slate-500 dark:text-slate-400';
                      return (
                        <span className={`inline-flex items-center justify-end gap-1 font-bold tabular-nums ${color}`}>
                          {dir === 'up' ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : dir === 'down' ? (
                            <TrendingDown className="w-3.5 h-3.5" />
                          ) : (
                            <Minus className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '='}{' '}
                            {pct === null
                              ? 'Nuevo'
                              : `${pct > 0 ? '+' : ''}${formatPctES(pct)}`}
                          </span>
                        </span>
                      );
                    };

                    return (
                      <tr key={row.category}>
                        <td className="py-2.5 pr-3 font-semibold">
                          {EXPENSE_CATEGORY_LABELS[row.category]}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono-num font-bold">
                          {formatEUR(row.current)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono-num text-slate-500 dark:text-slate-400">
                          {formatEUR(row.prev)}
                        </td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                          {renderDeltaCell(row.vsPrevPct, row.vsPrevDir, true)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono-num text-slate-500 dark:text-slate-400">
                          {categoryComparison.activePriorMonths > 0 ? formatEUR(row.avg6) : '—'}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {renderDeltaCell(
                            row.vsAvg6Pct,
                            row.vsAvg6Dir,
                            categoryComparison.activePriorMonths > 0
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Modals */}
      <QuickExpenseModal
        open={txModalOpen}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        editingTx={editingTx}
        onSaved={() => {
          setCachedHistory(null);
          if (globalSearchOpen) void loadHistoryOnDemand(true);
        }}
      />

      <BankCsvImportModal
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onImported={() => {
          setCachedHistory(null);
          if (globalSearchOpen) void loadHistoryOnDemand(true);
        }}
      />

      {recModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rec-modal-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 id="rec-modal-title" className="font-display text-lg font-bold">
              {editingRec ? 'Editar plantilla recurrente' : 'Nueva plantilla recurrente'}
            </h2>
            <form onSubmit={handleSaveRecurring} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Concepto</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={recConcept}
                  onChange={(e) => setRecConcept(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Categoría</label>
                  <select
                    value={recCategory}
                    onChange={(e) => setRecCategory(e.target.value as ExpenseCategory)}
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
                  <label className="block text-xs font-medium mb-1">Importe (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Frecuencia</label>
                  <select
                    value={recFrequency}
                    onChange={(e) => setRecFrequency(e.target.value as RecurrenceFrequency)}
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
                  <label className="block text-xs font-medium mb-1">Día de cobro (1-31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recDay}
                    onChange={(e) => setRecDay(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Pagado por defecto</label>
                <select
                  value={recPaidBy}
                  onChange={(e) => setRecPaidBy(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
                  {memberA && <option value={memberA.uid}>{shortNameA}</option>}
                  {memberB && <option value={memberB.uid}>{shortNameB}</option>}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm pt-1">
                <input
                  type="checkbox"
                  checked={recActive}
                  onChange={(e) => setRecActive(e.target.checked)}
                  className="w-4 h-4 accent-[#0E5A64]"
                />
                <span>Plantilla activa</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRecModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {budgetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-modal-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 id="budget-modal-title" className="font-display text-lg font-bold">
              Presupuestos de {formatMonthLabelES(selectedMonthKey)}
            </h2>
            <form onSubmit={handleSaveBudgets} className="space-y-3">
              {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                <div key={cat} className="flex items-center justify-between gap-3">
                  <label htmlFor={`bud-${cat}`} className="text-sm">
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </label>
                  <input
                    id={`bud-${cat}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="Sin límite"
                    value={draftLimits[cat] ?? ''}
                    onChange={(e) =>
                      setDraftLimits((prev) => ({ ...prev, [cat]: e.target.value }))
                    }
                    className="w-32 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right"
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
                >
                  Guardar límites
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Confirmar eliminación"
        description={
          deleteTarget?.kind === 'tx'
            ? `Vas a eliminar el gasto "${deleteTarget.item.concept}". Podrás deshacerlo durante 5 segundos.`
            : `Vas a eliminar la plantilla recurrente "${deleteTarget?.item.concept ?? ''}".`
        }
        confirmLabel="Eliminar"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmBulkDeleteTx}
        title="Eliminar movimientos seleccionados"
        description={`Se eliminarán ${selectedTxIds.size} movimientos de ${formatMonthLabelES(selectedMonthKey)}.`}
        confirmLabel={`Eliminar ${selectedTxIds.size}`}
        onConfirm={() => void handleConfirmBulkDeleteTx()}
        onCancel={() => setConfirmBulkDeleteTx(false)}
      />

      <ConfirmDialog
        open={confirmCloseMonth}
        title={`Cerrar ${formatMonthLabelES(selectedMonthKey)}`}
        description={`Se guardará una foto del saldo (${balance.summaryText}) y se bloqueará la edición de gastos de este mes hasta que lo desbloquees en Modo Avanzado.`}
        confirmLabel="Cerrar mes"
        destructive={false}
        onConfirm={() => void handleCloseMonth()}
        onCancel={() => setConfirmCloseMonth(false)}
      />
    </div>
  );
};
