import type { RecurringCatalogPreset } from '../domain/presets';
import type {
  ShoppingCheckoutBatchCleanupResult,
  ShoppingCheckoutItemSnapshot,
  ShoppingCheckoutPhase1Input,
  ShoppingCheckoutPhase1Result,
} from '../domain/shoppingCheckout';
import type {
  ActivityEntry,
  CategoryBudgetLimit,
  CategoryColorMap,
  ChecklistItem,
  CsvCategoryKeywords,
  CustomCategory,
  ExpenseCategory,
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
  PendingShoppingCheckout,
  RecurringExpense,
  SavingsGoal,
  ShoppingCatalogItem,
  ShoppingItem,
  ShoppingSection,
  ShoppingSourceType,
  Transaction,
  UiMode,
} from '../types/nido';

export type Unsubscribe = () => void;

export interface UserProfileInput {
  uid: string;
  displayName: string;
  photoURL: string;
}

export interface JoinHouseholdOptions {
  confirmSwitch?: boolean;
}

export interface BankCsvImportItem {
  monthKey: string;
  concept: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  paidBy: string;
  splitPctA: number;
  isPrivate: boolean;
  notes: string;
}

export class HouseholdSwitchConfirmationRequiredError extends Error {
  readonly currentHouseholdId: string;
  readonly targetHouseholdId: string;
  readonly targetHouseholdName: string;

  constructor(currentHouseholdId: string, targetHouseholdId: string, targetHouseholdName: string) {
    super(
      `Ya perteneces a otro hogar. Confirma si quieres cambiar a "${targetHouseholdName}".`
    );
    this.name = 'HouseholdSwitchConfirmationRequiredError';
    this.currentHouseholdId = currentHouseholdId;
    this.targetHouseholdId = targetHouseholdId;
    this.targetHouseholdName = targetHouseholdName;
  }
}

export interface HouseholdRepository {
  // User / Onboarding
  getUserHouseholdId(uid: string): Promise<string | null>;
  createHousehold(user: UserProfileInput, name: string): Promise<string>;
  joinHouseholdByCode(
    user: UserProfileInput,
    inviteCode: string,
    options?: JoinHouseholdOptions
  ): Promise<string>;
  seedDefaultLists(householdId: string, actor: UserProfileInput): Promise<number>;
  hasPendingDefaultSeed(householdId: string): boolean;
  regenerateInviteCode(householdId: string, oldCode: string, actor: UserProfileInput): Promise<string>;

  // Subscriptions & On-Demand Queries
  subscribeHousehold(
    householdId: string,
    onData: (h: Household | null) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeMembers(
    householdId: string,
    onData: (m: HouseholdMember[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeActivity(
    householdId: string,
    limitCount: number,
    onData: (a: ActivityEntry[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeInitialCosts(
    householdId: string,
    onData: (c: InitialCost[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  fetchAllInitialCosts(householdId: string): Promise<InitialCost[]>;
  subscribeChecklist(
    householdId: string,
    onData: (items: ChecklistItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeFurniture(
    householdId: string,
    onData: (items: FurnitureItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeRecurring(
    householdId: string,
    onData: (items: RecurringExpense[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeTransactionsByMonth(
    householdId: string,
    viewerUid: string,
    monthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeTransactionsRecentMonths(
    householdId: string,
    viewerUid: string,
    minMonthKey: string,
    onData: (items: Transaction[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  fetchAllTransactions(householdId: string, viewerUid: string): Promise<Transaction[]>;
  subscribeBudget(
    householdId: string,
    monthKey: string,
    onData: (b: MonthlyBudget | null) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeMonthClosures(
    householdId: string,
    onData: (c: MonthClosure[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeGoals(
    householdId: string,
    onData: (g: SavingsGoal[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeGoalMovements(
    householdId: string,
    onData: (m: GoalMovement[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeShopping(
    householdId: string,
    onData: (items: ShoppingItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeShoppingCatalog(
    householdId: string,
    onData: (items: ShoppingCatalogItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribePendingShoppingCheckouts(
    householdId: string,
    viewerUid: string,
    onData: (items: PendingShoppingCheckout[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeCustomCategories(
    householdId: string,
    onData: (items: CustomCategory[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  subscribeCategoryBudgets(
    householdId: string,
    monthKey: string,
    onData: (items: CategoryBudgetLimit[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe;
  fetchAllCategoryBudgets(householdId: string): Promise<CategoryBudgetLimit[]>;
  fetchMonthBudgets(
    householdId: string,
    monthKey: string
  ): Promise<{ systemBudget: MonthlyBudget | null; categoryBudgets: CategoryBudgetLimit[] }>;

  // Settings & Member
  updateSettings(
    householdId: string,
    settings: HouseholdSettings,
    actor: UserProfileInput,
    summary: string
  ): Promise<void>;
  updateHouseholdName(
    householdId: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void>;
  updateCsvKeywords(householdId: string, keywords: CsvCategoryKeywords): Promise<void>;
  updateCategoryColors(householdId: string, colors: CategoryColorMap): Promise<void>;
  updateMemberUiMode(
    householdId: string,
    uid: string,
    uiMode: UiMode
  ): Promise<void>;

  // Custom Categories
  upsertCustomCategory(
    householdId: string,
    cat: Omit<CustomCategory, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  reorderCustomCategories(
    householdId: string,
    ordered: Array<{ id: string; order: number }>
  ): Promise<void>;
  deleteUnusedCustomCategory(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void>;

  // Initial Costs
  upsertInitialCost(
    householdId: string,
    cost: Omit<InitialCost, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  restoreInitialCost(
    householdId: string,
    cost: InitialCost,
    actor: UserProfileInput
  ): Promise<void>;
  deleteInitialCost(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput
  ): Promise<void>;

  // Checklist
  toggleChecklistItem(
    householdId: string,
    item: ChecklistItem,
    done: boolean,
    actor: UserProfileInput
  ): Promise<void>;
  addChecklistItem(
    householdId: string,
    text: string,
    group: string,
    order: number,
    actor: UserProfileInput
  ): Promise<string>;
  deleteChecklistItem(
    householdId: string,
    id: string,
    text: string,
    actor: UserProfileInput
  ): Promise<void>;

  // Furniture
  upsertFurnitureItem(
    householdId: string,
    item: Omit<FurnitureItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  restoreFurnitureItem(
    householdId: string,
    item: FurnitureItem,
    actor: UserProfileInput
  ): Promise<void>;
  updateFurnitureStatus(
    householdId: string,
    item: FurnitureItem,
    status: FurnitureStatus,
    actor: UserProfileInput
  ): Promise<void>;
  deleteFurnitureItem(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void>;
  deleteFurnitureItemsBulk(
    householdId: string,
    items: Array<{ id: string; name: string }>,
    actor: UserProfileInput
  ): Promise<void>;

  // Recurring & Monthly Transactions
  upsertRecurring(
    householdId: string,
    rec: Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  addHabitualRecurringTemplates(
    householdId: string,
    presets: readonly RecurringCatalogPreset[],
    actor: UserProfileInput
  ): Promise<number>;
  deleteRecurring(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput
  ): Promise<void>;
  generateMonthTransactions(
    householdId: string,
    monthKey: string,
    missing: RecurringExpense[],
    defaultSplitPctA: number,
    actor: UserProfileInput
  ): Promise<number>;
  upsertTransaction(
    householdId: string,
    tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  restoreTransaction(
    householdId: string,
    tx: Transaction,
    actor: UserProfileInput
  ): Promise<void>;
  deleteTransaction(
    householdId: string,
    id: string,
    concept: string,
    actor: UserProfileInput,
    options?: { isPrivate?: boolean }
  ): Promise<void>;
  deleteTransactionsBulk(
    householdId: string,
    items: Array<{ id: string; concept: string; isPrivate?: boolean }>,
    actor: UserProfileInput
  ): Promise<void>;
  importBankTransactions(
    householdId: string,
    items: BankCsvImportItem[],
    actor: UserProfileInput
  ): Promise<number>;

  // Budgets & Closures
  saveBudget(
    householdId: string,
    monthKey: string,
    limits: MonthlyBudget['limits'],
    actor: UserProfileInput
  ): Promise<void>;
  saveAllBudgets(
    householdId: string,
    monthKey: string,
    limits: Record<string, number>,
    customCategoryIds: string[],
    actor: UserProfileInput
  ): Promise<void>;
  closeMonth(
    householdId: string,
    closure: Omit<MonthClosure, 'closedAt'>,
    actor: UserProfileInput
  ): Promise<void>;
  reopenMonth(
    householdId: string,
    monthKey: string,
    actor: UserProfileInput
  ): Promise<void>;

  // Savings Goals & Movements
  upsertGoal(
    householdId: string,
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string>;
  deleteGoal(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void>;
  deleteGoalWithMovements(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void>;
  addGoalMovement(
    householdId: string,
    movement: Omit<GoalMovement, 'id' | 'createdAt'>,
    goalName: string,
    actor: UserProfileInput
  ): Promise<string>;
  deleteGoalMovement(
    householdId: string,
    id: string,
    goalName: string,
    actor: UserProfileInput
  ): Promise<void>;

  // Shopping List (sin log de actividad por ítem)
  upsertShoppingItem(
    householdId: string,
    item: {
      id?: string;
      text: string;
      qty: number;
      unit?: string;
      done: boolean;
      catalogId?: string;
      brand?: string;
      format?: string;
      section?: ShoppingSection;
      sourceType?: ShoppingSourceType;
    },
    actor: UserProfileInput
  ): Promise<string>;
  deleteShoppingItem(householdId: string, id: string): Promise<void>;
  deleteShoppingItemsBulk(householdId: string, ids: string[]): Promise<void>;
  commitShoppingCheckoutPhase1(
    householdId: string,
    input: ShoppingCheckoutPhase1Input,
    actor: UserProfileInput
  ): Promise<ShoppingCheckoutPhase1Result>;
  cleanupShoppingCheckoutBatch(
    householdId: string,
    checkoutId: string,
    snapshotsById?: Record<string, ShoppingCheckoutItemSnapshot>
  ): Promise<ShoppingCheckoutBatchCleanupResult>;
  dismissPendingShoppingCheckout(householdId: string, checkoutId: string): Promise<void>;
  upsertShoppingCatalogItem(
    householdId: string,
    input: {
      text: string;
      defaultUnit?: string;
      favorite?: boolean;
      catalogId?: string;
      brand?: string;
      format?: string;
      section?: ShoppingSection;
      sourceType?: ShoppingSourceType;
    },
    actor: UserProfileInput
  ): Promise<string>;
  toggleShoppingCatalogFavorite(
    householdId: string,
    id: string,
    favorite: boolean
  ): Promise<void>;

  // Export & Backup Restore
  exportBackup(householdId: string, viewerUid: string): Promise<NidoBackupV1>;
  importBackup(householdId: string, backup: NidoBackupV1, actor: UserProfileInput): Promise<void>;
}
