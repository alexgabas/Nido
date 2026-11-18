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
import { clampDateForMonth, computeEffectiveSplitPctA, getTodayLocalISO } from '../domain/finance';
import {
  DEFAULT_CHECKLIST_CATALUNYA,
  DEFAULT_FURNITURE_ITEMS,
  DEFAULT_GOALS,
  DEFAULT_INITIAL_COSTS,
} from '../domain/presets';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import {
  MAX_LENGTHS,
  type ActivityAction,
  type ActivityEntry,
  type ChecklistItem,
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
  type Transaction,
  type UiMode,
} from '../types/nido';
import type { HouseholdRepository, Unsubscribe, UserProfileInput } from './HouseholdRepository';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function clampStr(v: string, max: number): string {
  return v.trim().slice(0, max);
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
  return {
    id,
    name: String(d.name ?? 'Mi hogar'),
    memberUids: Array.isArray(d.memberUids) ? d.memberUids.map(String) : [],
    inviteCode: String(d.inviteCode ?? ''),
    settings: {
      splitMode: d.settings?.splitMode ?? 'preset',
      presetA: Number(d.settings?.presetA ?? 50),
      presetB: Number(d.settings?.presetB ?? 50),
      incomeA: Number(d.settings?.incomeA ?? 0),
      incomeB: Number(d.settings?.incomeB ?? 0),
      currency: 'EUR',
    },
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
    paidBy: String(d.paidBy ?? 'comun'),
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
    splitOverride: d.splitOverride === null || d.splitOverride === undefined ? null : Number(d.splitOverride),
    paidByDefault: String(d.paidByDefault ?? 'cuenta_comun'),
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
    paidBy: String(d.paidBy ?? 'cuenta_comun'),
    recurringId: d.recurringId ? String(d.recurringId) : null,
    splitPctA: Number(d.splitPctA ?? 50),
    isSettlement: Boolean(d.isSettlement),
    settlementTo: String(d.settlementTo ?? ''),
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

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', code), {
        householdId: hid,
        householdName: cleanName,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'households', hid), {
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'households', hid, 'members', user.uid), {
        displayName,
        photoURL,
        role: 'member_a',
        uiMode: 'sencillo',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'users', user.uid), {
        householdId: hid,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, hid, user, 'create', 'hogar', hid, `Creó el hogar "${cleanName}"`);

      for (const ic of DEFAULT_INITIAL_COSTS) {
        const ref = doc(collection(db, 'households', hid, 'initialCosts'));
        batch.set(ref, {
          concept: ic.concept,
          category: ic.category,
          amount: ic.amount,
          paidBy: 'comun',
          status: ic.status,
          dueDate: '',
          notes: ic.notes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const task of DEFAULT_CHECKLIST_CATALUNYA) {
        const ref = doc(collection(db, 'households', hid, 'checklist'));
        batch.set(ref, {
          text: task.text,
          done: false,
          doneBy: '',
          doneAt: '',
          group: task.group,
          order: task.order,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const item of DEFAULT_FURNITURE_ITEMS) {
        const ref = doc(collection(db, 'households', hid, 'items'));
        batch.set(ref, {
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
        });
      }

      for (const g of DEFAULT_GOALS) {
        const ref = doc(collection(db, 'households', hid, 'goals'));
        batch.set(ref, {
          name: g.name,
          icon: g.icon,
          color: g.color,
          targetAmount: g.targetAmount,
          targetDate: g.targetDate,
          type: g.type,
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return hid;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `households/${hid}`);
    }
  }

  async joinHouseholdByCode(user: UserProfileInput, inviteCode: string): Promise<string> {
    const code = inviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      throw new Error('El código de invitación debe tener 6 caracteres alfanuméricos.');
    }

    let hid = '';
    try {
      const inviteSnap = await getDoc(doc(db, 'invites', code));
      if (!inviteSnap.exists()) {
        throw new Error('No hemos encontrado ningún hogar con ese código de invitación.');
      }
      hid = String(inviteSnap.data().householdId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No hemos encontrado')) throw error;
      handleFirestoreError(error, OperationType.GET, `invites/${code}`);
    }

    const displayName = clampStr(user.displayName || 'Pareja', MAX_LENGTHS.displayName) || 'Pareja';
    const photoURL = (user.photoURL || '').slice(0, 500);

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', hid), {
        memberUids: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
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
      handleFirestoreError(error, OperationType.UPDATE, `households/${hid}`);
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
      const hName = hSnap.exists() ? String(hSnap.data().name) : 'Nuestro hogar';
      const batch = writeBatch(db);
      batch.set(doc(db, 'invites', newCode), {
        householdId,
        householdName: hName,
        createdBy: actor.uid,
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

  subscribeTransactionsByMonth(
    householdId: string,
    monthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/transactions`;
    const q = query(
      collection(db, 'households', householdId, 'transactions'),
      where('monthKey', '==', monthKey)
    );
    return onSnapshot(
      q,
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapTransaction(d.id, d.data()))
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

  subscribeTransactionsRecentMonths(
    householdId: string,
    minMonthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/transactions`;
    const q = query(
      collection(db, 'households', householdId, 'transactions'),
      where('monthKey', '>=', minMonthKey)
    );
    return onSnapshot(
      q,
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapTransaction(d.id, d.data()))
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

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async updateSettings(
    householdId: string,
    settings: HouseholdSettings,
    actor: UserProfileInput,
    summary: string
  ): Promise<void> {
    const path = `households/${householdId}`;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), {
        settings: {
          splitMode: settings.splitMode,
          presetA: Number(settings.presetA),
          presetB: Number(settings.presetB),
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
      paidBy: cost.paidBy || 'comun',
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
        paidBy: cost.paidBy,
        status: cost.status,
        dueDate: cost.dueDate,
        notes: clampStr(cost.notes, MAX_LENGTHS.notes),
        createdAt: serverTimestamp(),
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
      splitOverride: rec.splitOverride === null ? null : Math.max(0, Math.min(100, Number(rec.splitOverride))),
      paidByDefault: rec.paidByDefault || 'cuenta_comun',
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
    const path = `households/${householdId}/transactions`;
    try {
      const batch = writeBatch(db);
      for (const rec of missing) {
        const ref = doc(collection(db, 'households', householdId, 'transactions'));
        batch.set(ref, {
          monthKey,
          concept: clampStr(rec.concept, MAX_LENGTHS.concept),
          category: rec.category,
          amount: Math.max(0, rec.amount),
          date: clampDateForMonth(monthKey, rec.dayOfMonth),
          paidBy: rec.paidByDefault || 'cuenta_comun',
          recurringId: rec.id,
          splitPctA: rec.splitOverride !== null ? rec.splitOverride : defaultSplitPctA,
          isSettlement: false,
          settlementTo: '',
          notes: 'Generado desde plantilla recurrente',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'create',
        'gastos_mes',
        monthKey,
        `Generó ${missing.length} gastos recurrentes para ${monthKey}`
      );
      await batch.commit();
      return missing.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async upsertTransaction(
    householdId: string,
    tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const id = tx.id || doc(collection(db, 'households', householdId, 'transactions')).id;
    const path = `households/${householdId}/transactions/${id}`;
    const concept = clampStr(tx.concept, MAX_LENGTHS.concept);
    const payload = {
      monthKey: tx.monthKey,
      concept,
      category: tx.category,
      amount: Math.max(0, Number(tx.amount) || 0),
      date: tx.date,
      paidBy: tx.paidBy,
      recurringId: tx.recurringId ?? null,
      splitPctA: Math.max(0, Math.min(100, Number(tx.splitPctA) || 50)),
      isSettlement: Boolean(tx.isSettlement),
      settlementTo: tx.settlementTo || '',
      notes: clampStr(tx.notes || '', MAX_LENGTHS.notes),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      const ref = doc(db, 'households', householdId, 'transactions', id);
      if (tx.id) {
        const { recurringId: _r, isSettlement: _s, settlementTo: _st, ...updateFields } = payload;
        batch.update(ref, updateFields);
        this.addActivityToBatch(batch, householdId, actor, 'update', 'gasto', id, `Editó "${concept}" (${payload.amount} €)`);
      } else {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'create',
          tx.isSettlement ? 'liquidacion' : 'gasto',
          id,
          `${tx.isSettlement ? 'Registró liquidación' : 'Añadió gasto'} "${concept}" (${payload.amount} €)`
        );
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
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'transactions', tx.id), {
        monthKey: tx.monthKey,
        concept: clampStr(tx.concept, MAX_LENGTHS.concept),
        category: tx.category,
        amount: Math.max(0, tx.amount),
        date: tx.date,
        paidBy: tx.paidBy,
        recurringId: tx.recurringId,
        splitPctA: tx.splitPctA,
        isSettlement: tx.isSettlement,
        settlementTo: tx.settlementTo,
        notes: clampStr(tx.notes, MAX_LENGTHS.notes),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'create', 'gasto', tx.id, `Restauró "${tx.concept}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  async deleteTransaction(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}/transactions/${id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'transactions', id));
      this.addActivityToBatch(batch, householdId, actor, 'delete', 'gasto', id, `Eliminó "${concept}"`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
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

  async exportBackup(householdId: string): Promise<NidoBackupV1> {
    try {
      const [hSnap, icSnap, clSnap, itSnap, recSnap, txSnap, budSnap, mcSnap, gSnap, gmSnap] =
        await Promise.all([
          getDoc(doc(db, 'households', householdId)),
          getDocs(collection(db, 'households', householdId, 'initialCosts')),
          getDocs(collection(db, 'households', householdId, 'checklist')),
          getDocs(collection(db, 'households', householdId, 'items')),
          getDocs(collection(db, 'households', householdId, 'recurring')),
          getDocs(collection(db, 'households', householdId, 'transactions')),
          getDocs(collection(db, 'households', householdId, 'budgets')),
          getDocs(collection(db, 'households', householdId, 'monthClosures')),
          getDocs(collection(db, 'households', householdId, 'goals')),
          getDocs(collection(db, 'households', householdId, 'goalMovements')),
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
        transactions: txSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapTransaction(d.id, d.data());
          return rest;
        }),
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
    try {
      const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
      const [icEx, clEx, itEx, recEx, txEx, budEx, mcEx, gEx, gmEx] = await Promise.all([
        getDocs(collection(db, 'households', householdId, 'initialCosts')),
        getDocs(collection(db, 'households', householdId, 'checklist')),
        getDocs(collection(db, 'households', householdId, 'items')),
        getDocs(collection(db, 'households', householdId, 'recurring')),
        getDocs(collection(db, 'households', householdId, 'transactions')),
        getDocs(collection(db, 'households', householdId, 'budgets')),
        getDocs(collection(db, 'households', householdId, 'monthClosures')),
        getDocs(collection(db, 'households', householdId, 'goals')),
        getDocs(collection(db, 'households', householdId, 'goalMovements')),
      ]);

      const existsSet = (snap: Awaited<ReturnType<typeof getDocs>>) =>
        new Set(snap.docs.map((d) => d.id));
      const icSet = existsSet(icEx);
      const clSet = existsSet(clEx);
      const itSet = existsSet(itEx);
      const recSet = existsSet(recEx);
      const txSet = existsSet(txEx);
      const budSet = existsSet(budEx);
      const mcSet = existsSet(mcEx);
      const gSet = existsSet(gEx);
      const gmSet = existsSet(gmEx);

      ops.push((b) =>
        b.update(doc(db, 'households', householdId), {
          name: backup.householdName,
          settings: backup.settings,
          updatedAt: serverTimestamp(),
        })
      );

      for (const item of backup.initialCosts) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'initialCosts', id);
        ops.push((b) =>
          icSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.checklist) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'checklist', id);
        ops.push((b) =>
          clSet.has(id)
            ? b.update(ref, { text: fields.text, group: fields.group, order: fields.order, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.items) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'items', id);
        ops.push((b) =>
          itSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.recurring) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'recurring', id);
        ops.push((b) =>
          recSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.transactions) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'transactions', id);
        ops.push((b) =>
          txSet.has(id)
            ? b.update(ref, {
                monthKey: fields.monthKey,
                concept: fields.concept,
                category: fields.category,
                amount: fields.amount,
                date: fields.date,
                paidBy: fields.paidBy,
                splitPctA: fields.splitPctA,
                notes: fields.notes,
                updatedAt: serverTimestamp(),
              })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.budgets) {
        const ref = doc(db, 'households', householdId, 'budgets', item.monthKey);
        ops.push((b) =>
          budSet.has(item.monthKey)
            ? b.update(ref, { limits: item.limits, updatedAt: serverTimestamp() })
            : b.set(ref, { monthKey: item.monthKey, limits: item.limits, updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.monthClosures) {
        if (!mcSet.has(item.monthKey)) {
          const ref = doc(db, 'households', householdId, 'monthClosures', item.monthKey);
          ops.push((b) =>
            b.set(ref, { ...item, closedBy: actor.uid, closedAt: serverTimestamp() })
          );
        }
      }

      for (const item of backup.goals) {
        const { id, ...fields } = item;
        const ref = doc(db, 'households', householdId, 'goals', id);
        ops.push((b) =>
          gSet.has(id)
            ? b.update(ref, { ...fields, updatedAt: serverTimestamp() })
            : b.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        );
      }

      for (const item of backup.goalMovements) {
        if (!gmSet.has(item.id)) {
          const { id, ...fields } = item;
          const ref = doc(db, 'households', householdId, 'goalMovements', id);
          ops.push((b) => b.set(ref, { ...fields, createdAt: serverTimestamp() }));
        }
      }

      ops.push((b) =>
        this.addActivityToBatch(
          b,
          householdId,
          actor,
          'import',
          'copia_json',
          householdId,
          `Importó copia de seguridad (${backup.transactions.length} gastos, ${backup.items.length} muebles)`
        )
      );

      const CHUNK = 400;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const fn of ops.slice(i, i + CHUNK)) {
          fn(batch);
        }
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `households/${householdId}`);
    }
  }
}

export { computeEffectiveSplitPctA };
