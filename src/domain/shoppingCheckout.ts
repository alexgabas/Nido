import { MAX_LENGTHS, type ShoppingItem } from '../types/nido';
import { formatShoppingQtyUnit } from './shoppingCatalog';

export const MAX_CHECKOUT_BATCH_ITEMS = 10;
export const MAX_CHECKOUT_PENDING_ITEMS = 100;
const CHECKOUT_ID_REGEX = /^chk_[a-zA-Z0-9_]{6,40}$/;
const LOCAL_PENDING_CHECKOUT_PREFIX = 'nido_pending_checkout_v1';

export interface ShoppingCheckoutItemSnapshot {
  id: string;
  text: string;
  qty: number;
  unit: string;
  done: boolean;
  updatedAt: string;
}

export interface ShoppingCleanupReconciliation {
  safeToDeleteIds: string[];
  skippedModified: ShoppingCheckoutItemSnapshot[];
  skippedUnchecked: ShoppingCheckoutItemSnapshot[];
  alreadyGone: ShoppingCheckoutItemSnapshot[];
}

export interface ShoppingCheckoutSession {
  createdExpenseId: string | null;
  snapshots: ShoppingCheckoutItemSnapshot[];
}

export interface LocalPendingShoppingCheckout {
  checkoutId: string;
  expenseId: string;
  householdId: string;
  viewerUid: string;
  monthKey: string;
  concept: string;
  amount: number;
  date: string;
  paidBy: string;
  splitPctA: number;
  isPrivate: boolean;
  notes: string;
  snapshots: ShoppingCheckoutItemSnapshot[];
  state: 'committing' | 'cleanup_pending';
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingCheckoutPhase1Input {
  checkoutId: string;
  monthKey: string;
  concept: string;
  amount: number;
  date: string;
  paidBy: string;
  splitPctA: number;
  isPrivate: boolean;
  notes: string;
  snapshots: ShoppingCheckoutItemSnapshot[];
}

export type ShoppingCheckoutPhase1Result =
  | {
      status: 'committed';
      expenseId: string;
      deletedIds: string[];
      skippedConcurrentIds: string[];
      pendingItemIds: string[];
    }
  | {
      status: 'already_committed';
      expenseId: string;
      pendingItemIds: string[];
    }
  | {
      status: 'overlap_conflict';
      alreadyGoneIds: string[];
    }
  | {
      status: 'all_modified_or_gone';
      skippedConcurrentIds: string[];
      alreadyGoneIds: string[];
    };

export interface ShoppingCheckoutBatchCleanupResult {
  checkoutId: string;
  deletedIds: string[];
  skippedConcurrentIds: string[];
  alreadyGoneIds: string[];
  remainingItemIds: string[];
  completed: boolean;
}

export type DurableShoppingCheckoutResult =
  | {
      status: 'ignored_in_flight';
    }
  | {
      status: 'overlap_conflict';
      alreadyGoneIds: string[];
    }
  | {
      status: 'all_modified_or_gone';
      skippedConcurrentIds: string[];
      alreadyGoneIds: string[];
    }
  | {
      status: 'phase1_failed';
      checkoutId: string;
      expenseId: string;
      error: unknown;
    }
  | {
      status: 'cleanup_partial';
      checkoutId: string;
      expenseId: string;
      deletedCount: number;
      skippedConcurrentCount: number;
      remainingItemIds: string[];
      reusedExistingExpense: boolean;
      error: unknown;
    }
  | {
      status: 'completed';
      checkoutId: string;
      expenseId: string;
      deletedCount: number;
      skippedConcurrentCount: number;
      reusedExistingExpense: boolean;
    };

export type ShoppingCheckoutExecutionResult =
  | {
      status: 'ignored_in_flight';
    }
  | {
      status: 'expense_failed';
      error: unknown;
    }
  | {
      status: 'cleanup_failed';
      expenseId: string;
      remainingSnapshots: ShoppingCheckoutItemSnapshot[];
      skippedConcurrentCount: number;
      error: unknown;
    }
  | {
      status: 'completed';
      expenseId: string;
      deletedCount: number;
      skippedConcurrentCount: number;
      reusedExistingExpense: boolean;
    };

export function isValidShoppingCheckoutId(id: string): boolean {
  return CHECKOUT_ID_REGEX.test(id);
}

export function generateShoppingCheckoutId(): string {
  const ts = Date.now().toString(36);
  let rand = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      rand = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 10);
    }
  } catch {
    // Fallback below
  }
  if (!rand) {
    rand = Math.random().toString(36).slice(2, 12);
  }
  const cleanRand = rand.replace(/[^a-zA-Z0-9]/g, '').padEnd(6, '0').slice(0, 10);
  return `chk_${ts}_${cleanRand}`;
}

export function buildCheckoutExpenseId(checkoutId: string): string {
  return `tx_${checkoutId}`;
}

export function sortSnapshotsDeterministically(
  snapshots: readonly ShoppingCheckoutItemSnapshot[]
): ShoppingCheckoutItemSnapshot[] {
  const seen = new Set<string>();
  const unique: ShoppingCheckoutItemSnapshot[] = [];
  for (const snap of snapshots) {
    if (!snap.id || seen.has(snap.id)) continue;
    seen.add(snap.id);
    unique.push(snap);
  }
  return unique.sort((a, b) => a.id.localeCompare(b.id));
}

export function captureShoppingCheckoutSnapshots(
  checkedItems: readonly ShoppingItem[]
): ShoppingCheckoutItemSnapshot[] {
  return sortSnapshotsDeterministically(
    checkedItems
      .filter((item) => item.done)
      .map((item) => ({
        id: item.id,
        text: item.text,
        qty: item.qty,
        unit: item.unit || '',
        done: Boolean(item.done),
        updatedAt: item.updatedAt || '',
      }))
  );
}

export function buildShoppingExpenseNotes(
  items: ReadonlyArray<Pick<ShoppingItem, 'text' | 'qty' | 'unit'>>
): string {
  const itemsList = items
    .map((i) => {
      const qtyUnit = formatShoppingQtyUnit(i.qty, i.unit);
      return i.qty !== 1 || i.unit ? `${i.text} (${qtyUnit})` : i.text;
    })
    .join(', ');
  return `Lista de la compra: ${itemsList}`.slice(0, MAX_LENGTHS.notes);
}

export function isShoppingItemUnchangedForCheckout(
  snapshot: ShoppingCheckoutItemSnapshot,
  liveItem: Pick<ShoppingItem, 'text' | 'qty' | 'unit' | 'done' | 'updatedAt'>
): boolean {
  if (!liveItem.done) return false;
  const sameText = liveItem.text === snapshot.text;
  const sameQty = Math.abs((Number(liveItem.qty) || 0) - (Number(snapshot.qty) || 0)) < 0.001;
  const sameUnit = (liveItem.unit || '') === (snapshot.unit || '');
  const sameUpdatedAt = (liveItem.updatedAt || '') === (snapshot.updatedAt || '');
  return sameText && sameQty && sameUnit && sameUpdatedAt;
}

/**
 * Validación segura cuando un segundo dispositivo (sin instantánea local)
 * reanuda la limpieza de lotes pendientes de una compra ya confirmada:
 * solo permite retirar el artículo si sigue marcado como comprado y su updatedAt
 * no es posterior al instante en que se confirmó la compra en servidor.
 */
export function isShoppingItemSafeForCrossDeviceCleanup(
  liveItem: Pick<ShoppingItem, 'done' | 'updatedAt'>,
  checkoutCreatedAtIso: string
): boolean {
  if (!liveItem.done) return false;
  const checkoutMs = Date.parse(checkoutCreatedAtIso);
  if (!Number.isFinite(checkoutMs)) return false;
  const itemMs = Date.parse(liveItem.updatedAt || '');
  if (!Number.isFinite(itemMs)) return false;
  return itemMs <= checkoutMs;
}

/**
 * Reconcilia la instantánea de artículos seleccionados al iniciar "Finalizar compra"
 * frente al estado vivo actual de la lista de la compra.
 */
export function reconcileShoppingItemsForCleanup(
  selectedSnapshots: readonly ShoppingCheckoutItemSnapshot[],
  liveItems: readonly ShoppingItem[]
): ShoppingCleanupReconciliation {
  const liveById = new Map<string, ShoppingItem>();
  for (const item of liveItems) {
    liveById.set(item.id, item);
  }

  const safeToDeleteIds: string[] = [];
  const skippedModified: ShoppingCheckoutItemSnapshot[] = [];
  const skippedUnchecked: ShoppingCheckoutItemSnapshot[] = [];
  const alreadyGone: ShoppingCheckoutItemSnapshot[] = [];

  for (const snap of selectedSnapshots) {
    const live = liveById.get(snap.id);
    if (!live) {
      alreadyGone.push(snap);
      continue;
    }
    if (!live.done) {
      skippedUnchecked.push(snap);
      continue;
    }
    if (!isShoppingItemUnchangedForCheckout(snap, live)) {
      skippedModified.push(snap);
      continue;
    }
    safeToDeleteIds.push(snap.id);
  }

  return {
    safeToDeleteIds,
    skippedModified,
    skippedUnchecked,
    alreadyGone,
  };
}

export function buildLocalPendingCheckoutStorageKey(
  householdId: string,
  viewerUid: string
): string {
  return `${LOCAL_PENDING_CHECKOUT_PREFIX}:${householdId}:${viewerUid}`;
}

export function saveLocalPendingCheckout(record: LocalPendingShoppingCheckout): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      buildLocalPendingCheckoutStorageKey(record.householdId, record.viewerUid),
      JSON.stringify(record)
    );
  } catch {
    // Storage unavailable or full
  }
}

export function loadLocalPendingCheckout(
  householdId: string,
  viewerUid: string
): LocalPendingShoppingCheckout | null {
  if (typeof localStorage === 'undefined' || !householdId || !viewerUid) return null;
  try {
    const raw = localStorage.getItem(
      buildLocalPendingCheckoutStorageKey(householdId, viewerUid)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPendingShoppingCheckout>;
    if (
      !parsed ||
      typeof parsed.checkoutId !== 'string' ||
      !isValidShoppingCheckoutId(parsed.checkoutId) ||
      typeof parsed.expenseId !== 'string' ||
      parsed.householdId !== householdId ||
      parsed.viewerUid !== viewerUid ||
      typeof parsed.monthKey !== 'string' ||
      typeof parsed.amount !== 'number' ||
      !Number.isFinite(parsed.amount) ||
      parsed.amount <= 0 ||
      !Array.isArray(parsed.snapshots)
    ) {
      return null;
    }
    return {
      checkoutId: parsed.checkoutId,
      expenseId: parsed.expenseId,
      householdId: parsed.householdId,
      viewerUid: parsed.viewerUid,
      monthKey: parsed.monthKey,
      concept: typeof parsed.concept === 'string' ? parsed.concept : 'Compra supermercado',
      amount: parsed.amount,
      date: typeof parsed.date === 'string' ? parsed.date : '',
      paidBy: typeof parsed.paidBy === 'string' ? parsed.paidBy : viewerUid,
      splitPctA: typeof parsed.splitPctA === 'number' ? parsed.splitPctA : 50,
      isPrivate: Boolean(parsed.isPrivate),
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      snapshots: parsed.snapshots,
      state: parsed.state === 'cleanup_pending' ? 'cleanup_pending' : 'committing',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearLocalPendingCheckout(householdId: string, viewerUid: string): void {
  if (typeof localStorage === 'undefined' || !householdId || !viewerUid) return;
  try {
    localStorage.removeItem(buildLocalPendingCheckoutStorageKey(householdId, viewerUid));
  } catch {
    // Ignore storage errors
  }
}

export function clearAllLocalPendingCheckouts(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${LOCAL_PENDING_CHECKOUT_PREFIX}:`)) {
        keysToDelete.push(k);
      }
    }
    for (const k of keysToDelete) {
      localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Ejecuta un cierre de compra duradero e idempotente en 2 fases atómicas:
 * - Fase 1 (runTransaction): valida mes abierto, comprueba si tx_${checkoutId} ya existe,
 *   detecta solapamiento con pareja y compromete gasto + lote 1 (≤10 artículos) +
 *   documento de continuación si quedan más lotes.
 * - Fase 2 (bucle de runTransaction, ≤10 artículos/lote): retira los lotes restantes con
 *   verificación atómica en servidor sin volver a tocar el gasto.
 */
export async function executeDurableShoppingCheckout(params: {
  input: ShoppingCheckoutPhase1Input;
  inFlightRef: { current: boolean };
  commitPhase1: (input: ShoppingCheckoutPhase1Input) => Promise<ShoppingCheckoutPhase1Result>;
  cleanupBatch: (
    checkoutId: string,
    snapshotsById?: Record<string, ShoppingCheckoutItemSnapshot>
  ) => Promise<ShoppingCheckoutBatchCleanupResult>;
  onPhase1Persisting?: () => void;
  onPhase1Confirmed?: (expenseId: string, pendingItemIds: string[]) => void;
  onBatchProgress?: (remainingItemIds: string[]) => void;
  onCleared?: () => void;
}): Promise<DurableShoppingCheckoutResult> {
  const {
    input,
    inFlightRef,
    commitPhase1,
    cleanupBatch,
    onPhase1Persisting,
    onPhase1Confirmed,
    onBatchProgress,
    onCleared,
  } = params;

  if (inFlightRef.current) {
    return { status: 'ignored_in_flight' };
  }

  const orderedSnapshots = sortSnapshotsDeterministically(input.snapshots);
  const normalizedInput: ShoppingCheckoutPhase1Input = {
    ...input,
    snapshots: orderedSnapshots,
  };
  const snapshotsById: Record<string, ShoppingCheckoutItemSnapshot> = {};
  for (const snap of orderedSnapshots) {
    snapshotsById[snap.id] = snap;
  }

  inFlightRef.current = true;
  try {
    onPhase1Persisting?.();

    let phase1: ShoppingCheckoutPhase1Result;
    try {
      phase1 = await commitPhase1(normalizedInput);
    } catch (error) {
      return {
        status: 'phase1_failed',
        checkoutId: input.checkoutId,
        expenseId: buildCheckoutExpenseId(input.checkoutId),
        error,
      };
    }

    if (phase1.status === 'overlap_conflict') {
      onCleared?.();
      return {
        status: 'overlap_conflict',
        alreadyGoneIds: phase1.alreadyGoneIds,
      };
    }

    if (phase1.status === 'all_modified_or_gone') {
      onCleared?.();
      return {
        status: 'all_modified_or_gone',
        skippedConcurrentIds: phase1.skippedConcurrentIds,
        alreadyGoneIds: phase1.alreadyGoneIds,
      };
    }

    const reusedExistingExpense = phase1.status === 'already_committed';
    const expenseId = phase1.expenseId;
    let deletedCount = phase1.status === 'committed' ? phase1.deletedIds.length : 0;
    let skippedConcurrentCount =
      phase1.status === 'committed' ? phase1.skippedConcurrentIds.length : 0;
    let pendingItemIds = [...phase1.pendingItemIds];

    onPhase1Confirmed?.(expenseId, pendingItemIds);

    let guardIterations = 0;
    const maxIterations = Math.ceil(MAX_CHECKOUT_PENDING_ITEMS / MAX_CHECKOUT_BATCH_ITEMS) + 2;

    while (pendingItemIds.length > 0 && guardIterations < maxIterations) {
      guardIterations += 1;
      try {
        const batchRes = await cleanupBatch(input.checkoutId, snapshotsById);
        deletedCount += batchRes.deletedIds.length;
        skippedConcurrentCount += batchRes.skippedConcurrentIds.length;
        pendingItemIds = batchRes.remainingItemIds;
        onBatchProgress?.(pendingItemIds);
        if (batchRes.completed || pendingItemIds.length === 0) {
          break;
        }
      } catch (error) {
        return {
          status: 'cleanup_partial',
          checkoutId: input.checkoutId,
          expenseId,
          deletedCount,
          skippedConcurrentCount,
          remainingItemIds: pendingItemIds,
          reusedExistingExpense,
          error,
        };
      }
    }

    onCleared?.();
    return {
      status: 'completed',
      checkoutId: input.checkoutId,
      expenseId,
      deletedCount,
      skippedConcurrentCount,
      reusedExistingExpense,
    };
  } finally {
    inFlightRef.current = false;
  }
}

/**
 * Helper legado (mantenido para compatibilidad de tests unitarios existentes).
 */
export async function executeShoppingCheckout(params: {
  session: ShoppingCheckoutSession;
  inFlightRef: { current: boolean };
  createExpense: () => Promise<string>;
  getLiveShoppingItems: () => readonly ShoppingItem[];
  deleteItemsBulk: (ids: string[]) => Promise<void>;
  onExpenseCreated?: (expenseId: string) => void;
}): Promise<ShoppingCheckoutExecutionResult> {
  const {
    session,
    inFlightRef,
    createExpense,
    getLiveShoppingItems,
    deleteItemsBulk,
    onExpenseCreated,
  } = params;

  if (inFlightRef.current) {
    return { status: 'ignored_in_flight' };
  }

  inFlightRef.current = true;
  try {
    let expenseId = session.createdExpenseId;
    const reusedExistingExpense = Boolean(expenseId);

    if (!expenseId) {
      try {
        expenseId = await createExpense();
        session.createdExpenseId = expenseId;
        onExpenseCreated?.(expenseId);
      } catch (error) {
        return { status: 'expense_failed', error };
      }
    }

    const reconciliation = reconcileShoppingItemsForCleanup(
      session.snapshots,
      getLiveShoppingItems()
    );
    const skippedConcurrentCount =
      reconciliation.skippedModified.length + reconciliation.skippedUnchecked.length;

    if (reconciliation.safeToDeleteIds.length === 0) {
      return {
        status: 'completed',
        expenseId,
        deletedCount: 0,
        skippedConcurrentCount,
        reusedExistingExpense,
      };
    }

    const safeSet = new Set(reconciliation.safeToDeleteIds);
    const remainingSnapshots = session.snapshots.filter((s) => safeSet.has(s.id));

    try {
      await deleteItemsBulk(reconciliation.safeToDeleteIds);
      return {
        status: 'completed',
        expenseId,
        deletedCount: reconciliation.safeToDeleteIds.length,
        skippedConcurrentCount,
        reusedExistingExpense,
      };
    } catch (error) {
      return {
        status: 'cleanup_failed',
        expenseId,
        remainingSnapshots,
        skippedConcurrentCount,
        error,
      };
    }
  } finally {
    inFlightRef.current = false;
  }
}
