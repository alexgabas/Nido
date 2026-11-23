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
  shoppingUnit: 20,
  shoppingCatalogId: 48,
  shoppingBrand: 60,
  shoppingFormat: 40,
  shoppingSection: 48,
  csvKeywordString: 300,
  categoryName: 40,
  categoryIcon: 32,
  checkoutId: 48,
} as const;

export interface HouseholdSettings {
  splitMode: SplitMode;
  presetA: number;
  presetB: number;
  incomeA: number;
  incomeB: number;
  currency: 'EUR';
}

export const SYSTEM_EXPENSE_CATEGORIES = [
  'alquiler',
  'luz',
  'agua',
  'gas',
  'internet',
  'movil',
  'suscripciones',
  'seguros',
  'comunidad',
  'supermercado',
  'transporte',
  'ocio',
  'otros',
] as const;

export type SystemExpenseCategory = (typeof SYSTEM_EXPENSE_CATEGORIES)[number];
export type ExpenseCategory = string;
export type TransactionCategory = ExpenseCategory | 'liquidacion';

export type CsvCategoryKeywords = Partial<Record<SystemExpenseCategory, string>> &
  Record<string, string | undefined>;
export type CategoryColorMap = Partial<Record<SystemExpenseCategory, string>> &
  Record<string, string | undefined>;

export interface CustomCategory {
  id: string; // cat_<slug>
  name: string;
  color: string; // #RRGGBB
  icon: string; // icon key from allowlist
  order: number;
  archived: boolean;
  csvKeywords: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryBudgetLimit {
  id: string; // `${monthKey}__${categoryId}`
  monthKey: string; // YYYY-MM
  categoryId: string; // cat_...
  limit: number;
  updatedAt: string;
}

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

export const SYSTEM_INITIAL_COST_CATEGORIES = [
  'alquiler',
  'fianza',
  'garantia_adicional',
  'suministros',
  'cerrajeria',
  'mudanza',
  'mobiliario',
  'otros',
] as const;

export type SystemInitialCostCategory = (typeof SYSTEM_INITIAL_COST_CATEGORIES)[number];
export type InitialCostCategory = SystemInitialCostCategory | string;

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
  limits: Partial<Record<SystemExpenseCategory, number>> & Record<string, number | undefined>;
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

export const SHOPPING_SECTIONS = [
  'Fruta y verdura',
  'Carne, charcutería y huevos',
  'Pescado y marisco',
  'Lácteos, quesos y bebidas vegetales',
  'Panadería y bollería',
  'Despensa, arroz, pasta y conservas',
  'Desayuno, café y dulces',
  'Congelados',
  'Platos preparados y refrigerados',
  'Bebidas',
  'Limpieza y hogar',
  'Cuidado personal e higiene',
  'Bebé y mascotas',
  'Otros de supermercado',
] as const;

export type ShoppingSection = (typeof SHOPPING_SECTIONS)[number];
export type ShoppingSourceType = 'mercadona' | 'custom' | 'generic';

export interface ShoppingItem {
  id: string;
  text: string;
  qty: number;
  unit?: string;
  done: boolean;
  catalogId?: string;
  brand?: string;
  format?: string;
  section?: ShoppingSection;
  sourceType?: ShoppingSourceType;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingCatalogItem {
  id: string; // prod_<hash_slug>
  text: string;
  defaultUnit: string;
  usageCount: number;
  lastUsedAt: string;
  favorite?: boolean;
  catalogId?: string;
  brand?: string;
  format?: string;
  section?: ShoppingSection;
  sourceType?: ShoppingSourceType;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingShoppingCheckout {
  id: string; // chk_<ts>_<rand>
  expenseId: string; // tx_chk_<ts>_<rand>
  monthKey: string; // YYYY-MM
  amount: number; // 0 when isPrivate
  concept: string; // 'Compra privada' when isPrivate
  pendingItemIds: string[]; // remaining shopping item IDs to clean up
  totalItemCount: number;
  isPrivate: boolean;
  createdBy: string;
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
  customCategories?: Omit<CustomCategory, 'createdAt' | 'updatedAt'>[];
  categoryBudgets?: Omit<CategoryBudgetLimit, 'updatedAt'>[];
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
  shoppingCatalog?: Omit<ShoppingCatalogItem, 'createdAt' | 'updatedAt'>[];
}
