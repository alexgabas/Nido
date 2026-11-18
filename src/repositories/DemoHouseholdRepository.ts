import {
  clampDateForMonth,
  clampSplitPct,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  normalizeSplitPair,
  shiftMonthKey,
} from '../domain/finance';
import {
  DEFAULT_CHECKLIST_CATALUNYA,
  DEFAULT_FURNITURE_ITEMS,
  DEFAULT_GOALS,
  DEFAULT_INITIAL_COSTS,
} from '../domain/presets';
import { COMMON_ACCOUNT_ID } from '../types/nido';
import type {
  ActivityAction,
  ActivityEntry,
  ChecklistItem,
  FurnitureItem,
  FurnitureStatus,
  GoalMovement,
  Household,
  HouseholdMember,
  HouseholdSettings,
  InitialCost,
  MonthClosure,
  MonthlyBudget,
  NidoBackupV1,
  RecurringExpense,
  SavingsGoal,
  Transaction,
  UiMode,
} from '../types/nido';
import type { HouseholdRepository, Unsubscribe, UserProfileInput } from './HouseholdRepository';

interface DemoState {
  household: Household;
  members: HouseholdMember[];
  activity: ActivityEntry[];
  initialCosts: InitialCost[];
  checklist: ChecklistItem[];
  items: FurnitureItem[];
  recurring: RecurringExpense[];
  transactions: Transaction[];
  budgets: Record<string, MonthlyBudget>;
  monthClosures: MonthClosure[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];
}

const STORAGE_KEY = 'nido_demo_state_v1';

function buildInitialDemoState(): DemoState {
  const now = new Date();
  const todayISO = getTodayLocalISO(now);
  const currentMonth = getCurrentMonthKeyLocal(now);
  const prevMonth = shiftMonthKey(currentMonth, -1);
  const prevMonth2 = shiftMonthKey(currentMonth, -2);
  const ts = now.toISOString();

  const uidA = 'demo_alex';
  const uidB = 'demo_marta';
  const hid = 'demo_hogar_santsadurni';

  const initialCosts: InitialCost[] = [
    { id: 'ic_1', concept: 'Primer mes de alquiler', category: 'alquiler', amount: 850, paidBy: COMMON_ACCOUNT_ID, status: 'pagado', dueDate: `${currentMonth}-01`, notes: 'Transferencia al firmar llaves', createdAt: ts, updatedAt: ts },
    { id: 'ic_2', concept: 'Fianza legal (1 mensualidad)', category: 'fianza', amount: 850, paidBy: uidA, status: 'pagado', dueDate: `${currentMonth}-01`, notes: 'Depositar en INCASÒL', createdAt: ts, updatedAt: ts },
    { id: 'ic_3', concept: 'Garantía adicional (1 mes)', category: 'garantia_adicional', amount: 850, paidBy: uidB, status: 'pagado', dueDate: `${currentMonth}-01`, notes: 'Devuelta al finalizar contrato', createdAt: ts, updatedAt: ts },
    { id: 'ic_4', concept: 'Alta / cambio titular luz', category: 'suministros', amount: 45, paidBy: uidA, status: 'pendiente', dueDate: `${currentMonth}-22`, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'ic_5', concept: 'Alta / cambio titular agua', category: 'suministros', amount: 35, paidBy: COMMON_ACCOUNT_ID, status: 'pendiente', dueDate: `${currentMonth}-22`, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'ic_6', concept: 'Cambio de bombín', category: 'cerrajeria', amount: 110, paidBy: uidB, status: 'pagado', dueDate: `${currentMonth}-03`, notes: 'Bombín antibumping', createdAt: ts, updatedAt: ts },
    { id: 'ic_7', concept: 'Seguro de hogar (anual)', category: 'otros', amount: 168, paidBy: COMMON_ACCOUNT_ID, status: 'pendiente', dueDate: `${currentMonth}-25`, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'ic_8', concept: 'Furgoneta mudanza', category: 'mudanza', amount: 95, paidBy: uidA, status: 'pendiente', dueDate: `${currentMonth}-20`, notes: '', createdAt: ts, updatedAt: ts },
  ];

  const checklist: ChecklistItem[] = DEFAULT_CHECKLIST_CATALUNYA.map((item, idx) => ({
    id: `cl_${idx + 1}`,
    text: item.text,
    done: idx === 0 || idx === 3,
    doneBy: idx === 0 ? uidA : idx === 3 ? uidB : '',
    doneAt: idx === 0 || idx === 3 ? todayISO : '',
    group: item.group,
    order: item.order,
    createdAt: ts,
    updatedAt: ts,
  }));

  const items: FurnitureItem[] = DEFAULT_FURNITURE_ITEMS.map((item, idx) => {
    const prices = [599, 249, 45, 89, 429, 349, 40, 35, 29, 45, 69, 39, 25, 85, 29, 12, 22, 139];
    const statuses: FurnitureStatus[] = [
      'en_carrito',
      'pendiente',
      'en_carrito',
      'pendiente',
      'comprado',
      'pendiente',
      'comprado',
      'pendiente',
      'pendiente',
      'ya_lo_tenemos',
      'en_carrito',
      'pendiente',
      'ya_lo_tenemos',
      'ya_lo_tenemos',
      'pendiente',
      'comprado',
      'pendiente',
      'ya_lo_tenemos',
    ];
    return {
      id: `fur_${idx + 1}`,
      name: item.name,
      room: item.room,
      priority: item.priority,
      status: statuses[idx] ?? 'pendiente',
      store: item.store,
      productUrl: idx === 0 ? 'https://www.ikea.com/es/es/search/?q=Sof%C3%A1' : '',
      articleNumber: idx === 0 ? '304.914.52' : '',
      unitPrice: prices[idx] ?? 0,
      qty: item.qty,
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    };
  });

  const recurring: RecurringExpense[] = [
    { id: 'rec_rent', concept: 'Alquiler piso', category: 'alquiler', amount: 850, frequency: 'mensual', dayOfMonth: 1, splitOverride: null, paidByDefault: 'cuenta_comun', active: true, createdAt: ts, updatedAt: ts },
    { id: 'rec_fiber', concept: 'Fibra y móviles', category: 'internet', amount: 48, frequency: 'mensual', dayOfMonth: 5, splitOverride: null, paidByDefault: uidA, active: true, createdAt: ts, updatedAt: ts },
    { id: 'rec_light', concept: 'Electricidad', category: 'luz', amount: 68, frequency: 'mensual', dayOfMonth: 12, splitOverride: null, paidByDefault: 'cuenta_comun', active: true, createdAt: ts, updatedAt: ts },
    { id: 'rec_water', concept: 'Agua (bimestral)', category: 'agua', amount: 52, frequency: 'bimestral', dayOfMonth: 24, splitOverride: null, paidByDefault: uidB, active: true, createdAt: ts, updatedAt: ts },
    { id: 'rec_ins', concept: 'Seguro de hogar', category: 'seguros', amount: 168, frequency: 'anual', dayOfMonth: 28, splitOverride: null, paidByDefault: 'cuenta_comun', active: true, createdAt: ts, updatedAt: ts },
  ];

  const transactions: Transaction[] = [
    { id: 'tx_1', monthKey: currentMonth, concept: 'Alquiler piso', category: 'alquiler', amount: 850, date: clampDateForMonth(currentMonth, 1), paidBy: 'cuenta_comun', recurringId: 'rec_rent', splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_2', monthKey: currentMonth, concept: 'Fibra y móviles', category: 'internet', amount: 48, date: clampDateForMonth(currentMonth, 5), paidBy: uidA, recurringId: 'rec_fiber', splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_3', monthKey: currentMonth, concept: 'Compra semanal Bonpreu', category: 'supermercado', amount: 142.6, date: clampDateForMonth(currentMonth, 8), paidBy: uidA, recurringId: null, splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_4', monthKey: currentMonth, concept: 'Frutería y mercado', category: 'supermercado', amount: 64.2, date: clampDateForMonth(currentMonth, 14), paidBy: uidB, recurringId: null, splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidB, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_5', monthKey: currentMonth, concept: 'Cena cava Sant Sadurní', category: 'ocio', amount: 56, date: clampDateForMonth(currentMonth, 16), paidBy: uidA, recurringId: null, splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_p1', monthKey: prevMonth, concept: 'Alquiler piso', category: 'alquiler', amount: 850, date: clampDateForMonth(prevMonth, 1), paidBy: 'cuenta_comun', recurringId: 'rec_rent', splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_p2', monthKey: prevMonth, concept: 'Compra mensual', category: 'supermercado', amount: 310, date: clampDateForMonth(prevMonth, 10), paidBy: uidB, recurringId: null, splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidB, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_p3', monthKey: prevMonth2, concept: 'Alquiler piso', category: 'alquiler', amount: 850, date: clampDateForMonth(prevMonth2, 1), paidBy: 'cuenta_comun', recurringId: 'rec_rent', splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
    { id: 'tx_p4', monthKey: prevMonth2, concept: 'Supermercado', category: 'supermercado', amount: 265, date: clampDateForMonth(prevMonth2, 11), paidBy: uidA, recurringId: null, splitPctA: 55, isSettlement: false, settlementTo: '', isPrivate: false, createdBy: uidA, notes: '', createdAt: ts, updatedAt: ts },
  ];

  const goals: SavingsGoal[] = DEFAULT_GOALS.map((g, idx) => ({
    id: `goal_${idx + 1}`,
    name: g.name,
    icon: g.icon,
    color: g.color,
    targetAmount: idx === 0 ? 3000 : g.targetAmount,
    targetDate: idx === 2 ? shiftMonthKey(currentMonth, 6) + '-15' : '',
    type: g.type,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  }));

  const goalMovements: GoalMovement[] = [
    { id: 'gm_1', goalId: 'goal_1', amount: 1100, by: uidA, date: `${prevMonth}-05`, note: 'Aportación inicial colchón', createdAt: ts },
    { id: 'gm_2', goalId: 'goal_1', amount: 900, by: uidB, date: `${prevMonth}-05`, note: 'Aportación inicial colchón', createdAt: ts },
    { id: 'gm_3', goalId: 'goal_2', amount: 450, by: uidA, date: `${currentMonth}-02`, note: 'Ahorro mensual', createdAt: ts },
    { id: 'gm_4', goalId: 'goal_3', amount: 320, by: uidB, date: `${currentMonth}-04`, note: 'Escapada primavera', createdAt: ts },
  ];

  return {
    household: {
      id: hid,
      name: 'Piso Sant Sadurní',
      memberUids: [uidA, uidB],
      inviteCode: 'SNT26A',
      settings: {
        splitMode: 'income',
        presetA: 55,
        presetB: 45,
        incomeA: 2200,
        incomeB: 1800,
        currency: 'EUR',
      },
      createdAt: ts,
      updatedAt: ts,
    },
    members: [
      { uid: uidA, displayName: 'Alex', photoURL: '', role: 'member_a', uiMode: 'sencillo', joinedAt: ts, updatedAt: ts },
      { uid: uidB, displayName: 'Marta', photoURL: '', role: 'member_b', uiMode: 'sencillo', joinedAt: ts, updatedAt: ts },
    ],
    activity: [
      { id: 'act_1', uid: uidA, actorName: 'Alex', action: 'create', entity: 'gasto', entityId: 'tx_5', summary: 'Añadió gasto "Cena cava Sant Sadurní" (56 €)', timestamp: ts },
      { id: 'act_2', uid: uidB, actorName: 'Marta', action: 'update', entity: 'checklist', entityId: 'cl_4', summary: 'Completó "Leer contadores de luz, agua y gas"', timestamp: ts },
    ],
    initialCosts,
    checklist,
    items,
    recurring,
    transactions,
    budgets: {
      [currentMonth]: {
        monthKey: currentMonth,
        limits: {
          alquiler: 850,
          supermercado: 350,
          ocio: 120,
          internet: 50,
          luz: 80,
        },
        updatedAt: ts,
      },
    },
    monthClosures: [],
    goals,
    goalMovements,
  };
}

export class DemoHouseholdRepository implements HouseholdRepository {
  private state: DemoState;
  private listeners = new Set<() => void>();

  constructor() {
    let loaded: DemoState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        loaded = JSON.parse(raw) as DemoState;
        if (loaded && Array.isArray(loaded.initialCosts)) {
          loaded.initialCosts = loaded.initialCosts.map((ic) => ({
            ...ic,
            paidBy: ic.paidBy === 'comun' ? COMMON_ACCOUNT_ID : ic.paidBy,
          }));
        }
        if (loaded && Array.isArray(loaded.transactions)) {
          loaded.transactions = loaded.transactions.map((tx) => ({
            ...tx,
            paidBy: tx.paidBy === 'comun' ? COMMON_ACCOUNT_ID : tx.paidBy,
            isPrivate: Boolean(tx.isPrivate),
            createdBy:
              typeof tx.createdBy === 'string' && tx.createdBy
                ? tx.createdBy
                : tx.paidBy === 'demo_marta'
                  ? 'demo_marta'
                  : 'demo_alex',
          }));
        }
      }
    } catch {
      loaded = null;
    }
    this.state = loaded ?? buildInitialDemoState();
  }

  private emit() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore storage quota errors
    }
    for (const fn of this.listeners) fn();
  }

  private logActivity(
    actor: UserProfileInput,
    action: ActivityAction,
    entity: string,
    entityId: string,
    summary: string
  ) {
    this.state.activity = [
      {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        uid: actor.uid,
        actorName: actor.displayName || 'Alex',
        action,
        entity,
        entityId,
        summary,
        timestamp: new Date().toISOString(),
      },
      ...this.state.activity,
    ].slice(0, 100);
  }

  private subscribe(fn: () => void): Unsubscribe {
    fn();
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async getUserHouseholdId(): Promise<string | null> {
    return this.state.household.id;
  }

  async createHousehold(_user: UserProfileInput, name: string): Promise<string> {
    this.state.household.name = name.trim() || 'Mi hogar';
    this.emit();
    return this.state.household.id;
  }

  async joinHouseholdByCode(): Promise<string> {
    return this.state.household.id;
  }

  hasPendingDefaultSeed(): boolean {
    return false;
  }

  async seedDefaultLists(_hid: string, actor: UserProfileInput): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;

    const icConcepts = new Set(this.state.initialCosts.map((c) => c.concept.trim().toLowerCase()));
    DEFAULT_INITIAL_COSTS.forEach((ic, idx) => {
      const id = `seed_ic_${idx}`;
      if (!this.state.initialCosts.some((c) => c.id === id) && !icConcepts.has(ic.concept.trim().toLowerCase())) {
        this.state.initialCosts.push({
          id,
          concept: ic.concept,
          category: ic.category,
          amount: ic.amount,
          paidBy: COMMON_ACCOUNT_ID,
          status: ic.status,
          dueDate: '',
          notes: ic.notes,
          createdAt: now,
          updatedAt: now,
        });
        count++;
      }
    });

    const clTexts = new Set(this.state.checklist.map((c) => c.text.trim().toLowerCase()));
    DEFAULT_CHECKLIST_CATALUNYA.forEach((t, idx) => {
      const id = `seed_cl_${idx}`;
      if (!this.state.checklist.some((c) => c.id === id) && !clTexts.has(t.text.trim().toLowerCase())) {
        this.state.checklist.push({
          id,
          text: t.text,
          done: false,
          doneBy: '',
          doneAt: '',
          group: t.group,
          order: t.order,
          createdAt: now,
          updatedAt: now,
        });
        count++;
      }
    });

    const furNames = new Set(this.state.items.map((c) => c.name.trim().toLowerCase()));
    DEFAULT_FURNITURE_ITEMS.forEach((it, idx) => {
      const id = `seed_fur_${idx}`;
      if (!this.state.items.some((c) => c.id === id) && !furNames.has(it.name.trim().toLowerCase())) {
        this.state.items.push({
          id,
          name: it.name,
          room: it.room,
          priority: it.priority,
          status: it.status,
          store: it.store,
          productUrl: '',
          articleNumber: '',
          unitPrice: 0,
          qty: it.qty,
          notes: '',
          createdAt: now,
          updatedAt: now,
        });
        count++;
      }
    });

    const goalNames = new Set(this.state.goals.map((g) => g.name.trim().toLowerCase()));
    DEFAULT_GOALS.forEach((g, idx) => {
      const id = `seed_goal_${idx}`;
      if (!this.state.goals.some((x) => x.id === id) && !goalNames.has(g.name.trim().toLowerCase())) {
        this.state.goals.push({
          id,
          name: g.name,
          icon: g.icon,
          color: g.color,
          targetAmount: g.targetAmount,
          targetDate: g.targetDate,
          type: g.type,
          archived: false,
          createdAt: now,
          updatedAt: now,
        });
        count++;
      }
    });

    if (count > 0) {
      this.logActivity(actor, 'create', 'hogar', this.state.household.id, 'Cargó las listas iniciales por defecto');
      this.emit();
    }
    return count;
  }

  async regenerateInviteCode(_hid: string, _old: string, actor: UserProfileInput): Promise<string> {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.state.household.inviteCode = code;
    this.logActivity(actor, 'update', 'hogar', this.state.household.id, 'Regeneró el código de invitación');
    this.emit();
    return code;
  }

  subscribeHousehold(_hid: string, onData: (h: Household | null) => void): Unsubscribe {
    return this.subscribe(() => onData({ ...this.state.household }));
  }

  subscribeMembers(_hid: string, onData: (m: HouseholdMember[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.members]));
  }

  subscribeActivity(_hid: string, limitCount: number, onData: (a: ActivityEntry[]) => void): Unsubscribe {
    return this.subscribe(() => onData(this.state.activity.slice(0, limitCount)));
  }

  subscribeInitialCosts(_hid: string, onData: (c: InitialCost[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.initialCosts]));
  }

  subscribeChecklist(_hid: string, onData: (items: ChecklistItem[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.checklist].sort((a, b) => a.order - b.order)));
  }

  subscribeFurniture(_hid: string, onData: (items: FurnitureItem[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.items]));
  }

  subscribeRecurring(_hid: string, onData: (items: RecurringExpense[]) => void): Unsubscribe {
    return this.subscribe(() =>
      onData([...this.state.recurring].sort((a, b) => a.dayOfMonth - b.dayOfMonth))
    );
  }

  subscribeTransactionsByMonth(
    _hid: string,
    viewerUid: string,
    monthKey: string,
    onData: (items: Transaction[]) => void
  ): Unsubscribe {
    return this.subscribe(() =>
      onData(
        this.state.transactions
          .filter((t) => t.monthKey === monthKey && (!t.isPrivate || t.createdBy === viewerUid))
          .sort((a, b) => b.date.localeCompare(a.date))
      )
    );
  }

  subscribeTransactionsRecentMonths(
    _hid: string,
    viewerUid: string,
    minMonthKey: string,
    onData: (items: Transaction[]) => void
  ): Unsubscribe {
    return this.subscribe(() =>
      onData(
        this.state.transactions
          .filter((t) => t.monthKey >= minMonthKey && (!t.isPrivate || t.createdBy === viewerUid))
          .sort((a, b) => b.date.localeCompare(a.date))
      )
    );
  }

  subscribeAllTransactions(
    _hid: string,
    viewerUid: string,
    onData: (items: Transaction[]) => void
  ): Unsubscribe {
    return this.subscribe(() =>
      onData(
        this.state.transactions
          .filter((t) => !t.isPrivate || t.createdBy === viewerUid)
          .sort((a, b) => b.date.localeCompare(a.date))
      )
    );
  }

  subscribeBudget(_hid: string, monthKey: string, onData: (b: MonthlyBudget | null) => void): Unsubscribe {
    return this.subscribe(() => onData(this.state.budgets[monthKey] ?? null));
  }

  subscribeMonthClosures(_hid: string, onData: (c: MonthClosure[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.monthClosures]));
  }

  subscribeGoals(_hid: string, onData: (g: SavingsGoal[]) => void): Unsubscribe {
    return this.subscribe(() => onData([...this.state.goals]));
  }

  subscribeGoalMovements(_hid: string, onData: (m: GoalMovement[]) => void): Unsubscribe {
    return this.subscribe(() =>
      onData([...this.state.goalMovements].sort((a, b) => b.date.localeCompare(a.date)))
    );
  }

  async updateSettings(
    hid: string,
    settings: HouseholdSettings,
    actor: UserProfileInput,
    summary: string
  ): Promise<void> {
    const { presetA, presetB } = normalizeSplitPair(settings.presetA);
    this.state.household.settings = { ...settings, presetA, presetB, currency: 'EUR' };
    this.state.household.updatedAt = new Date().toISOString();
    this.logActivity(actor, 'update', 'reparto', hid, summary);
    this.emit();
  }

  async updateHouseholdName(hid: string, name: string, actor: UserProfileInput): Promise<void> {
    this.state.household.name = name.trim() || 'Nuestro hogar';
    this.logActivity(actor, 'update', 'hogar', hid, `Renombró el hogar a "${this.state.household.name}"`);
    this.emit();
  }

  async updateMemberUiMode(_hid: string, uid: string, uiMode: UiMode): Promise<void> {
    this.state.members = this.state.members.map((m) => (m.uid === uid ? { ...m, uiMode } : m));
    this.emit();
  }

  async upsertInitialCost(
    _hid: string,
    cost: Omit<InitialCost, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = cost.id || `ic_${Date.now()}`;
    if (cost.id) {
      this.state.initialCosts = this.state.initialCosts.map((c) =>
        c.id === id ? { ...c, ...cost, id, updatedAt: now } : c
      );
      this.logActivity(actor, 'update', 'gasto_inicial', id, `Editó "${cost.concept}" (${cost.amount} €)`);
    } else {
      this.state.initialCosts.push({ ...cost, id, createdAt: now, updatedAt: now });
      this.logActivity(actor, 'create', 'gasto_inicial', id, `Añadió "${cost.concept}"`);
    }
    this.emit();
    return id;
  }

  async restoreInitialCost(_hid: string, cost: InitialCost, actor: UserProfileInput): Promise<void> {
    this.state.initialCosts.push(cost);
    this.logActivity(actor, 'create', 'gasto_inicial', cost.id, `Restauró "${cost.concept}"`);
    this.emit();
  }

  async deleteInitialCost(_hid: string, id: string, concept: string, actor: UserProfileInput): Promise<void> {
    this.state.initialCosts = this.state.initialCosts.filter((c) => c.id !== id);
    this.logActivity(actor, 'delete', 'gasto_inicial', id, `Eliminó "${concept}"`);
    this.emit();
  }

  async toggleChecklistItem(
    _hid: string,
    item: ChecklistItem,
    done: boolean,
    actor: UserProfileInput
  ): Promise<void> {
    const today = getTodayLocalISO();
    this.state.checklist = this.state.checklist.map((c) =>
      c.id === item.id
        ? { ...c, done, doneBy: done ? actor.uid : '', doneAt: done ? today : '', updatedAt: new Date().toISOString() }
        : c
    );
    this.logActivity(
      actor,
      'update',
      'checklist',
      item.id,
      `${done ? 'Completó' : 'Reabrió'} "${item.text.slice(0, 60)}"`
    );
    this.emit();
  }

  async addChecklistItem(
    _hid: string,
    text: string,
    group: string,
    order: number,
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = `cl_${Date.now()}`;
    this.state.checklist.push({
      id,
      text: text.trim(),
      done: false,
      doneBy: '',
      doneAt: '',
      group: group || 'Personalizado',
      order,
      createdAt: now,
      updatedAt: now,
    });
    this.logActivity(actor, 'create', 'checklist', id, `Añadió tarea "${text.slice(0, 60)}"`);
    this.emit();
    return id;
  }

  async deleteChecklistItem(_hid: string, id: string, text: string, actor: UserProfileInput): Promise<void> {
    this.state.checklist = this.state.checklist.filter((c) => c.id !== id);
    this.logActivity(actor, 'delete', 'checklist', id, `Eliminó tarea "${text.slice(0, 60)}"`);
    this.emit();
  }

  async upsertFurnitureItem(
    _hid: string,
    item: Omit<FurnitureItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = item.id || `fur_${Date.now()}`;
    if (item.id) {
      this.state.items = this.state.items.map((it) =>
        it.id === id ? { ...it, ...item, id, updatedAt: now } : it
      );
      this.logActivity(actor, 'update', 'mobiliario', id, `Editó "${item.name}"`);
    } else {
      this.state.items.push({ ...item, id, createdAt: now, updatedAt: now });
      this.logActivity(actor, 'create', 'mobiliario', id, `Añadió mueble "${item.name}"`);
    }
    this.emit();
    return id;
  }

  async restoreFurnitureItem(_hid: string, item: FurnitureItem, actor: UserProfileInput): Promise<void> {
    this.state.items.push(item);
    this.logActivity(actor, 'create', 'mobiliario', item.id, `Restauró "${item.name}"`);
    this.emit();
  }

  async updateFurnitureStatus(
    _hid: string,
    item: FurnitureItem,
    status: FurnitureStatus,
    actor: UserProfileInput
  ): Promise<void> {
    this.state.items = this.state.items.map((it) =>
      it.id === item.id ? { ...it, status, updatedAt: new Date().toISOString() } : it
    );
    this.logActivity(actor, 'update', 'mobiliario', item.id, `Marcó "${item.name}" como ${status}`);
    this.emit();
  }

  async deleteFurnitureItem(_hid: string, id: string, name: string, actor: UserProfileInput): Promise<void> {
    this.state.items = this.state.items.filter((it) => it.id !== id);
    this.logActivity(actor, 'delete', 'mobiliario', id, `Eliminó "${name}"`);
    this.emit();
  }

  async deleteFurnitureItemsBulk(
    _hid: string,
    items: Array<{ id: string; name: string }>,
    actor: UserProfileInput
  ): Promise<void> {
    if (items.length === 0) return;
    const ids = new Set(items.map((it) => it.id));
    this.state.items = this.state.items.filter((it) => !ids.has(it.id));
    this.logActivity(
      actor,
      'delete',
      'mobiliario',
      items[0].id,
      `Eliminó ${items.length} artículos de mobiliario`
    );
    this.emit();
  }

  async upsertRecurring(
    _hid: string,
    rec: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = rec.id || `rec_${Date.now()}`;
    if (rec.id) {
      this.state.recurring = this.state.recurring.map((r) =>
        r.id === id ? { ...r, ...rec, id, updatedAt: now } : r
      );
      this.logActivity(actor, 'update', 'recurrente', id, `Editó plantilla "${rec.concept}"`);
    } else {
      this.state.recurring.push({ ...rec, id, createdAt: now, updatedAt: now });
      this.logActivity(actor, 'create', 'recurrente', id, `Creó plantilla "${rec.concept}"`);
    }
    this.emit();
    return id;
  }

  async deleteRecurring(_hid: string, id: string, concept: string, actor: UserProfileInput): Promise<void> {
    this.state.recurring = this.state.recurring.filter((r) => r.id !== id);
    this.logActivity(actor, 'delete', 'recurrente', id, `Eliminó plantilla "${concept}"`);
    this.emit();
  }

  async generateMonthTransactions(
    _hid: string,
    monthKey: string,
    missing: RecurringExpense[],
    defaultSplitPctA: number,
    actor: UserProfileInput
  ): Promise<number> {
    if (missing.length === 0) return 0;
    const now = new Date().toISOString();
    for (const rec of missing) {
      this.state.transactions.push({
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        monthKey,
        concept: rec.concept,
        category: rec.category,
        amount: rec.amount,
        date: clampDateForMonth(monthKey, rec.dayOfMonth),
        paidBy: rec.paidByDefault || COMMON_ACCOUNT_ID,
        recurringId: rec.id,
        splitPctA:
          rec.splitOverride !== null && rec.splitOverride !== undefined
            ? clampSplitPct(rec.splitOverride, defaultSplitPctA)
            : clampSplitPct(defaultSplitPctA, 50),
        isSettlement: false,
        settlementTo: '',
        isPrivate: false,
        createdBy: actor.uid,
        notes: 'Generado desde plantilla recurrente',
        createdAt: now,
        updatedAt: now,
      });
    }
    this.logActivity(
      actor,
      'create',
      'gastos_mes',
      monthKey,
      `Generó ${missing.length} gastos recurrentes para ${monthKey}`
    );
    this.emit();
    return missing.length;
  }

  async upsertTransaction(
    _hid: string,
    tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = tx.id || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const isPrivate = Boolean(tx.isPrivate) && !tx.isSettlement;
    const ownerUid = tx.id ? (tx.createdBy || actor.uid) : actor.uid;
    const normalizedTx = {
      ...tx,
      splitPctA: clampSplitPct(tx.splitPctA, 50),
      isPrivate,
      createdBy: ownerUid,
      paidBy: isPrivate
        ? ownerUid
        : tx.paidBy === 'comun' || !tx.paidBy
          ? COMMON_ACCOUNT_ID
          : tx.paidBy,
      settlementTo: isPrivate ? '' : tx.settlementTo,
    };
    if (tx.id) {
      this.state.transactions = this.state.transactions.map((t) =>
        t.id === id ? { ...t, ...normalizedTx, id, updatedAt: now } : t
      );
      if (!isPrivate) {
        this.logActivity(actor, 'update', 'gasto', id, `Editó "${tx.concept}" (${tx.amount} €)`);
      }
    } else {
      this.state.transactions.push({ ...normalizedTx, id, createdAt: now, updatedAt: now });
      if (!isPrivate) {
        this.logActivity(
          actor,
          'create',
          tx.isSettlement ? 'liquidacion' : 'gasto',
          id,
          `${tx.isSettlement ? 'Registró liquidación' : 'Añadió gasto'} "${tx.concept}" (${tx.amount} €)`
        );
      }
    }
    this.emit();
    return id;
  }

  async restoreTransaction(_hid: string, tx: Transaction, actor: UserProfileInput): Promise<void> {
    const isPrivate = Boolean(tx.isPrivate) && !tx.isSettlement;
    const restored: Transaction = {
      ...tx,
      isPrivate,
      createdBy: tx.createdBy || actor.uid,
      paidBy: isPrivate ? (tx.createdBy || actor.uid) : tx.paidBy,
    };
    this.state.transactions.push(restored);
    if (!isPrivate) {
      this.logActivity(actor, 'create', 'gasto', tx.id, `Restauró "${tx.concept}"`);
    }
    this.emit();
  }

  async deleteTransaction(
    _hid: string,
    id: string,
    concept: string,
    actor: UserProfileInput,
    options?: { isPrivate?: boolean }
  ): Promise<void> {
    const existing = this.state.transactions.find((t) => t.id === id);
    const wasPrivate = options?.isPrivate ?? Boolean(existing?.isPrivate);
    this.state.transactions = this.state.transactions.filter((t) => t.id !== id);
    if (!wasPrivate) {
      this.logActivity(actor, 'delete', 'gasto', id, `Eliminó "${concept}"`);
    }
    this.emit();
  }

  async deleteTransactionsBulk(
    _hid: string,
    items: Array<{ id: string; concept: string; isPrivate?: boolean }>,
    actor: UserProfileInput
  ): Promise<void> {
    if (items.length === 0) return;
    const ids = new Set(items.map((tx) => tx.id));
    const publicItems = items.filter((item) => {
      const existing = this.state.transactions.find((t) => t.id === item.id);
      return !(item.isPrivate ?? existing?.isPrivate);
    });
    this.state.transactions = this.state.transactions.filter((t) => !ids.has(t.id));
    if (publicItems.length > 0) {
      this.logActivity(
        actor,
        'delete',
        'gasto',
        publicItems[0].id,
        `Eliminó ${publicItems.length} movimientos`
      );
    }
    this.emit();
  }

  async saveBudget(
    _hid: string,
    monthKey: string,
    limits: MonthlyBudget['limits'],
    actor: UserProfileInput
  ): Promise<void> {
    this.state.budgets[monthKey] = {
      monthKey,
      limits: { ...limits },
      updatedAt: new Date().toISOString(),
    };
    this.logActivity(actor, 'update', 'presupuesto', monthKey, `Actualizó presupuestos de ${monthKey}`);
    this.emit();
  }

  async closeMonth(
    _hid: string,
    closure: Omit<MonthClosure, 'closedAt'>,
    actor: UserProfileInput
  ): Promise<void> {
    this.state.monthClosures = [
      ...this.state.monthClosures.filter((c) => c.monthKey !== closure.monthKey),
      { ...closure, closedAt: new Date().toISOString() },
    ];
    this.logActivity(
      actor,
      'close_month',
      'cierre_mes',
      closure.monthKey,
      `Cerró el mes ${closure.monthKey} (${closure.settlementText})`
    );
    this.emit();
  }

  async reopenMonth(_hid: string, monthKey: string, actor: UserProfileInput): Promise<void> {
    this.state.monthClosures = this.state.monthClosures.filter((c) => c.monthKey !== monthKey);
    this.logActivity(actor, 'reopen_month', 'cierre_mes', monthKey, `Desbloqueó el mes ${monthKey}`);
    this.emit();
  }

  async upsertGoal(
    _hid: string,
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = goal.id || `goal_${Date.now()}`;
    if (goal.id) {
      this.state.goals = this.state.goals.map((g) =>
        g.id === id ? { ...g, ...goal, id, updatedAt: now } : g
      );
      this.logActivity(actor, 'update', 'meta', id, `Editó meta "${goal.name}"`);
    } else {
      this.state.goals.push({ ...goal, id, createdAt: now, updatedAt: now });
      this.logActivity(actor, 'create', 'meta', id, `Creó meta "${goal.name}"`);
    }
    this.emit();
    return id;
  }

  async deleteGoal(_hid: string, id: string, name: string, actor: UserProfileInput): Promise<void> {
    this.state.goals = this.state.goals.filter((g) => g.id !== id);
    this.logActivity(actor, 'delete', 'meta', id, `Eliminó meta "${name}"`);
    this.emit();
  }

  async addGoalMovement(
    _hid: string,
    movement: Omit<GoalMovement, 'id' | 'createdAt'>,
    goalName: string,
    actor: UserProfileInput
  ): Promise<string> {
    const id = `gm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.state.goalMovements.push({
      ...movement,
      id,
      createdAt: new Date().toISOString(),
    });
    const verb = movement.amount > 0 ? 'Aportó' : 'Retiró';
    this.logActivity(actor, 'create', 'ahorro', id, `${verb} ${Math.abs(movement.amount)} € en "${goalName}"`);
    this.emit();
    return id;
  }

  async deleteGoalMovement(_hid: string, id: string, goalName: string, actor: UserProfileInput): Promise<void> {
    this.state.goalMovements = this.state.goalMovements.filter((m) => m.id !== id);
    this.logActivity(actor, 'delete', 'ahorro', id, `Eliminó movimiento en "${goalName}"`);
    this.emit();
  }

  async exportBackup(_hid: string, viewerUid: string): Promise<NidoBackupV1> {
    return {
      schemaVersion: 1,
      app: 'nido',
      exportedAt: new Date().toISOString(),
      householdName: this.state.household.name,
      settings: this.state.household.settings,
      initialCosts: this.state.initialCosts.map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      checklist: this.state.checklist.map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      items: this.state.items.map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      recurring: this.state.recurring.map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      transactions: this.state.transactions
        .filter((t) => !t.isPrivate || t.createdBy === viewerUid)
        .map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      budgets: Object.values(this.state.budgets).map(({ updatedAt: _u, ...r }) => r),
      monthClosures: this.state.monthClosures.map(({ closedAt: _c, ...r }) => r),
      goals: this.state.goals.map(({ createdAt: _c, updatedAt: _u, ...r }) => r),
      goalMovements: this.state.goalMovements.map(({ createdAt: _c, ...r }) => r),
    };
  }

  async importBackup(_hid: string, backup: NidoBackupV1, actor: UserProfileInput): Promise<void> {
    const now = new Date().toISOString();
    this.state.household.name = backup.householdName;
    this.state.household.settings = backup.settings;
    this.state.initialCosts = backup.initialCosts.map((c) => ({ ...c, createdAt: now, updatedAt: now }));
    this.state.checklist = backup.checklist.map((c) => ({ ...c, createdAt: now, updatedAt: now }));
    this.state.items = backup.items.map((c) => ({ ...c, createdAt: now, updatedAt: now }));
    this.state.recurring = backup.recurring.map((c) => ({ ...c, createdAt: now, updatedAt: now }));
    const preservedPrivateFromPartner = this.state.transactions.filter(
      (t) => t.isPrivate && t.createdBy !== actor.uid
    );
    const importedTxs = backup.transactions.map((c) => ({
      ...c,
      isPrivate: Boolean(c.isPrivate),
      createdBy: c.createdBy || actor.uid,
      createdAt: now,
      updatedAt: now,
    }));
    const importedIds = new Set(importedTxs.map((t) => t.id));
    this.state.transactions = [
      ...preservedPrivateFromPartner.filter((t) => !importedIds.has(t.id)),
      ...importedTxs,
    ];
    this.state.budgets = Object.fromEntries(
      backup.budgets.map((b) => [b.monthKey, { ...b, updatedAt: now }])
    );
    this.state.monthClosures = backup.monthClosures.map((c) => ({ ...c, closedAt: now }));
    this.state.goals = backup.goals.map((g) => ({ ...g, createdAt: now, updatedAt: now }));
    this.state.goalMovements = backup.goalMovements.map((m) => ({ ...m, createdAt: now }));
    this.logActivity(actor, 'import', 'copia_json', this.state.household.id, 'Importó copia de seguridad JSON');
    this.emit();
  }
}
