import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
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
import { AnnualBalanceSection } from '../components/mensual/AnnualBalanceSection';
import {
  BudgetProgressCard,
  CategoryComparisonSection,
} from '../components/mensual/BudgetAndComparisonSection';
import { BudgetEditorModal } from '../components/mensual/BudgetEditorModal';
import { CategoryColorModal } from '../components/mensual/CategoryColorModal';
import { CommonAccountRadarCard } from '../components/mensual/CommonAccountRadarCard';
import { GlobalSearchSection } from '../components/mensual/GlobalSearchSection';
import { GuidedMonthCloseModal } from '../components/mensual/GuidedMonthCloseModal';
import { HabitualCatalogModal } from '../components/mensual/HabitualCatalogModal';
import { MonthlyCalendarSection } from '../components/mensual/MonthlyCalendarSection';
import { MonthlySummaryCard } from '../components/mensual/MonthlySummaryCard';
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
  annualBalanceSessionCache,
  computeAnnualBalance,
  extractAvailableYears,
  type ScopedAnnualBalanceEntry,
} from '../domain/annualBalance';
import {
  filterGlobalExpenses,
  globalSearchSessionCache,
  type GlobalSearchOrigin,
} from '../domain/globalSearch';
import { computeCommonAccountRadar } from '../domain/commonAccountRadar';
import { computeMonthlyPlanSummary } from '../domain/monthlyPlanning';
import type { RecurringCatalogPreset } from '../domain/presets';
import { loadAndExportNidoPDF } from '../services/pdfExportLoader';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type ExpenseCategory,
  type ExpensePrefill,
  type InitialCost,
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
    setActiveTab,
    focusMensualSection,
    clearFocusMensualSection,
    uiMode,
    recurring,
    monthTransactions,
    recentTransactions,
    budget,
    monthClosures,
    customCategories,
    categoryRegistry,
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

  // Avanzado: Global search on demand (no permanent listener; cached in session scoped by householdId + viewerUid)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [cachedHistory, setCachedHistory] = useState<Transaction[] | null>(null);
  const [cachedInitialCosts, setCachedInitialCosts] = useState<InitialCost[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [globalOrigin, setGlobalOrigin] = useState<GlobalSearchOrigin>('todos');
  const [globalPayer, setGlobalPayer] = useState<string>('todos');
  const [globalText, setGlobalText] = useState('');
  const [globalAmount, setGlobalAmount] = useState('');
  const [globalCategory, setGlobalCategory] = useState<string>('todas');
  const [globalLimit, setGlobalLimit] = useState(40);
  const historyLoadSeqRef = useRef(0);

  // Balance anual bajo demanda (sin listener desde Inicio; caché aislada por householdId + viewerUid)
  const [annualBalanceOpen, setAnnualBalanceOpen] = useState(false);
  const [annualYear, setAnnualYear] = useState<number>(() => Number(getTodayLocalISO().slice(0, 4)));
  const [annualData, setAnnualData] = useState<ScopedAnnualBalanceEntry | null>(null);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [annualError, setAnnualError] = useState<string | null>(null);
  const annualLoadSeqRef = useRef(0);

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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);

  const plantillasSectionRef = useRef<HTMLElement | null>(null);
  const transactionsSectionRef = useRef<HTMLDivElement | null>(null);

  // Confirm dialogs
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'tx'; item: Transaction }
    | { kind: 'rec'; item: RecurringExpense }
    | null
  >(null);
  const [guidedCloseOpen, setGuidedCloseOpen] = useState(false);

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

  // Focus plantillas section or guided close modal when navigated from Inicio CTA
  useEffect(() => {
    if (focusMensualSection === 'cierre_guiado') {
      setGuidedCloseOpen(true);
      clearFocusMensualSection();
      return;
    }
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

  const plannedCommonCategories = useMemo(
    () => household?.commonAccountPlannedCategories ?? [],
    [household?.commonAccountPlannedCategories]
  );

  const manualCommonBalance = household?.commonAccountManualBalance ?? null;

  const monthlyPlanSummary = useMemo(
    () =>
      computeMonthlyPlanSummary({
        monthKey: selectedMonthKey,
        transactions: monthTransactions,
        recurring,
        budget,
        categoryRegistry,
      }),
    [selectedMonthKey, monthTransactions, recurring, budget, categoryRegistry]
  );

  const commonMonthlySummary = useMemo(
    () =>
      computeCommonAccountRadar(
        selectedMonthKey,
        monthTransactions,
        recurring,
        effectiveSplitPctA,
        {
          manualBalance: manualCommonBalance,
          budget,
          plannedCommonCategoryIds: plannedCommonCategories,
          categoryRegistry,
        }
      ),
    [
      selectedMonthKey,
      monthTransactions,
      recurring,
      effectiveSplitPctA,
      manualCommonBalance,
      budget,
      plannedCommonCategories,
      categoryRegistry,
    ]
  );

  const scrollToTemplatesSection = () => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    plantillasSectionRef.current?.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const handleSavePlannedCommonCategories = async (categoryIds: string[]) => {
    if (!householdId) return;
    if (isClosed) {
      showToast('Este mes está cerrado y no se puede cambiar la planificación.');
      return;
    }
    try {
      await repo.updateCommonAccountPlannedCategories(householdId, categoryIds);
      showToast('Planificación de Cuenta común guardada');
    } catch (err) {
      const msg = toUserFriendlyErrorMessage(
        err,
        'No se pudieron guardar las categorías de Cuenta común.'
      );
      showToast(msg);
      throw new Error(msg);
    }
  };

  const handleSaveManualCommonBalance = async (
    nextBalance: { amount: number; referenceDate: string } | null
  ) => {
    if (!householdId || !currentUserProfile) return;
    if (isClosed) {
      showToast('Este mes está cerrado y no se puede cambiar la planificación.');
      return;
    }
    try {
      await repo.updateCommonAccountManualBalance(householdId, nextBalance, currentUserProfile);
      showToast(
        nextBalance === null
          ? 'Saldo disponible de Cuenta común eliminado'
          : 'Saldo disponible de Cuenta común actualizado'
      );
    } catch (err) {
      const msg = toUserFriendlyErrorMessage(
        err,
        'No se pudo actualizar el saldo de Cuenta común.'
      );
      showToast(msg);
      throw new Error(msg);
    }
  };

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

  // Reset local view state when household or viewer user changes (strict scope isolation)
  useEffect(() => {
    historyLoadSeqRef.current += 1;
    annualLoadSeqRef.current += 1;
    const scoped =
      householdId && currentUserProfile?.uid
        ? globalSearchSessionCache.get(householdId, currentUserProfile.uid)
        : null;
    setCachedHistory(scoped ? scoped.transactions : null);
    setCachedInitialCosts(scoped ? scoped.initialCosts : null);
    setHistoryError(null);
    setHistoryLoading(false);

    const scopedAnnual =
      householdId && currentUserProfile?.uid
        ? annualBalanceSessionCache.get(householdId, currentUserProfile.uid)
        : null;
    setAnnualData(scopedAnnual);
    setAnnualError(null);
    setAnnualLoading(false);
    setAnnualBalanceOpen(false);
  }, [householdId, currentUserProfile?.uid]);

  const invalidateScopedHistoryCache = () => {
    if (householdId && currentUserProfile?.uid) {
      globalSearchSessionCache.invalidateScope(householdId, currentUserProfile.uid);
      annualBalanceSessionCache.invalidateScope(householdId, currentUserProfile.uid);
    } else if (householdId) {
      globalSearchSessionCache.invalidateHousehold(householdId);
      annualBalanceSessionCache.invalidateHousehold(householdId);
    }
    setCachedHistory(null);
    setCachedInitialCosts(null);
    setAnnualData(null);
  };

  const loadAnnualBalanceOnDemand = async (force = false) => {
    if (!householdId || !currentUserProfile) return;
    const scopeHouseholdId = householdId;
    const scopeUid = currentUserProfile.uid;

    if (!force) {
      const existing = annualBalanceSessionCache.get(scopeHouseholdId, scopeUid);
      if (existing) {
        setAnnualData(existing);
        setAnnualError(null);
        return;
      }
    }

    const requestSeq = ++annualLoadSeqRef.current;
    setAnnualLoading(true);
    setAnnualError(null);
    try {
      const raw = await repo.fetchAnnualBalanceData(scopeHouseholdId);
      if (requestSeq !== annualLoadSeqRef.current) return;
      const entry: ScopedAnnualBalanceEntry = {
        sharedTransactions: raw.sharedTransactions,
        systemBudgets: raw.systemBudgets,
        categoryBudgets: raw.categoryBudgets,
        loadedAt: Date.now(),
      };
      annualBalanceSessionCache.set(scopeHouseholdId, scopeUid, entry);
      setAnnualData(entry);
    } catch (err) {
      if (requestSeq !== annualLoadSeqRef.current) return;
      setAnnualError(
        toUserFriendlyErrorMessage(
          err,
          'No se pudieron cargar los datos para el balance anual.'
        )
      );
    } finally {
      if (requestSeq === annualLoadSeqRef.current) {
        setAnnualLoading(false);
      }
    }
  };

  const openAnnualBalanceView = () => {
    setAnnualYear(Number(getTodayLocalISO().slice(0, 4)));
    setAnnualBalanceOpen(true);
    void loadAnnualBalanceOnDemand(false);
  };

  const handleJumpToMonthFromAnnual = (monthKey: string) => {
    setSelectedMonthKey(monthKey);
    setCategoryFilter('todas');
    setAnnualBalanceOpen(false);
  };

  const handleJumpToCategoryFromAnnual = (monthKey: string, categoryId: string) => {
    setSelectedMonthKey(monthKey);
    setCategoryFilter(categoryId);
    setAnnualBalanceOpen(false);
    if (uiMode === 'avanzado') {
      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => {
        transactionsSectionRef.current?.scrollIntoView({
          behavior: prefersReduced ? 'auto' : 'smooth',
          block: 'start',
        });
      }, 60);
    }
  };

  const annualAvailableYears = useMemo(() => {
    if (!annualData) return [annualYear];
    return extractAvailableYears({
      sharedTransactions: annualData.sharedTransactions,
      monthClosures,
      systemBudgets: annualData.systemBudgets,
      categoryBudgets: annualData.categoryBudgets,
      todayISO: getTodayLocalISO(),
      selectedYear: annualYear,
    });
  }, [annualData, monthClosures, annualYear]);

  const annualBalanceResult = useMemo(() => {
    if (!annualBalanceOpen || !annualData) return null;
    return computeAnnualBalance({
      year: annualYear,
      sharedTransactions: annualData.sharedTransactions,
      systemBudgets: annualData.systemBudgets,
      categoryBudgets: annualData.categoryBudgets,
      monthClosures,
      recurring,
      categoryRegistry,
      todayISO: getTodayLocalISO(),
    });
  }, [annualBalanceOpen, annualData, annualYear, monthClosures, recurring, categoryRegistry]);

  const loadHistoryOnDemand = async (force = false) => {
    if (!householdId || !currentUserProfile) return;
    const scopeHouseholdId = householdId;
    const scopeUid = currentUserProfile.uid;

    if (!force) {
      const existing = globalSearchSessionCache.get(scopeHouseholdId, scopeUid);
      if (existing) {
        setCachedHistory(existing.transactions);
        setCachedInitialCosts(existing.initialCosts);
        setHistoryError(null);
        return;
      }
    }

    const requestSeq = ++historyLoadSeqRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const [rows, costs] = await Promise.all([
        repo.fetchAllTransactions(scopeHouseholdId, scopeUid),
        repo.fetchAllInitialCosts(scopeHouseholdId),
      ]);
      // Ignorar si cambió de hogar/usuario o hubo una petición más reciente mientras cargaba
      if (requestSeq !== historyLoadSeqRef.current) return;
      globalSearchSessionCache.set(scopeHouseholdId, scopeUid, {
        transactions: rows,
        initialCosts: costs,
      });
      setCachedHistory(rows);
      setCachedInitialCosts(costs);
    } catch (err) {
      if (requestSeq !== historyLoadSeqRef.current) return;
      setHistoryError(
        toUserFriendlyErrorMessage(
          err,
          'No se pudo cargar el historial de movimientos y mudanza.'
        )
      );
    } finally {
      if (requestSeq === historyLoadSeqRef.current) {
        setHistoryLoading(false);
      }
    }
  };

  const hasGlobalCriteria =
    globalText.trim() !== '' ||
    globalAmount.trim() !== '' ||
    globalCategory !== 'todas' ||
    globalOrigin !== 'todos' ||
    globalPayer !== 'todos';

  const globalSummary = useMemo(() => {
    if (
      uiMode !== 'avanzado' ||
      !globalSearchOpen ||
      cachedHistory === null ||
      cachedInitialCosts === null
    ) {
      return {
        items: [],
        monthlyCount: 0,
        monthlyExpenseTotal: 0,
        movingCount: 0,
        movingTotal: 0,
        movingPaidTotal: 0,
        movingPendingTotal: 0,
      };
    }
    return filterGlobalExpenses(
      cachedHistory,
      cachedInitialCosts,
      {
        origin: globalOrigin,
        payer: globalPayer,
        text: globalText,
        amountQuery: globalAmount,
        category: globalCategory,
      },
      {
        viewerUid: currentUserProfile?.uid,
        expenseCategoryLabels: categoryRegistry.labelsMap,
      }
    );
  }, [
    uiMode,
    globalSearchOpen,
    cachedHistory,
    cachedInitialCosts,
    globalOrigin,
    globalPayer,
    globalText,
    globalAmount,
    globalCategory,
    currentUserProfile?.uid,
    categoryRegistry.labelsMap,
  ]);

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
      const normalizedPaidBy = tx.paidBy === 'comun' ? COMMON_ACCOUNT_ID : tx.paidBy;
      if (payerFilter !== 'todos' && normalizedPaidBy !== payerFilter) return false;
      if (q) {
        const hay = `${tx.concept} ${tx.notes} ${categoryRegistry.getLabel(tx.category)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'concept') cmp = a.concept.localeCompare(b.concept, 'es');
      else if (sortField === 'category') {
        cmp = categoryRegistry
          .getLabel(a.category)
          .localeCompare(categoryRegistry.getLabel(b.category), 'es');
      } else {
        cmp = a.amount - b.amount;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [uiMode, monthTransactions, txSearch, categoryFilter, payerFilter, sortField, sortAsc, categoryRegistry]);

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
      invalidateScopedHistoryCache();
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
      invalidateScopedHistoryCache();
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
      if (count > 0) {
        invalidateScopedHistoryCache();
        if (globalSearchOpen) void loadHistoryOnDemand(true);
      }
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

    try {
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
      invalidateScopedHistoryCache();
      if (globalSearchOpen) void loadHistoryOnDemand(true);
      showToast('Liquidación registrada');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo registrar la liquidación.'));
    }
  };

  const handleCloseMonth = async () => {
    if (!householdId || !currentUserProfile) return;
    try {
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
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo cerrar el mes.'));
    }
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
      invalidateScopedHistoryCache();
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

  const handleSaveBudgets = async (limits: Record<string, number>) => {
    if (!householdId || !currentUserProfile) return;
    if (isClosed) {
      showToast('No puedes modificar los presupuestos de un mes cerrado.');
      return;
    }
    await repo.saveAllBudgets(
      householdId,
      selectedMonthKey,
      limits,
      customCategories.map((c) => c.id),
      currentUserProfile
    );
    invalidateScopedHistoryCache();
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
      try {
        await repo.deleteTransaction(householdId, backup.id, backup.concept, currentUserProfile, {
          isPrivate: backup.isPrivate,
        });
        invalidateScopedHistoryCache();
        if (globalSearchOpen) void loadHistoryOnDemand(true);
        scheduleUndo(`Eliminado "${backup.concept}"`, async () => {
          if (closedMonthKeysRef.current.has(backup.monthKey)) {
            showToast('No se puede deshacer: el mes está cerrado.');
            return;
          }
          await repo.restoreTransaction(householdId, backup, currentUserProfile);
          invalidateScopedHistoryCache();
          if (globalSearchOpen) void loadHistoryOnDemand(true);
        });
      } catch (err) {
        showToast(toUserFriendlyErrorMessage(err, 'No se pudo eliminar el movimiento.'));
      }
    } else {
      try {
        await repo.deleteRecurring(householdId, target.item.id, target.item.concept, currentUserProfile);
        showToast('Plantilla eliminada');
      } catch (err) {
        showToast(toUserFriendlyErrorMessage(err, 'No se pudo eliminar la plantilla.'));
      }
    }
  };

  const handleExportCSV = () => {
    const csv = generateSpanishCSV(
      ['Fecha', 'Concepto', 'Categoría', 'Pagó', 'Reparto A (%)', 'Tipo', 'Importe (€)'],
      monthTransactions.map((t) => [
        formatDateES(t.date),
        t.concept,
        categoryRegistry.getLabel(t.category),
        memberLabel(t.paidBy),
        t.isPrivate ? 'Personal' : t.splitPctA,
        t.isPrivate ? 'Personal' : t.isSettlement ? 'Liquidación' : 'Gasto',
        t.amount,
      ])
    );
    downloadTextFile(`nido-mensual-${selectedMonthKey}.csv`, csv, 'text/csv;charset=utf-8;');
    showToast('CSV mensual descargado');
  };

  const handleExportPDF = async () => {
    if (!household || exportingPdf) return;
    setExportingPdf(true);
    setPdfExportError(null);
    const fromDate = `${selectedMonthKey}-01`;
    const toDate = `${selectedMonthKey}-${String(daysInMonth(selectedMonthKey)).padStart(2, '0')}`;
    try {
      await loadAndExportNidoPDF({
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
        categoryLabels: categoryRegistry.labelsMap,
      });
      showToast('PDF mensual descargado');
    } catch (err) {
      setPdfExportError(
        toUserFriendlyErrorMessage(
          err,
          'No se pudo cargar el módulo PDF. Comprueba tu conexión e inténtalo de nuevo.'
        )
      );
    } finally {
      setExportingPdf(false);
    }
  };

  // ─── VISTA DE BALANCE ANUAL (SENCILLO REDUCIDO Y AVANZADO COMPLETO) ─────────
  if (annualBalanceOpen) {
    return (
      <>
        <AnnualBalanceSection
          uiMode={uiMode}
          selectedYear={annualYear}
          availableYears={annualAvailableYears}
          balance={annualBalanceResult}
          loading={annualLoading}
          error={annualError}
          lastLoadedAt={annualData?.loadedAt ?? null}
          memberLabel={memberLabel}
          onSelectYear={setAnnualYear}
          onRefresh={() => void loadAnnualBalanceOnDemand(true)}
          onBackToMonth={() => setAnnualBalanceOpen(false)}
          onJumpToMonth={handleJumpToMonthFromAnnual}
          onJumpToCategory={handleJumpToCategoryFromAnnual}
          onConfigureRecurring={
            uiMode === 'avanzado' ? (rec) => openRecModal(rec, false) : undefined
          }
        />

        {uiMode === 'avanzado' && (
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
        )}
      </>
    );
  }

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

        {isClosed ? (
          <div className="rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <Lock className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Este mes ya está cerrado y no se puede cambiar.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={openAnnualBalanceView}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <BarChart3 className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                <span>Balance anual</span>
              </button>
              <button
                type="button"
                onClick={() => setGuidedCloseOpen(true)}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Ver resumen de cierre
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={openAnnualBalanceView}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <BarChart3 className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <span>Balance anual</span>
            </button>
            <button
              type="button"
              onClick={() => setGuidedCloseOpen(true)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <span>Cerrar mes</span>
            </button>
          </div>
        )}

        <MonthlySummaryCard
          summary={monthlyPlanSummary}
          uiMode="sencillo"
          isClosed={isClosed}
          secondPersonBalanceText={secondPersonBalanceText}
          isPeaceBalance={balance.owesDirection === 'peace'}
          personalMonthTotal={personalMonthTotal}
          commonAccountMonthlyNeed={commonMonthlySummary.totalMonthlyNeed}
        />

        <CommonAccountRadarCard
          monthKey={selectedMonthKey}
          transactions={monthTransactions}
          recurring={recurring}
          budget={budget}
          uiMode="sencillo"
          isClosed={isClosed}
          effectiveSplitPctA={effectiveSplitPctA}
          shortNameA={shortNameA}
          shortNameB={shortNameB}
          hasPartner={Boolean(memberB)}
          plannedCategoryIds={plannedCommonCategories}
          manualBalance={manualCommonBalance}
          memberLabel={memberLabel}
          onSavePlannedCategories={handleSavePlannedCommonCategories}
          onSaveManualBalance={handleSaveManualCommonBalance}
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

        <GuidedMonthCloseModal
          open={guidedCloseOpen}
          onClose={() => setGuidedCloseOpen(false)}
          uiMode="sencillo"
          selectedMonthKey={selectedMonthKey}
          isClosed={isClosed}
          closure={closure ?? undefined}
          monthlyPlanSummary={monthlyPlanSummary}
          monthTransactions={monthTransactions}
          recentTransactions={recentTransactions}
          recurring={recurring}
          budget={budget}
          customCategories={customCategories}
          balance={balance}
          secondPersonBalanceText={secondPersonBalanceText}
          memberA={memberA}
          memberB={memberB}
          effectiveSplitPctA={effectiveSplitPctA}
          closedMonthKeys={closedMonthKeys}
          onRegisterSettlement={handleRegisterSettlement}
          onCloseMonth={handleCloseMonth}
          onAfterTransactionCreated={invalidateScopedHistoryCache}
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
            onClick={openAnnualBalanceView}
            className="min-h-[44px] px-3.5 rounded-xl border border-[#0E5A64]/40 dark:border-[#5EEAD4]/40 bg-[#0E5A64]/5 dark:bg-[#5EEAD4]/10 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#0E5A64]/10 dark:hover:bg-[#5EEAD4]/15 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Balance anual</span>
          </button>
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
            disabled={exportingPdf}
            onClick={() => void handleExportPDF()}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{exportingPdf ? 'Generando PDF...' : 'PDF'}</span>
          </button>
          {!isClosed ? (
            <button
              type="button"
              onClick={() => setGuidedCloseOpen(true)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Lock className="w-4 h-4" />
              <span>Cerrar mes</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setGuidedCloseOpen(true)}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Lock className="w-4 h-4 text-slate-500" />
                <span>Ver resumen de cierre</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!householdId || !currentUserProfile) return;
                  try {
                    await repo.reopenMonth(householdId, selectedMonthKey, currentUserProfile);
                    showToast(`Mes ${selectedMonthKey} desbloqueado`);
                  } catch (err) {
                    showToast(toUserFriendlyErrorMessage(err, 'No se pudo desbloquear el mes.'));
                  }
                }}
                className="min-h-[44px] px-3.5 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5"
              >
                <Unlock className="w-4 h-4" />
                <span>Desbloquear mes</span>
              </button>
            </>
          )}
        </div>
      </div>

      {pdfExportError && (
        <div
          role="alert"
          className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] px-4 py-3 text-xs font-medium flex flex-wrap items-center justify-between gap-2"
        >
          <span>{pdfExportError}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={exportingPdf}
              onClick={() => void handleExportPDF()}
              className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64] text-white font-semibold disabled:opacity-50"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => setPdfExportError(null)}
              className="min-h-[44px] px-2.5 rounded-lg border border-current/30 font-semibold"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      <GlobalSearchSection
        open={globalSearchOpen}
        cachedMonthlyCount={cachedHistory ? cachedHistory.length : null}
        cachedMovingCount={cachedInitialCosts ? cachedInitialCosts.length : null}
        historyLoading={historyLoading}
        historyError={historyError}
        globalOrigin={globalOrigin}
        globalPayer={globalPayer}
        globalText={globalText}
        globalAmount={globalAmount}
        globalCategory={globalCategory}
        globalLimit={globalLimit}
        hasGlobalCriteria={hasGlobalCriteria}
        summary={globalSummary}
        closedMonthKeys={closedMonthKeys}
        memberA={memberA}
        memberB={memberB}
        memberLabel={memberLabel}
        onRefresh={() => void loadHistoryOnDemand(true)}
        onOriginChange={(val) => {
          setGlobalOrigin(val);
          setGlobalLimit(40);
        }}
        onPayerChange={(val) => {
          setGlobalPayer(val);
          setGlobalLimit(40);
        }}
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
          setGlobalOrigin('todos');
          setGlobalPayer('todos');
          setGlobalText('');
          setGlobalAmount('');
          setGlobalCategory('todas');
        }}
        onShowMore={() => setGlobalLimit((n) => n + 40)}
        onClose={() => setGlobalSearchOpen(false)}
        onGoToMonth={setSelectedMonthKey}
        onGoToMudanza={() => setActiveTab('mudanza')}
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

      <MonthlySummaryCard
        summary={monthlyPlanSummary}
        uiMode="avanzado"
        isClosed={isClosed}
        onOpenBudgetEditor={() => setBudgetModalOpen(true)}
        onScrollToTemplates={scrollToTemplatesSection}
      />

      <CommonAccountRadarCard
        monthKey={selectedMonthKey}
        transactions={monthTransactions}
        recurring={recurring}
        budget={budget}
        uiMode="avanzado"
        isClosed={isClosed}
        effectiveSplitPctA={effectiveSplitPctA}
        shortNameA={shortNameA}
        shortNameB={shortNameB}
        hasPartner={Boolean(memberB)}
        plannedCategoryIds={plannedCommonCategories}
        manualBalance={manualCommonBalance}
        memberLabel={memberLabel}
        onSavePlannedCategories={handleSavePlannedCommonCategories}
        onSaveManualBalance={handleSaveManualCommonBalance}
        onOpenBudgetEditor={() => setBudgetModalOpen(true)}
        onScrollToTemplates={scrollToTemplatesSection}
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

      <div ref={transactionsSectionRef}>
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
      </div>

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
          invalidateScopedHistoryCache();
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
          invalidateScopedHistoryCache();
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
        isClosed={isClosed}
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

      <GuidedMonthCloseModal
        open={guidedCloseOpen}
        onClose={() => setGuidedCloseOpen(false)}
        uiMode="avanzado"
        selectedMonthKey={selectedMonthKey}
        isClosed={isClosed}
        closure={closure ?? undefined}
        monthlyPlanSummary={monthlyPlanSummary}
        monthTransactions={monthTransactions}
        recentTransactions={recentTransactions}
        recurring={recurring}
        budget={budget}
        customCategories={customCategories}
        balance={balance}
        secondPersonBalanceText={secondPersonBalanceText}
        memberA={memberA}
        memberB={memberB}
        effectiveSplitPctA={effectiveSplitPctA}
        closedMonthKeys={closedMonthKeys}
        onRegisterSettlement={handleRegisterSettlement}
        onCloseMonth={handleCloseMonth}
        onAfterTransactionCreated={invalidateScopedHistoryCache}
      />
    </div>
  );
};
