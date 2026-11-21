import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { BankCsvImportModal } from '../components/BankCsvImportModal';
import { CategoryTag } from '../components/CategoryTag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QuickExpenseModal } from '../components/QuickExpenseModal';
import {
  BudgetProgressCard,
  CategoryComparisonSection,
} from '../components/mensual/BudgetAndComparisonSection';
import { BudgetEditorModal } from '../components/mensual/BudgetEditorModal';
import { CategoryColorModal } from '../components/mensual/CategoryColorModal';
import { CommonAccountRadarCard } from '../components/mensual/CommonAccountRadarCard';
import { GlobalSearchSection } from '../components/mensual/GlobalSearchSection';
import { HabitualCatalogModal } from '../components/mensual/HabitualCatalogModal';
import { MonthlyCalendarSection } from '../components/mensual/MonthlyCalendarSection';
import { RecurringIcsModal } from '../components/mensual/RecurringIcsModal';
import { RecurringTemplateModal } from '../components/mensual/RecurringTemplateModal';
import { RecurringTemplatesSection } from '../components/mensual/RecurringTemplatesSection';
import {
  TransactionsTableSection,
  type TxSortField,
} from '../components/mensual/TransactionsTableSection';
import { useNido } from '../context/NidoContext';
import { downloadTextFile, generateSpanishCSV } from '../domain/backup';
import {
  calculateCoupleBalance,
  computeBudgetProgress,
  computeCategoryComparison,
  daysInMonth,
  filterGlobalTransactions,
  findMissingRecurringForMonth,
  formatCoupleBalanceSecondPerson,
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  getTodayLocalISO,
  monthlyEquivalent,
  roundCents,
  shiftMonthKey,
} from '../domain/finance';
import {
  TRANSACTION_CATEGORY_LABELS,
  type RecurringCatalogPreset,
} from '../domain/presets';
import { exportNidoPDF } from '../services/pdfExport';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type ExpensePrefill,
  type MonthlyBudget,
  type RecurringExpense,
  type Transaction,
  type TransactionCategory,
} from '../types/nido';

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
    focusMensualSection,
    clearFocusMensualSection,
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
  const [txPrefill, setTxPrefill] = useState<ExpensePrefill | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [colorModalOpen, setColorModalOpen] = useState(false);
  const [icsModalOpen, setIcsModalOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Avanzado: Search, filters, sorting, multi-select bulk delete
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

  // Recurring modal & generation lock
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<RecurringExpense | null>(null);
  const [recActivateOnOpen, setRecActivateOnOpen] = useState(false);
  const [generatingTemplates, setGeneratingTemplates] = useState(false);

  // Habitual expenses catalog & budget modals
  const [habitualModalOpen, setHabitualModalOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);

  const plantillasSectionRef = useRef<HTMLElement | null>(null);

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

  // Reset selections if month changes or becomes closed
  useEffect(() => {
    setSelectedTxIds(new Set());
  }, [selectedMonthKey, isClosed]);

  // Focus plantillas section when navigated from Modo Sencillo CTA
  useEffect(() => {
    if (uiMode !== 'avanzado' || focusMensualSection !== 'plantillas') return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    plantillasSectionRef.current?.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    });
    clearFocusMensualSection();
  }, [uiMode, focusMensualSection, clearFocusMensualSection]);

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

  const activeFixedByCategory = useMemo(() => {
    const map: Partial<Record<ExpenseCategory, number>> = {};
    for (const rec of recurring) {
      if (!rec.active || (Number(rec.amount) || 0) <= 0) continue;
      const eq = monthlyEquivalent(rec.amount, rec.frequency);
      map[rec.category] = roundCents((map[rec.category] ?? 0) + eq);
    }
    return map;
  }, [recurring]);

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

  const handleSaveInlineEdit = async (
    tx: Transaction,
    updates: {
      concept: string;
      category: ExpenseCategory;
      paidBy: string;
      splitPctA: number;
      amount: number;
    }
  ): Promise<boolean> => {
    if (!householdId || !currentUserProfile || isClosed) return false;
    if (!Number.isFinite(updates.amount) || updates.amount <= 0 || !updates.concept.trim()) {
      showToast('Introduce un concepto e importe válido mayor que 0.');
      return false;
    }
    try {
      await repo.upsertTransaction(
        householdId,
        {
          ...tx,
          concept: updates.concept.trim(),
          category: updates.category,
          paidBy: updates.paidBy,
          splitPctA: updates.splitPctA,
          amount: Math.round(updates.amount * 100) / 100,
        },
        currentUserProfile
      );
      setCachedHistory(null);
      if (globalSearchOpen) void loadHistoryOnDemand(true);
      showToast('Gasto actualizado');
      return true;
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el gasto.'));
      return false;
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
    if (!householdId || !currentUserProfile || isClosed || generatingTemplates) return;
    if (missingRecurring.length === 0) {
      showToast('Todas las plantillas de este mes ya están generadas');
      return;
    }
    setGeneratingTemplates(true);
    try {
      const count = await repo.generateMonthTransactions(
        householdId,
        selectedMonthKey,
        missingRecurring,
        effectiveSplitPctA,
        currentUserProfile
      );
      showToast(
        count > 0
          ? `Generados ${count} gastos desde plantillas`
          : 'Todas las plantillas de este mes ya estaban generadas'
      );
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudieron generar las plantillas del mes.'));
    } finally {
      setGeneratingTemplates(false);
    }
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

  const viewerIsMemberA = currentMember
    ? currentMember.role !== 'member_b'
    : !memberB || currentUserProfile?.uid !== memberB.uid;

  const openRecModal = (rec: RecurringExpense | null, activateOnOpen = false) => {
    setEditingRec(rec);
    setRecActivateOnOpen(activateOnOpen);
    setRecModalOpen(true);
  };

  const handleSaveRecurringPayload = async (
    payload: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => {
    if (!householdId || !currentUserProfile) return;
    await repo.upsertRecurring(householdId, payload, currentUserProfile);
    setRecModalOpen(false);
    showToast('Plantilla recurrente guardada');
  };

  const handleSaveHabitualCatalog = async (
    presetsToAdd: RecurringCatalogPreset[],
    nextLimits: MonthlyBudget['limits'],
    budgetChanged: boolean
  ) => {
    if (!householdId || !currentUserProfile) return;
    let addedCount = 0;
    if (presetsToAdd.length > 0) {
      addedCount = await repo.addHabitualRecurringTemplates(
        householdId,
        presetsToAdd,
        currentUserProfile
      );
    }
    if (!isClosed && budgetChanged) {
      await repo.saveBudget(householdId, selectedMonthKey, nextLimits, currentUserProfile);
    }
    setHabitualModalOpen(false);
    if (addedCount > 0 && budgetChanged) {
      showToast(`Añadidas ${addedCount} plantillas y actualizado el presupuesto`);
    } else if (addedCount > 0) {
      showToast(
        `Añadidas ${addedCount} ${addedCount === 1 ? 'plantilla habitual' : 'plantillas habituales'}`
      );
    } else if (budgetChanged) {
      showToast('Presupuesto orientativo guardado');
    } else {
      showToast('Las plantillas seleccionadas ya estaban añadidas');
    }
  };

  const handleSaveBudgets = async (limits: MonthlyBudget['limits']) => {
    if (!householdId || !currentUserProfile) return;
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

  // ─── MODO SENCILLO ──────────────────────────────────────────────────────────
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

        <CommonAccountRadarCard
          monthKey={selectedMonthKey}
          transactions={monthTransactions}
          recurring={recurring}
          uiMode="sencillo"
          effectiveSplitPctA={effectiveSplitPctA}
          shortNameA={shortNameA}
          shortNameB={shortNameB}
          hasPartner={Boolean(memberB)}
        />

        <MonthlyCalendarSection
          monthKey={selectedMonthKey}
          transactions={monthTransactions}
          recurring={recurring}
          uiMode="sencillo"
          isClosed={isClosed}
          memberLabel={memberLabel}
          effectiveSplitPctA={effectiveSplitPctA}
          onAddExpenseForDay={(prefill) => {
            setEditingTx(null);
            setTxPrefill(prefill);
            setTxModalOpen(true);
          }}
          onEditTransaction={(tx) => {
            setTxPrefill(null);
            setEditingTx(tx);
            setTxModalOpen(true);
          }}
        />

        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <h2 className="font-display text-base font-bold">Gastos ({simpleList.length})</h2>

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
                <li
                  key={tx.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <CategoryTag category={tx.category} size="xs" />
                      <p className="text-sm font-bold truncate">{tx.concept}</p>
                      {tx.isPrivate && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                          <Lock className="w-3 h-3" />
                          <span>Privado</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateES(tx.date)}
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
                            setTxPrefill(null);
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
            setTxPrefill(null);
          }}
          editingTx={editingTx}
          prefill={txPrefill}
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

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
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

      <GlobalSearchSection
        open={globalSearchOpen}
        cachedHistory={cachedHistory}
        historyLoading={historyLoading}
        historyError={historyError}
        globalText={globalText}
        globalAmount={globalAmount}
        globalCategory={globalCategory}
        globalLimit={globalLimit}
        hasGlobalCriteria={hasGlobalCriteria}
        globalResults={globalResults}
        globalTotalAmount={globalTotalAmount}
        closedMonthKeys={closedMonthKeys}
        memberLabel={memberLabel}
        onRefresh={() => void loadHistoryOnDemand(true)}
        onTextChange={(val) => {
          setGlobalText(val);
          setGlobalLimit(40);
        }}
        onAmountChange={(val) => {
          setGlobalAmount(val);
          setGlobalLimit(40);
        }}
        onCategoryChange={(val) => {
          setGlobalCategory(val);
          setGlobalLimit(40);
        }}
        onClearCriteria={() => {
          setGlobalText('');
          setGlobalAmount('');
          setGlobalCategory('todas');
        }}
        onShowMore={() => setGlobalLimit((n) => n + 40)}
        onClose={() => setGlobalSearchOpen(false)}
        onGoToMonth={setSelectedMonthKey}
        onEditTx={(tx) => {
          setTxPrefill(null);
          setEditingTx(tx);
          setTxModalOpen(true);
        }}
        onDeleteTx={(tx) => setDeleteTarget({ kind: 'tx', item: tx })}
      />

      {isClosed && closure && (
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-2.5 text-sm">
          <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
          <span>
            <strong>Mes cerrado.</strong> Foto guardada: {closure.settlementText} (Total{' '}
            {formatEUR(closure.totalSpent)}). Edición y borrado masivo bloqueados hasta desbloquear.
          </span>
        </div>
      )}

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
                  setTxPrefill(null);
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
              disabled={generatingTemplates}
              onClick={() => void handleGenerateFromTemplates()}
              className="min-h-[44px] px-4 rounded-xl border border-[#0E5A64] text-[#0E5A64] dark:text-[#5EEAD4] dark:border-[#5EEAD4] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#0E5A64]/5 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${generatingTemplates ? 'animate-spin' : ''}`} />
              <span>
                {generatingTemplates
                  ? 'Generando...'
                  : 'Generar gastos del mes desde plantillas'}
              </span>
            </button>
          </div>
        )}
      </section>

      <CommonAccountRadarCard
        monthKey={selectedMonthKey}
        transactions={monthTransactions}
        recurring={recurring}
        uiMode="avanzado"
        effectiveSplitPctA={effectiveSplitPctA}
        shortNameA={shortNameA}
        shortNameB={shortNameB}
        hasPartner={Boolean(memberB)}
      />

      <MonthlyCalendarSection
        monthKey={selectedMonthKey}
        transactions={monthTransactions}
        recurring={recurring}
        uiMode="avanzado"
        isClosed={isClosed}
        memberLabel={memberLabel}
        effectiveSplitPctA={effectiveSplitPctA}
        onAddExpenseForDay={(prefill) => {
          setEditingTx(null);
          setTxPrefill(prefill);
          setTxModalOpen(true);
        }}
        onEditTransaction={(tx) => {
          setTxPrefill(null);
          setEditingTx(tx);
          setTxModalOpen(true);
        }}
        onOpenColorModal={() => setColorModalOpen(true)}
      />

      <TransactionsTableSection
        selectedMonthKey={selectedMonthKey}
        monthTransactionsCount={monthTransactions.length}
        filteredTransactions={filteredAndSortedTransactions}
        isClosed={isClosed}
        txSearch={txSearch}
        categoryFilter={categoryFilter}
        payerFilter={payerFilter}
        selectedTxIds={selectedTxIds}
        memberA={memberA}
        memberB={memberB}
        effectiveSplitPctA={effectiveSplitPctA}
        memberLabel={memberLabel}
        onTxSearchChange={setTxSearch}
        onCategoryFilterChange={setCategoryFilter}
        onPayerFilterChange={setPayerFilter}
        onSortClick={handleSortClick}
        onToggleSelectAll={(checked) => {
          if (checked) {
            setSelectedTxIds(new Set(filteredAndSortedTransactions.map((t) => t.id)));
          } else {
            setSelectedTxIds(new Set());
          }
        }}
        onToggleSelectOne={(id, checked) => {
          setSelectedTxIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
        onBulkDeleteRequest={() => setConfirmBulkDeleteTx(true)}
        onSaveInlineEdit={handleSaveInlineEdit}
        onOpenEditModal={(tx) => {
          setTxPrefill(null);
          setEditingTx(tx);
          setTxModalOpen(true);
        }}
        onDeleteRequest={(tx) => setDeleteTarget({ kind: 'tx', item: tx })}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BudgetProgressCard
          budgetProgress={budgetProgress}
          isClosed={isClosed}
          onOpenBudgetEditor={() => setBudgetModalOpen(true)}
        />

        <RecurringTemplatesSection
          sectionRef={plantillasSectionRef}
          recurring={recurring}
          memberLabel={memberLabel}
          onOpenHabitualModal={() => setHabitualModalOpen(true)}
          onOpenRecModal={openRecModal}
          onOpenIcsModal={() => setIcsModalOpen(true)}
          onDeleteRequest={(rec) => setDeleteTarget({ kind: 'rec', item: rec })}
        />
      </div>

      <CategoryComparisonSection
        selectedMonthKey={selectedMonthKey}
        categoryComparison={categoryComparison}
      />

      <QuickExpenseModal
        open={txModalOpen}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
          setTxPrefill(null);
        }}
        editingTx={editingTx}
        prefill={txPrefill}
        onSaved={() => {
          setCachedHistory(null);
          if (globalSearchOpen) void loadHistoryOnDemand(true);
        }}
      />

      <CategoryColorModal open={colorModalOpen} onClose={() => setColorModalOpen(false)} />

      <RecurringIcsModal
        open={icsModalOpen}
        onClose={() => setIcsModalOpen(false)}
        householdName={household?.name || 'Nido'}
        fromMonthKey={selectedMonthKey}
        recurring={recurring}
        onDownloaded={(count) =>
          showToast(`Calendario .ics descargado (${count} evento${count === 1 ? '' : 's'})`)
        }
      />

      <BankCsvImportModal
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onImported={() => {
          setCachedHistory(null);
          if (globalSearchOpen) void loadHistoryOnDemand(true);
        }}
      />

      <RecurringTemplateModal
        open={recModalOpen}
        editingRec={editingRec}
        activateOnOpen={recActivateOnOpen}
        selectedMonthKey={selectedMonthKey}
        transactions={comparisonSourceTransactions}
        memberA={memberA}
        memberB={memberB}
        viewerIsMemberA={viewerIsMemberA}
        effectiveSplitPctA={effectiveSplitPctA}
        onSave={handleSaveRecurringPayload}
        onDeleteRequest={(rec) => setDeleteTarget({ kind: 'rec', item: rec })}
        onClose={() => setRecModalOpen(false)}
      />

      <HabitualCatalogModal
        open={habitualModalOpen}
        selectedMonthKey={selectedMonthKey}
        isClosed={isClosed}
        recurring={recurring}
        budget={budget}
        onSave={handleSaveHabitualCatalog}
        onClose={() => setHabitualModalOpen(false)}
      />

      <BudgetEditorModal
        open={budgetModalOpen}
        selectedMonthKey={selectedMonthKey}
        budget={budget}
        activeFixedByCategory={activeFixedByCategory}
        onSave={handleSaveBudgets}
        onClose={() => setBudgetModalOpen(false)}
      />

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
