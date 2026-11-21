export type SplitMode = 'income' | 'preset' | 'custom';
export type UiMode = 'sencillo' | 'avanzado';
export type MemberRole = 'member_a' | 'member_b';
export type ThemeMode = 'light' | 'dark';
export type NavTab = 'inicio' | 'mudanza' | 'mensual' | 'ahorros' | 'ajustes' | 'ayuda';

export const MAX_LENGTHS = {
  householdName: 80,
  displayName: 80,
  concept: 120,
  notes: 500,
  checklistText: 240,
  itemName: 120,
  productUrl: 500,
  articleNumber: 40,
  goalName: 80,
  movementNote: 240,
  activitySummary: 240,
  shoppingText: 120,
  csvKeywordString: 300,
} as const;

export interface HouseholdSettings {
  splitMode: SplitMode;
  presetA: number;
  presetB: number;
  incomeA: number;
  incomeB: number;
  currency: 'EUR';
}

export type CsvCategoryKeywords = Partial<Record<ExpenseCategory, string>>;
export type CategoryColorMap = Partial<Record<ExpenseCategory, string>>;

export interface Household {
  id: string;
  name: string;
  memberUids: string[];
  inviteCode: string;
  settings: HouseholdSettings;
  csvKeywords?: CsvCategoryKeywords;
  categoryColors?: CategoryColorMap;
  seedPending?: boolean;
  recurringSeedVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdMember {
  uid: string;
  displayName: string;
  photoURL: string;
  role: MemberRole;
  uiMode: UiMode;
  joinedAt: string;
  updatedAt: string;
}

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'close_month'
  | 'reopen_month'
  | 'join'
  | 'import';

export interface ActivityEntry {
  id: string;
  uid: string;
  actorName: string;
  action: ActivityAction;
  entity: string;
  entityId: string;
  summary: string;
  timestamp: string;
}

export type InitialCostCategory =
  | 'alquiler'
  | 'fianza'
  | 'garantia_adicional'
  | 'suministros'
  | 'cerrajeria'
  | 'mudanza'
  | 'mobiliario'
  | 'otros';

export type InitialCostStatus = 'pendiente' | 'pagado';

export const COMMON_ACCOUNT_ID = 'cuenta_comun' as const;

export interface InitialCost {
  id: string;
  concept: string;
  category: InitialCostCategory;
  amount: number;
  paidBy: string; // uid | 'cuenta_comun'
  status: InitialCostStatus;
  dueDate: string; // '' or YYYY-MM-DD
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneBy: string;
  doneAt: string;
  group: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type FurnitureRoom =
  | 'salon'
  | 'dormitorio'
  | 'cocina'
  | 'baño'
  | 'entrada'
  | 'terraza'
  | 'otros';

export type FurniturePriority = 'imprescindible' | 'pronto' | 'algun_dia';
export type FurnitureStatus = 'ya_lo_tenemos' | 'pendiente' | 'en_carrito' | 'comprado';

export interface FurnitureItem {
  id: string;
  name: string;
  room: FurnitureRoom;
  priority: FurniturePriority;
  status: FurnitureStatus;
  store: string;
  productUrl: string;
  articleNumber: string;
  unitPrice: number;
  qty: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseCategory =
  | 'alquiler'
  | 'luz'
  | 'agua'
  | 'gas'
  | 'internet'
  | 'movil'
  | 'suscripciones'
  | 'seguros'
  | 'comunidad'
  | 'supermercado'
  | 'transporte'
  | 'ocio'
  | 'otros';

export type TransactionCategory = ExpenseCategory | 'liquidacion';
export type RecurrenceFrequency = 'mensual' | 'bimestral' | 'trimestral' | 'anual';

export interface RecurringExpense {
  id: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  frequency: RecurrenceFrequency;
  dayOfMonth: number;
  startMonth?: string; // '' or 'YYYY-MM'
  splitOverride: number | null;
  paidByDefault: string; // uid | 'cuenta_comun'
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SplitPresetChoice =
  | 'segun_reparto'
  | 'a_medias'
  | 'solo_yo'
  | 'solo_pareja'
  | 'personalizado';

export interface Transaction {
  id: string;
  monthKey: string; // YYYY-MM
  concept: string;
  category: TransactionCategory;
  amount: number;
  date: string; // YYYY-MM-DD
  paidBy: string; // uid | 'cuenta_comun'
  recurringId: string | null;
  splitPctA: number;
  isSettlement: boolean;
  settlementTo: string;
  isPrivate: boolean;
  createdBy: string; // creator uid
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyBudget {
  monthKey: string;
  limits: Partial<Record<ExpenseCategory, number>>;
  updatedAt: string;
}

export interface MonthClosure {
  monthKey: string;
  totalSpent: number;
  paidA: number;
  paidB: number;
  paidComun: number;
  shareA: number;
  shareB: number;
  balanceA: number;
  settlementText: string;
  closedBy: string;
  closedAt: string;
}

export type GoalType =
  | 'navidad'
  | 'viajes'
  | 'cumpleaños'
  | 'ahorro_comun'
  | 'emergencia'
  | 'custom';

export interface SavingsGoal {
  id: string;
  name: string;
  icon: string;
  color: string;
  targetAmount: number;
  targetDate: string; // '' or YYYY-MM-DD
  type: GoalType;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalMovement {
  id: string;
  goalId: string;
  amount: number; // + deposit / - withdrawal
  by: string; // uid
  date: string; // YYYY-MM-DD
  note: string;
  createdAt: string;
}

export interface ShoppingItem {
  id: string;
  text: string;
  qty: number;
  done: boolean;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePrefill {
  amount?: string;
  concept?: string;
  category?: ExpenseCategory;
  notes?: string;
  date?: string;
  recurringId?: string | null;
  paidBy?: string;
  splitPctA?: number;
}

export interface NidoBackupV1 {
  schemaVersion: 1;
  app: 'nido';
  exportedAt: string;
  householdName: string;
  settings: HouseholdSettings;
  csvKeywords?: CsvCategoryKeywords;
  categoryColors?: CategoryColorMap;
  initialCosts: Omit<InitialCost, 'createdAt' | 'updatedAt'>[];
  checklist: Omit<ChecklistItem, 'createdAt' | 'updatedAt'>[];
  items: Omit<FurnitureItem, 'createdAt' | 'updatedAt'>[];
  recurring: Omit<RecurringExpense, 'createdAt' | 'updatedAt'>[];
  transactions: Omit<Transaction, 'createdAt' | 'updatedAt'>[];
  budgets: Omit<MonthlyBudget, 'updatedAt'>[];
  monthClosures: Omit<MonthClosure, 'closedAt'>[];
  goals: Omit<SavingsGoal, 'createdAt' | 'updatedAt'>[];
  goalMovements: Omit<GoalMovement, 'createdAt'>[];
  shopping?: Omit<ShoppingItem, 'createdAt' | 'updatedAt'>[];
}
