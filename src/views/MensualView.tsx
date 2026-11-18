import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
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
  SlidersHorizontal,
  Trash2,
  Unlock,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QuickExpenseModal } from '../components/QuickExpenseModal';
import { useNido } from '../context/NidoContext';
import { downloadTextFile, generateSpanishCSV } from '../domain/backup';
import {
  calculateCoupleBalance,
  computeBudgetProgress,
  daysInMonth,
  findMissingRecurringForMonth,
  formatDateES,
  formatEUR,
  formatMonthLabelES,
  getTodayLocalISO,
  monthlyEquivalent,
  shiftMonthKey,
} from '../domain/finance';
import {
  EXPENSE_CATEGORY_LABELS,
  FREQUENCY_LABELS,
  TRANSACTION_CATEGORY_LABELS,
} from '../domain/presets';
import { exportNidoPDF } from '../services/pdfExport';
import type {
  ExpenseCategory,
  MonthlyBudget,
  RecurrenceFrequency,
  RecurringExpense,
  Transaction,
} from '../types/nido';

export const MensualView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentUserProfile,
    effectiveSplitPctA,
    selectedMonthKey,
    setSelectedMonthKey,
    uiMode,
    recurring,
    monthTransactions,
    budget,
    monthClosures,
    initialCosts,
    furnitureItems,
    goals,
    goalMovements,
    repo,
    showToast,
    scheduleUndo,
  } = useNido();

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);

  // Recurring modal
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<RecurringExpense | null>(null);
  const [recConcept, setRecConcept] = useState('');
  const [recCategory, setRecCategory] = useState<ExpenseCategory>('alquiler');
  const [recAmount, setRecAmount] = useState('');
  const [recFrequency, setRecFrequency] = useState<RecurrenceFrequency>('mensual');
  const [recDay, setRecDay] = useState('1');
  const [recPaidBy, setRecPaidBy] = useState('cuenta_comun');
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

  const balance = useMemo(
    () => calculateCoupleBalance(monthTransactions, memberA, memberB),
    [monthTransactions, memberA, memberB]
  );

  const budgetProgress = useMemo(
    () => computeBudgetProgress(monthTransactions, budget),
    [monthTransactions, budget]
  );

  const missingRecurring = useMemo(
    () => findMissingRecurringForMonth(recurring, monthTransactions, selectedMonthKey),
    [recurring, monthTransactions, selectedMonthKey]
  );

  const nameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const nameB = memberB?.displayName?.split(' ')[0] || 'Pareja';

  const memberLabel = (uid: string) => {
    if (uid === 'cuenta_comun' || uid === 'comun') return 'Cuenta común';
    return members.find((m) => m.uid === uid)?.displayName?.split(' ')[0] || 'Pareja';
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
    setRecPaidBy(rec?.paidByDefault ?? 'cuenta_comun');
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
        splitOverride: null,
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
      draft[cat] = val ? String(val) : '';
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
      await repo.deleteTransaction(householdId, backup.id, backup.concept, currentUserProfile);
      scheduleUndo(`Eliminado "${backup.concept}"`, () =>
        repo.restoreTransaction(householdId, backup, currentUserProfile)
      );
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
        t.splitPctA,
        t.isSettlement ? 'Liquidación' : 'Gasto',
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
      initialCosts,
      items: furnitureItems,
      goals,
      goalMovements,
    });
    showToast('PDF mensual descargado');
  };

  const statusBadge = (status: 'sin_limite' | 'verde' | 'ambar' | 'rojo') => {
    switch (status) {
      case 'verde':
        return { bar: 'bg-[#15803D]', text: 'text-[#15803D] dark:text-[#4ADE80]', label: 'En presupuesto' };
      case 'ambar':
        return { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: 'Cerca del límite' };
      case 'rojo':
        return { bar: 'bg-[#DC4C3E]', text: 'text-[#DC4C3E]', label: 'Superado' };
      default:
        return { bar: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', label: 'Sin límite' };
    }
  };

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
              Reparto vigente: {nameA} {effectiveSplitPctA}% · {nameB} {Math.round((100 - effectiveSplitPctA) * 10) / 10}%
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
            uiMode === 'avanzado' && (
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
            )
          )}
        </div>
      </div>

      {isClosed && closure && (
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-sm">
            <Lock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
            <span>
              <strong>Mes cerrado.</strong> Foto guardada: {closure.settlementText} (Total {formatEUR(closure.totalSpent)}).
            </span>
          </div>
          {uiMode === 'sencillo' && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Activa Modo Avanzado en Ajustes para desbloquear.
            </span>
          )}
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
              Total mes: {formatEUR(balance.totalSpent)} · {nameA} pagó {formatEUR(balance.paidA)} (corresponde {formatEUR(balance.shareA)}) · {nameB} pagó {formatEUR(balance.paidB)} (corresponde {formatEUR(balance.shareB)})
              {balance.paidComun > 0 ? ` · Cuenta común: ${formatEUR(balance.paidComun)}` : ''}
            </p>
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

      {/* Budget vs Real + Transactions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Transactions list */}
        <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">
              Movimientos ({monthTransactions.length})
            </h2>
          </div>

          {monthTransactions.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-semibold">No hay gastos en {formatMonthLabelES(selectedMonthKey)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pulsa «Añadir gasto» o genera los gastos fijos desde vuestras plantillas.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {monthTransactions.map((tx) => (
                <li key={tx.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {tx.concept}
                      {tx.isSettlement ? ' · Liquidación' : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateES(tx.date)} · {TRANSACTION_CATEGORY_LABELS[tx.category]} · Pagó: {memberLabel(tx.paidBy)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`font-mono-num text-sm font-bold mr-1 ${
                        tx.isSettlement ? 'text-[#15803D] dark:text-[#4ADE80]' : ''
                      }`}
                    >
                      {formatEUR(tx.amount)}
                    </span>
                    {!isClosed && (
                      <>
                        {!tx.isSettlement && (
                          <button
                            type="button"
                            aria-label={`Editar ${tx.concept}`}
                            onClick={() => {
                              setEditingTx(tx);
                              setTxModalOpen(true);
                            }}
                            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Eliminar ${tx.concept}`}
                          onClick={() => setDeleteTarget({ kind: 'tx', item: tx })}
                          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
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

        {/* Budget vs Real + Recurring */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Presupuesto vs real</h2>
              {!isClosed && (
                <button
                  type="button"
                  onClick={openBudgetEditor}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5"
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

          {/* Recurring Templates & Simple Day-of-Month Calendar */}
          <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                <h2 className="font-display text-base font-bold">Plantillas y calendario</h2>
              </div>
              <button
                type="button"
                onClick={() => openRecModal(null)}
                className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1"
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
                          {rec.frequency !== 'mensual'
                            ? ` · Equiv. mensual: ${formatEUR(equiv)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-mono-num text-xs font-bold">{formatEUR(rec.amount)}</span>
                        {uiMode === 'avanzado' && (
                          <>
                            <button
                              type="button"
                              aria-label={`Editar plantilla ${rec.concept}`}
                              onClick={() => openRecModal(rec)}
                              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Eliminar plantilla ${rec.concept}`}
                              onClick={() => setDeleteTarget({ kind: 'rec', item: rec })}
                              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Modals */}
      <QuickExpenseModal
        open={txModalOpen}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        editingTx={editingTx}
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
                  <option value="cuenta_comun">Cuenta común</option>
                  {memberA && <option value={memberA.uid}>{nameA}</option>}
                  {memberB && <option value={memberB.uid}>{nameB}</option>}
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
                    className="w-32 min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm text-right"
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
