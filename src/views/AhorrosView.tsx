import React, { useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Download,
  FileSpreadsheet,
  Pencil,
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

  // 2-tap Movement modal
  const [moveGoal, setMoveGoal] = useState<SavingsGoal | null>(null);
  const [moveDirection, setMoveDirection] = useState<'add' | 'withdraw'>('add');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveBy, setMoveBy] = useState(currentUserProfile?.uid || memberA?.uid || '');
  const [moveNote, setMoveNote] = useState('');

  // Goal create/edit modal
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDate, setGoalDate] = useState('');
  const [goalType, setGoalType] = useState<GoalType>('custom');
  const [goalColor, setGoalColor] = useState('#0E5A64');

  // Celebration banner
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
    const signed = moveDirection === 'add' ? Math.round(rawAmt * 100) / 100 : -Math.round(rawAmt * 100) / 100;

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
      showToast(signed > 0 ? 'Aportación registrada' : 'Retirada registrada');
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            Ahorros y metas
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Colchón de emergencia, viajes y objetivos compartidos.
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
          className="rounded-2xl bg-[#15803D] text-white p-4 flex items-center gap-3 shadow-md transition-transform"
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
                  <span className="font-semibold">{ms.displayName.split(' ')[0]}</span>
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
                {uiMode === 'avanzado' && (
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
                )}
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

      {/* 2-tap Movement Modal */}
      {moveGoal && (
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
            <form onSubmit={handleSaveMovement} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Importe (€)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  autoFocus
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  placeholder="100,00"
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xl font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Persona</label>
                <select
                  value={moveBy}
                  onChange={(e) => setMoveBy(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {memberA && <option value={memberA.uid}>{memberA.displayName}</option>}
                  {memberB && <option value={memberB.uid}>{memberB.displayName}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nota (opcional)</label>
                <input
                  type="text"
                  maxLength={240}
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMoveGoal(null)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
