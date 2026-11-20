import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  clampDateForMonth,
  clampSplitPct,
  computeEffectiveSplitPctA,
  getTodayLocalISO,
  normalizeSplitPair,
} from '../domain/finance';
import {
  DEFAULT_CHECKLIST_CATALUNYA,
  DEFAULT_FURNITURE_ITEMS,
  DEFAULT_GOALS,
  DEFAULT_INITIAL_COSTS,
  EXPENSE_CATEGORY_LABELS,
  findMatchingRecurringForPreset,
  RECURRING_CATALOG_PRESETS,
  RECURRING_CATALOG_SEED_VERSION,
  type RecurringCatalogPreset,
} from '../domain/presets';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  MAX_LENGTHS,
  type ActivityAction,
  type ActivityEntry,
  type ChecklistItem,
  type CsvCategoryKeywords,
  type ExpenseCategory,
  type FurnitureItem,
  type FurnitureStatus,
  type GoalMovement,
  type Household,
  type HouseholdMember,
  type HouseholdSettings,
  type InitialCost,
  type MonthClosure,
  type MonthlyBudget,
  type NidoBackupV1,
  type RecurringExpense,
  type SavingsGoal,
  type ShoppingItem,
  type Transaction,
  type UiMode,
} from '../types/nido';
import {
  HouseholdSwitchConfirmationRequiredError,
  type BankCsvImportItem,
  type HouseholdRepository,
  type JoinHouseholdOptions,
  type Unsubscribe,
  type UserProfileInput,
} from './HouseholdRepository';

const MAX_BATCH_DOCS = 15;
const PENDING_SEED_KEY_PREFIX = 'nido_seed_pending_';

function normalizePayerValue(val: unknown): string {
  const s = typeof val === 'string' ? val.trim() : '';
  if (!s || s === 'comun') return COMMON_ACCOUNT_ID;
  return s;
}

function setPendingSeedFlag(householdId: string, pending: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${PENDING_SEED_KEY_PREFIX}${householdId}`;
    if (pending) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // ignore storage access issues
  }
}

function getPendingSeedFlag(householdId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${PENDING_SEED_KEY_PREFIX}${householdId}`) === '1';
  } catch {
    return false;
  }
}

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function isoToFirestoreTimestamp(iso: unknown) {
  if (typeof iso === 'string' && iso.trim()) {
    const dt = new Date(iso);
    if (Number.isFinite(dt.getTime())) {
      const safeDate = dt.getTime() > Date.now() ? new Date() : dt;
      return Timestamp.fromDate(safeDate);
    }
  }
  return serverTimestamp();
}

function clampStr(v: string, max: number): string {
  return v.trim().slice(0, max);
}

function sanitizeCsvKeywords(kw: unknown): CsvCategoryKeywords | undefined {
  if (!kw || typeof kw !== 'object' || Array.isArray(kw)) return undefined;
  const clean: CsvCategoryKeywords = {};
  let hasAny = false;
  for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
    const rawVal = (kw as Record<string, unknown>)[cat];
    if (typeof rawVal === 'string') {
      clean[cat] = rawVal.slice(0, MAX_LENGTHS.csvKeywordString);
      hasAny = true;
    }
  }
  return hasAny ? clean : undefined;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function mapHousehold(id: string, d: DocumentData): Household {
  const { presetA, presetB } = normalizeSplitPair(d.settings?.presetA);
  const csvKeywords = sanitizeCsvKeywords(d.csvKeywords);
  return {
    id,
    name: String(d.name ?? 'Mi hogar'),
    memberUids: Array.isArray(d.memberUids) ? d.memberUids.map(String) : [],
    inviteCode: String(d.inviteCode ?? ''),
    settings: {
      splitMode: d.settings?.splitMode ?? 'preset',
      presetA,
      presetB: d.settings?.presetB !== undefined ? clampSplitPct(d.settings.presetB, presetB) : presetB,
      incomeA: Number(d.settings?.incomeA ?? 0),
      incomeB: Number(d.settings?.incomeB ?? 0),
      currency: 'EUR',
    },
    ...(csvKeywords ? { csvKeywords } : {}),
    ...(typeof d.seedPending === 'boolean' ? { seedPending: d.seedPending } : {}),
    ...(typeof d.recurringSeedVersion === 'number'
      ? { recurringSeedVersion: d.recurringSeedVersion }
      : {}),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapMember(uid: string, d: DocumentData): HouseholdMember {
  return {
    uid,
    displayName: String(d.displayName ?? 'Usuario'),
    photoURL: String(d.photoURL ?? ''),
    role: d.role === 'member_b' ? 'member_b' : 'member_a',
    uiMode: d.uiMode === 'avanzado' ? 'avanzado' : 'sencillo',
    joinedAt: tsToIso(d.joinedAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapInitialCost(id: string, d: DocumentData): InitialCost {
  return {
    id,
    concept: String(d.concept ?? ''),
    category: d.category ?? 'otros',
    amount: Number(d.amount ?? 0),
    paidBy: normalizePayerValue(d.paidBy),
    status: d.status === 'pagado' ? 'pagado' : 'pendiente',
    dueDate: String(d.dueDate ?? ''),
    notes: String(d.notes ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapChecklist(id: string, d: DocumentData): ChecklistItem {
  return {
    id,
    text: String(d.text ?? ''),
    done: Boolean(d.done),
    doneBy: String(d.doneBy ?? ''),
    doneAt: String(d.doneAt ?? ''),
    group: String(d.group ?? 'General'),
    order: Number(d.order ?? 0),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapFurniture(id: string, d: DocumentData): FurnitureItem {
  return {
    id,
    name: String(d.name ?? ''),
    room: d.room ?? 'otros',
    priority: d.priority ?? 'pronto',
    status: d.status ?? 'pendiente',
    store: String(d.store ?? 'IKEA'),
    productUrl: String(d.productUrl ?? ''),
    articleNumber: String(d.articleNumber ?? ''),
    unitPrice: Number(d.unitPrice ?? 0),
    qty: Math.max(1, Number(d.qty ?? 1)),
    notes: String(d.notes ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapRecurring(id: string, d: DocumentData): RecurringExpense {
  return {
    id,
    concept: String(d.concept ?? ''),
    category: d.category ?? 'otros',
    amount: Number(d.amount ?? 0),
    frequency: d.frequency ?? 'mensual',
    dayOfMonth: Number(d.dayOfMonth ?? 1),
    splitOverride:
      d.splitOverride === null || d.splitOverride === undefined
        ? null
        : clampSplitPct(d.splitOverride, 50),
    paidByDefault: normalizePayerValue(d.paidByDefault),
    active: Boolean(d.active),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapTransaction(id: string, d: DocumentData): Transaction {
  return {
    id,
    monthKey: String(d.monthKey ?? ''),
    concept: String(d.concept ?? ''),
    category: d.category ?? 'otros',
    amount: Number(d.amount ?? 0),
    date: String(d.date ?? ''),
    paidBy: normalizePayerValue(d.paidBy),
    recurringId: d.recurringId ? String(d.recurringId) : null,
    splitPctA: clampSplitPct(d.splitPctA, 50),
    isSettlement: Boolean(d.isSettlement),
    settlementTo: String(d.settlementTo ?? ''),
    isPrivate: Boolean(d.isPrivate),
    createdBy: String(d.createdBy ?? ''),
    notes: String(d.notes ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapGoal(id: string, d: DocumentData): SavingsGoal {
  return {
    id,
    name: String(d.name ?? ''),
    icon: String(d.icon ?? 'piggy-bank'),
    color: String(d.color ?? '#0E5A64'),
    targetAmount: Number(d.targetAmount ?? 0),
    targetDate: String(d.targetDate ?? ''),
    type: d.type ?? 'custom',
    archived: Boolean(d.archived),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapGoalMovement(id: string, d: DocumentData): GoalMovement {
  return {
    id,
    goalId: String(d.goalId ?? ''),
    amount: Number(d.amount ?? 0),
    by: String(d.by ?? ''),
    date: String(d.date ?? ''),
    note: String(d.note ?? ''),
    createdAt: tsToIso(d.createdAt),
  };
}

function mapShoppingItem(id: string, d: DocumentData): ShoppingItem {
  return {
    id,
    text: String(d.text ?? ''),
    qty: Math.max(1, Math.min(999, Math.round(Number(d.qty ?? 1)))),
    done: Boolean(d.done),
    addedBy: String(d.addedBy ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

export class FirestoreHouseholdRepository implements HouseholdRepository {
  private addActivityToBatch(
    batch: ReturnType<typeof writeBatch>,
    householdId: string,
    actor: UserProfileInput,
    action: ActivityAction,
    entity: string,
    entityId: string,
    summary: string
  ) {
    const actRef = doc(collection(db, 'households', householdId, 'activity'));
    batch.set(actRef, {
      uid: actor.uid,
      actorName: clampStr(actor.displayName || 'Usuario', MAX_LENGTHS.displayName) || 'Usuario',
      action,
      entity: clampStr(entity, 40),
      entityId: clampStr(entityId, 128),
      summary: clampStr(summary, MAX_LENGTHS.activitySummary),
      timestamp: serverTimestamp(),
    });
  }

  private pendingSeedHouseholds = new Set<string>();

  hasPendingDefaultSeed(householdId: string): boolean {
    return this.pendingSeedHouseholds.has(householdId) || getPendingSeedFlag(householdId);
  }

  private async commitBatchOps(
    ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }>,
    operationType: OperationType,
    fallbackPath: string,
    customUserMessage?: string
  ): Promise<void> {
    for (let i = 0; i < ops.length; i += MAX_BATCH_DOCS) {
      const slice = ops.slice(i, i + MAX_BATCH_DOCS);
      const uniquePaths = Array.from(new Set(slice.map((item) => item.path))).join(', ') || fallbackPath;
      const batch = writeBatch(db);
      for (const item of slice) {
        item.apply(batch);
      }
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, operationType, uniquePaths, customUserMessage);
      }
    }
  }

  async getUserHouseholdId(uid: string): Promise<string | null> {
    const path = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) return null;
      const hid = snap.data().householdId;
      return typeof hid === 'string' && hid.length > 0 ? hid : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async createHousehold(user: UserProfileInput, name: string): Promise<string> {
    const hid = doc(collection(db, 'households')).id;
    const code = generateInviteCode();
    const cleanName = clampStr(name, MAX_LENGTHS.householdName) || 'Nuestro hogar';
    const displayName = clampStr(user.displayName || 'Usuario', MAX_LENGTHS.displayName) || 'Usuario';
    const photoURL = (user.photoURL || '').slice(0, 500);

    // Fase A (mínimo): invites/{code}, households/{hid}, members/{uid}, users/{uid}, activity de creación
    try {
      const batchA = writeBatch(db);
      batchA.set(doc(db, 'invites', code), {
        householdId: hid,
        householdName: cleanName,
        createdBy: user.uid,
        memberCount: 1,
        createdAt: serverTimestamp(),
      });
      batchA.set(doc(db, 'households', hid), {
        name: cleanName,
        memberUids: [user.uid],
        inviteCode: code,
        settings: {
          splitMode: 'preset',
          presetA: 50,
          presetB: 50,
          incomeA: 0,
          incomeB: 0,
          currency: 'EUR',
        },
        seedPending: true,
        recurringSeedVersion: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batchA.set(doc(db, 'households', hid, 'members', user.uid), {
        displayName,
        photoURL,
        role: 'member_a',
        uiMode: 'sencillo',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batchA.set(doc(db, 'users', user.uid), {
        householdId: hid,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batchA, hid, user, 'create', 'hogar', hid, `Creó el hogar "${cleanName}"`);
      await batchA.commit();
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `households/${hid}`,
        'No se ha podido crear el hogar, inténtalo de nuevo'
      );
    }

    // Fase B (seeds): tras confirmar el commit de A, en lotes pequeños (<= 15 docs)
    try {
      await this.seedDefaultLists(hid, user, false);
      this.pendingSeedHouseholds.delete(hid);
      setPendingSeedFlag(hid, false);
    } catch (seedError) {
      // El hogar ya existe tras Fase A y sigue siendo usable; marcamos reintento idempotente.
      console.error('Error en Fase B de siembra inicial (el hogar sigue usable):', seedError);
      this.pendingSeedHouseholds.add(hid);
      setPendingSeedFlag(hid, true);
    }

    return hid;
  }

  async seedDefaultLists(
    householdId: string,
    actor: UserProfileInput,
    logActivityEntry = true
  ): Promise<number> {
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

    let hSnap, icSnap, clSnap, itSnap, gSnap, recSnap;
    try {
      [hSnap, icSnap, clSnap, itSnap, gSnap, recSnap] = await Promise.all([
        getDoc(doc(db, 'households', householdId)),
        getDocs(collection(db, 'households', householdId, 'initialCosts')),
        getDocs(collection(db, 'households', householdId, 'checklist')),
        getDocs(collection(db, 'households', householdId, 'items')),
        getDocs(collection(db, 'households', householdId, 'goals')),
        getDocs(collection(db, 'households', householdId, 'recurring')),
      ]);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        `households/${householdId}/initialCosts`,
        'No se pudieron comprobar las listas actuales. Inténtalo de nuevo.'
      );
    }

    const hData = hSnap.exists() ? hSnap.data() : {};
    const currentSeedPending = Boolean(hData.seedPending);
    const currentRecSeedVersion =
      typeof hData.recurringSeedVersion === 'number' ? hData.recurringSeedVersion : 0;

    const existingIcIds = new Set(icSnap.docs.map((d) => d.id));
    const existingIcConcepts = new Set(icSnap.docs.map((d) => norm(d.data().concept)));

    const existingClIds = new Set(clSnap.docs.map((d) => d.id));
    const existingClTexts = new Set(clSnap.docs.map((d) => norm(d.data().text)));

    const existingItIds = new Set(itSnap.docs.map((d) => d.id));
    const existingItNames = new Set(itSnap.docs.map((d) => norm(d.data().name)));

    const existingGIds = new Set(gSnap.docs.map((d) => d.id));
    const existingGNames = new Set(gSnap.docs.map((d) => norm(d.data().name)));

    const existingRecurring = recSnap.docs.map((d) => mapRecurring(d.id, d.data()));

    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    DEFAULT_INITIAL_COSTS.forEach((ic, idx) => {
      const id = `seed_ic_${idx}`;
      if (existingIcIds.has(id) || existingIcConcepts.has(norm(ic.concept))) return;
      const ref = doc(db, 'households', householdId, 'initialCosts', id);
      ops.push({
        path: `households/${householdId}/initialCosts/${id}`,
        apply: (b) =>
          b.set(ref, {
            concept: ic.concept,
            category: ic.category,
            amount: ic.amount,
            paidBy: COMMON_ACCOUNT_ID,
            status: ic.status,
            dueDate: '',
            notes: ic.notes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    });

    DEFAULT_CHECKLIST_CATALUNYA.forEach((task, idx) => {
      const id = `seed_cl_${idx}`;
      if (existingClIds.has(id) || existingClTexts.has(norm(task.text))) return;
      const ref = doc(db, 'households', householdId, 'checklist', id);
      ops.push({
        path: `households/${householdId}/checklist/${id}`,
        apply: (b) =>
          b.set(ref, {
            text: task.text,
            done: false,
            doneBy: '',
            doneAt: '',
            group: task.group,
            order: task.order,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    });

    DEFAULT_FURNITURE_ITEMS.forEach((item, idx) => {
      const id = `seed_fur_${idx}`;
      if (existingItIds.has(id) || existingItNames.has(norm(item.name))) return;
      const ref = doc(db, 'households', householdId, 'items', id);
      ops.push({
        path: `households/${householdId}/items/${id}`,
        apply: (b) =>
          b.set(ref, {
            name: item.name,
            room: item.room,
            priority: item.priority,
            status: item.status,
            store: item.store,
            productUrl: '',
            articleNumber: '',
            unitPrice: 0,
            qty: item.qty,
            notes: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    });

    DEFAULT_GOALS.forEach((g, idx) => {
      const id = `seed_goal_${idx}`;
      if (existingGIds.has(id) || existingGNames.has(norm(g.name))) return;
      const ref = doc(db, 'households', householdId, 'goals', id);
      ops.push({
        path: `households/${householdId}/goals/${id}`,
        apply: (b) =>
          b.set(ref, {
            name: g.name,
            icon: g.icon,
            color: g.color,
            targetAmount: g.targetAmount,
            targetDate: g.targetDate,
            type: g.type,
            archived: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    });

    // Solo sembramos el catálogo de gastos habituales si aún no se ha completado esta versión,
    // para no recrear plantillas que el usuario haya eliminado voluntariamente después.
    if (currentRecSeedVersion < RECURRING_CATALOG_SEED_VERSION) {
      for (const preset of RECURRING_CATALOG_PRESETS) {
        if (findMatchingRecurringForPreset(preset, existingRecurring)) continue;
        const ref = doc(db, 'households', householdId, 'recurring', preset.id);
        ops.push({
          path: `households/${householdId}/recurring/${preset.id}`,
          apply: (b) =>
            b.set(ref, {
              concept: clampStr(preset.concept, MAX_LENGTHS.concept),
              category: preset.category,
              amount: 0,
              frequency: preset.frequency,
              dayOfMonth: 1,
              splitOverride: null,
              paidByDefault: COMMON_ACCOUNT_ID,
              active: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
        });
      }
    }

    const createdCount = ops.length;
    const needsSeedStateFinalize =
      currentSeedPending || currentRecSeedVersion < RECURRING_CATALOG_SEED_VERSION;

    if (createdCount === 0 && !needsSeedStateFinalize) {
      this.pendingSeedHouseholds.delete(householdId);
      setPendingSeedFlag(householdId, false);
      return 0;
    }

    if (createdCount > 0 && logActivityEntry) {
      ops.push({
        path: `households/${householdId}/activity`,
        apply: (b) =>
          this.addActivityToBatch(
            b,
            householdId,
            actor,
            'create',
            'hogar',
            householdId,
            `Cargó ${createdCount} elementos iniciales por defecto`
          ),
      });
    }

    if (needsSeedStateFinalize) {
      const hRef = doc(db, 'households', householdId);
      ops.push({
        path: `households/${householdId}`,
        apply: (b) =>
          b.update(hRef, {
            seedPending: false,
            recurringSeedVersion: Math.max(currentRecSeedVersion, RECURRING_CATALOG_SEED_VERSION),
            updatedAt: serverTimestamp(),
          }),
      });
    }

    await this.commitBatchOps(
      ops,
      OperationType.CREATE,
      `households/${householdId}`,
      'No se pudieron cargar las listas por defecto. Puedes volver a intentarlo.'
    );

    this.pendingSeedHouseholds.delete(householdId);
    setPendingSeedFlag(householdId, false);
    return createdCount;
  }

  async joinHouseholdByCode(
    user: UserProfileInput,
    inviteCode: string,
    options?: JoinHouseholdOptions
  ): Promise<string> {
    const code = inviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      throw new Error('El código de invitación debe tener 6 caracteres alfanuméricos.');
    }

    let hid = '';
    let householdName = 'Hogar compartido';
    let memberCount = 1;
    try {
      const inviteSnap = await getDoc(doc(db, 'invites', code));
      if (!inviteSnap.exists()) {
        throw new Error('No hemos encontrado ningún hogar con ese código de invitación.');
      }
      const inviteData = inviteSnap.data();
      hid = String(inviteData.householdId ?? '');
      householdName = String(inviteData.householdName ?? 'Hogar compartido');
      memberCount = Number(inviteData.memberCount ?? 1);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No hemos encontrado')) throw error;
      handleFirestoreError(error, OperationType.GET, `invites/${code}`);
    }

    if (!hid) {
      throw new Error('El código de invitación no es válido.');
    }

    if (memberCount >= 2) {
      throw new Error('Este hogar ya está completo');
    }

    const existingHid = await this.getUserHouseholdId(user.uid);
    if (existingHid && existingHid === hid) {
      return hid;
    }
    if (existingHid && existingHid !== hid && !options?.confirmSwitch) {
      throw new HouseholdSwitchConfirmationRequiredError(existingHid, hid, householdName);
    }

    const displayName = clampStr(user.displayName || 'Pareja', MAX_LENGTHS.displayName) || 'Pareja';
    const photoURL = (user.photoURL || '').slice(0, 500);

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', hid), {
        memberUids: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'invites', code), {
        memberCount: 2,
      });
      batch.set(doc(db, 'households', hid, 'members', user.uid), {
        displayName,
        photoURL,
        role: 'member_b',
        uiMode: 'sencillo',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'users', user.uid), {
        householdId: hid,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, hid, user, 'join', 'hogar', hid, `${displayName} se unió al hogar`);
      await batch.commit();
      return hid;
    } catch (error) {
      try {
        const recheck = await getDoc(doc(db, 'invites', code));
        if (recheck.exists() && Number(recheck.data().memberCount ?? 1) >= 2) {
          throw new Error('Este hogar ya está completo');
        }
      } catch (recheckErr) {
        if (recheckErr instanceof Error && recheckErr.message === 'Este hogar ya está completo') {
          throw recheckErr;
        }
      }
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `households/${hid}`,
        'No se pudo completar la unión al hogar. Comprueba el código o si el hogar ya está completo.'
      );
    }
  }

  async regenerateInviteCode(
    householdId: string,
    oldCode: string,
    actor: UserProfileInput
  ): Promise<string> {
    const newCode = generateInviteCode();
    try {
      const hSnap = await getDoc(doc(db, 'households', householdId));
      const hData = hSnap.exists() ? hSnap.data() : null;
      const hName = hData ? String(hData.name) : 'Nuestro hogar';
      const currentMemberCount =
        hData && Array.isArray(hData.memberUids)
          ? Math.max(1, Math.min(2, hData.memberUids.length))
          : 1;
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', newCode), {
        householdId,
        householdName: hName,
        createdBy: actor.uid,
        memberCount: currentMemberCount,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'households', householdId), {
        inviteCode: newCode,
        updatedAt: serverTimestamp(),
      });
      if (oldCode && /^[A-Z0-9]{6}$/.test(oldCode)) {
        batch.delete(doc(db, 'invites', oldCode));
      }
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'update',
        'hogar',
        householdId,
        'Regeneró el código de invitación'
      );
      await batch.commit();
      return newCode;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `households/${householdId}`);
    }
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  subscribeHousehold(
    householdId: string,
    onData: (h: Household | null) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}`;
    return onSnapshot(
      doc(db, 'households', householdId),
      (snap) => onData(snap.exists() ? mapHousehold(snap.id, snap.data()) : null),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeMembers(
    householdId: string,
    onData: (m: HouseholdMember[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/members`;
    return onSnapshot(
      collection(db, 'households', householdId, 'members'),
      (snap) => {
        const list = snap.docs
          .map((d) => mapMember(d.id, d.data()))
          .sort((a, b) => a.role.localeCompare(b.role));
        onData(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeActivity(
    householdId: string,
    limitCount: number,
    onData: (a: ActivityEntry[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/activity`;
    const q = query(
      collection(db, 'households', householdId, 'activity'),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );
    return onSnapshot(
      q,
      (snap) =>
        onData(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              uid: String(data.uid ?? ''),
              actorName: String(data.actorName ?? ''),
              action: data.action ?? 'update',
              entity: String(data.entity ?? ''),
              entityId: String(data.entityId ?? ''),
              summary: String(data.summary ?? ''),
              timestamp: tsToIso(data.timestamp),
            };
          })
        ),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeInitialCosts(
    householdId: string,
    onData: (c: InitialCost[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/initialCosts`;
    return onSnapshot(
      collection(db, 'households', householdId, 'initialCosts'),
      (snap) => onData(snap.docs.map((d) => mapInitialCost(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeChecklist(
    householdId: string,
    onData: (items: ChecklistItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/checklist`;
    const q = query(collection(db, 'households', householdId, 'checklist'), orderBy('order', 'asc'));
    return onSnapshot(
      q,
      (snap) => onData(snap.docs.map((d) => mapChecklist(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeFurniture(
    householdId: string,
    onData: (items: FurnitureItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/items`;
    return onSnapshot(
      collection(db, 'households', householdId, 'items'),
      (snap) => onData(snap.docs.map((d) => mapFurniture(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeRecurring(
    householdId: string,
    onData: (items: RecurringExpense[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/recurring`;
    return onSnapshot(
      collection(db, 'households', householdId, 'recurring'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapRecurring(d.id, d.data()))
            .sort((a, b) => a.dayOfMonth - b.dayOfMonth)
        ),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  private subscribeVisibleTransactions(
    householdId: string,
    viewerUid: string,
    predicate: (t: Transaction) => boolean,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/transactions`;
    const colRef = collection(db, 'households', householdId, 'transactions');
    const sharedMap = new Map<string, Transaction>();
    const ownMap = new Map<string, Transaction>();
    let readyShared = false;
    let readyOwn = !viewerUid;

    const emit = () => {
      if (!readyShared || !readyOwn) return;
      const merged = new Map<string, Transaction>(sharedMap);
      for (const [id, tx] of ownMap) merged.set(id, tx);
      onData(
        Array.from(merged.values())
          .filter((t) => predicate(t) && (!t.isPrivate || t.createdBy === viewerUid))
          .sort((a, b) => b.date.localeCompare(a.date))
      );
    };

    const unsubShared = onSnapshot(
      query(colRef, where('isPrivate', '==', false)),
      (snap) => {
        sharedMap.clear();
        for (const d of snap.docs) {
          sharedMap.set(d.id, mapTransaction(d.id, d.data()));
        }
        readyShared = true;
        emit();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );

    const unsubOwn = viewerUid
      ? onSnapshot(
          query(colRef, where('createdBy', '==', viewerUid)),
          (snap) => {
            ownMap.clear();
            for (const d of snap.docs) {
              ownMap.set(d.id, mapTransaction(d.id, d.data()));
            }
            readyOwn = true;
            emit();
          },
          (err) => {
            try {
              handleFirestoreError(err, OperationType.LIST, path);
            } catch (wrapped) {
              onError(wrapped as Error);
            }
          }
        )
      : () => {};

    return () => {
      unsubShared();
      unsubOwn();
    };
  }

  subscribeTransactionsByMonth(
    householdId: string,
    viewerUid: string,
    monthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    return this.subscribeVisibleTransactions(
      householdId,
      viewerUid,
      (t) => t.monthKey === monthKey,
      onData,
      onError
    );
  }

  subscribeTransactionsRecentMonths(
    householdId: string,
    viewerUid: string,
    minMonthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    return this.subscribeVisibleTransactions(
      householdId,
      viewerUid,
      (t) => t.monthKey >= minMonthKey,
      onData,
      onError
    );
  }

  async fetchAllTransactions(householdId: string, viewerUid: string): Promise<Transaction[]> {
    const path = `households/${householdId}/transactions`;
    try {
      const txMap = await this.fetchVisibleTransactionsMap(householdId, viewerUid);
      return Array.from(txMap.entries())
        .map(([id, data]) => mapTransaction(id, data))
        .filter((t) => !t.isPrivate || t.createdBy === viewerUid)
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  subscribeBudget(
    householdId: string,
    monthKey: string,
    onData: (b: MonthlyBudget | null) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/budgets/${monthKey}`;
    return onSnapshot(
      doc(db, 'households', householdId, 'budgets', monthKey),
      (snap) => {
        if (!snap.exists()) {
          onData(null);
          return;
        }
        const d = snap.data();
        onData({
          monthKey: String(d.monthKey ?? monthKey),
          limits: (d.limits ?? {}) as MonthlyBudget['limits'],
          updatedAt: tsToIso(d.updatedAt),
        });
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeMonthClosures(
    householdId: string,
    onData: (c: MonthClosure[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/monthClosures`;
    return onSnapshot(
      collection(db, 'households', householdId, 'monthClosures'),
      (snap) =>
        onData(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              monthKey: String(data.monthKey ?? d.id),
              totalSpent: Number(data.totalSpent ?? 0),
              paidA: Number(data.paidA ?? 0),
              paidB: Number(data.paidB ?? 0),
              paidComun: Number(data.paidComun ?? 0),
              shareA: Number(data.shareA ?? 0),
              shareB: Number(data.shareB ?? 0),
              balanceA: Number(data.balanceA ?? 0),
              settlementText: String(data.settlementText ?? ''),
              closedBy: String(data.closedBy ?? ''),
              closedAt: tsToIso(data.closedAt),
            };
          })
        ),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeGoals(
    householdId: string,
    onData: (g: SavingsGoal[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/goals`;
    return onSnapshot(
      collection(db, 'households', householdId, 'goals'),
      (snap) => onData(snap.docs.map((d) => mapGoal(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeGoalMovements(
    householdId: string,
    onData: (m: GoalMovement[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/goalMovements`;
    return onSnapshot(
      collection(db, 'households', householdId, 'goalMovements'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapGoalMovement(d.id, d.data()))
            .sort((a, b) => b.date.localeCompare(a.date))
        ),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeShopping(
    householdId: string,
    onData: (items: ShoppingItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/shopping`;
    return onSnapshot(
      collection(db, 'households', householdId, 'shopping'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapShoppingItem(d.id, d.data()))
            .sort(
              (a, b) => Number(a.done) - Number(b.done) || a.createdAt.localeCompare(b.createdAt)
            )
        ),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async updateSettings(
    householdId: string,
    settings: HouseholdSettings,
    actor: UserProfileInput,
    summary: string
  ): Promise<void> {
    const path = `households/${householdId}`;
    const { presetA, presetB } = normalizeSplitPair(settings.presetA);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), {
        settings: {
          splitMode: settings.splitMode,
          presetA,
          presetB,
          incomeA: Math.max(0, Number(settings.incomeA) || 0),
          incomeB: Math.max(0, Number(settings.incomeB) || 0),
          currency: 'EUR',
        },
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'update', 'reparto', householdId, summary);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async updateHouseholdName(
    householdId: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void> {
    const clean = clampStr(name, MAX_LENGTHS.householdName) || 'Nuestro hogar';
    const path = `households/${householdId}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), {
        name: clean,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'update', 'hogar', householdId, `Renombró el hogar a "${clean}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async updateCsvKeywords(householdId: string, keywords: CsvCategoryKeywords): Promise<void> {
    const path = `households/${householdId}`;
    const clean = sanitizeCsvKeywords(keywords) ?? {};
    try {
      await updateDoc(doc(db, 'households', householdId), {
        csvKeywords: clean,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async updateMemberUiMode(householdId: string, uid: string, uiMode: UiMode): Promise<void> {
    const path = `households/${householdId}/members/${uid}`;
    try {
      await updateDoc(doc(db, 'households', householdId, 'members', uid), {
        uiMode,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async upsertInitialCost(
    householdId: string,
    cost: Omit<InitialCost, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = cost.id || doc(collection(db, 'households', householdId, 'initialCosts')).id;
    const path = `households/${householdId}/initialCosts/${id}`;
    const concept = clampStr(cost.concept, MAX_LENGTHS.concept);
    const payload = {
      concept,
      category: cost.category,
      amount: Math.max(0, Number(cost.amount) || 0),
      paidBy: normalizePayerValue(cost.paidBy),
      status: cost.status,
      dueDate: cost.dueDate || '',
      notes: clampStr(cost.notes || '', MAX_LENGTHS.notes),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'initialCosts', id);
      if (cost.id) {
        batch.update(ref, payload);
        this.addActivityToBatch(batch, householdId, actor, 'update', 'gasto_inicial', id, `Editó "${concept}" (${payload.amount} €)`);
      } else {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
        this.addActivityToBatch(batch, householdId, actor, 'create', 'gasto_inicial', id, `Añadió gasto inicial "${concept}"`);
      }
      await batch.commit();
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async restoreInitialCost(
    householdId: string,
    cost: InitialCost,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/initialCosts/${cost.id}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'initialCosts', cost.id), {
        concept: clampStr(cost.concept, MAX_LENGTHS.concept),
        category: cost.category,
        amount: Math.max(0, cost.amount),
        paidBy: normalizePayerValue(cost.paidBy),
        status: cost.status,
        dueDate: cost.dueDate,
        notes: clampStr(cost.notes, MAX_LENGTHS.notes),
        createdAt: isoToFirestoreTimestamp(cost.createdAt),
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'create', 'gasto_inicial', cost.id, `Restauró "${cost.concept}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async deleteInitialCost(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/initialCosts/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'initialCosts', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'gasto_inicial', id, `Eliminó "${concept}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async toggleChecklistItem(
    householdId: string,
    item: ChecklistItem,
    done: boolean,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/checklist/${item.id}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId, 'checklist', item.id), {
        done,
        doneBy: done ? actor.uid : '',
        doneAt: done ? getTodayLocalISO() : '',
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'update',
        'checklist',
        item.id,
        `${done ? 'Completó' : 'Reabrió'} "${item.text.slice(0, 60)}"`
      );
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async addChecklistItem(
    householdId: string,
    text: string,
    group: string,
    order: number,
    actor: UserProfileInput
  ): Promise<string> {
    const ref = doc(collection(db, 'households', householdId, 'checklist'));
    const cleanText = clampStr(text, MAX_LENGTHS.checklistText);
    try {
      const batch = writeBatch(db);
      batch.set(ref, {
        text: cleanText,
        done: false,
        doneBy: '',
        doneAt: '',
        group: clampStr(group || 'Personalizado', 60),
        order,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'create', 'checklist', ref.id, `Añadió tarea "${cleanText.slice(0, 60)}"`);
      await batch.commit();
      return ref.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `households/${householdId}/checklist/${ref.id}`);
    }
  }

  async deleteChecklistItem(
    householdId: string,
    id: string,
    text: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/checklist/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'checklist', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'checklist', id, `Eliminó tarea "${text.slice(0, 60)}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async upsertFurnitureItem(
    householdId: string,
    item: Omit<FurnitureItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = item.id || doc(collection(db, 'households', householdId, 'items')).id;
    const path = `households/${householdId}/items/${id}`;
    const name = clampStr(item.name, MAX_LENGTHS.itemName);
    const payload = {
      name,
      room: item.room,
      priority: item.priority,
      status: item.status,
      store: clampStr(item.store || 'IKEA', 60) || 'IKEA',
      productUrl: clampStr(item.productUrl || '', MAX_LENGTHS.productUrl),
      articleNumber: clampStr(item.articleNumber || '', MAX_LENGTHS.articleNumber),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      qty: Math.max(1, Math.min(999, Math.round(Number(item.qty) || 1))),
      notes: clampStr(item.notes || '', MAX_LENGTHS.notes),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'items', id);
      if (item.id) {
        batch.update(ref, payload);
        this.addActivityToBatch(batch, householdId, actor, 'update', 'mobiliario', id, `Editó "${name}"`);
      } else {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
        this.addActivityToBatch(batch, householdId, actor, 'create', 'mobiliario', id, `Añadió mueble "${name}"`);
      }
      await batch.commit();
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async restoreFurnitureItem(
    householdId: string,
    item: FurnitureItem,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/items/${item.id}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'items', item.id), {
        name: clampStr(item.name, MAX_LENGTHS.itemName),
        room: item.room,
        priority: item.priority,
        status: item.status,
        store: item.store,
        productUrl: clampStr(item.productUrl, MAX_LENGTHS.productUrl),
        articleNumber: clampStr(item.articleNumber, MAX_LENGTHS.articleNumber),
        unitPrice: Math.max(0, item.unitPrice),
        qty: Math.max(1, item.qty),
        notes: clampStr(item.notes, MAX_LENGTHS.notes),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'create', 'mobiliario', item.id, `Restauró "${item.name}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async updateFurnitureStatus(
    householdId: string,
    item: FurnitureItem,
    status: FurnitureStatus,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/items/${item.id}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId, 'items', item.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'update', 'mobiliario', item.id, `Marcó "${item.name}" como ${status}`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async deleteFurnitureItem(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/items/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'items', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'mobiliario', id, `Eliminó "${name}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async deleteFurnitureItemsBulk(
    householdId: string,
    items: Array<{ id: string; name: string }>,
    actor: UserProfileInput
  ): Promise<void> {
    if (items.length === 0) return;
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = items.map(
      (item) => ({
        path: `households/${householdId}/items/${item.id}`,
        apply: (batch) => batch.delete(doc(db, 'households', householdId, 'items', item.id)),
      })
    );
    ops.push({
      path: `households/${householdId}/activity`,
      apply: (batch) =>
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'delete',
          'mobiliario',
          items[0].id,
          `Eliminó ${items.length} artículos de mobiliario`
        ),
    });
    await this.commitBatchOps(
      ops,
      OperationType.DELETE,
      `households/${householdId}/items`,
      'No se pudieron eliminar los artículos seleccionados.'
    );
  }

  async upsertRecurring(
    householdId: string,
    rec: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = rec.id || doc(collection(db, 'households', householdId, 'recurring')).id;
    const path = `households/${householdId}/recurring/${id}`;
    const concept = clampStr(rec.concept, MAX_LENGTHS.concept);
    const payload = {
      concept,
      category: rec.category,
      amount: Math.max(0, Number(rec.amount) || 0),
      frequency: rec.frequency,
      dayOfMonth: Math.max(1, Math.min(31, Math.round(Number(rec.dayOfMonth) || 1))),
      splitOverride:
        rec.splitOverride === null || rec.splitOverride === undefined
          ? null
          : clampSplitPct(rec.splitOverride, 50),
      paidByDefault: normalizePayerValue(rec.paidByDefault),
      active: Boolean(rec.active),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'recurring', id);
      if (rec.id) {
        batch.update(ref, payload);
        this.addActivityToBatch(batch, householdId, actor, 'update', 'recurrente', id, `Editó plantilla "${concept}"`);
      } else {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
        this.addActivityToBatch(batch, householdId, actor, 'create', 'recurrente', id, `Creó plantilla "${concept}"`);
      }
      await batch.commit();
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async addHabitualRecurringTemplates(
    householdId: string,
    presets: readonly RecurringCatalogPreset[],
    actor: UserProfileInput
  ): Promise<number> {
    if (presets.length === 0) return 0;

    let recSnap;
    try {
      recSnap = await getDocs(collection(db, 'households', householdId, 'recurring'));
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        `households/${householdId}/recurring`,
        'No se pudieron comprobar las plantillas existentes.'
      );
    }

    const existingRecurring = recSnap.docs.map((d) => mapRecurring(d.id, d.data()));
    const seenIds = new Set<string>();
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    for (const preset of presets) {
      if (seenIds.has(preset.id)) continue;
      seenIds.add(preset.id);
      if (findMatchingRecurringForPreset(preset, existingRecurring)) continue;
      const ref = doc(db, 'households', householdId, 'recurring', preset.id);
      ops.push({
        path: `households/${householdId}/recurring/${preset.id}`,
        apply: (batch) =>
          batch.set(ref, {
            concept: clampStr(preset.concept, MAX_LENGTHS.concept),
            category: preset.category,
            amount: 0,
            frequency: preset.frequency,
            dayOfMonth: 1,
            splitOverride: null,
            paidByDefault: COMMON_ACCOUNT_ID,
            active: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    }

    const addedCount = ops.length;
    if (addedCount === 0) return 0;

    ops.push({
      path: `households/${householdId}/activity`,
      apply: (batch) =>
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'create',
          'recurrente',
          presets[0].id,
          `Añadió ${addedCount} ${addedCount === 1 ? 'plantilla habitual' : 'plantillas habituales'}`
        ),
    });

    await this.commitBatchOps(
      ops,
      OperationType.CREATE,
      `households/${householdId}/recurring`,
      'No se pudieron añadir las plantillas habituales.'
    );
    return addedCount;
  }

  async deleteRecurring(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/recurring/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'recurring', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'recurrente', id, `Eliminó plantilla "${concept}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async generateMonthTransactions(
    householdId: string,
    monthKey: string,
    missing: RecurringExpense[],
    defaultSplitPctA: number,
    actor: UserProfileInput
  ): Promise<number> {
    if (missing.length === 0) return 0;
    const baseSplit = clampSplitPct(defaultSplitPctA, 50);
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    for (const rec of missing) {
      const ref = doc(collection(db, 'households', householdId, 'transactions'));
      const splitPctA =
        rec.splitOverride !== null && rec.splitOverride !== undefined
          ? clampSplitPct(rec.splitOverride, baseSplit)
          : baseSplit;
      ops.push({
        path: `households/${householdId}/transactions/${ref.id}`,
        apply: (batch) =>
          batch.set(ref, {
            monthKey,
            concept: clampStr(rec.concept, MAX_LENGTHS.concept),
            category: rec.category,
            amount: Math.max(0, Number(rec.amount) || 0),
            date: clampDateForMonth(monthKey, rec.dayOfMonth),
            paidBy: normalizePayerValue(rec.paidByDefault),
            recurringId: rec.id,
            splitPctA,
            isSettlement: false,
            settlementTo: '',
            isPrivate: false,
            createdBy: actor.uid,
            notes: 'Generado desde plantilla recurrente',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    }

    ops.push({
      path: `households/${householdId}/activity`,
      apply: (batch) =>
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'create',
          'gastos_mes',
          monthKey,
          `Generó ${missing.length} gastos recurrentes para ${monthKey}`
        ),
    });

    await this.commitBatchOps(ops, OperationType.CREATE, `households/${householdId}/transactions`);
    return missing.length;
  }

  async upsertTransaction(
    householdId: string,
    tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = tx.id || doc(collection(db, 'households', householdId, 'transactions')).id;
    const path = `households/${householdId}/transactions/${id}`;
    const concept = clampStr(tx.concept, MAX_LENGTHS.concept);
    const isPrivate = Boolean(tx.isPrivate) && !tx.isSettlement;
    const ownerUid = tx.id ? (tx.createdBy || actor.uid) : actor.uid;
    const safePaidBy = isPrivate ? ownerUid : normalizePayerValue(tx.paidBy);
    const basePayload = {
      monthKey: tx.monthKey,
      concept,
      category: tx.category,
      amount: Math.max(0, Number(tx.amount) || 0),
      date: tx.date,
      paidBy: safePaidBy,
      splitPctA: clampSplitPct(tx.splitPctA, 50),
      isPrivate,
      notes: clampStr(tx.notes || '', MAX_LENGTHS.notes),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'transactions', id);
      if (tx.id) {
        const updateFields = tx.createdBy
          ? basePayload
          : { ...basePayload, createdBy: actor.uid };
        batch.update(ref, updateFields);
        if (!isPrivate) {
          this.addActivityToBatch(batch, householdId, actor, 'update', 'gasto', id, `Editó "${concept}" (${basePayload.amount} €)`);
        }
      } else {
        batch.set(ref, {
          ...basePayload,
          recurringId: tx.recurringId ?? null,
          isSettlement: Boolean(tx.isSettlement),
          settlementTo: isPrivate ? '' : tx.settlementTo || '',
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        });
        if (!isPrivate) {
          this.addActivityToBatch(
            batch,
            householdId,
            actor,
            'create',
            tx.isSettlement ? 'liquidacion' : 'gasto',
            id,
            `${tx.isSettlement ? 'Registró liquidación' : 'Añadió gasto'} "${concept}" (${basePayload.amount} €)`
          );
        }
      }
      await batch.commit();
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async restoreTransaction(
    householdId: string,
    tx: Transaction,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/transactions/${tx.id}`;
    const isPrivate = Boolean(tx.isPrivate) && !tx.isSettlement;
    const originalCreatedBy = tx.createdBy || actor.uid;
    const safePaidBy = isPrivate ? originalCreatedBy : normalizePayerValue(tx.paidBy);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'transactions', tx.id), {
        monthKey: tx.monthKey,
        concept: clampStr(tx.concept, MAX_LENGTHS.concept),
        category: tx.category,
        amount: Math.max(0, tx.amount),
        date: tx.date,
        paidBy: safePaidBy,
        recurringId: tx.recurringId,
        splitPctA: clampSplitPct(tx.splitPctA, 50),
        isSettlement: isPrivate ? false : tx.isSettlement,
        settlementTo: isPrivate ? '' : tx.settlementTo,
        isPrivate,
        createdBy: originalCreatedBy,
        notes: clampStr(tx.notes, MAX_LENGTHS.notes),
        createdAt: isoToFirestoreTimestamp(tx.createdAt),
        updatedAt: serverTimestamp(),
      });
      if (!isPrivate) {
        this.addActivityToBatch(batch, householdId, actor, 'create', 'gasto', tx.id, `Restauró "${tx.concept}"`);
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async deleteTransaction(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput,
    options?: { isPrivate?: boolean }
  ): Promise<void> {
    const path = `households/${householdId}/transactions/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'transactions', id));
      if (!options?.isPrivate) {
        this.addActivityToBatch(batch, householdId, actor, 'delete', 'gasto', id, `Eliminó "${concept}"`);
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async deleteTransactionsBulk(
    householdId: string,
    items: Array<{ id: string; concept: string; isPrivate?: boolean }>,
    actor: UserProfileInput
  ): Promise<void> {
    if (items.length === 0) return;
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = items.map(
      (tx) => ({
        path: `households/${householdId}/transactions/${tx.id}`,
        apply: (batch) => batch.delete(doc(db, 'households', householdId, 'transactions', tx.id)),
      })
    );
    const publicItems = items.filter((item) => !item.isPrivate);
    if (publicItems.length > 0) {
      ops.push({
        path: `households/${householdId}/activity`,
        apply: (batch) =>
          this.addActivityToBatch(
            batch,
            householdId,
            actor,
            'delete',
            'gasto',
            publicItems[0].id,
            `Eliminó ${publicItems.length} movimientos`
          ),
      });
    }
    await this.commitBatchOps(
      ops,
      OperationType.DELETE,
      `households/${householdId}/transactions`,
      'No se pudieron eliminar los movimientos seleccionados.'
    );
  }

  async importBankTransactions(
    householdId: string,
    items: BankCsvImportItem[],
    actor: UserProfileInput
  ): Promise<number> {
    if (items.length === 0) return 0;
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];
    let sharedCount = 0;

    for (const item of items) {
      const ref = doc(collection(db, 'households', householdId, 'transactions'));
      const isPrivate = Boolean(item.isPrivate);
      if (!isPrivate) sharedCount += 1;
      const safePaidBy = isPrivate ? actor.uid : normalizePayerValue(item.paidBy);
      ops.push({
        path: `households/${householdId}/transactions/${ref.id}`,
        apply: (batch) =>
          batch.set(ref, {
            monthKey: item.monthKey,
            concept: clampStr(item.concept, MAX_LENGTHS.concept) || 'Movimiento',
            category: item.category,
            amount: Math.max(0, Number(item.amount) || 0),
            date: item.date,
            paidBy: safePaidBy,
            recurringId: null,
            splitPctA: clampSplitPct(item.splitPctA, 50),
            isSettlement: false,
            settlementTo: '',
            isPrivate,
            createdBy: actor.uid,
            notes: clampStr(item.notes || '', MAX_LENGTHS.notes),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    }

    if (sharedCount > 0) {
      ops.push({
        path: `households/${householdId}/activity`,
        apply: (batch) =>
          this.addActivityToBatch(
            batch,
            householdId,
            actor,
            'import',
            'gasto',
            householdId,
            `Importó ${sharedCount} movimientos desde CSV bancario`
          ),
      });
    }

    await this.commitBatchOps(
      ops,
      OperationType.CREATE,
      `households/${householdId}/transactions`,
      'No se pudieron importar los movimientos CSV.'
    );
    return items.length;
  }

  async saveBudget(
    householdId: string,
    monthKey: string,
    limits: MonthlyBudget['limits'],
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/budgets/${monthKey}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'budgets', monthKey), {
        monthKey,
        limits,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'update', 'presupuesto', monthKey, `Actualizó presupuestos de ${monthKey}`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async closeMonth(
    householdId: string,
    closure: Omit<MonthClosure, 'closedAt'>,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/monthClosures/${closure.monthKey}`;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'monthClosures', closure.monthKey), {
        ...closure,
        closedBy: actor.uid,
        closedAt: serverTimestamp(),
      });
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'close_month',
        'cierre_mes',
        closure.monthKey,
        `Cerró el mes ${closure.monthKey} (${closure.settlementText})`
      );
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async reopenMonth(
    householdId: string,
    monthKey: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/monthClosures/${monthKey}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'monthClosures', monthKey));
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'reopen_month',
        'cierre_mes',
        monthKey,
        `Desbloqueó el mes ${monthKey} en Modo Avanzado`
      );
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async upsertGoal(
    householdId: string,
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = goal.id || doc(collection(db, 'households', householdId, 'goals')).id;
    const path = `households/${householdId}/goals/${id}`;
    const name = clampStr(goal.name, MAX_LENGTHS.goalName);
    const payload = {
      name,
      icon: clampStr(goal.icon || 'piggy-bank', 40),
      color: clampStr(goal.color || '#0E5A64', 30),
      targetAmount: Math.max(0, Number(goal.targetAmount) || 0),
      targetDate: goal.targetDate || '',
      type: goal.type,
      archived: Boolean(goal.archived),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'goals', id);
      if (goal.id) {
        batch.update(ref, payload);
        this.addActivityToBatch(batch, householdId, actor, 'update', 'meta', id, `Editó meta "${name}"`);
      } else {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
        this.addActivityToBatch(batch, householdId, actor, 'create', 'meta', id, `Creó meta "${name}"`);
      }
      await batch.commit();
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async deleteGoal(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/goals/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'goals', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'meta', id, `Eliminó meta "${name}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async deleteGoalWithMovements(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void> {
    let movDocs;
    try {
      const q = query(
        collection(db, 'households', householdId, 'goalMovements'),
        where('goalId', '==', id)
      );
      movDocs = (await getDocs(q)).docs;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `households/${householdId}/goalMovements`);
    }

    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> =
      movDocs.map((mDoc) => ({
        path: `households/${householdId}/goalMovements/${mDoc.id}`,
        apply: (batch) => batch.delete(mDoc.ref),
      }));

    ops.push({
      path: `households/${householdId}/goals/${id}`,
      apply: (batch) => batch.delete(doc(db, 'households', householdId, 'goals', id)),
    });
    ops.push({
      path: `households/${householdId}/activity`,
      apply: (batch) =>
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'delete',
          'meta',
          id,
          `Eliminó meta "${name}" y sus ${movDocs.length} movimientos`
        ),
    });

    await this.commitBatchOps(
      ops,
      OperationType.DELETE,
      `households/${householdId}/goals/${id}`,
      'No se pudo eliminar la meta y sus movimientos.'
    );
  }

  async addGoalMovement(
    householdId: string,
    movement: Omit<GoalMovement, 'id' | 'createdAt'>,
    goalName: string,
    actor: UserProfileInput
  ): Promise<string> {
    const ref = doc(collection(db, 'households', householdId, 'goalMovements'));
    const path = `households/${householdId}/goalMovements/${ref.id}`;
    const note = clampStr(movement.note || '', MAX_LENGTHS.movementNote);
    try {
      const batch = writeBatch(db);
      batch.set(ref, {
        goalId: movement.goalId,
        amount: Number(movement.amount),
        by: movement.by,
        date: movement.date,
        note,
        createdAt: serverTimestamp(),
      });
      const verb = movement.amount > 0 ? 'Aportó' : 'Retiró';
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'create',
        'ahorro',
        ref.id,
        `${verb} ${Math.abs(movement.amount)} € en "${goalName}"`
      );
      await batch.commit();
      return ref.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async deleteGoalMovement(
    householdId: string,
    id: string,
    goalName: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/goalMovements/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'goalMovements', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'ahorro', id, `Eliminó movimiento en "${goalName}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async upsertShoppingItem(
    householdId: string,
    item: { id?: string; text: string; qty: number; done: boolean },
    actor: UserProfileInput
  ): Promise<string> {
    const id = item.id || doc(collection(db, 'households', householdId, 'shopping')).id;
    const path = `households/${householdId}/shopping/${id}`;
    const cleanText = clampStr(item.text, MAX_LENGTHS.shoppingText);
    const cleanQty = Math.max(1, Math.min(999, Math.round(Number(item.qty) || 1)));
    try {
      const ref = doc(db, 'households', householdId, 'shopping', id);
      if (item.id) {
        await updateDoc(ref, {
          text: cleanText,
          qty: cleanQty,
          done: Boolean(item.done),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          text: cleanText,
          qty: cleanQty,
          done: Boolean(item.done),
          addedBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async deleteShoppingItem(householdId: string, id: string): Promise<void> {
    const path = `households/${householdId}/shopping/${id}`;
    try {
      await deleteDoc(doc(db, 'households', householdId, 'shopping', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async deleteShoppingItemsBulk(householdId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const ops = ids.map((id) => ({
      path: `households/${householdId}/shopping/${id}`,
      apply: (batch: ReturnType<typeof writeBatch>) =>
        batch.delete(doc(db, 'households', householdId, 'shopping', id)),
    }));
    await this.commitBatchOps(
      ops,
      OperationType.DELETE,
      `households/${householdId}/shopping`,
      'No se pudieron limpiar los productos marcados de la lista.'
    );
  }

  private async fetchVisibleTransactionsMap(
    householdId: string,
    viewerUid: string
  ): Promise<Map<string, DocumentData>> {
    const colRef = collection(db, 'households', householdId, 'transactions');
    const [sharedSnap, ownSnap] = await Promise.all([
      getDocs(query(colRef, where('isPrivate', '==', false))),
      getDocs(query(colRef, where('createdBy', '==', viewerUid))),
    ]);
    const map = new Map<string, DocumentData>();
    for (const d of sharedSnap.docs) map.set(d.id, d.data());
    for (const d of ownSnap.docs) map.set(d.id, d.data());
    return map;
  }

  async exportBackup(householdId: string, viewerUid: string): Promise<NidoBackupV1> {
    try {
      const [hSnap, icSnap, clSnap, itSnap, recSnap, txMap, budSnap, mcSnap, gSnap, gmSnap, shopSnap] =
        await Promise.all([
          getDoc(doc(db, 'households', householdId)),
          getDocs(collection(db, 'households', householdId, 'initialCosts')),
          getDocs(collection(db, 'households', householdId, 'checklist')),
          getDocs(collection(db, 'households', householdId, 'items')),
          getDocs(collection(db, 'households', householdId, 'recurring')),
          this.fetchVisibleTransactionsMap(householdId, viewerUid),
          getDocs(collection(db, 'households', householdId, 'budgets')),
          getDocs(collection(db, 'households', householdId, 'monthClosures')),
          getDocs(collection(db, 'households', householdId, 'goals')),
          getDocs(collection(db, 'households', householdId, 'goalMovements')),
          getDocs(collection(db, 'households', householdId, 'shopping')),
        ]);

      const hData = hSnap.exists() ? mapHousehold(hSnap.id, hSnap.data()) : null;
      return {
        schemaVersion: 1,
        app: 'nido',
        exportedAt: new Date().toISOString(),
        householdName: hData?.name || 'Nuestro hogar',
        settings: hData?.settings || {
          splitMode: 'preset',
          presetA: 50,
          presetB: 50,
          incomeA: 0,
          incomeB: 0,
          currency: 'EUR',
        },
        ...(hData?.csvKeywords ? { csvKeywords: hData.csvKeywords } : {}),
        initialCosts: icSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapInitialCost(d.id, d.data());
          return rest;
        }),
        checklist: clSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapChecklist(d.id, d.data());
          return rest;
        }),
        items: itSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapFurniture(d.id, d.data());
          return rest;
        }),
        recurring: recSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapRecurring(d.id, d.data());
          return rest;
        }),
        transactions: Array.from(txMap.entries())
          .map(([id, data]) => {
            const { createdAt: _c, updatedAt: _u, ...rest } = mapTransaction(id, data);
            return rest;
          })
          .filter((t) => !t.isPrivate || t.createdBy === viewerUid),
        budgets: budSnap.docs.map((d) => ({
          monthKey: String(d.data().monthKey ?? d.id),
          limits: (d.data().limits ?? {}) as MonthlyBudget['limits'],
        })),
        monthClosures: mcSnap.docs.map((d) => ({
          monthKey: String(d.data().monthKey ?? d.id),
          totalSpent: Number(d.data().totalSpent ?? 0),
          paidA: Number(d.data().paidA ?? 0),
          paidB: Number(d.data().paidB ?? 0),
          paidComun: Number(d.data().paidComun ?? 0),
          shareA: Number(d.data().shareA ?? 0),
          shareB: Number(d.data().shareB ?? 0),
          balanceA: Number(d.data().balanceA ?? 0),
          settlementText: String(d.data().settlementText ?? ''),
          closedBy: String(d.data().closedBy ?? ''),
        })),
        goals: gSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapGoal(d.id, d.data());
          return rest;
        }),
        goalMovements: gmSnap.docs.map((d) => {
          const { createdAt: _c, ...rest } = mapGoalMovement(d.id, d.data());
          return rest;
        }),
        shopping: shopSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapShoppingItem(d.id, d.data());
          return rest;
        }),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `households/${householdId}`);
    }
  }

  async importBackup(
    householdId: string,
    backup: NidoBackupV1,
    actor: UserProfileInput
  ): Promise<void> {
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    let hSnap, icEx, clEx, itEx, recEx, txExistingMap, budEx, mcEx, gEx, gmEx, shopEx;
    try {
      [hSnap, icEx, clEx, itEx, recEx, txExistingMap, budEx, mcEx, gEx, gmEx, shopEx] = await Promise.all([
        getDoc(doc(db, 'households', householdId)),
        getDocs(collection(db, 'households', householdId, 'initialCosts')),
        getDocs(collection(db, 'households', householdId, 'checklist')),
        getDocs(collection(db, 'households', householdId, 'items')),
        getDocs(collection(db, 'households', householdId, 'recurring')),
        this.fetchVisibleTransactionsMap(householdId, actor.uid),
        getDocs(collection(db, 'households', householdId, 'budgets')),
        getDocs(collection(db, 'households', householdId, 'monthClosures')),
        getDocs(collection(db, 'households', householdId, 'goals')),
        getDocs(collection(db, 'households', householdId, 'goalMovements')),
        getDocs(collection(db, 'households', householdId, 'shopping')),
      ]);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `households/${householdId}`);
    }

    const memberUids = new Set<string>(
      hSnap.exists() && Array.isArray(hSnap.data().memberUids)
        ? hSnap.data().memberUids.map(String)
        : [actor.uid]
    );
    const resolvePayer = (raw: string): string => {
      const clean = normalizePayerValue(raw);
      if (clean === COMMON_ACCOUNT_ID || memberUids.has(clean)) return clean;
      return COMMON_ACCOUNT_ID;
    };
    const resolveMemberUid = (raw: string): string => {
      if (raw && memberUids.has(raw)) return raw;
      return actor.uid;
    };

    const existsSet = (snap: Awaited<ReturnType<typeof getDocs>>) =>
      new Set(snap.docs.map((d) => d.id));
    const icSet = existsSet(icEx);
    const clSet = existsSet(clEx);
    const itSet = existsSet(itEx);
    const recSet = existsSet(recEx);
    const budSet = existsSet(budEx);
    const mcSet = existsSet(mcEx);
    const gSet = existsSet(gEx);
    const gmSet = existsSet(gmEx);
    const shopSet = existsSet(shopEx);

    const { presetA, presetB } = normalizeSplitPair(backup.settings.presetA);
    ops.push({
      path: `households/${householdId}`,
      apply: (b) =>
        b.update(doc(db, 'households', householdId), {
          name: backup.householdName,
          settings: {
            ...backup.settings,
            presetA,
            presetB,
            currency: 'EUR',
          },
          updatedAt: serverTimestamp(),
        }),
    });
    if (backup.csvKeywords) {
      const cleanKw = sanitizeCsvKeywords(backup.csvKeywords) ?? {};
      ops.push({
        path: `households/${householdId}`,
        apply: (b) =>
          b.update(doc(db, 'households', householdId), {
            csvKeywords: cleanKw,
            updatedAt: serverTimestamp(),
          }),
      });
    }

    for (const item of backup.initialCosts) {
      const { id, ...fields } = item;
      const safeFields = { ...fields, paidBy: resolvePayer(fields.paidBy) };
      const ref = doc(db, 'households', householdId, 'initialCosts', id);
      ops.push({
        path: `households/${householdId}/initialCosts/${id}`,
        apply: (b) =>
          icSet.has(id)
            ? b.update(ref, { ...safeFields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...safeFields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.checklist) {
      const { id, ...fields } = item;
      const ref = doc(db, 'households', householdId, 'checklist', id);
      ops.push({
        path: `households/${householdId}/checklist/${id}`,
        apply: (b) =>
          clSet.has(id)
            ? b.update(ref, { text: fields.text, group: fields.group, order: fields.order, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.items) {
      const { id, ...fields } = item;
      const ref = doc(db, 'households', householdId, 'items', id);
      ops.push({
        path: `households/${householdId}/items/${id}`,
        apply: (b) =>
          itSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.recurring) {
      const { id, ...fields } = item;
      const safeFields = { ...fields, paidByDefault: resolvePayer(fields.paidByDefault) };
      const ref = doc(db, 'households', householdId, 'recurring', id);
      ops.push({
        path: `households/${householdId}/recurring/${id}`,
        apply: (b) =>
          recSet.has(id)
            ? b.update(ref, { ...safeFields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...safeFields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.transactions) {
      const { id, ...fields } = item;
      const existingDoc = txExistingMap.get(id);
      const safeSplitPctA = clampSplitPct(fields.splitPctA, 50);
      const ref = doc(db, 'households', householdId, 'transactions', id);
      if (existingDoc) {
        const existingCreatedBy =
          typeof existingDoc.createdBy === 'string' && existingDoc.createdBy
            ? existingDoc.createdBy
            : '';
        const canBePrivate =
          Boolean(fields.isPrivate) &&
          !existingDoc.isSettlement &&
          (!existingCreatedBy || existingCreatedBy === actor.uid);
        const safePaidBy = canBePrivate ? actor.uid : resolvePayer(fields.paidBy);
        ops.push({
          path: `households/${householdId}/transactions/${id}`,
          apply: (b) => {
            const updatePayload: Record<string, unknown> = {
              monthKey: fields.monthKey,
              concept: fields.concept,
              category: canBePrivate && fields.category === 'liquidacion' ? 'otros' : fields.category,
              amount: fields.amount,
              date: fields.date,
              paidBy: safePaidBy,
              splitPctA: safeSplitPctA,
              isPrivate: canBePrivate,
              notes: fields.notes,
              updatedAt: serverTimestamp(),
            };
            if (!existingCreatedBy) {
              updatePayload.createdBy = actor.uid;
            }
            b.update(ref, updatePayload);
          },
        });
      } else {
        const isPrivate = Boolean(fields.isPrivate) && !fields.isSettlement;
        const safePaidBy = isPrivate ? actor.uid : resolvePayer(fields.paidBy);
        const safeSettlementTo = isPrivate
          ? ''
          : fields.settlementTo
            ? resolveMemberUid(fields.settlementTo)
            : '';
        ops.push({
          path: `households/${householdId}/transactions/${id}`,
          apply: (b) =>
            b.set(ref, {
              ...fields,
              category: isPrivate && fields.category === 'liquidacion' ? 'otros' : fields.category,
              isSettlement: isPrivate ? false : Boolean(fields.isSettlement),
              paidBy: safePaidBy,
              splitPctA: safeSplitPctA,
              settlementTo: safeSettlementTo,
              isPrivate,
              createdBy: actor.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
        });
      }
    }

    for (const item of backup.budgets) {
      const ref = doc(db, 'households', householdId, 'budgets', item.monthKey);
      ops.push({
        path: `households/${householdId}/budgets/${item.monthKey}`,
        apply: (b) =>
          budSet.has(item.monthKey)
            ? b.update(ref, { limits: item.limits, updatedAt: serverTimestamp() })
            : b.set(ref, { monthKey: item.monthKey, limits: item.limits, updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.monthClosures) {
      if (!mcSet.has(item.monthKey)) {
        const ref = doc(db, 'households', householdId, 'monthClosures', item.monthKey);
        ops.push({
          path: `households/${householdId}/monthClosures/${item.monthKey}`,
          apply: (b) =>
            b.set(ref, { ...item, closedBy: actor.uid, closedAt: serverTimestamp() }),
        });
      }
    }

    for (const item of backup.goals) {
      const { id, ...fields } = item;
      const ref = doc(db, 'households', householdId, 'goals', id);
      ops.push({
        path: `households/${householdId}/goals/${id}`,
        apply: (b) =>
          gSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      });
    }

    for (const item of backup.goalMovements) {
      if (!gmSet.has(item.id)) {
        const { id, ...fields } = item;
        const safeBy = resolvePayer(fields.by);
        const ref = doc(db, 'households', householdId, 'goalMovements', id);
        ops.push({
          path: `households/${householdId}/goalMovements/${id}`,
          apply: (b) => b.set(ref, { ...fields, by: safeBy, createdAt: serverTimestamp() }),
        });
      }
    }

    if (Array.isArray(backup.shopping)) {
      for (const item of backup.shopping) {
        const { id, text, qty, done, addedBy } = item;
        const safeAddedBy = resolveMemberUid(addedBy);
        const cleanQty = Math.max(1, Math.min(999, Math.round(Number(qty) || 1)));
        const ref = doc(db, 'households', householdId, 'shopping', id);
        ops.push({
          path: `households/${householdId}/shopping/${id}`,
          apply: (b) =>
            shopSet.has(id)
              ? b.update(ref, {
                  text: clampStr(text, MAX_LENGTHS.shoppingText) || 'Producto',
                  qty: cleanQty,
                  done: Boolean(done),
                  updatedAt: serverTimestamp(),
                })
              : b.set(ref, {
                  text: clampStr(text, MAX_LENGTHS.shoppingText) || 'Producto',
                  qty: cleanQty,
                  done: Boolean(done),
                  addedBy: safeAddedBy,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }),
        });
      }
    }

    ops.push({
      path: `households/${householdId}/activity`,
      apply: (b) =>
        this.addActivityToBatch(
          b,
          householdId,
          actor,
          'import',
          'copia_json',
          householdId,
          `Importó copia de seguridad (${backup.transactions.length} gastos, ${backup.items.length} muebles)`
        ),
    });

    await this.commitBatchOps(ops, OperationType.WRITE, `households/${householdId}`);
  }
}

export { computeEffectiveSplitPctA };
