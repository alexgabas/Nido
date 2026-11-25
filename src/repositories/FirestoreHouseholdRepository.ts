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
  runTransaction,
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
  roundCents,
} from '../domain/finance';
import { isValidHexColor, sanitizeCategoryColors } from '../domain/categoryPalette';
import {
  isValidLocalDateISO,
  sanitizeCommonAccountManualBalance,
  sanitizePlannedCommonCategories,
} from '../domain/monthlyPlanning';
import {
  buildCategoryBudgetDocId,
  canSafelyDeleteCustomCategory,
  CATEGORY_SELECTOR_PREFS_VERSION,
  generateCustomCategoryId,
  isCustomCategoryId,
  isSystemExpenseCategory,
  isValidCategoryIcon,
  isValidSelectorCategoryId,
  MAX_VISIBLE_SELECTOR_CATEGORIES,
  resolveInitialVisibleCategoriesPlan,
} from '../domain/categories';
import {
  buildShoppingCatalogId,
  normalizeShoppingSection,
  normalizeShoppingSourceType,
  normalizeShoppingUnit,
} from '../domain/shoppingCatalog';
import {
  generateShoppingTemplateId,
  sanitizeShoppingTemplateItems,
  type ApplyShoppingTemplatePlan,
} from '../domain/shoppingTemplates';
import {
  buildDeterministicRecurringTxId,
  isRecurringDueInMonth,
  isValidMonthKey,
  sanitizeSkippedMonths,
} from '../domain/recurrence';
import {
  sanitizeHabitualSavingsPlan,
  sanitizeSavingsPlanAllocations,
} from '../domain/savingsPlan';
import { sanitizeHouseholdIncomeConfig } from '../domain/incomeProfile';
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
  buildCheckoutExpenseId,
  isShoppingItemSafeForCrossDeviceCleanup,
  isShoppingItemUnchangedForCheckout,
  isValidShoppingCheckoutId,
  MAX_CHECKOUT_BATCH_ITEMS,
  MAX_CHECKOUT_PENDING_ITEMS,
  sortSnapshotsDeterministically,
  type ShoppingCheckoutBatchCleanupResult,
  type ShoppingCheckoutItemSnapshot,
  type ShoppingCheckoutPhase1Input,
  type ShoppingCheckoutPhase1Result,
} from '../domain/shoppingCheckout';
import {
  COMMON_ACCOUNT_ID,
  MAX_LENGTHS,
  type ActivityAction,
  type ActivityEntry,
  type CategoryBudgetLimit,
  type CategoryColorMap,
  type ChecklistItem,
  type CsvCategoryKeywords,
  type CustomCategory,
  type ExpenseCategory,
  type FurnitureItem,
  type FurnitureStatus,
  type GoalMovement,
  type Household,
  type HouseholdIncomeConfig,
  type HouseholdMember,
  type HouseholdSettings,
  type InitialCost,
  type MemberCategoryPreferences,
  type MonthClosure,
  type MonthlyBudget,
  type MonthlySavingsPlan,
  type NidoBackupV1,
  type PendingShoppingCheckout,
  type RecurringExpense,
  type SavingsGoal,
  type SavingsPlanAdjustmentKind,
  type SavingsPlanAllocation,
  type ShoppingCatalogItem,
  type ShoppingItem,
  type ShoppingListTemplate,
  type ShoppingSection,
  type ShoppingSectionOverride,
  type ShoppingSourceType,
  type ShoppingTemplateItem,
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
  const categoryColors = sanitizeCategoryColors(d.categoryColors);
  const commonAccountPlannedCategories = Array.isArray(d.commonAccountPlannedCategories)
    ? sanitizePlannedCommonCategories(d.commonAccountPlannedCategories)
    : undefined;
  const commonAccountManualBalance =
    d.commonAccountManualBalance === null
      ? null
      : d.commonAccountManualBalance !== undefined
        ? sanitizeCommonAccountManualBalance(d.commonAccountManualBalance)
        : undefined;
  const incomeConfig =
    d.incomeConfig === null
      ? null
      : d.incomeConfig !== undefined
        ? sanitizeHouseholdIncomeConfig(d.incomeConfig, {
            incomeA: Number(d.settings?.incomeA ?? 0),
            incomeB: Number(d.settings?.incomeB ?? 0),
          })
        : undefined;
  const habitualSavingsPlan =
    d.habitualSavingsPlan === null
      ? null
      : d.habitualSavingsPlan !== undefined
        ? sanitizeHabitualSavingsPlan(d.habitualSavingsPlan)
        : undefined;
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
    ...(incomeConfig !== undefined ? { incomeConfig } : {}),
    ...(habitualSavingsPlan !== undefined ? { habitualSavingsPlan } : {}),
    ...(csvKeywords ? { csvKeywords } : {}),
    ...(categoryColors ? { categoryColors } : {}),
    ...(commonAccountPlannedCategories !== undefined ? { commonAccountPlannedCategories } : {}),
    ...(commonAccountManualBalance !== undefined ? { commonAccountManualBalance } : {}),
    ...(typeof d.mudanzaCompleted === 'boolean' ? { mudanzaCompleted: d.mudanzaCompleted } : {}),
    ...(typeof d.mudanzaCompletedAt === 'string'
      ? { mudanzaCompletedAt: d.mudanzaCompletedAt }
      : d.mudanzaCompletedAt === null
        ? { mudanzaCompletedAt: null }
        : {}),
    ...(typeof d.mudanzaCompletedBy === 'string'
      ? { mudanzaCompletedBy: d.mudanzaCompletedBy }
      : d.mudanzaCompletedBy === null
        ? { mudanzaCompletedBy: null }
        : {}),
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
  const startMonth = isValidMonthKey(d.startMonth) ? d.startMonth : undefined;
  const skippedMonths = sanitizeSkippedMonths(d.skippedMonths);
  return {
    id,
    concept: String(d.concept ?? ''),
    category: d.category ?? 'otros',
    amount: Number(d.amount ?? 0),
    frequency: d.frequency ?? 'mensual',
    dayOfMonth: Number(d.dayOfMonth ?? 1),
    ...(startMonth ? { startMonth } : {}),
    ...(skippedMonths.length > 0 ? { skippedMonths } : {}),
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

function mapSavingsPlan(id: string, d: DocumentData): MonthlySavingsPlan {
  const monthKey = isValidMonthKey(String(d.monthKey ?? id)) ? String(d.monthKey ?? id) : id;
  const rawAllocs = Array.isArray(d.allocations) ? (d.allocations as SavingsPlanAllocation[]) : [];
  const adjustmentKind: SavingsPlanAdjustmentKind | undefined =
    d.adjustmentKind === 'ajuste' || d.adjustmentKind === 'extra'
      ? d.adjustmentKind
      : undefined;
  const extraAmount =
    typeof d.extraAmount === 'number' && Number.isFinite(d.extraAmount) && d.extraAmount > 0
      ? roundCents(d.extraAmount)
      : undefined;
  return {
    monthKey,
    targetAmount: roundCents(Math.max(0, Number(d.targetAmount ?? 0))),
    allocations: sanitizeSavingsPlanAllocations(rawAllocs),
    ...(adjustmentKind ? { adjustmentKind } : {}),
    ...(extraAmount !== undefined ? { extraAmount } : {}),
    updatedBy: String(d.updatedBy ?? ''),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapShoppingItem(id: string, d: DocumentData): ShoppingItem {
  const unit = normalizeShoppingUnit(typeof d.unit === 'string' ? d.unit : '');
  const rawQty = Number(d.qty ?? 1);
  const catalogId = typeof d.catalogId === 'string' && d.catalogId.trim() ? d.catalogId.trim() : undefined;
  const brand = typeof d.brand === 'string' && d.brand.trim() ? d.brand.trim() : undefined;
  const format = typeof d.format === 'string' && d.format.trim() ? d.format.trim() : undefined;
  const section = normalizeShoppingSection(typeof d.section === 'string' ? d.section : undefined);
  const sourceType = normalizeShoppingSourceType(
    typeof d.sourceType === 'string' ? d.sourceType : undefined
  );
  return {
    id,
    text: String(d.text ?? ''),
    qty: roundCents(Math.max(0.01, Math.min(999, Number.isFinite(rawQty) ? rawQty : 1))),
    ...(unit ? { unit } : {}),
    done: Boolean(d.done),
    ...(catalogId ? { catalogId } : {}),
    ...(brand ? { brand } : {}),
    ...(format ? { format } : {}),
    ...(section ? { section } : {}),
    ...(sourceType ? { sourceType } : {}),
    addedBy: String(d.addedBy ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapShoppingCatalogItem(id: string, d: DocumentData): ShoppingCatalogItem {
  const catalogId = typeof d.catalogId === 'string' && d.catalogId.trim() ? d.catalogId.trim() : undefined;
  const brand = typeof d.brand === 'string' && d.brand.trim() ? d.brand.trim() : undefined;
  const format = typeof d.format === 'string' && d.format.trim() ? d.format.trim() : undefined;
  const section = normalizeShoppingSection(typeof d.section === 'string' ? d.section : undefined);
  const sourceType = normalizeShoppingSourceType(
    typeof d.sourceType === 'string' ? d.sourceType : undefined
  );
  return {
    id,
    text: String(d.text ?? ''),
    defaultUnit: normalizeShoppingUnit(typeof d.defaultUnit === 'string' ? d.defaultUnit : ''),
    usageCount: Math.max(1, Math.round(Number(d.usageCount ?? 1) || 1)),
    lastUsedAt: String(d.lastUsedAt ?? tsToIso(d.updatedAt)),
    ...(typeof d.favorite === 'boolean' ? { favorite: d.favorite } : {}),
    ...(catalogId ? { catalogId } : {}),
    ...(brand ? { brand } : {}),
    ...(format ? { format } : {}),
    ...(section ? { section } : {}),
    ...(sourceType ? { sourceType } : {}),
    createdBy: String(d.createdBy ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapCustomCategory(id: string, d: DocumentData): CustomCategory {
  return {
    id,
    name: String(d.name ?? ''),
    color: isValidHexColor(d.color) ? String(d.color).toUpperCase() : '#0F766E',
    icon: isValidCategoryIcon(d.icon) ? d.icon : 'tag',
    order: Number.isFinite(Number(d.order)) ? Number(d.order) : 0,
    archived: Boolean(d.archived),
    csvKeywords: String(d.csvKeywords ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapCategoryBudget(id: string, d: DocumentData): CategoryBudgetLimit {
  return {
    id,
    monthKey: String(d.monthKey ?? ''),
    categoryId: String(d.categoryId ?? ''),
    limit: Math.max(0, Number(d.limit ?? 0) || 0),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapMemberCategoryPreferences(uid: string, d: DocumentData): MemberCategoryPreferences {
  const rawList = Array.isArray(d.visibleCategoryIds) ? d.visibleCategoryIds : [];
  const visibleCategoryIds = rawList
    .filter((id): id is string => typeof id === 'string' && isValidSelectorCategoryId(id))
    .slice(0, MAX_VISIBLE_SELECTOR_CATEGORIES);
  return {
    uid,
    selectorVersion: Math.max(0, Math.round(Number(d.selectorVersion ?? 0) || 0)),
    visibleCategoryIds,
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapShoppingListTemplate(id: string, d: DocumentData): ShoppingListTemplate {
  const rawItems = Array.isArray(d.items) ? (d.items as ShoppingTemplateItem[]) : [];
  return {
    id,
    name: String(d.name ?? ''),
    items: sanitizeShoppingTemplateItems(rawItems),
    createdBy: String(d.createdBy ?? ''),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapShoppingSectionOverride(id: string, d: DocumentData): ShoppingSectionOverride {
  const section = normalizeShoppingSection(typeof d.section === 'string' ? d.section : undefined) ?? 'Sin clasificar';
  return {
    id,
    productKey: String(d.productKey ?? id),
    section,
    updatedBy: String(d.updatedBy ?? ''),
    updatedAt: tsToIso(d.updatedAt),
  };
}

function mapPendingShoppingCheckout(id: string, d: DocumentData): PendingShoppingCheckout {
  return {
    id,
    expenseId: String(d.expenseId ?? buildCheckoutExpenseId(id)),
    monthKey: String(d.monthKey ?? ''),
    amount: Math.max(0, Number(d.amount ?? 0) || 0),
    concept: String(d.concept ?? 'Compra supermercado'),
    pendingItemIds: Array.isArray(d.pendingItemIds)
      ? d.pendingItemIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [],
    totalItemCount: Math.max(1, Math.round(Number(d.totalItemCount ?? 1) || 1)),
    isPrivate: Boolean(d.isPrivate),
    createdBy: String(d.createdBy ?? ''),
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

  subscribePendingShoppingCheckouts(
    householdId: string,
    viewerUid: string,
    onData: (items: PendingShoppingCheckout[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/shoppingCheckouts`;
    const colRef = collection(db, 'households', householdId, 'shoppingCheckouts');
    const sharedMap = new Map<string, PendingShoppingCheckout>();
    const ownMap = new Map<string, PendingShoppingCheckout>();
    let readyShared = false;
    let readyOwn = !viewerUid;

    const emit = () => {
      if (!readyShared || !readyOwn) return;
      const merged = new Map<string, PendingShoppingCheckout>();
      for (const [k, v] of sharedMap) merged.set(k, v);
      for (const [k, v] of ownMap) merged.set(k, v);
      onData(
        Array.from(merged.values())
          .filter((item) => (!item.isPrivate || item.createdBy === viewerUid) && item.pendingItemIds.length > 0)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    };

    const unsubShared = onSnapshot(
      query(colRef, where('isPrivate', '==', false)),
      (snap) => {
        sharedMap.clear();
        for (const d of snap.docs) {
          sharedMap.set(d.id, mapPendingShoppingCheckout(d.id, d.data()));
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
              ownMap.set(d.id, mapPendingShoppingCheckout(d.id, d.data()));
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

  async fetchAllInitialCosts(householdId: string): Promise<InitialCost[]> {
    const path = `households/${householdId}/initialCosts`;
    try {
      const snap = await getDocs(collection(db, 'households', householdId, 'initialCosts'));
      return snap.docs
        .map((d) => mapInitialCost(d.id, d.data()))
        .sort((a, b) => (b.dueDate || b.createdAt || '').localeCompare(a.dueDate || a.createdAt || ''));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
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

  subscribeSavingsPlans(
    householdId: string,
    onData: (plans: MonthlySavingsPlan[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/savingsPlans`;
    return onSnapshot(
      collection(db, 'households', householdId, 'savingsPlans'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapSavingsPlan(d.id, d.data()))
            .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
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

  subscribeShoppingCatalog(
    householdId: string,
    onData: (items: ShoppingCatalogItem[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/shoppingCatalog`;
    return onSnapshot(
      collection(db, 'households', householdId, 'shoppingCatalog'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapShoppingCatalogItem(d.id, d.data()))
            .sort(
              (a, b) =>
                Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
                b.usageCount - a.usageCount ||
                b.lastUsedAt.localeCompare(a.lastUsedAt)
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

  subscribeCustomCategories(
    householdId: string,
    onData: (items: CustomCategory[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/categories`;
    return onSnapshot(
      collection(db, 'households', householdId, 'categories'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapCustomCategory(d.id, d.data()))
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'es'))
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

  subscribeMemberCategoryPreferences(
    householdId: string,
    uid: string,
    onData: (prefs: MemberCategoryPreferences | null) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/memberPreferences/${uid}`;
    return onSnapshot(
      doc(db, 'households', householdId, 'memberPreferences', uid),
      (snap) => {
        onData(snap.exists() ? mapMemberCategoryPreferences(uid, snap.data()) : null);
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

  subscribeShoppingTemplates(
    householdId: string,
    onData: (items: ShoppingListTemplate[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/shoppingTemplates`;
    return onSnapshot(
      collection(db, 'households', householdId, 'shoppingTemplates'),
      (snap) =>
        onData(
          snap.docs
            .map((d) => mapShoppingListTemplate(d.id, d.data()))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
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

  subscribeShoppingSectionOverrides(
    householdId: string,
    onData: (items: ShoppingSectionOverride[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/shoppingSectionOverrides`;
    return onSnapshot(
      collection(db, 'households', householdId, 'shoppingSectionOverrides'),
      (snap) => onData(snap.docs.map((d) => mapShoppingSectionOverride(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  subscribeCategoryBudgets(
    householdId: string,
    monthKey: string,
    onData: (items: CategoryBudgetLimit[]) => void,
    onError: (e: Error) => void
  ): Unsubscribe {
    const path = `households/${householdId}/categoryBudgets`;
    return onSnapshot(
      query(collection(db, 'households', householdId, 'categoryBudgets'), where('monthKey', '==', monthKey)),
      (snap) => onData(snap.docs.map((d) => mapCategoryBudget(d.id, d.data()))),
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      }
    );
  }

  async fetchAllCategoryBudgets(householdId: string): Promise<CategoryBudgetLimit[]> {
    const path = `households/${householdId}/categoryBudgets`;
    try {
      const snap = await getDocs(collection(db, 'households', householdId, 'categoryBudgets'));
      return snap.docs.map((d) => mapCategoryBudget(d.id, d.data()));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async fetchMonthBudgets(
    householdId: string,
    monthKey: string
  ): Promise<{ systemBudget: MonthlyBudget | null; categoryBudgets: CategoryBudgetLimit[] }> {
    const budgetPath = `households/${householdId}/budgets/${monthKey}`;
    const customPath = `households/${householdId}/categoryBudgets`;
    try {
      const [budgetSnap, customSnap] = await Promise.all([
        getDoc(doc(db, 'households', householdId, 'budgets', monthKey)),
        getDocs(
          query(
            collection(db, 'households', householdId, 'categoryBudgets'),
            where('monthKey', '==', monthKey)
          )
        ),
      ]);

      let systemBudget: MonthlyBudget | null = null;
      if (budgetSnap.exists()) {
        const d = budgetSnap.data();
        systemBudget = {
          monthKey: String(d.monthKey ?? monthKey),
          limits: (d.limits ?? {}) as MonthlyBudget['limits'],
          updatedAt: tsToIso(d.updatedAt),
        };
      }
      const categoryBudgets = customSnap.docs.map((d) => mapCategoryBudget(d.id, d.data()));
      return { systemBudget, categoryBudgets };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `${budgetPath} | ${customPath}`);
    }
  }

  async fetchAnnualBalanceData(
    householdId: string
  ): Promise<{
    sharedTransactions: Transaction[];
    systemBudgets: MonthlyBudget[];
    categoryBudgets: CategoryBudgetLimit[];
  }> {
    const txPath = `households/${householdId}/transactions`;
    const budPath = `households/${householdId}/budgets`;
    const catBudPath = `households/${householdId}/categoryBudgets`;
    try {
      const [sharedTxSnap, budSnap, catBudSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'households', householdId, 'transactions'),
            where('isPrivate', '==', false)
          )
        ),
        getDocs(collection(db, 'households', householdId, 'budgets')),
        getDocs(collection(db, 'households', householdId, 'categoryBudgets')),
      ]);

      const sharedTransactions = sharedTxSnap.docs
        .map((d) => mapTransaction(d.id, d.data()))
        .filter((t) => !t.isPrivate)
        .sort((a, b) => b.date.localeCompare(a.date));

      const systemBudgets: MonthlyBudget[] = budSnap.docs.map((d) => {
        const data = d.data();
        return {
          monthKey: String(data.monthKey ?? d.id),
          limits: (data.limits ?? {}) as MonthlyBudget['limits'],
          updatedAt: tsToIso(data.updatedAt),
        };
      });

      const categoryBudgets = catBudSnap.docs.map((d) => mapCategoryBudget(d.id, d.data()));

      return { sharedTransactions, systemBudgets, categoryBudgets };
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `${txPath} | ${budPath} | ${catBudPath}`);
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async updateSettings(
    householdId: string,
    settings: HouseholdSettings,
    actor: UserProfileInput,
    summary: string,
    options?: { incomeConfig?: HouseholdIncomeConfig | null }
  ): Promise<void> {
    const path = `households/${householdId}`;
    const { presetA, presetB } = normalizeSplitPair(settings.presetA);
    const cleanIncomeA = roundCents(Math.max(0, Number(settings.incomeA) || 0));
    const cleanIncomeB = roundCents(Math.max(0, Number(settings.incomeB) || 0));
    const updatePayload: Record<string, unknown> = {
      settings: {
        splitMode: settings.splitMode,
        presetA,
        presetB,
        incomeA: cleanIncomeA,
        incomeB: cleanIncomeB,
        currency: 'EUR',
      },
      updatedAt: serverTimestamp(),
    };
    if (options && Object.prototype.hasOwnProperty.call(options, 'incomeConfig')) {
      if (options.incomeConfig === null) {
        updatePayload.incomeConfig = null;
      } else if (options.incomeConfig) {
        const cleanCfg = sanitizeHouseholdIncomeConfig(options.incomeConfig, {
          incomeA: cleanIncomeA,
          incomeB: cleanIncomeB,
        });
        updatePayload.incomeConfig = cleanCfg
          ? {
              ...cleanCfg,
              updatedBy: actor.uid,
              updatedAt: new Date().toISOString(),
            }
          : null;
      }
    }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), updatePayload);
      this.addActivityToBatch(batch, householdId, actor, 'update', 'reparto', householdId, summary);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async saveHabitualSavingsPlan(
    householdId: string,
    plan: { monthlyAmount: number; priorityGoalIds: string[] } | null,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}`;
    const now = new Date().toISOString();
    let payloadValue: ReturnType<typeof sanitizeHabitualSavingsPlan> = null;
    if (plan !== null) {
      payloadValue = sanitizeHabitualSavingsPlan({
        monthlyAmount: plan.monthlyAmount,
        priorityGoalIds: plan.priorityGoalIds,
        updatedBy: actor.uid,
        updatedAt: now,
      });
      if (!payloadValue) {
        throw new Error('Datos inválidos para el plan de ahorro habitual.');
      }
    }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), {
        habitualSavingsPlan: payloadValue,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        payloadValue ? 'update' : 'delete',
        'plan_ahorro',
        householdId,
        payloadValue
          ? `Actualizó el plan de ahorro habitual (${payloadValue.monthlyAmount} €/mes)`
          : 'Eliminó el plan de ahorro habitual'
      );
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

  async updateCategoryColors(householdId: string, colors: CategoryColorMap): Promise<void> {
    const path = `households/${householdId}`;
    const clean = sanitizeCategoryColors(colors) ?? {};
    try {
      await updateDoc(doc(db, 'households', householdId), {
        categoryColors: clean,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async updateCommonAccountPlannedCategories(
    householdId: string,
    categoryIds: string[]
  ): Promise<void> {
    const path = `households/${householdId}`;
    const clean = sanitizePlannedCommonCategories(categoryIds);
    try {
      await updateDoc(doc(db, 'households', householdId), {
        commonAccountPlannedCategories: clean,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async updateCommonAccountManualBalance(
    householdId: string,
    balance: { amount: number; referenceDate: string } | null,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}`;
    const payload =
      balance === null
        ? null
        : {
            amount: roundCents(Math.max(0, Number(balance.amount) || 0)),
            referenceDate: isValidLocalDateISO(balance.referenceDate)
              ? balance.referenceDate
              : getTodayLocalISO(),
            updatedBy: actor.uid,
            updatedAt: new Date().toISOString(),
          };
    try {
      await updateDoc(doc(db, 'households', householdId), {
        commonAccountManualBalance: payload,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async setMudanzaCompleted(
    householdId: string,
    completed: boolean,
    actor: UserProfileInput
  ): Promise<void> {
    const path = `households/${householdId}`;
    const now = new Date().toISOString();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'households', householdId), {
        mudanzaCompleted: completed,
        mudanzaCompletedAt: completed ? now : null,
        mudanzaCompletedBy: completed ? actor.uid : null,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'update',
        'hogar',
        householdId,
        completed ? 'Dio por terminada la etapa de mudanza' : 'Reabrió la etapa de mudanza'
      );
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

  async upsertCustomCategory(
    householdId: string,
    cat: Omit<CustomCategory, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    actor: UserProfileInput
  ): Promise<string> {
    const colRef = collection(db, 'households', householdId, 'categories');
    let id = cat.id || '';
    if (!id) {
      try {
        const snap = await getDocs(colRef);
        id = generateCustomCategoryId(
          cat.name,
          snap.docs.map((d) => d.id)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, `households/${householdId}/categories`);
      }
    }
    if (!isCustomCategoryId(id)) {
      throw new Error('Identificador de categoría personalizada no válido.');
    }

    const path = `households/${householdId}/categories/${id}`;
    const cleanName = clampStr(cat.name, MAX_LENGTHS.categoryName);
    const cleanColor = isValidHexColor(cat.color) ? cat.color.toUpperCase() : '#0F766E';
    const cleanIcon = isValidCategoryIcon(cat.icon) ? cat.icon : 'tag';
    const cleanOrder = Math.max(0, Math.min(999, Math.round(Number(cat.order) || 0)));
    const cleanKeywords = clampStr(cat.csvKeywords || '', MAX_LENGTHS.csvKeywordString);

    const payload = {
      name: cleanName,
      color: cleanColor,
      icon: cleanIcon,
      order: cleanOrder,
      archived: Boolean(cat.archived),
      csvKeywords: cleanKeywords,
      updatedAt: serverTimestamp(),
    };

    try {
      const ref = doc(db, 'households', householdId, 'categories', id);
      await runTransaction(db, async (trx) => {
        const existingSnap = await trx.get(ref);
        const actRef = doc(collection(db, 'households', householdId, 'activity'));
        if (existingSnap.exists()) {
          trx.update(ref, payload);
          trx.set(actRef, {
            uid: actor.uid,
            actorName: clampStr(actor.displayName || 'Usuario', MAX_LENGTHS.displayName) || 'Usuario',
            action: 'update',
            entity: 'categoria',
            entityId: clampStr(id, 128),
            summary: clampStr(`Editó categoría "${cleanName}"`, MAX_LENGTHS.activitySummary),
            timestamp: serverTimestamp(),
          });
        } else {
          trx.set(ref, { ...payload, createdAt: serverTimestamp() });
          trx.set(actRef, {
            uid: actor.uid,
            actorName: clampStr(actor.displayName || 'Usuario', MAX_LENGTHS.displayName) || 'Usuario',
            action: 'create',
            entity: 'categoria',
            entityId: clampStr(id, 128),
            summary: clampStr(`Creó categoría "${cleanName}"`, MAX_LENGTHS.activitySummary),
            timestamp: serverTimestamp(),
          });
        }
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async saveMemberCategoryPreferences(
    householdId: string,
    uid: string,
    prefs: { selectorVersion: number; visibleCategoryIds: string[] }
  ): Promise<void> {
    const path = `households/${householdId}/memberPreferences/${uid}`;
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const rawId of prefs.visibleCategoryIds) {
      if (deduped.length >= MAX_VISIBLE_SELECTOR_CATEGORIES) break;
      if (typeof rawId === 'string' && isValidSelectorCategoryId(rawId) && !seen.has(rawId)) {
        seen.add(rawId);
        deduped.push(rawId);
      }
    }
    const version = Math.max(1, Math.round(Number(prefs.selectorVersion) || CATEGORY_SELECTOR_PREFS_VERSION));
    try {
      await setDoc(doc(db, 'households', householdId, 'memberPreferences', uid), {
        selectorVersion: version,
        visibleCategoryIds: deduped,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async ensureInitialVisibleCategoriesSetup(
    householdId: string,
    uid: string,
    actor: UserProfileInput
  ): Promise<MemberCategoryPreferences> {
    const prefRef = doc(db, 'households', householdId, 'memberPreferences', uid);
    const prefPath = `households/${householdId}/memberPreferences/${uid}`;

    try {
      const existingPrefSnap = await getDoc(prefRef);
      if (existingPrefSnap.exists()) {
        const mapped = mapMemberCategoryPreferences(uid, existingPrefSnap.data());
        if (mapped.selectorVersion >= CATEGORY_SELECTOR_PREFS_VERSION) {
          return mapped;
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, prefPath);
    }

    let currentCustom: CustomCategory[] = [];
    try {
      const catSnap = await getDocs(collection(db, 'households', householdId, 'categories'));
      currentCustom = catSnap.docs.map((d) => mapCustomCategory(d.id, d.data()));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `households/${householdId}/categories`);
    }

    const plan = resolveInitialVisibleCategoriesPlan(currentCustom);

    if (plan.missingSuggestionsToCreate.length > 0) {
      const ops = plan.missingSuggestionsToCreate.map(({ id, suggestion, order }) => {
        const ref = doc(db, 'households', householdId, 'categories', id);
        return {
          path: `households/${householdId}/categories/${id}`,
          apply: (batch: ReturnType<typeof writeBatch>) =>
            batch.set(ref, {
              name: clampStr(suggestion.name, MAX_LENGTHS.categoryName),
              color: isValidHexColor(suggestion.color) ? suggestion.color.toUpperCase() : '#0F766E',
              icon: isValidCategoryIcon(suggestion.icon) ? suggestion.icon : 'tag',
              order: Math.max(0, Math.min(999, Math.round(order))),
              archived: false,
              csvKeywords: clampStr(suggestion.csvKeywords || '', MAX_LENGTHS.csvKeywordString),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
        };
      });

      try {
        await this.commitBatchOps(
          ops,
          OperationType.CREATE,
          `households/${householdId}/categories`,
          'No se pudieron inicializar las categorías iniciales.'
        );
      } catch {
        // Si el otro miembro creó alguna simultáneamente, creamos solo las realmente faltantes de forma idempotente.
        for (const { id, suggestion, order } of plan.missingSuggestionsToCreate) {
          const ref = doc(db, 'households', householdId, 'categories', id);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            await this.upsertCustomCategory(
              householdId,
              {
                id,
                name: suggestion.name,
                color: suggestion.color,
                icon: suggestion.icon,
                order,
                archived: false,
                csvKeywords: suggestion.csvKeywords,
              },
              actor
            );
          }
        }
      }
    }

    try {
      const finalPrefs = await runTransaction(db, async (trx) => {
        const snap = await trx.get(prefRef);
        if (snap.exists()) {
          const mapped = mapMemberCategoryPreferences(uid, snap.data());
          if (mapped.selectorVersion >= CATEGORY_SELECTOR_PREFS_VERSION) {
            return mapped;
          }
        }
        trx.set(prefRef, {
          selectorVersion: CATEGORY_SELECTOR_PREFS_VERSION,
          visibleCategoryIds: plan.orderedVisibleIds,
          updatedAt: serverTimestamp(),
        });
        return {
          uid,
          selectorVersion: CATEGORY_SELECTOR_PREFS_VERSION,
          visibleCategoryIds: plan.orderedVisibleIds,
          updatedAt: new Date().toISOString(),
        };
      });
      return finalPrefs;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, prefPath);
    }
  }

  async reorderCustomCategories(
    householdId: string,
    ordered: Array<{ id: string; order: number }>
  ): Promise<void> {
    if (ordered.length === 0) return;
    const ops = ordered.map(({ id, order }) => ({
      path: `households/${householdId}/categories/${id}`,
      apply: (batch: ReturnType<typeof writeBatch>) =>
        batch.update(doc(db, 'households', householdId, 'categories', id), {
          order: Math.max(0, Math.min(999, Math.round(order))),
          updatedAt: serverTimestamp(),
        }),
    }));
    await this.commitBatchOps(
      ops,
      OperationType.UPDATE,
      `households/${householdId}/categories`,
      'No se pudo guardar el orden de categorías.'
    );
  }

  async deleteUnusedCustomCategory(
    householdId: string,
    id: string,
    name: string,
    actor: UserProfileInput
  ): Promise<void> {
    try {
      const [hSnap, cbSnap, visibleTxMap, recSnap, icSnap] = await Promise.all([
        getDoc(doc(db, 'households', householdId)),
        getDocs(query(collection(db, 'households', householdId, 'categoryBudgets'), where('categoryId', '==', id))),
        this.fetchVisibleTransactionsMap(householdId, actor.uid),
        getDocs(query(collection(db, 'households', householdId, 'recurring'), where('category', '==', id), limit(1))),
        getDocs(query(collection(db, 'households', householdId, 'initialCosts'), where('category', '==', id), limit(1))),
      ]);
      const memberCount =
        hSnap.exists() && Array.isArray(hSnap.data().memberUids) ? hSnap.data().memberUids.length : 1;
      const hasVisibleTxWithCategory = Array.from(visibleTxMap.values()).some(
        (d) => d.category === id
      );

      const check = canSafelyDeleteCustomCategory(id, {
        memberCount,
        transactions: hasVisibleTxWithCategory ? [{ category: id }] : [],
        recurring: !recSnap.empty ? [{ category: id }] : [],
        initialCosts: !icSnap.empty ? [{ category: id }] : [],
        categoryBudgets: cbSnap.docs.map((d) => mapCategoryBudget(d.id, d.data())),
      });
      if (!check.canDelete) {
        throw new Error(
          check.reason === 'multi_member_privacy'
            ? 'En un hogar compartido no se eliminan categorías personalizadas de forma definitiva porque podría haber gastos privados de tu pareja. Archívala para ocultarla sin perder historial.'
            : 'Esta categoría tiene gastos, plantillas o presupuestos asociados. Archívala en lugar de borrarla.'
        );
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('Archívala') || error.message.includes('hogar compartido'))) {
        throw error;
      }
      handleFirestoreError(error, OperationType.LIST, `households/${householdId}/categories/${id}`);
    }

    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [
      {
        path: `households/${householdId}/categories/${id}`,
        apply: (batch) => batch.delete(doc(db, 'households', householdId, 'categories', id)),
      },
      {
        path: `households/${householdId}/activity`,
        apply: (batch) =>
          this.addActivityToBatch(batch, householdId, actor, 'delete', 'categoria', id, `Eliminó categoría "${name}"`),
      },
    ];

    await this.commitBatchOps(
      ops,
      OperationType.DELETE,
      `households/${householdId}/categories/${id}`,
      'No se pudo eliminar la categoría.'
    );
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
      startMonth: isValidMonthKey(rec.startMonth) ? rec.startMonth : '',
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
        const initialSkipped = sanitizeSkippedMonths(rec.skippedMonths);
        batch.set(ref, {
          ...payload,
          ...(initialSkipped.length > 0 ? { skippedMonths: initialSkipped } : {}),
          createdAt: serverTimestamp(),
        });
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

  async setRecurringMonthSkipped(
    householdId: string,
    recurringId: string,
    monthKey: string,
    skipped: boolean,
    actor: UserProfileInput
  ): Promise<void> {
    if (!isValidMonthKey(monthKey)) {
      throw new Error('Mes no válido para registrar la omisión.');
    }
    const path = `households/${householdId}/recurring/${recurringId}`;
    const recRef = doc(db, 'households', householdId, 'recurring', recurringId);
    const closureRef = doc(db, 'households', householdId, 'monthClosures', monthKey);

    let conceptForLog = '';
    let changed = false;
    try {
      await runTransaction(db, async (trx) => {
        const [closureSnap, recSnap] = await Promise.all([trx.get(closureRef), trx.get(recRef)]);
        if (closureSnap.exists()) {
          throw new Error(
            `El mes ${monthKey} está cerrado. Desbloquéalo antes de cambiar las omisiones.`
          );
        }
        if (!recSnap.exists()) {
          throw new Error('No se encontró la plantilla recurrente.');
        }
        const data = recSnap.data();
        conceptForLog = clampStr(String(data.concept ?? ''), MAX_LENGTHS.concept);
        const currentList = sanitizeSkippedMonths(data.skippedMonths);
        const nextList = skipped
          ? sanitizeSkippedMonths([...currentList, monthKey])
          : currentList.filter((m) => m !== monthKey);

        if (currentList.join(',') === nextList.join(',')) {
          changed = false;
          return;
        }
        changed = true;
        trx.update(recRef, {
          skippedMonths: nextList,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('está cerrado') || error.message.includes('No se encontró la plantilla'))
      ) {
        throw error;
      }
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    if (changed) {
      try {
        const actBatch = writeBatch(db);
        this.addActivityToBatch(
          actBatch,
          householdId,
          actor,
          'update',
          'recurrente',
          recurringId,
          skipped
            ? `Marcó "${conceptForLog || recurringId}" como no producido en ${monthKey}`
            : `Deshizo la omisión de "${conceptForLog || recurringId}" en ${monthKey}`
        );
        await actBatch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `households/${householdId}/activity`);
      }
    }
  }

  async generateMonthTransactions(
    householdId: string,
    monthKey: string,
    missing: RecurringExpense[],
    defaultSplitPctA: number,
    actor: UserProfileInput
  ): Promise<number> {
    if (missing.length === 0 || !isValidMonthKey(monthKey)) return 0;

    // 1) Deduplicate candidates and verify cadence strictly via unified engine
    const seenRecIds = new Set<string>();
    const dueCandidates: RecurringExpense[] = [];
    for (const rec of missing) {
      if (seenRecIds.has(rec.id)) continue;
      if (!isRecurringDueInMonth(rec, monthKey)) continue;
      seenRecIds.add(rec.id);
      dueCandidates.push(rec);
    }
    if (dueCandidates.length === 0) return 0;

    // 2) Check existing non-private transactions in this month to avoid duplicating manual/legacy entries
    let existingRecIdsInMonth = new Set<string>();
    try {
      const sharedSnap = await getDocs(
        query(
          collection(db, 'households', householdId, 'transactions'),
          where('isPrivate', '==', false)
        )
      );
      existingRecIdsInMonth = new Set(
        sharedSnap.docs
          .map((d) => d.data())
          .filter((data) => data.monthKey === monthKey && typeof data.recurringId === 'string' && data.recurringId)
          .map((data) => String(data.recurringId))
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `households/${householdId}/transactions`);
    }

    const toCreate = dueCandidates.filter((rec) => !existingRecIdsInMonth.has(rec.id));
    if (toCreate.length === 0) return 0;

    const baseSplit = clampSplitPct(defaultSplitPctA, 50);
    let totalCreated = 0;

    // 3) Atomic transaction per chunk (<= 15 writes) with deterministic IDs
    for (let i = 0; i < toCreate.length; i += MAX_BATCH_DOCS) {
      const slice = toCreate.slice(i, i + MAX_BATCH_DOCS);
      try {
        const chunkCreated = await runTransaction(db, async (trx) => {
          const refsAndRecs = slice.map((rec) => {
            const detId = buildDeterministicRecurringTxId(monthKey, rec.id);
            return {
              rec,
              ref: doc(db, 'households', householdId, 'transactions', detId),
            };
          });

          const snaps = await Promise.all(refsAndRecs.map(({ ref }) => trx.get(ref)));
          let createdInChunk = 0;

          refsAndRecs.forEach(({ rec, ref }, idx) => {
            if (snaps[idx].exists()) return;
            const splitPctA =
              rec.splitOverride !== null && rec.splitOverride !== undefined
                ? clampSplitPct(rec.splitOverride, baseSplit)
                : baseSplit;
            trx.set(ref, {
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
            });
            createdInChunk++;
          });

          return createdInChunk;
        });
        totalCreated += chunkCreated;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `households/${householdId}/transactions`);
      }
    }

    if (totalCreated > 0) {
      try {
        const actBatch = writeBatch(db);
        this.addActivityToBatch(
          actBatch,
          householdId,
          actor,
          'create',
          'gastos_mes',
          monthKey,
          `Generó ${totalCreated} gastos recurrentes para ${monthKey}`
        );
        await actBatch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `households/${householdId}/activity`);
      }
    }

    return totalCreated;
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
    const sysLimits: MonthlyBudget['limits'] = {};
    for (const [k, v] of Object.entries(limits ?? {})) {
      if (isSystemExpenseCategory(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        sysLimits[k] = roundCents(v);
      }
    }
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'households', householdId, 'budgets', monthKey), {
        monthKey,
        limits: sysLimits,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(batch, householdId, actor, 'update', 'presupuesto', monthKey, `Actualizó presupuestos de ${monthKey}`);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async saveAllBudgets(
    householdId: string,
    monthKey: string,
    limits: Record<string, number>,
    customCategoryIds: string[],
    actor: UserProfileInput
  ): Promise<void> {
    const sysLimits: MonthlyBudget['limits'] = {};
    for (const [k, v] of Object.entries(limits)) {
      if (isSystemExpenseCategory(k) && Number.isFinite(v) && v >= 0) {
        sysLimits[k] = roundCents(v);
      }
    }

    let existingCustomIds = new Set<string>();
    try {
      const cbSnap = await getDocs(
        query(collection(db, 'households', householdId, 'categoryBudgets'), where('monthKey', '==', monthKey))
      );
      existingCustomIds = new Set(cbSnap.docs.map((d) => d.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `households/${householdId}/categoryBudgets`);
    }

    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];
    ops.push({
      path: `households/${householdId}/budgets/${monthKey}`,
      apply: (batch) =>
        batch.set(doc(db, 'households', householdId, 'budgets', monthKey), {
          monthKey,
          limits: sysLimits,
          updatedAt: serverTimestamp(),
        }),
    });

    for (const catId of customCategoryIds) {
      if (!isCustomCategoryId(catId)) continue;
      const docId = buildCategoryBudgetDocId(monthKey, catId);
      const hasExplicit = Object.prototype.hasOwnProperty.call(limits, catId);
      const rawVal = hasExplicit ? limits[catId] : undefined;
      const val = typeof rawVal === 'number' ? rawVal : NaN;
      const ref = doc(db, 'households', householdId, 'categoryBudgets', docId);
      if (hasExplicit && Number.isFinite(val) && val >= 0) {
        ops.push({
          path: `households/${householdId}/categoryBudgets/${docId}`,
          apply: (batch) =>
            batch.set(ref, {
              monthKey,
              categoryId: catId,
              limit: roundCents(val),
              updatedAt: serverTimestamp(),
            }),
        });
      } else if (existingCustomIds.has(docId)) {
        ops.push({
          path: `households/${householdId}/categoryBudgets/${docId}`,
          apply: (batch) => batch.delete(ref),
        });
      }
    }

    ops.push({
      path: `households/${householdId}/activity`,
      apply: (batch) =>
        this.addActivityToBatch(
          batch,
          householdId,
          actor,
          'update',
          'presupuesto',
          monthKey,
          `Actualizó presupuestos de ${monthKey}`
        ),
    });

    await this.commitBatchOps(
      ops,
      OperationType.WRITE,
      `households/${householdId}/budgets/${monthKey}`,
      'No se pudieron guardar los presupuestos del mes.'
    );
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

  async saveSavingsPlan(
    householdId: string,
    plan: {
      monthKey: string;
      targetAmount: number;
      allocations: SavingsPlanAllocation[];
      adjustmentKind?: SavingsPlanAdjustmentKind;
      extraAmount?: number;
    },
    actor: UserProfileInput
  ): Promise<void> {
    if (!isValidMonthKey(plan.monthKey)) {
      throw new Error('Mes inválido para el plan de ahorro.');
    }
    const path = `households/${householdId}/savingsPlans/${plan.monthKey}`;
    const cleanTarget = roundCents(Math.max(0, Number(plan.targetAmount) || 0));
    const cleanAllocations = sanitizeSavingsPlanAllocations(plan.allocations);
    const cleanKind =
      plan.adjustmentKind === 'ajuste' || plan.adjustmentKind === 'extra'
        ? plan.adjustmentKind
        : undefined;
    const cleanExtra =
      typeof plan.extraAmount === 'number' && Number.isFinite(plan.extraAmount) && plan.extraAmount > 0
        ? roundCents(plan.extraAmount)
        : undefined;
    const ref = doc(db, 'households', householdId, 'savingsPlans', plan.monthKey);
    try {
      const batch = writeBatch(db);
      batch.set(ref, {
        monthKey: plan.monthKey,
        targetAmount: cleanTarget,
        allocations: cleanAllocations,
        ...(cleanKind ? { adjustmentKind: cleanKind } : {}),
        ...(cleanExtra !== undefined ? { extraAmount: cleanExtra } : {}),
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'update',
        'plan_ahorro',
        plan.monthKey,
        `Guardó plan de ahorro de ${plan.monthKey} (${cleanTarget} €)`
      );
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async deleteSavingsPlan(
    householdId: string,
    monthKey: string,
    actor: UserProfileInput
  ): Promise<void> {
    if (!isValidMonthKey(monthKey)) return;
    const path = `households/${householdId}/savingsPlans/${monthKey}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'households', householdId, 'savingsPlans', monthKey));
      this.addActivityToBatch(
        batch,
        householdId,
        actor,
        'delete',
        'plan_ahorro',
        monthKey,
        `Eliminó plan de ahorro de ${monthKey}`
      );
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async upsertShoppingItem(
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
  ): Promise<string> {
    const id = item.id || doc(collection(db, 'households', householdId, 'shopping')).id;
    const path = `households/${householdId}/shopping/${id}`;
    const cleanText = clampStr(item.text, MAX_LENGTHS.shoppingText);
    const cleanQty = roundCents(Math.max(0.01, Math.min(999, Number(item.qty) || 1)));
    const cleanUnit = normalizeShoppingUnit(item.unit);
    const cleanCatalogId = clampStr(item.catalogId || '', MAX_LENGTHS.shoppingCatalogId);
    const cleanBrand = clampStr(item.brand || '', MAX_LENGTHS.shoppingBrand);
    const cleanFormat = clampStr(item.format || '', MAX_LENGTHS.shoppingFormat);
    const cleanSection = normalizeShoppingSection(item.section);
    const cleanSourceType = normalizeShoppingSourceType(item.sourceType);
    const optionalMeta: Record<string, unknown> = {
      ...(cleanCatalogId ? { catalogId: cleanCatalogId } : {}),
      ...(cleanBrand ? { brand: cleanBrand } : {}),
      ...(cleanFormat ? { format: cleanFormat } : {}),
      ...(cleanSection ? { section: cleanSection } : {}),
      ...(cleanSourceType ? { sourceType: cleanSourceType } : {}),
    };
    try {
      const ref = doc(db, 'households', householdId, 'shopping', id);
      if (item.id) {
        await updateDoc(ref, {
          text: cleanText,
          qty: cleanQty,
          unit: cleanUnit,
          done: Boolean(item.done),
          ...optionalMeta,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          text: cleanText,
          qty: cleanQty,
          unit: cleanUnit,
          done: Boolean(item.done),
          ...optionalMeta,
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

  async commitShoppingCheckoutPhase1(
    householdId: string,
    input: ShoppingCheckoutPhase1Input,
    actor: UserProfileInput
  ): Promise<ShoppingCheckoutPhase1Result> {
    if (!isValidShoppingCheckoutId(input.checkoutId)) {
      throw new Error('Identificador de cierre de compra inválido.');
    }
    const cleanAmount = roundCents(Number(input.amount));
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new Error('Introduce un importe válido mayor que 0 €.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !isValidMonthKey(input.monthKey)) {
      throw new Error('Fecha de compra inválida.');
    }

    const ordered = sortSnapshotsDeterministically(input.snapshots);
    if (ordered.length === 0) {
      return { status: 'all_modified_or_gone', skippedConcurrentIds: [], alreadyGoneIds: [] };
    }
    if (ordered.length > MAX_CHECKOUT_PENDING_ITEMS) {
      throw new Error(`El carro supera el máximo de ${MAX_CHECKOUT_PENDING_ITEMS} artículos por cierre.`);
    }

    const expenseId = buildCheckoutExpenseId(input.checkoutId);
    const batch1 = ordered.slice(0, MAX_CHECKOUT_BATCH_ITEMS);
    const remainingSnapshots = ordered.slice(MAX_CHECKOUT_BATCH_ITEMS);
    const isPrivate = Boolean(input.isPrivate);
    const cleanConcept = clampStr(input.concept || 'Compra supermercado', MAX_LENGTHS.concept) || 'Compra supermercado';
    const cleanNotes = clampStr(input.notes || '', MAX_LENGTHS.notes);
    const safePaidBy = isPrivate ? actor.uid : normalizePayerValue(input.paidBy);
    const safeSplitPctA = clampSplitPct(input.splitPctA, 50);

    const monthClosureRef = doc(db, 'households', householdId, 'monthClosures', input.monthKey);
    const txRef = doc(db, 'households', householdId, 'transactions', expenseId);
    const checkoutRef = doc(db, 'households', householdId, 'shoppingCheckouts', input.checkoutId);
    const path = `households/${householdId}/transactions/${expenseId}`;

    try {
      return await runTransaction(db, async (trx) => {
        const [closureSnap, txSnap, checkoutSnap, ...allItemSnaps] = await Promise.all([
          trx.get(monthClosureRef),
          trx.get(txRef),
          trx.get(checkoutRef),
          ...ordered.map((snap) => trx.get(doc(db, 'households', householdId, 'shopping', snap.id))),
        ]);

        // Idempotencia duradera: si el gasto ya existe para este checkoutId, NO duplicar.
        if (txSnap.exists()) {
          const pendingItemIds = checkoutSnap.exists()
            ? mapPendingShoppingCheckout(checkoutSnap.id, checkoutSnap.data()).pendingItemIds
            : [];
          return {
            status: 'already_committed',
            expenseId,
            pendingItemIds,
          };
        }

        if (closureSnap.exists()) {
          throw new Error(
            'El mes de la fecha elegida está cerrado. Desbloquéalo en Avanzado o elige una fecha en un mes abierto.'
          );
        }

        const alreadyGoneIds: string[] = [];
        const deletedIds: string[] = [];
        const validRemainingIds: string[] = [];
        const skippedConcurrentIds: string[] = [];

        for (let i = 0; i < batch1.length; i++) {
          const expected = batch1[i];
          const liveSnap = allItemSnaps[i];
          if (!liveSnap.exists()) {
            alreadyGoneIds.push(expected.id);
            continue;
          }
          const liveItem = mapShoppingItem(liveSnap.id, liveSnap.data());
          if (isShoppingItemUnchangedForCheckout(expected, liveItem)) {
            deletedIds.push(expected.id);
          } else {
            skippedConcurrentIds.push(expected.id);
          }
        }

        // Verificar también lotes posteriores (≥ 11) dentro de la misma transacción
        // para detectar solapamientos antes de crear el gasto sin superar ≤ 13 escrituras.
        for (let i = 0; i < remainingSnapshots.length; i++) {
          const expected = remainingSnapshots[i];
          const liveSnap = allItemSnaps[batch1.length + i];
          if (!liveSnap.exists()) {
            alreadyGoneIds.push(expected.id);
            continue;
          }
          const liveItem = mapShoppingItem(liveSnap.id, liveSnap.data());
          if (isShoppingItemUnchangedForCheckout(expected, liveItem)) {
            validRemainingIds.push(expected.id);
          } else {
            skippedConcurrentIds.push(expected.id);
          }
        }

        // Protección frente a cierre simultáneo o repetición tras pérdida de red/sesión
        // tanto en el lote 1 como en lotes posteriores.
        if (alreadyGoneIds.length > 0) {
          return {
            status: 'overlap_conflict',
            alreadyGoneIds,
          };
        }

        if (deletedIds.length === 0 && validRemainingIds.length === 0) {
          return {
            status: 'all_modified_or_gone',
            skippedConcurrentIds,
            alreadyGoneIds: [],
          };
        }

        // Escritura atómica (≤ 13 escrituras en total: tx + activity? + ≤10 deletes + checkout?).
        trx.set(txRef, {
          monthKey: input.monthKey,
          concept: cleanConcept,
          category: 'supermercado',
          amount: cleanAmount,
          date: input.date,
          paidBy: safePaidBy,
          recurringId: null,
          splitPctA: safeSplitPctA,
          isSettlement: false,
          settlementTo: '',
          isPrivate,
          createdBy: actor.uid,
          notes: cleanNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (!isPrivate) {
          const actRef = doc(collection(db, 'households', householdId, 'activity'));
          trx.set(actRef, {
            uid: actor.uid,
            actorName: clampStr(actor.displayName || 'Usuario', MAX_LENGTHS.displayName) || 'Usuario',
            action: 'create',
            entity: 'gasto',
            entityId: clampStr(expenseId, 128),
            summary: clampStr(`Añadió gasto "${cleanConcept}" (${cleanAmount} €)`, MAX_LENGTHS.activitySummary),
            timestamp: serverTimestamp(),
          });
        }

        for (const itemId of deletedIds) {
          trx.delete(doc(db, 'households', householdId, 'shopping', itemId));
        }

        if (validRemainingIds.length > 0) {
          trx.set(checkoutRef, {
            expenseId,
            monthKey: input.monthKey,
            amount: isPrivate ? 0 : cleanAmount,
            concept: isPrivate ? 'Compra privada' : cleanConcept,
            pendingItemIds: validRemainingIds,
            totalItemCount: ordered.length,
            isPrivate,
            createdBy: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        return {
          status: 'committed',
          expenseId,
          deletedIds,
          skippedConcurrentIds,
          pendingItemIds: validRemainingIds,
        };
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('mes de la fecha elegida está cerrado')) {
        throw error;
      }
      handleFirestoreError(
        error,
        OperationType.WRITE,
        path,
        'No se pudo confirmar la compra en el servidor. Comprueba tu conexión e inténtalo de nuevo.'
      );
    }
  }

  async cleanupShoppingCheckoutBatch(
    householdId: string,
    checkoutId: string,
    snapshotsById?: Record<string, ShoppingCheckoutItemSnapshot>
  ): Promise<ShoppingCheckoutBatchCleanupResult> {
    if (!isValidShoppingCheckoutId(checkoutId)) {
      throw new Error('Identificador de limpieza inválido.');
    }
    const checkoutRef = doc(db, 'households', householdId, 'shoppingCheckouts', checkoutId);
    const path = `households/${householdId}/shoppingCheckouts/${checkoutId}`;

    try {
      return await runTransaction(db, async (trx) => {
        const checkoutSnap = await trx.get(checkoutRef);
        if (!checkoutSnap.exists()) {
          return {
            checkoutId,
            deletedIds: [],
            skippedConcurrentIds: [],
            alreadyGoneIds: [],
            remainingItemIds: [],
            completed: true,
          };
        }

        const checkout = mapPendingShoppingCheckout(checkoutSnap.id, checkoutSnap.data());
        const batchIds = checkout.pendingItemIds.slice(0, MAX_CHECKOUT_BATCH_ITEMS);
        const remainingItemIds = checkout.pendingItemIds.slice(batchIds.length);

        const itemSnaps = await Promise.all(
          batchIds.map((id) => trx.get(doc(db, 'households', householdId, 'shopping', id)))
        );

        const deletedIds: string[] = [];
        const skippedConcurrentIds: string[] = [];
        const alreadyGoneIds: string[] = [];

        for (let i = 0; i < batchIds.length; i++) {
          const itemId = batchIds[i];
          const liveSnap = itemSnaps[i];
          if (!liveSnap.exists()) {
            alreadyGoneIds.push(itemId);
            continue;
          }
          const liveItem = mapShoppingItem(liveSnap.id, liveSnap.data());
          const localSnap = snapshotsById?.[itemId];
          const safeToDelete = localSnap
            ? isShoppingItemUnchangedForCheckout(localSnap, liveItem)
            : isShoppingItemSafeForCrossDeviceCleanup(liveItem, checkout.createdAt);

          if (safeToDelete) {
            deletedIds.push(itemId);
          } else {
            skippedConcurrentIds.push(itemId);
          }
        }

        for (const itemId of deletedIds) {
          trx.delete(doc(db, 'households', householdId, 'shopping', itemId));
        }

        if (remainingItemIds.length === 0) {
          trx.delete(checkoutRef);
        } else {
          trx.update(checkoutRef, {
            pendingItemIds: remainingItemIds,
            updatedAt: serverTimestamp(),
          });
        }

        return {
          checkoutId,
          deletedIds,
          skippedConcurrentIds,
          alreadyGoneIds,
          remainingItemIds,
          completed: remainingItemIds.length === 0,
        };
      });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        path,
        'El gasto ya está guardado, pero no se pudo completar este lote de limpieza.'
      );
    }
  }

  async dismissPendingShoppingCheckout(householdId: string, checkoutId: string): Promise<void> {
    if (!isValidShoppingCheckoutId(checkoutId)) return;
    const path = `households/${householdId}/shoppingCheckouts/${checkoutId}`;
    try {
      await deleteDoc(doc(db, 'households', householdId, 'shoppingCheckouts', checkoutId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async upsertShoppingCatalogItem(
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
  ): Promise<string> {
    const cleanText = clampStr(input.text, MAX_LENGTHS.shoppingText);
    if (!cleanText) return '';
    const cleanCatalogId = clampStr(input.catalogId || '', MAX_LENGTHS.shoppingCatalogId);
    const cleanBrand = clampStr(input.brand || '', MAX_LENGTHS.shoppingBrand);
    const cleanFormat = clampStr(input.format || '', MAX_LENGTHS.shoppingFormat);
    const cleanSection = normalizeShoppingSection(input.section);
    const cleanSourceType = normalizeShoppingSourceType(input.sourceType);
    const id = buildShoppingCatalogId(cleanText, {
      catalogId: cleanCatalogId,
      brand: cleanBrand,
      format: cleanFormat,
    });
    const cleanUnit = normalizeShoppingUnit(input.defaultUnit);
    const nowIso = new Date().toISOString().slice(0, 32);
    const ref = doc(db, 'households', householdId, 'shoppingCatalog', id);
    const path = `households/${householdId}/shoppingCatalog/${id}`;
    const optionalMeta: Record<string, unknown> = {
      ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(cleanCatalogId ? { catalogId: cleanCatalogId } : {}),
      ...(cleanBrand ? { brand: cleanBrand } : {}),
      ...(cleanFormat ? { format: cleanFormat } : {}),
      ...(cleanSection ? { section: cleanSection } : {}),
      ...(cleanSourceType ? { sourceType: cleanSourceType } : {}),
    };
    try {
      await runTransaction(db, async (trx) => {
        const snap = await trx.get(ref);
        if (snap.exists()) {
          const prev = snap.data();
          const prevCount = Number(prev.usageCount ?? 0);
          trx.update(ref, {
            text: cleanText,
            defaultUnit: cleanUnit || normalizeShoppingUnit(typeof prev.defaultUnit === 'string' ? prev.defaultUnit : ''),
            usageCount: Math.min(100000, Math.max(1, Math.round(prevCount) + 1)),
            lastUsedAt: nowIso,
            ...optionalMeta,
            updatedAt: serverTimestamp(),
          });
        } else {
          trx.set(ref, {
            text: cleanText,
            defaultUnit: cleanUnit,
            usageCount: 1,
            lastUsedAt: nowIso,
            ...optionalMeta,
            createdBy: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async toggleShoppingCatalogFavorite(
    householdId: string,
    id: string,
    favorite: boolean
  ): Promise<void> {
    const path = `households/${householdId}/shoppingCatalog/${id}`;
    try {
      await updateDoc(doc(db, 'households', householdId, 'shoppingCatalog', id), {
        favorite: Boolean(favorite),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async upsertShoppingTemplate(
    householdId: string,
    tpl: { id?: string; name: string; items: ShoppingTemplateItem[] },
    actor: UserProfileInput
  ): Promise<string> {
    const cleanName = clampStr(tpl.name, MAX_LENGTHS.shoppingTemplateName);
    if (!cleanName) {
      throw new Error('Escribe un nombre para la lista reutilizable.');
    }
    const cleanItems = sanitizeShoppingTemplateItems(tpl.items);
    const id = tpl.id?.trim() || generateShoppingTemplateId();
    const ref = doc(db, 'households', householdId, 'shoppingTemplates', id);
    const path = `households/${householdId}/shoppingTemplates/${id}`;

    try {
      await runTransaction(db, async (trx) => {
        const snap = await trx.get(ref);
        if (snap.exists()) {
          trx.update(ref, {
            name: cleanName,
            items: cleanItems,
            updatedAt: serverTimestamp(),
          });
        } else {
          trx.set(ref, {
            name: cleanName,
            items: cleanItems,
            createdBy: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async deleteShoppingTemplate(householdId: string, id: string): Promise<void> {
    const path = `households/${householdId}/shoppingTemplates/${id}`;
    try {
      await deleteDoc(doc(db, 'households', householdId, 'shoppingTemplates', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  async applyShoppingTemplate(
    householdId: string,
    plan: ApplyShoppingTemplatePlan,
    actor: UserProfileInput
  ): Promise<{ createdCount: number; updatedCount: number }> {
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    for (const upd of plan.toUpdate) {
      const ref = doc(db, 'households', householdId, 'shopping', upd.id);
      const cleanUnit = normalizeShoppingUnit(upd.unit);
      const optMeta: Record<string, unknown> = {
        ...(upd.catalogId ? { catalogId: clampStr(upd.catalogId, MAX_LENGTHS.shoppingCatalogId) } : {}),
        ...(upd.brand ? { brand: clampStr(upd.brand, MAX_LENGTHS.shoppingBrand) } : {}),
        ...(upd.format ? { format: clampStr(upd.format, MAX_LENGTHS.shoppingFormat) } : {}),
        ...(upd.section ? { section: upd.section } : {}),
        ...(upd.sourceType ? { sourceType: upd.sourceType } : {}),
      };
      ops.push({
        path: `households/${householdId}/shopping/${upd.id}`,
        apply: (batch) =>
          batch.update(ref, {
            text: clampStr(upd.text, MAX_LENGTHS.shoppingText) || 'Producto',
            qty: roundCents(Math.max(0.01, Math.min(999, Number(upd.qty) || 1))),
            unit: cleanUnit,
            done: false,
            ...optMeta,
            updatedAt: serverTimestamp(),
          }),
      });
    }

    for (const item of plan.toCreate) {
      const ref = doc(collection(db, 'households', householdId, 'shopping'));
      const cleanUnit = normalizeShoppingUnit(item.unit);
      const optMeta: Record<string, unknown> = {
        ...(item.catalogId ? { catalogId: clampStr(item.catalogId, MAX_LENGTHS.shoppingCatalogId) } : {}),
        ...(item.brand ? { brand: clampStr(item.brand, MAX_LENGTHS.shoppingBrand) } : {}),
        ...(item.format ? { format: clampStr(item.format, MAX_LENGTHS.shoppingFormat) } : {}),
        ...(item.section ? { section: item.section } : {}),
        ...(item.sourceType ? { sourceType: item.sourceType } : {}),
      };
      ops.push({
        path: `households/${householdId}/shopping/${ref.id}`,
        apply: (batch) =>
          batch.set(ref, {
            text: clampStr(item.text, MAX_LENGTHS.shoppingText) || 'Producto',
            qty: roundCents(Math.max(0.01, Math.min(999, Number(item.qty) || 1))),
            unit: cleanUnit,
            done: false,
            ...optMeta,
            addedBy: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      });
    }

    if (ops.length > 0) {
      await this.commitBatchOps(
        ops,
        OperationType.WRITE,
        `households/${householdId}/shopping`,
        'No se pudo aplicar la lista reutilizable a la lista de la compra.'
      );
    }

    return {
      createdCount: plan.toCreate.length,
      updatedCount: plan.toUpdate.length,
    };
  }

  async setShoppingSectionOverride(
    householdId: string,
    productKey: string,
    section: ShoppingSection,
    actor: UserProfileInput
  ): Promise<void> {
    const cleanKey = productKey.trim().slice(0, MAX_LENGTHS.shoppingOverrideKey);
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(cleanKey)) {
      throw new Error('Identificador de producto inválido para guardar la sección.');
    }
    const cleanSection = normalizeShoppingSection(section);
    if (!cleanSection) {
      throw new Error('Sección de supermercado no válida.');
    }
    const path = `households/${householdId}/shoppingSectionOverrides/${cleanKey}`;
    try {
      await setDoc(doc(db, 'households', householdId, 'shoppingSectionOverrides', cleanKey), {
        productKey: cleanKey,
        section: cleanSection,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async clearShoppingSectionOverride(householdId: string, productKey: string): Promise<void> {
    const cleanKey = productKey.trim().slice(0, MAX_LENGTHS.shoppingOverrideKey);
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(cleanKey)) return;
    const path = `households/${householdId}/shoppingSectionOverrides/${cleanKey}`;
    try {
      await deleteDoc(doc(db, 'households', householdId, 'shoppingSectionOverrides', cleanKey));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
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
      const [
        hSnap,
        catSnap,
        cbSnap,
        icSnap,
        clSnap,
        itSnap,
        recSnap,
        txMap,
        budSnap,
        mcSnap,
        gSnap,
        gmSnap,
        spSnap,
        shopSnap,
        catalogSnap,
        tplSnap,
        ovSnap,
      ] = await Promise.all([
        getDoc(doc(db, 'households', householdId)),
        getDocs(collection(db, 'households', householdId, 'categories')),
        getDocs(collection(db, 'households', householdId, 'categoryBudgets')),
        getDocs(collection(db, 'households', householdId, 'initialCosts')),
        getDocs(collection(db, 'households', householdId, 'checklist')),
        getDocs(collection(db, 'households', householdId, 'items')),
        getDocs(collection(db, 'households', householdId, 'recurring')),
        this.fetchVisibleTransactionsMap(householdId, viewerUid),
        getDocs(collection(db, 'households', householdId, 'budgets')),
        getDocs(collection(db, 'households', householdId, 'monthClosures')),
        getDocs(collection(db, 'households', householdId, 'goals')),
        getDocs(collection(db, 'households', householdId, 'goalMovements')),
        getDocs(collection(db, 'households', householdId, 'savingsPlans')),
        getDocs(collection(db, 'households', householdId, 'shopping')),
        getDocs(collection(db, 'households', householdId, 'shoppingCatalog')),
        getDocs(collection(db, 'households', householdId, 'shoppingTemplates')),
        getDocs(collection(db, 'households', householdId, 'shoppingSectionOverrides')),
      ]);

      const hData = hSnap.exists() ? mapHousehold(hSnap.id, hSnap.data()) : null;
      const customCategories = catSnap.docs.map((d) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = mapCustomCategory(d.id, d.data());
        return rest;
      });
      const categoryBudgets = cbSnap.docs.map((d) => {
        const { updatedAt: _u, ...rest } = mapCategoryBudget(d.id, d.data());
        return rest;
      });
      const shoppingCatalog = catalogSnap.docs.map((d) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = mapShoppingCatalogItem(d.id, d.data());
        return rest;
      });
      const shoppingTemplates = tplSnap.docs.map((d) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = mapShoppingListTemplate(d.id, d.data());
        return rest;
      });
      const shoppingSectionOverrides = ovSnap.docs.map((d) => {
        const { updatedAt: _u, ...rest } = mapShoppingSectionOverride(d.id, d.data());
        return rest;
      });

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
        ...(hData?.incomeConfig !== undefined ? { incomeConfig: hData.incomeConfig } : {}),
        ...(hData?.habitualSavingsPlan !== undefined
          ? { habitualSavingsPlan: hData.habitualSavingsPlan }
          : {}),
        ...(typeof hData?.mudanzaCompleted === 'boolean'
          ? {
              mudanzaCompleted: hData.mudanzaCompleted,
              mudanzaCompletedAt: hData.mudanzaCompletedAt ?? null,
              mudanzaCompletedBy: hData.mudanzaCompletedBy ?? null,
            }
          : {}),
        ...(hData?.csvKeywords ? { csvKeywords: hData.csvKeywords } : {}),
        ...(hData?.categoryColors ? { categoryColors: hData.categoryColors } : {}),
        ...(hData?.commonAccountPlannedCategories && hData.commonAccountPlannedCategories.length > 0
          ? { commonAccountPlannedCategories: hData.commonAccountPlannedCategories }
          : {}),
        ...(hData?.commonAccountManualBalance
          ? { commonAccountManualBalance: hData.commonAccountManualBalance }
          : {}),
        ...(customCategories.length > 0 ? { customCategories } : {}),
        ...(categoryBudgets.length > 0 ? { categoryBudgets } : {}),
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
        ...(spSnap.docs.length > 0
          ? {
              savingsPlans: spSnap.docs
                .map((d) => {
                  const { updatedAt: _u, ...rest } = mapSavingsPlan(d.id, d.data());
                  return rest;
                })
                .sort((a, b) => a.monthKey.localeCompare(b.monthKey)),
            }
          : {}),
        shopping: shopSnap.docs.map((d) => {
          const { createdAt: _c, updatedAt: _u, ...rest } = mapShoppingItem(d.id, d.data());
          return rest;
        }),
        ...(shoppingCatalog.length > 0 ? { shoppingCatalog } : {}),
        ...(shoppingTemplates.length > 0 ? { shoppingTemplates } : {}),
        ...(shoppingSectionOverrides.length > 0 ? { shoppingSectionOverrides } : {}),
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
    const categoryOps: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];
    const ops: Array<{ path: string; apply: (batch: ReturnType<typeof writeBatch>) => void }> = [];

    let hSnap, catEx, cbEx, icEx, clEx, itEx, recEx, txExistingMap, budEx, mcEx, gEx, gmEx, shopEx, catalogEx, tplEx;
    try {
      [hSnap, catEx, cbEx, icEx, clEx, itEx, recEx, txExistingMap, budEx, mcEx, gEx, gmEx, shopEx, catalogEx, tplEx] =
        await Promise.all([
          getDoc(doc(db, 'households', householdId)),
          getDocs(collection(db, 'households', householdId, 'categories')),
          getDocs(collection(db, 'households', householdId, 'categoryBudgets')),
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
          getDocs(collection(db, 'households', householdId, 'shoppingCatalog')),
          getDocs(collection(db, 'households', householdId, 'shoppingTemplates')),
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
    const catSet = existsSet(catEx);
    const cbSet = existsSet(cbEx);
    const icSet = existsSet(icEx);
    const clSet = existsSet(clEx);
    const itSet = existsSet(itEx);
    const recSet = existsSet(recEx);
    const budSet = existsSet(budEx);
    const mcSet = existsSet(mcEx);
    const gSet = existsSet(gEx);
    const gmSet = existsSet(gmEx);
    const shopSet = existsSet(shopEx);
    const catalogSet = existsSet(catalogEx);
    const tplSet = existsSet(tplEx);

    if (Array.isArray(backup.customCategories)) {
      for (const cat of backup.customCategories) {
        const ref = doc(db, 'households', householdId, 'categories', cat.id);
        const payload = {
          name: clampStr(cat.name, MAX_LENGTHS.categoryName),
          color: isValidHexColor(cat.color) ? cat.color.toUpperCase() : '#0F766E',
          icon: isValidCategoryIcon(cat.icon) ? cat.icon : 'tag',
          order: Math.max(0, Math.min(999, Math.round(Number(cat.order) || 0))),
          archived: Boolean(cat.archived),
          csvKeywords: clampStr(cat.csvKeywords || '', MAX_LENGTHS.csvKeywordString),
          updatedAt: serverTimestamp(),
        };
        categoryOps.push({
          path: `households/${householdId}/categories/${cat.id}`,
          apply: (b) =>
            catSet.has(cat.id)
              ? b.update(ref, payload)
              : b.set(ref, { ...payload, createdAt: serverTimestamp() }),
        });
      }
    }

    const { presetA, presetB } = normalizeSplitPair(backup.settings.presetA);
    const cleanImportedIncomeCfg =
      backup.incomeConfig === null
        ? null
        : backup.incomeConfig
          ? sanitizeHouseholdIncomeConfig(backup.incomeConfig, backup.settings)
          : undefined;
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
          ...(cleanImportedIncomeCfg !== undefined
            ? {
                incomeConfig:
                  cleanImportedIncomeCfg === null
                    ? null
                    : {
                        ...cleanImportedIncomeCfg,
                        updatedBy: actor.uid,
                        updatedAt: new Date().toISOString(),
                      },
              }
            : {}),
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
    if (backup.categoryColors) {
      const cleanColors = sanitizeCategoryColors(backup.categoryColors) ?? {};
      ops.push({
        path: `households/${householdId}`,
        apply: (b) =>
          b.update(doc(db, 'households', householdId), {
            categoryColors: cleanColors,
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
      const { id, skippedMonths: rawSkipped, ...fields } = item;
      const safeSkipped = sanitizeSkippedMonths(rawSkipped);
      const baseSafeFields = {
        ...fields,
        startMonth: isValidMonthKey(fields.startMonth) ? fields.startMonth : '',
        paidByDefault: resolvePayer(fields.paidByDefault),
      };
      const ref = doc(db, 'households', householdId, 'recurring', id);
      ops.push({
        path: `households/${householdId}/recurring/${id}`,
        apply: (b) =>
          recSet.has(id)
            ? b.update(ref, { ...baseSafeFields, updatedAt: serverTimestamp() })
            : b.set(ref, {
                ...baseSafeFields,
                ...(safeSkipped.length > 0 ? { skippedMonths: safeSkipped } : {}),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }),
      });
    }

    for (const item of backup.transactions) {
      if (mcSet.has(item.monthKey)) continue;
      const { id, ...fields } = item;
      const existingDoc = txExistingMap.get(id);
      if (existingDoc && typeof existingDoc.monthKey === 'string' && mcSet.has(existingDoc.monthKey)) {
        continue;
      }
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
      if (mcSet.has(item.monthKey)) continue;
      const ref = doc(db, 'households', householdId, 'budgets', item.monthKey);
      const sysLimits: MonthlyBudget['limits'] = {};
      for (const [k, v] of Object.entries(item.limits ?? {})) {
        if (isSystemExpenseCategory(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          sysLimits[k] = roundCents(v);
        }
      }
      ops.push({
        path: `households/${householdId}/budgets/${item.monthKey}`,
        apply: (b) =>
          budSet.has(item.monthKey)
            ? b.update(ref, { limits: sysLimits, updatedAt: serverTimestamp() })
            : b.set(ref, { monthKey: item.monthKey, limits: sysLimits, updatedAt: serverTimestamp() }),
      });
    }

    if (Array.isArray(backup.categoryBudgets)) {
      for (const cb of backup.categoryBudgets) {
        if (mcSet.has(cb.monthKey)) continue;
        const ref = doc(db, 'households', householdId, 'categoryBudgets', cb.id);
        ops.push({
          path: `households/${householdId}/categoryBudgets/${cb.id}`,
          apply: (b) =>
            cbSet.has(cb.id)
              ? b.update(ref, { limit: roundCents(cb.limit), updatedAt: serverTimestamp() })
              : b.set(ref, {
                  monthKey: cb.monthKey,
                  categoryId: cb.categoryId,
                  limit: roundCents(cb.limit),
                  updatedAt: serverTimestamp(),
                }),
        });
      }
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

    if (Array.isArray(backup.savingsPlans)) {
      for (const sp of backup.savingsPlans) {
        if (!isValidMonthKey(sp.monthKey)) continue;
        const cleanTarget = roundCents(Math.max(0, Number(sp.targetAmount) || 0));
        const cleanAllocations = sanitizeSavingsPlanAllocations(sp.allocations);
        const ref = doc(db, 'households', householdId, 'savingsPlans', sp.monthKey);
        const cleanKind =
          sp.adjustmentKind === 'ajuste' || sp.adjustmentKind === 'extra'
            ? sp.adjustmentKind
            : undefined;
        const cleanExtra =
          typeof sp.extraAmount === 'number' && Number.isFinite(sp.extraAmount) && sp.extraAmount > 0
            ? roundCents(sp.extraAmount)
            : undefined;
        ops.push({
          path: `households/${householdId}/savingsPlans/${sp.monthKey}`,
          apply: (b) =>
            b.set(ref, {
              monthKey: sp.monthKey,
              targetAmount: cleanTarget,
              allocations: cleanAllocations,
              ...(cleanKind ? { adjustmentKind: cleanKind } : {}),
              ...(cleanExtra !== undefined ? { extraAmount: cleanExtra } : {}),
              updatedBy: actor.uid,
              updatedAt: serverTimestamp(),
            }),
        });
      }
    }

    if (Array.isArray(backup.shopping)) {
      for (const item of backup.shopping) {
        const { id, text, qty, unit, done, addedBy } = item;
        const safeAddedBy = resolveMemberUid(addedBy);
        const cleanQty = roundCents(Math.max(0.01, Math.min(999, Number(qty) || 1)));
        const cleanUnit = normalizeShoppingUnit(unit);
        const cleanCatalogId = clampStr(item.catalogId || '', MAX_LENGTHS.shoppingCatalogId);
        const cleanBrand = clampStr(item.brand || '', MAX_LENGTHS.shoppingBrand);
        const cleanFormat = clampStr(item.format || '', MAX_LENGTHS.shoppingFormat);
        const cleanSection = normalizeShoppingSection(item.section);
        const cleanSourceType = normalizeShoppingSourceType(item.sourceType);
        const optMeta: Record<string, unknown> = {
          ...(cleanCatalogId ? { catalogId: cleanCatalogId } : {}),
          ...(cleanBrand ? { brand: cleanBrand } : {}),
          ...(cleanFormat ? { format: cleanFormat } : {}),
          ...(cleanSection ? { section: cleanSection } : {}),
          ...(cleanSourceType ? { sourceType: cleanSourceType } : {}),
        };
        const ref = doc(db, 'households', householdId, 'shopping', id);
        ops.push({
          path: `households/${householdId}/shopping/${id}`,
          apply: (b) =>
            shopSet.has(id)
              ? b.update(ref, {
                  text: clampStr(text, MAX_LENGTHS.shoppingText) || 'Producto',
                  qty: cleanQty,
                  unit: cleanUnit,
                  done: Boolean(done),
                  ...optMeta,
                  updatedAt: serverTimestamp(),
                })
              : b.set(ref, {
                  text: clampStr(text, MAX_LENGTHS.shoppingText) || 'Producto',
                  qty: cleanQty,
                  unit: cleanUnit,
                  done: Boolean(done),
                  ...optMeta,
                  addedBy: safeAddedBy,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }),
        });
      }
    }

    if (Array.isArray(backup.shoppingCatalog)) {
      for (const item of backup.shoppingCatalog) {
        const ref = doc(db, 'households', householdId, 'shoppingCatalog', item.id);
        const cleanText = clampStr(item.text, MAX_LENGTHS.shoppingText) || 'Producto';
        const cleanUnit = normalizeShoppingUnit(item.defaultUnit);
        const safeUsage = Math.max(1, Math.min(100000, Math.round(Number(item.usageCount) || 1)));
        const safeLastUsed = (item.lastUsedAt || new Date().toISOString()).slice(0, 32);
        const safeCreator = resolveMemberUid(item.createdBy);
        const cleanCatalogId = clampStr(item.catalogId || '', MAX_LENGTHS.shoppingCatalogId);
        const cleanBrand = clampStr(item.brand || '', MAX_LENGTHS.shoppingBrand);
        const cleanFormat = clampStr(item.format || '', MAX_LENGTHS.shoppingFormat);
        const cleanSection = normalizeShoppingSection(item.section);
        const cleanSourceType = normalizeShoppingSourceType(item.sourceType);
        const optMeta: Record<string, unknown> = {
          ...(typeof item.favorite === 'boolean' ? { favorite: item.favorite } : {}),
          ...(cleanCatalogId ? { catalogId: cleanCatalogId } : {}),
          ...(cleanBrand ? { brand: cleanBrand } : {}),
          ...(cleanFormat ? { format: cleanFormat } : {}),
          ...(cleanSection ? { section: cleanSection } : {}),
          ...(cleanSourceType ? { sourceType: cleanSourceType } : {}),
        };
        ops.push({
          path: `households/${householdId}/shoppingCatalog/${item.id}`,
          apply: (b) =>
            catalogSet.has(item.id)
              ? b.update(ref, {
                  text: cleanText,
                  defaultUnit: cleanUnit,
                  usageCount: safeUsage,
                  lastUsedAt: safeLastUsed,
                  ...optMeta,
                  updatedAt: serverTimestamp(),
                })
              : b.set(ref, {
                  text: cleanText,
                  defaultUnit: cleanUnit,
                  usageCount: safeUsage,
                  lastUsedAt: safeLastUsed,
                  ...optMeta,
                  createdBy: safeCreator,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }),
        });
      }
    }

    if (Array.isArray(backup.shoppingTemplates)) {
      for (const tpl of backup.shoppingTemplates) {
        const ref = doc(db, 'households', householdId, 'shoppingTemplates', tpl.id);
        const cleanName = clampStr(tpl.name, MAX_LENGTHS.shoppingTemplateName) || 'Lista';
        const cleanItems = sanitizeShoppingTemplateItems(tpl.items);
        const safeCreator = resolveMemberUid(tpl.createdBy);
        ops.push({
          path: `households/${householdId}/shoppingTemplates/${tpl.id}`,
          apply: (b) =>
            tplSet.has(tpl.id)
              ? b.update(ref, {
                  name: cleanName,
                  items: cleanItems,
                  updatedAt: serverTimestamp(),
                })
              : b.set(ref, {
                  name: cleanName,
                  items: cleanItems,
                  createdBy: safeCreator,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }),
        });
      }
    }

    if (Array.isArray(backup.shoppingSectionOverrides)) {
      for (const ov of backup.shoppingSectionOverrides) {
        const cleanKey = (ov.productKey || ov.id || '').trim().slice(0, MAX_LENGTHS.shoppingOverrideKey);
        const cleanSection = normalizeShoppingSection(ov.section);
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(cleanKey) || !cleanSection) continue;
        const ref = doc(db, 'households', householdId, 'shoppingSectionOverrides', cleanKey);
        ops.push({
          path: `households/${householdId}/shoppingSectionOverrides/${cleanKey}`,
          apply: (b) =>
            b.set(ref, {
              productKey: cleanKey,
              section: cleanSection,
              updatedBy: actor.uid,
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

    // Primero confirmamos categorías personalizadas para que las reglas exists(...) de las colecciones dependientes siempre pasen.
    if (categoryOps.length > 0) {
      await this.commitBatchOps(
        categoryOps,
        OperationType.WRITE,
        `households/${householdId}/categories`
      );
    }

    await this.commitBatchOps(ops, OperationType.WRITE, `households/${householdId}`);

    // Preferencias opcionales de planificación de Cuenta común (escrituras independientes para respetar cada acción de reglas)
    if (backup.commonAccountPlannedCategories !== undefined) {
      await this.updateCommonAccountPlannedCategories(
        householdId,
        backup.commonAccountPlannedCategories
      );
    }
    if (backup.commonAccountManualBalance !== undefined) {
      await this.updateCommonAccountManualBalance(
        householdId,
        backup.commonAccountManualBalance
          ? {
              amount: backup.commonAccountManualBalance.amount,
              referenceDate: backup.commonAccountManualBalance.referenceDate,
            }
          : null,
        actor
      );
    }
    if (typeof backup.mudanzaCompleted === 'boolean') {
      await this.setMudanzaCompleted(householdId, backup.mudanzaCompleted, actor);
    }
    if (backup.habitualSavingsPlan !== undefined) {
      await this.saveHabitualSavingsPlan(
        householdId,
        backup.habitualSavingsPlan
          ? {
              monthlyAmount: backup.habitualSavingsPlan.monthlyAmount,
              priorityGoalIds: backup.habitualSavingsPlan.priorityGoalIds,
            }
          : null,
        actor
      );
    }
  }
}

export { computeEffectiveSplitPctA };
