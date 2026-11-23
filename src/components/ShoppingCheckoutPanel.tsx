import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  ShoppingCart,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import {
  clampSplitPct,
  formatDateES,
  formatEUR,
  getTodayLocalISO,
  resolveSplitPctForChoice,
  roundCents,
} from '../domain/finance';
import {
  buildCheckoutExpenseId,
  buildShoppingExpenseNotes,
  clearLocalPendingCheckout,
  executeDurableShoppingCheckout,
  generateShoppingCheckoutId,
  saveLocalPendingCheckout,
  type LocalPendingShoppingCheckout,
  type ShoppingCheckoutItemSnapshot,
} from '../domain/shoppingCheckout';
import { globalSearchSessionCache } from '../domain/globalSearch';
import { formatShoppingQtyUnit } from '../domain/shoppingCatalog';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import { usePwaUpdateBlock } from '../services/pwaUpdateGuard';
import {
  COMMON_ACCOUNT_ID,
  MAX_LENGTHS,
  type ShoppingItem,
  type SplitPresetChoice,
} from '../types/nido';

interface ShoppingCheckoutPanelProps {
  snapshots: ShoppingCheckoutItemSnapshot[];
  liveShoppingItems: ShoppingItem[];
  onCancel: () => void;
  onCompleted: () => void;
}

const SPLIT_OPTIONS: Array<{ id: SplitPresetChoice; label: string }> = [
  { id: 'segun_reparto', label: 'Según reparto' },
  { id: 'a_medias', label: 'A medias' },
  { id: 'solo_yo', label: 'Solo yo' },
  { id: 'solo_pareja', label: 'Solo mi pareja' },
  { id: 'personalizado', label: 'Personalizado' },
];

export const ShoppingCheckoutPanel: React.FC<ShoppingCheckoutPanelProps> = ({
  snapshots,
  onCancel,
  onCompleted,
}) => {
  const {
    householdId,
    isDemoMode,
    currentUserProfile,
    currentMember,
    memberA,
    memberB,
    effectiveSplitPctA,
    monthClosures,
    pendingShoppingCheckouts,
    uiMode,
    repo,
    showToast,
    refreshLocalPendingCheckout,
  } = useNido();

  const isOnline = useOnlineStatus();
  const viewerUid = currentUserProfile?.uid || '';
  const viewerIsMemberA = currentMember
    ? currentMember.role !== 'member_b'
    : !memberB || currentUserProfile?.uid !== memberB.uid;

  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [showDetails, setShowDetails] = useState(false);
  const [date, setDate] = useState(() => getTodayLocalISO());
  const [concept, setConcept] = useState('Compra supermercado');
  const [notes, setNotes] = useState(() => buildShoppingExpenseNotes(snapshots));
  const [splitChoice, setSplitChoice] = useState<SplitPresetChoice>('segun_reparto');
  const [splitPctInput, setSplitPctInput] = useState(() => String(effectiveSplitPctA));
  const [isPrivate, setIsPrivate] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapConflict, setOverlapConflict] = useState<{
    count: number;
    inProgressOtherCheckout?: boolean;
  } | null>(null);
  const [cleanupRecovery, setCleanupRecovery] = useState<{
    checkoutId: string;
    expenseId: string;
    remainingCount: number;
    skippedConcurrentCount: number;
  } | null>(null);

  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightRef = useRef(false);
  // Se genera únicamente al confirmar el envío: cancelar antes de confirmar no deja rastro.
  const checkoutIdRef = useRef<string | null>(null);

  usePwaUpdateBlock(true, 'edit');
  usePwaUpdateBlock(submitting, 'write');

  useEffect(() => {
    window.requestAnimationFrame(() => amountInputRef.current?.focus());
  }, []);

  const targetMonthKey = date.slice(0, 7);
  const isMonthClosed = useMemo(
    () => monthClosures.some((c) => c.monthKey === targetMonthKey),
    [monthClosures, targetMonthKey]
  );

  const payerOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = [
      { id: COMMON_ACCOUNT_ID, label: 'Cuenta común' },
    ];
    if (memberA) {
      opts.push({
        id: memberA.uid,
        label: memberA.displayName.split(' ')[0] || memberA.displayName,
      });
    }
    if (memberB) {
      opts.push({
        id: memberB.uid,
        label: memberB.displayName.split(' ')[0] || memberB.displayName,
      });
    }
    return opts;
  }, [memberA, memberB]);

  const parsedAmount = Number(amount.trim().replace(',', '.'));
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const offlineBlocked = !isDemoMode && !isOnline;

  const runCheckoutExecution = async (isRetryCleanup: boolean) => {
    if (!householdId || !currentUserProfile || !viewerUid) return;

    if (offlineBlocked) {
      setError(
        'Sin conexión: para finalizar la compra de forma segura sin duplicar gastos entre dispositivos necesitas conexión a internet.'
      );
      return;
    }

    if (!isRetryCleanup) {
      if (!hasValidAmount) {
        setError('Introduce el importe real de la compra (mayor que 0 €).');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setError('Selecciona una fecha válida.');
        return;
      }
      if (isMonthClosed) {
        setError('Ese mes está cerrado. Cambia la fecha o desbloquea el mes en Avanzado.');
        return;
      }
      // Si ya existe otro cierre multi-lote pendiente en el hogar que incluye alguno de estos productos,
      // bloqueamos antes de comprometer la Fase 1 para evitar solapamiento en lotes posteriores.
      const otherPendingItemIds = new Set(
        pendingShoppingCheckouts
          .filter((c) => c.id !== checkoutIdRef.current)
          .flatMap((c) => c.pendingItemIds)
      );
      const overlappingWithPending = snapshots.filter((s) => otherPendingItemIds.has(s.id));
      if (overlappingWithPending.length > 0) {
        setOverlapConflict({
          count: overlappingWithPending.length,
          inProgressOtherCheckout: true,
        });
        setError(null);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setOverlapConflict(null);

    const effectiveSplitA = isPrivate
      ? viewerIsMemberA
        ? 100
        : 0
      : resolveSplitPctForChoice(
          splitChoice,
          viewerIsMemberA,
          effectiveSplitPctA,
          clampSplitPct(Number(splitPctInput.replace(',', '.')), effectiveSplitPctA)
        );
    const cleanConcept = (concept.trim() || 'Compra supermercado').slice(0, MAX_LENGTHS.concept);
    const cleanNotes = notes.trim().slice(0, MAX_LENGTHS.notes);
    const cleanAmount = roundCents(parsedAmount);
    const cleanSplitPctA = clampSplitPct(effectiveSplitA, effectiveSplitPctA);
    const checkoutId = checkoutIdRef.current ?? generateShoppingCheckoutId();
    checkoutIdRef.current = checkoutId;
    const expenseId = buildCheckoutExpenseId(checkoutId);
    const nowIso = new Date().toISOString();

    const localRecordBase: LocalPendingShoppingCheckout = {
      checkoutId,
      expenseId,
      householdId,
      viewerUid,
      monthKey: targetMonthKey,
      concept: cleanConcept,
      amount: cleanAmount,
      date,
      paidBy,
      splitPctA: cleanSplitPctA,
      isPrivate,
      notes: cleanNotes,
      snapshots,
      state: isRetryCleanup ? 'cleanup_pending' : 'committing',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const result = await executeDurableShoppingCheckout({
      input: {
        checkoutId,
        monthKey: targetMonthKey,
        concept: cleanConcept,
        amount: cleanAmount,
        date,
        paidBy,
        splitPctA: cleanSplitPctA,
        isPrivate,
        notes: cleanNotes,
        snapshots,
      },
      inFlightRef,
      commitPhase1: (phase1Input) =>
        repo.commitShoppingCheckoutPhase1(householdId, phase1Input, currentUserProfile),
      cleanupBatch: (id, snapsById) =>
        repo.cleanupShoppingCheckoutBatch(householdId, id, snapsById),
      onPhase1Persisting: () => {
        saveLocalPendingCheckout(localRecordBase);
        refreshLocalPendingCheckout();
      },
      onPhase1Confirmed: (_confirmedExpenseId, pendingIds) => {
        globalSearchSessionCache.invalidateHousehold(householdId);
        if (pendingIds.length > 0) {
          saveLocalPendingCheckout({
            ...localRecordBase,
            state: 'cleanup_pending',
            updatedAt: new Date().toISOString(),
          });
          refreshLocalPendingCheckout();
        }
      },
      onCleared: () => {
        clearLocalPendingCheckout(householdId, viewerUid);
        refreshLocalPendingCheckout();
      },
    });

    setSubmitting(false);

    if (result.status === 'ignored_in_flight') {
      return;
    }

    if (result.status === 'overlap_conflict') {
      checkoutIdRef.current = null;
      setOverlapConflict({ count: result.alreadyGoneIds.length });
      setError(null);
      return;
    }

    if (result.status === 'all_modified_or_gone') {
      checkoutIdRef.current = null;
      setError(
        'Los productos seleccionados cambiaron o se desmarcaron mientras tanto. No se ha guardado ningún gasto; vuelve a la lista para revisarla.'
      );
      return;
    }

    if (result.status === 'phase1_failed') {
      // Conservamos checkoutIdRef y el registro local para que cualquier reintento
      // (ahora o tras recargar) compruebe primero si el servidor confirmó el gasto.
      setError(
        toUserFriendlyErrorMessage(
          result.error,
          'No se pudo confirmar la compra en el servidor. Al reintentar comprobaremos primero si ya se guardó para no duplicarla.'
        )
      );
      return;
    }

    if (result.status === 'cleanup_partial') {
      setCleanupRecovery({
        checkoutId: result.checkoutId,
        expenseId: result.expenseId,
        remainingCount: result.remainingItemIds.length,
        skippedConcurrentCount: result.skippedConcurrentCount,
      });
      setError(
        toUserFriendlyErrorMessage(
          result.error,
          'El gasto está confirmado en el servidor, pero falló la retirada de un lote de productos.'
        )
      );
      return;
    }

    checkoutIdRef.current = null;
    const concurrentSuffix =
      result.skippedConcurrentCount > 0
        ? ` · ${result.skippedConcurrentCount} conservados por cambios recientes`
        : '';
    const alreadyGoneSuffix =
      result.alreadyGoneCount > 0
        ? ` · Aviso: ${result.alreadyGoneCount} ya habían sido retirados en otro cierre (revisa los gastos recientes)`
        : '';

    if (result.reusedExistingExpense) {
      showToast(
        `Compra confirmada sin duplicar gasto (${result.deletedCount} ${
          result.deletedCount === 1 ? 'producto retirado' : 'productos retirados'
        })${concurrentSuffix}${alreadyGoneSuffix}`
      );
    } else {
      showToast(
        `Compra finalizada: ${formatEUR(cleanAmount)} confirmado y ${result.deletedCount} ${
          result.deletedCount === 1 ? 'producto retirado' : 'productos retirados'
        }${concurrentSuffix}${alreadyGoneSuffix}`
      );
    }
    onCompleted();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runCheckoutExecution(false);
  };

  const visibleSplitOptions =
    uiMode === 'avanzado'
      ? SPLIT_OPTIONS
      : SPLIT_OPTIONS.filter((o) => o.id !== 'personalizado');

  if (overlapConflict) {
    return (
      <div className="space-y-4 py-1">
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-bold text-amber-950 dark:text-amber-100 text-sm">
                {overlapConflict.inProgressOtherCheckout
                  ? 'Hay otro cierre de compra en curso con estos productos'
                  : 'Estos productos ya fueron procesados'}
              </p>
              <p className="text-amber-900 dark:text-amber-200">
                {overlapConflict.inProgressOtherCheckout
                  ? overlapConflict.count === 1
                    ? 'Uno de los productos seleccionados pertenece a una limpieza pendiente en el hogar.'
                    : `${overlapConflict.count} de los productos seleccionados pertenecen a una limpieza pendiente en el hogar.`
                  : overlapConflict.count === 1
                    ? 'Uno de los productos seleccionados ya fue retirado o finalizado (por tu pareja o por un intento anterior ya confirmado en el servidor tras perder conexión o cerrar sesión).'
                    : `${overlapConflict.count} de los productos seleccionados ya fueron retirados o finalizados (por tu pareja o por un intento anterior ya confirmado en el servidor tras perder conexión o cerrar sesión).`}
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                No se ha creado ningún gasto para evitar duplicados. Revisa los gastos recientes del
                mes y la lista actualizada antes de volver a guardar.
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-full min-h-[48px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold"
        >
          Volver a la lista actualizada
        </button>
      </div>
    );
  }

  if (cleanupRecovery) {
    return (
      <div className="space-y-4 py-1">
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2.5"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-bold text-amber-950 dark:text-amber-100 text-sm">
                Gasto confirmado, limpieza pendiente
              </p>
              <p className="text-amber-900 dark:text-amber-200">
                El gasto ya está confirmado ({formatEUR(roundCents(parsedAmount))}), pero quedan{' '}
                {cleanupRecovery.remainingCount}{' '}
                {cleanupRecovery.remainingCount === 1 ? 'producto' : 'productos'} por retirar de la
                lista.
              </p>
              <p className="text-amber-800 dark:text-amber-300">
                El progreso ya guardado se conserva: al reintentar solo se procesarán los lotes
                pendientes sin duplicar el gasto.
              </p>
            </div>
          </div>
          {error && (
            <p className="text-[11px] font-medium text-[#B42318] dark:text-[#FCA5A5]">{error}</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            disabled={submitting || offlineBlocked}
            onClick={() => void runCheckoutExecution(true)}
            className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
            <span>
              {submitting
                ? 'Reanudando limpieza...'
                : 'Reanudar limpieza (sin duplicar gasto)'}
            </span>
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onCompleted}
            className="min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
          >
            Cerrar y limpiar luego
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-pwa-unsaved="true"
      className="space-y-4 overflow-y-auto pr-0.5"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a la lista</span>
        </button>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {snapshots.length} {snapshots.length === 1 ? 'producto marcado' : 'productos marcados'}
        </span>
      </div>

      {/* Resumen de artículos marcados */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/60 p-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Resumen del carro ({snapshots.length})
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
          {snapshots.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-700 text-xs"
            >
              <span className="font-medium">{item.text}</span>
              {(item.qty !== 1 || item.unit) && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  ({formatShoppingQtyUnit(item.qty, item.unit)})
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {offlineBlocked && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/35 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-100 flex items-start gap-2"
        >
          <WifiOff className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <span>
            <strong>Necesitas conexión para finalizar la compra.</strong> Para evitar gastos
            duplicados entre dos dispositivos y limpiar el carro de forma atómica, el cierre requiere
            confirmación del servidor. Tus productos siguen marcados hasta que recuperes cobertura.
          </span>
        </div>
      )}

      {isMonthClosed && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200 font-medium"
        >
          El mes de la fecha elegida está cerrado. Desbloquéalo en Avanzado o elige una fecha en un
          mes abierto.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] px-3 py-2.5 text-xs font-medium"
        >
          {error}
        </div>
      )}

      {/* Formulario reducido: Importe + Pagador */}
      <div className="space-y-3">
        <div>
          <label
            htmlFor="checkout-amount"
            className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-1"
          >
            Importe total del ticket (€)
          </label>
          <input
            ref={amountInputRef}
            id="checkout-amount"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            className="w-full min-h-[52px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xl font-bold text-right focus:outline-2 focus:outline-[#0E5A64]"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 block">
            ¿Quién ha pagado?
          </span>
          <div className="grid grid-cols-3 gap-2">
            {payerOptions.map((opt) => {
              const active = paidBy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPaidBy(opt.id)}
                  className={`min-h-[44px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    active
                      ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {opt.id === COMMON_ACCOUNT_ID && <Wallet className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span>
            Por defecto: <strong>{formatDateES(date)}</strong> · <strong>Supermercado</strong>
            {isPrivate ? ' · Personal' : ''}
          </span>
          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((v) => !v)}
            className="min-h-[44px] px-2.5 rounded-lg font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10 inline-flex items-center gap-1"
          >
            <span>Más detalles</span>
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Opciones secundarias desplegables */}
      {showDetails && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="checkout-date"
                className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1"
              >
                Fecha
              </label>
              <input
                id="checkout-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="checkout-concept"
                className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1"
              >
                Concepto
              </label>
              <input
                id="checkout-concept"
                type="text"
                maxLength={MAX_LENGTHS.concept}
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="checkout-notes"
              className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1"
            >
              Notas
            </label>
            <textarea
              id="checkout-notes"
              rows={2}
              maxLength={MAX_LENGTHS.notes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>

          {!isPrivate && (
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Reparto
              </span>
              <div className="flex flex-wrap gap-1.5">
                {visibleSplitOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={splitChoice === opt.id}
                    onClick={() => setSplitChoice(opt.id)}
                    className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold ${
                      splitChoice === opt.id
                        ? 'border-[#0E5A64] bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4]'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {uiMode === 'avanzado' && splitChoice === 'personalizado' && (
                <div className="flex items-center gap-2 pt-1">
                  <label
                    htmlFor="checkout-split-pct"
                    className="text-xs text-slate-600 dark:text-slate-300"
                  >
                    % {memberA?.displayName.split(' ')[0] || 'Miembro A'}:
                  </label>
                  <input
                    id="checkout-split-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={splitPctInput}
                    onChange={(e) => setSplitPctInput(e.target.value)}
                    className="w-24 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-right font-mono-num"
                  />
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="w-4 h-4 rounded accent-[#0E5A64]"
            />
            <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Gasto solo mío (privado, no entra en cuentas de pareja)
            </span>
          </label>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || !hasValidAmount || isMonthClosed || offlineBlocked}
          className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#15803D] hover:bg-[#166534] disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
        >
          <ShoppingCart className="w-4 h-4" />
          <span>
            {submitting
              ? 'Confirmando compra...'
              : hasValidAmount
                ? `Guardar gasto (${formatEUR(roundCents(parsedAmount))}) y limpiar carro`
                : 'Guardar gasto y limpiar carro'}
          </span>
        </button>
      </div>
    </form>
  );
};
