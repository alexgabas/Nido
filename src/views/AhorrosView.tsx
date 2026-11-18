import React, { useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Download,
  FileSpreadsheet,
  Pencil,
  PiggyBank,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { DonutChart } from '../components/Charts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNido } from '../context/NidoContext';
import { downloadTextFile, generateSpanishCSV } from '../domain/backup';
import {
  computeEmergencyTarget,
  computeGoalProgress,
  computeSavingsByMember,
  formatDateES,
  formatEUR,
  formatPctES,
  getTodayLocalISO,
  roundCents,
} from '../domain/finance';
import { GOAL_TYPE_LABELS } from '../domain/presets';
import { exportNidoPDF } from '../services/pdfExport';
import type { GoalType, SavingsGoal } from '../types/nido';

export const AhorrosView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentUserProfile,
    effectiveSplitPctA,
    uiMode,
    goals,
    goalMovements,
    recurring,
    monthTransactions,
    initialCosts,
    furnitureItems,
    repo,
    showToast,
  } = useNido();

  const todayISO = getTodayLocalISO();

  // Movement modal
  const [moveGoal, setMoveGoal] = useState<SavingsGoal | null>(null);
  const [moveDirection, setMoveDirection] = useState<'add' | 'withdraw'>('add');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveBy, setMoveBy] = useState(currentUserProfile?.uid || memberA?.uid || '');
  const [moveNote, setMoveNote] = useState('');

  // Goal create/edit modal (Avanzado)
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [goalColor, setGoalColor] = useState('#0E5A64');

  const [celebratedGoalName, setCelebratedGoalName] = useState<string | null>(null);
  const [deleteGoalTarget, setDeleteGoalTarget] = useState<SavingsGoal | null>(null);

  const activeGoals = useMemo(() => goals.filter((g) => !g.archived), [goals]);

  const goalsProgress = useMemo(
    () => activeGoals.map((g) => computeGoalProgress(g, goalMovements, todayISO)),
    [activeGoals, goalMovements, todayISO]
  );

  const totalSaved = useMemo(
    () => roundCents(goalsProgress.reduce((s, p) => s + p.savedAmount, 0)),
    [goalsProgress]
  );

  const totalTarget = useMemo(
    () => roundCents(activeGoals.reduce((s, g) => s + Math.max(0, Number(g.targetAmount) || 0), 0)),
    [activeGoals]
  );

  const emergency3x = useMemo(() => computeEmergencyTarget(recurring, 3), [recurring]);
  const emergency6x = useMemo(() => computeEmergencyTarget(recurring, 6), [recurring]);
  const emergencyGoal = activeGoals.find((g) => g.type === 'emergencia') ?? null;

  const memberShares = useMemo(
    () => computeSavingsByMember(goalMovements, memberA, memberB, effectiveSplitPctA),
    [goalMovements, memberA, memberB, effectiveSplitPctA]
  );

  const donutSlices = useMemo(
    () =>
      goalsProgress.map((gp) => ({
        label: gp.goal.name,
        value: gp.savedAmount,
        color: gp.goal.color || '#0E5A64',
      })),
    [goalsProgress]
  );

  const openMovementModal = (goal: SavingsGoal, direction: 'add' | 'withdraw') => {
    setMoveGoal(goal);
    setMoveDirection(direction);
    setMoveAmount('');
    setMoveBy(currentUserProfile?.uid || memberA?.uid || '');
    setMoveNote('');
  };

  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveGoal || !householdId || !currentUserProfile) return;
    const rawAmt = Number(moveAmount.replace(',', '.'));
    if (!Number.isFinite(rawAmt) || rawAmt <= 0) return;
    const signed =
      moveDirection === 'add'
        ? Math.round(rawAmt * 100) / 100
        : -Math.round(rawAmt * 100) / 100;

    const currentProg = computeGoalProgress(moveGoal, goalMovements, todayISO);
    const willComplete =
      !currentProg.isCompleted &&
      moveGoal.targetAmount > 0 &&
      currentProg.savedAmount + signed >= moveGoal.targetAmount;

    await repo.addGoalMovement(
      householdId,
      {
        goalId: moveGoal.id,
        amount: signed,
        by: moveBy || currentUserProfile.uid,
        date: todayISO,
        note: moveNote.trim(),
      },
      moveGoal.name,
      currentUserProfile
    );

    const completedName = moveGoal.name;
    setMoveGoal(null);
    if (willComplete) {
      setCelebratedGoalName(completedName);
      window.setTimeout(() => setCelebratedGoalName(null), 5000);
    } else {
      showToast(signed > 0 ? 'Aportación guardada' : 'Retirada guardada');
    }
  };

  const openGoalEditor = (goal: SavingsGoal | null) => {
    setEditingGoal(goal);
    setGoalName(goal?.name ?? '');
    setGoalTarget(goal ? String(goal.targetAmount) : '');
    setGoalDate(goal?.targetDate ?? '');
    setGoalType(goal?.type ?? 'custom');
    setGoalColor(goal?.color ?? '#0E5A64');
    setGoalModalOpen(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const target = Math.max(0, Number(goalTarget.replace(',', '.')) || 0);
    await repo.upsertGoal(
      householdId,
      {
        id: editingGoal?.id,
        name: goalName.trim(),
        icon: editingGoal?.icon ?? 'piggy-bank',
        color: goalColor,
        targetAmount: Math.round(target * 100) / 100,
        targetDate: goalDate,
        type: goalType,
        archived: false,
      },
      currentUserProfile
    );
    setGoalModalOpen(false);
    showToast('Meta de ahorro guardada');
  };

  const applyEmergencyTarget = async (amount: number) => {
    if (!householdId || !currentUserProfile || !emergencyGoal) return;
    await repo.upsertGoal(
      householdId,
      {
        ...emergencyGoal,
        targetAmount: amount,
      },
      currentUserProfile
    );
    showToast(`Colchón de emergencia actualizado a ${formatEUR(amount)}`);
  };

  const handleExportCSV = () => {
    const csv = generateSpanishCSV(
      ['Fecha', 'Meta', 'Persona', 'Nota', 'Importe (€)'],
      goalMovements.map((m) => [
        formatDateES(m.date),
        goals.find((g) => g.id === m.goalId)?.name || 'Meta',
        members.find((mb) => mb.uid === m.by)?.displayName?.split(' ')[0] || m.by,
        m.note,
        m.amount,
      ])
    );
    downloadTextFile(`nido-ahorros-${todayISO}.csv`, csv, 'text/csv;charset=utf-8;');
    showToast('CSV de ahorros descargado');
  };

  const handleExportPDF = () => {
    if (!household) return;
    exportNidoPDF({
      scope: 'ahorros',
      household,
      members,
      fromDate: todayISO.slice(0, 4) + '-01-01',
      toDate: todayISO,
      transactions: monthTransactions,
      initialCosts,
      items: furnitureItems,
      goals,
      goalMovements,
    });
    showToast('PDF de ahorros descargado');
  };

  const movementModal = moveGoal && (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <h2 id="move-modal-title" className="font-display text-lg font-bold">
          {moveDirection === 'add' ? 'Aportar a' : 'Retirar de'} {moveGoal.name}
        </h2>
        <form onSubmit={handleSaveMovement} className="space-y-4">
          <div>
            <label htmlFor="move-amount" className="block text-xs font-medium mb-1">
              Importe (€)
            </label>
            <input
              id="move-amount"
              type="text"
              inputMode="decimal"
              required
              autoFocus
              value={moveAmount}
              onChange={(e) => setMoveAmount(e.target.value)}
              placeholder="100,00"
              className="w-full min-h-[50px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-2xl font-bold"
            />
          </div>

          <div>
            <span className="block text-xs font-medium mb-1.5">Quién</span>
            <div className="grid grid-cols-2 gap-2">
              {memberA && (
                <button
                  type="button"
                  onClick={() => setMoveBy(memberA.uid)}
                  className={`min-h-[48px] px-3 rounded-xl text-sm font-semibold border transition-colors truncate ${
                    moveBy === memberA.uid
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {memberA.displayName}
                </button>
              )}
              {memberB && (
                <button
                  type="button"
                  onClick={() => setMoveBy(memberB.uid)}
                  className={`min-h-[48px] px-3 rounded-xl text-sm font-semibold border transition-colors truncate ${
                    moveBy === memberB.uid
                      ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {memberB.displayName}
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="move-note" className="block text-xs font-medium mb-1">
              Nota (opcional)
            </label>
            <input
              id="move-note"
              type="text"
              maxLength={240}
              value={moveNote}
              onChange={(e) => setMoveNote(e.target.value)}
              placeholder="Ej. Ahorro de este mes"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMoveGoal(null)}
              className="min-h-[46px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="min-h-[46px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ─── MODO SENCILLO: SOLO TOTAL + TARJETAS DE METAS CON APORTAR / RETIRAR ────
  if (uiMode === 'sencillo') {
    const overallBarPct =
      totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <header className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Ahorros</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vuestras metas para aportar o retirar cuando lo necesitéis.
          </p>
        </header>

        {celebratedGoalName && (
          <div
            role="status"
            className="rounded-2xl bg-[#15803D] text-white p-4 flex items-center gap-3 shadow-md"
          >
            <Sparkles className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-display font-bold text-base">
                ¡Meta «{celebratedGoalName}» completada!
              </p>
              <p className="text-xs text-white/90">Habéis llegado al objetivo.</p>
            </div>
          </div>
        )}

        {/* Total savings summary card (no donut, no %) */}
        <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Total ahorrado juntos
              </p>
              <p className="font-display text-3xl font-bold tabular-nums text-[#15803D] dark:text-[#4ADE80] mt-0.5">
                {formatEUR(totalSaved)}
              </p>
            </div>
            <span className="w-12 h-12 rounded-2xl bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80] flex items-center justify-center shrink-0">
              <PiggyBank className="w-6 h-6" />
            </span>
          </div>
          {totalTarget > 0 && (
            <div className="space-y-1.5">
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#15803D] dark:bg-[#4ADE80] transition-all duration-500"
                  style={{ width: `${overallBarPct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Objetivo total: {formatEUR(totalTarget)}
              </p>
            </div>
          )}
        </section>

        {/* Goal Cards */}
        {goalsProgress.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
            <p className="text-base font-bold">No tenéis metas de ahorro todavía</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Cuando creéis una meta aparecerá aquí para ir sumando.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {goalsProgress.map(({ goal, savedAmount, pct, remaining, isCompleted }) => (
              <article
                key={goal.id}
                className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold">{goal.name}</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {isCompleted
                        ? 'Objetivo conseguido'
                        : remaining > 0
                          ? `Faltan ${formatEUR(remaining)}`
                          : GOAL_TYPE_LABELS[goal.type]}
                    </p>
                  </div>
                  <p className="font-display text-xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                    {formatEUR(savedAmount)}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="h-3.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isCompleted ? '#15803D' : goal.color || '#0E5A64',
                      }}
                    />
                  </div>
                  {goal.targetAmount > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      Objetivo: {formatEUR(goal.targetAmount)}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => openMovementModal(goal, 'add')}
                    className="min-h-[48px] px-4 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <ArrowUpCircle className="w-5 h-5" />
                    <span>Aportar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openMovementModal(goal, 'withdraw')}
                    className="min-h-[48px] px-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <ArrowDownCircle className="w-5 h-5" />
                    <span>Retirar</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {movementModal}
      </div>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            Ahorros y metas
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Colchón de emergencia, viajes y objetivos compartidos con reparto por miembro.
          </p>
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
          <button
            type="button"
            onClick={() => openGoalEditor(null)}
            className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva meta</span>
          </button>
        </div>
      </div>

      {celebratedGoalName && (
        <div
          role="status"
          className="rounded-2xl bg-[#15803D] text-white p-4 flex items-center gap-3 shadow-md"
        >
          <Sparkles className="w-6 h-6 shrink-0" />
          <div>
            <p className="font-display font-bold text-base">
              ¡Meta «{celebratedGoalName}» completada!
            </p>
            <p className="text-xs text-white/90">Habéis alcanzado el 100 % del objetivo previsto.</p>
          </div>
        </div>
      )}

      {/* Consolidated Overview + Donut + Member Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Reparto del ahorro total</h2>
            <span className="font-display text-xl font-bold tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
              {formatEUR(totalSaved)}
            </span>
          </div>
          <DonutChart
            slices={donutSlices}
            centerLabel="Total ahorrado"
            centerValue={formatEUR(totalSaved)}
          />
        </section>

        <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="font-display text-base font-bold">Aportaciones por persona</h2>
          <div className="space-y-3">
            {memberShares.map((ms) => (
              <div key={ms.uid} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{ms.displayName}</span>
                  <span className="font-mono-num font-bold">{formatEUR(ms.totalContributed)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Aportado: {ms.actualPct}%</span>
                  <span>Reparto acordado: {ms.agreedPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-[#0E5A64] dark:bg-[#2AA1AE] rounded-full transition-all duration-500"
                    style={{ width: `${ms.actualPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {emergencyGoal && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4]">
                <ShieldCheck className="w-4 h-4" />
                <span>Sugerencia colchón (gastos fijos activos)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void applyEmergencyTarget(emergency3x)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                >
                  <span className="block text-slate-500 dark:text-slate-400">3 meses</span>
                  <span className="font-mono-num text-sm">{formatEUR(emergency3x)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void applyEmergencyTarget(emergency6x)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                >
                  <span className="block text-slate-500 dark:text-slate-400">6 meses</span>
                  <span className="font-mono-num text-sm">{formatEUR(emergency6x)}</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Goal Cards */}
      {goalsProgress.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
          <p className="text-sm font-semibold">Todavía no tenéis metas de ahorro</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Crea una meta para el colchón de emergencia o vuestro próximo viaje.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goalsProgress.map(({ goal, savedAmount, pct, remaining, monthlyNeeded, isCompleted }) => (
            <article
              key={goal.id}
              className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-lg font-bold flex items-center gap-2">
                    <span>{goal.name}</span>
                    {isCompleted && (
                      <span className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80]">
                        · Completada
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {GOAL_TYPE_LABELS[goal.type]}
                    {goal.targetDate ? ` · Objetivo ${formatDateES(goal.targetDate)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Editar meta ${goal.name}`}
                    onClick={() => openGoalEditor(goal)}
                    className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar meta ${goal.name}`}
                    onClick={() => setDeleteGoalTarget(goal)}
                    className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-2xl font-bold tabular-nums">
                    {formatEUR(savedAmount)}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    de {formatEUR(goal.targetAmount)} ({formatPctES(pct)})
                  </span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: isCompleted ? '#15803D' : goal.color || '#0E5A64',
                    }}
                  />
                </div>
                {remaining > 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                    Faltan {formatEUR(remaining)}
                    {monthlyNeeded !== null ? ` → ${formatEUR(monthlyNeeded)}/mes hasta la fecha objetivo` : ''}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80]">
                    Objetivo alcanzado
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openMovementModal(goal, 'add')}
                  className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  <span>Aportar</span>
                </button>
                <button
                  type="button"
                  onClick={() => openMovementModal(goal, 'withdraw')}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  <span>Retirar</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Advanced: Recent Goal Movements Table */}
      <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="font-display text-base font-bold">
          Historial de movimientos ({goalMovements.length})
        </h2>
        {goalMovements.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Todavía no hay aportaciones o retiradas registradas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="py-2 pr-3 font-semibold">Meta</th>
                  <th className="py-2 pr-3 font-semibold">Persona</th>
                  <th className="py-2 pr-3 font-semibold">Nota</th>
                  <th className="py-2 pr-3 font-semibold text-right">Importe</th>
                  <th className="py-2 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {goalMovements.slice(0, 20).map((m) => {
                  const goalNameForMov = goals.find((g) => g.id === m.goalId)?.name || 'Meta';
                  const personName =
                    members.find((mb) => mb.uid === m.by)?.displayName?.split(' ')[0] || m.by;
                  return (
                    <tr key={m.id}>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {formatDateES(m.date)}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold">{goalNameForMov}</td>
                      <td className="py-2.5 pr-3">{personName}</td>
                      <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400 max-w-[180px] truncate">
                        {m.note || '—'}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono-num font-bold whitespace-nowrap ${
                          m.amount >= 0 ? 'text-[#15803D] dark:text-[#4ADE80]' : 'text-[#DC4C3E]'
                        }`}
                      >
                        {m.amount >= 0 ? `+${formatEUR(m.amount)}` : formatEUR(m.amount)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          aria-label={`Eliminar movimiento de ${goalNameForMov}`}
                          onClick={() =>
                            householdId &&
                            currentUserProfile &&
                            void repo.deleteGoalMovement(
                              householdId,
                              m.id,
                              goalNameForMov,
                              currentUserProfile
                            )
                          }
                          className="min-h-[36px] min-w-[36px] rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {movementModal}

      {/* Create/Edit Goal Modal */}
      {goalModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="goal-modal-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 id="goal-modal-title" className="font-display text-lg font-bold">
              {editingGoal ? 'Editar meta' : 'Nueva meta de ahorro'}
            </h2>
            <form onSubmit={handleSaveGoal} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Objetivo (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Fecha objetivo (opcional)</label>
                  <input
                    type="date"
                    value={goalDate}
                    onChange={(e) => setGoalDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Tipo</label>
                  <select
                    value={goalType}
                    onChange={(e) => setGoalType(e.target.value as GoalType)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {(Object.keys(GOAL_TYPE_LABELS) as GoalType[]).map((t) => (
                      <option key={t} value={t}>
                        {GOAL_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Color</label>
                  <input
                    type="color"
                    value={goalColor}
                    onChange={(e) => setGoalColor(e.target.value)}
                    className="w-full min-h-[44px] p-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setGoalModalOpen(false)}
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

      <ConfirmDialog
        open={Boolean(deleteGoalTarget)}
        title="Eliminar meta de ahorro"
        description={`Vas a eliminar la meta "${deleteGoalTarget?.name ?? ''}". Los movimientos asociados dejarán de mostrarse en el panel.`}
        confirmLabel="Eliminar meta"
        onConfirm={async () => {
          if (!deleteGoalTarget || !householdId || !currentUserProfile) return;
          const target = deleteGoalTarget;
          setDeleteGoalTarget(null);
          await repo.deleteGoal(householdId, target.id, target.name, currentUserProfile);
          showToast('Meta eliminada');
        }}
        onCancel={() => setDeleteGoalTarget(null)}
      />
    </div>
  );
};
