import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCoupleBalance,
  clampSplitPct,
  computeBudgetProgress,
  computeCategoryComparison,
  computeEffectiveSplitPctA,
  computeEmergencyTarget,
  computeFurnitureSummary,
  computeGoalProgress,
  computeRecurringHistoricalAverage,
  computeSavingsCapacity,
  filterGlobalTransactions,
  findMissingRecurringForMonth,
  formatCoupleBalanceSecondPerson,
  formatDateES,
  formatEUR,
  formatLocalDateISO,
  getBudgetThresholdAlerts,
  getCurrentMonthKeyLocal,
  getUpcomingCharges,
  getUpcomingChargesWithinDays,
  inferSplitChoice,
  isRecurringTemplatePending,
  monthlyEquivalent,
  resolveSplitPctForChoice,
  roundCents,
} from './finance';
import {
  buildParsedBankRows,
  detectCsvDelimiter,
  guessCsvColumns,
  matchCategoryFromKeywords,
  parseBankAmount,
  parseBankDateToISO,
  parseCsvMatrix,
  suggestKeywordTokenFromDescription,
} from './csvImport';
import {
  findMatchingRecurringForPreset,
  RECURRING_CATALOG_PRESETS,
  RECURRING_CATALOG_SEED_VERSION,
  VARIABLE_BUDGET_SUGGESTIONS,
} from './presets';
import {
  buildDeterministicRecurringTxId,
  getNextRecurringDueDate,
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringMissingStartMonth,
  isRecurringSkippedInMonth,
  sanitizeSkippedMonths,
} from './recurrence';
import {
  buildMonthAgendaGroups,
  buildMonthCalendarGrid,
} from './calendar';
import {
  buildMudanzaCompletionDescription,
  countPendingMudanzaItems,
  isMudanzaCompleted,
  isValidNavTab,
  resolveDeepLinkNavigation,
  resolveTabForUiMode,
} from './mudanzaStage';
import {
  DEFAULT_CATEGORY_COLORS,
  resolveCategoryColor,
  sanitizeCategoryColors,
} from './categoryPalette';
import {
  allocateExactMemberShares,
  computeCommonAccountRadar,
  splitAmountExactCents,
} from './commonAccountRadar';
import {
  buildGuidedClosePendingItems,
  buildNextMonthBudgetCopyPlan,
  computeGuidedCloseReview,
  computeGuidedCloseSteps,
  deriveGuidedCloseInitialStep,
  shouldShowPreviousMonthCloseReminder,
} from './guidedMonthClose';
import {
  computeAnnualBalance,
  createScopedAnnualBalanceCache,
  extractAvailableYears,
} from './annualBalance';
import { computeMonthlyPlanSummary } from './monthlyPlanning';
import {
  buildInitialSavingsPlanDraft,
  evaluateMonthlySavingsPlan,
  formatDecimalInputES,
  getDefaultSelectableSavingsGoals,
  parseNonNegativeAmountInput,
  proposeMonthlySavingsDistribution,
  sanitizeSavingsPlanAllocations,
} from './savingsPlan';
import { buildRecurringIcsCalendar } from './icsExport';
import { getDueNotificationsForDevice } from './localNotifications';
import {
  daysSinceLastBackup,
  generateSpanishCSV,
  shouldShowBackupReminder,
  validateAndMigrateBackup,
} from './backup';
import {
  GENERIC_STAPLES_CATALOG,
  buildSectionOverridesMap,
  buildShoppingCatalogId,
  findPendingDuplicateMatch,
  formatShoppingQtyUnit,
  groupShoppingItemsBySection,
  inferShoppingSection,
  preindexMercadonaCatalog,
  resolveEffectiveShoppingSection,
  resolveShoppingProductKey,
  searchShoppingSuggestions,
  searchShoppingSuggestionsPaginated,
  type StaticMercadonaCatalogEntry,
} from './shoppingCatalog';
import { planApplyShoppingTemplate } from './shoppingTemplates';
import {
  CATEGORY_ICON_KEYS,
  CATEGORY_SELECTOR_PREFS_VERSION,
  CUSTOM_CATEGORY_SUGGESTIONS,
  INITIAL_VISIBLE_CATEGORY_SPEC,
  buildCategoryRegistry,
  canSafelyDeleteCustomCategory,
  generateCustomCategoryId,
  getAvailableCategorySuggestions,
  isCategoryDuplicateName,
  isCategoryUsedInHouseholdData,
  isCustomCategoryId,
  mergeMonthlyAndCustomBudgetLimits,
  pickSimpleWizardCategories,
  planCopyPreviousMonthBudgets,
  resolveInitialVisibleCategoriesPlan,
  resolveSelectorCategories,
} from './categories';
import {
  MAX_CHECKOUT_BATCH_ITEMS,
  buildCheckoutExpenseId,
  captureShoppingCheckoutSnapshots,
  clearAllLocalPendingCheckouts,
  clearLocalPendingCheckout,
  executeDurableShoppingCheckout,
  executeShoppingCheckout,
  generateShoppingCheckoutId,
  isShoppingItemSafeForCrossDeviceCleanup,
  isValidShoppingCheckoutId,
  loadLocalPendingCheckout,
  reconcileShoppingItemsForCleanup,
  saveLocalPendingCheckout,
  type ShoppingCheckoutSession,
} from './shoppingCheckout';
import {
  acquirePwaEditLock,
  acquirePwaWriteLock,
  canTriggerSafeChunkReload,
  clearSafeChunkReloadAttempts,
  getPwaReloadBlockStatus,
  isLikelyStaleChunkError,
  recordSafeChunkReloadAttempt,
  resetPwaGuardForTests,
} from '../services/pwaUpdateGuard';
import {
  createScopedGlobalSearchCache,
  filterGlobalExpenses,
} from './globalSearch';
import { DemoHouseholdRepository } from '../repositories/DemoHouseholdRepository';
import {
  COMMON_ACCOUNT_ID,
  type ChecklistItem,
  type CustomCategory,
  type FurnitureItem,
  type GoalMovement,
  type Household,
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
  type ShoppingItem,
  type ShoppingListTemplate,
  type ShoppingSectionOverride,
  type Transaction,
} from '../types/nido';

const memberA: HouseholdMember = {
  uid: 'uid_alex',
  displayName: 'Alex',
  photoURL: '',
  role: 'member_a',
  uiMode: 'sencillo',
  joinedAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const memberB: HouseholdMember = {
  uid: 'uid_marta',
  displayName: 'Marta',
  photoURL: '',
  role: 'member_b',
  uiMode: 'sencillo',
  joinedAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_default',
    monthKey: '2026-11',
    concept: 'Gasto',
    category: 'otros',
    amount: 50,
    date: '2026-11-10',
    paidBy: 'uid_alex',
    recurringId: null,
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    notes: '',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

test('computeEffectiveSplitPctA calcula salario neto redondeado a 1 decimal y presets', () => {
  const incomeSettings: HouseholdSettings = {
    splitMode: 'income',
    presetA: 50,
    presetB: 50,
    incomeA: 2100,
    incomeB: 1400,
    currency: 'EUR',
  };
  assert.equal(computeEffectiveSplitPctA(incomeSettings), 60);

  const unevenIncome: HouseholdSettings = {
    ...incomeSettings,
    incomeA: 1850,
    incomeB: 1550,
  };
  // 1850 / 3400 = 54.4117 -> 54.4
  assert.equal(computeEffectiveSplitPctA(unevenIncome), 54.4);

  const zeroIncome: HouseholdSettings = { ...incomeSettings, incomeA: 0, incomeB: 0 };
  assert.equal(computeEffectiveSplitPctA(zeroIncome), 50);

  const presetSettings: HouseholdSettings = {
    ...incomeSettings,
    splitMode: 'preset',
    presetA: 70,
    presetB: 30,
  };
  assert.equal(computeEffectiveSplitPctA(presetSettings), 70);
});

test('resolveSplitPctForChoice e inferSplitChoice traducen Solo yo / Solo mi pareja según rol', () => {
  const effectiveA = 60;

  // Para member_a: Solo yo => 100, Solo mi pareja => 0
  assert.equal(resolveSplitPctForChoice('segun_reparto', true, effectiveA), 60);
  assert.equal(resolveSplitPctForChoice('a_medias', true, effectiveA), 50);
  assert.equal(resolveSplitPctForChoice('solo_yo', true, effectiveA), 100);
  assert.equal(resolveSplitPctForChoice('solo_pareja', true, effectiveA), 0);
  assert.equal(resolveSplitPctForChoice('personalizado', true, effectiveA, 72.5), 72.5);
  assert.equal(resolveSplitPctForChoice('personalizado', true, effectiveA, 0), 0);

  // Para member_b: Solo yo => 0, Solo mi pareja => 100
  assert.equal(resolveSplitPctForChoice('segun_reparto', false, effectiveA), 60);
  assert.equal(resolveSplitPctForChoice('a_medias', false, effectiveA), 50);
  assert.equal(resolveSplitPctForChoice('solo_yo', false, effectiveA), 0);
  assert.equal(resolveSplitPctForChoice('solo_pareja', false, effectiveA), 100);

  // Inferencia inversa
  assert.equal(inferSplitChoice(60, true, effectiveA), 'segun_reparto');
  assert.equal(inferSplitChoice(50, true, effectiveA), 'a_medias');
  assert.equal(inferSplitChoice(100, true, effectiveA), 'solo_yo');
  assert.equal(inferSplitChoice(0, true, effectiveA), 'solo_pareja');
  assert.equal(inferSplitChoice(0, false, effectiveA), 'solo_yo');
  assert.equal(inferSplitChoice(100, false, effectiveA), 'solo_pareja');
  assert.equal(inferSplitChoice(35, false, effectiveA), 'personalizado');
});

test('calculateCoupleBalance aplica fórmula de reparto, cuenta común, liquidación y excluye gastos personales', () => {
  const txs: Transaction[] = [
    makeTx({
      id: 't1',
      concept: 'Supermercado',
      category: 'supermercado',
      amount: 100,
      date: '2026-11-05',
      paidBy: 'uid_alex',
      splitPctA: 60,
    }),
    makeTx({
      id: 't2',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      date: '2026-11-01',
      paidBy: 'cuenta_comun',
      recurringId: 'r1',
      splitPctA: 60,
    }),
    makeTx({
      id: 't_priv',
      concept: 'Regalo sorpresa',
      category: 'ocio',
      amount: 250,
      date: '2026-11-12',
      paidBy: 'uid_alex',
      splitPctA: 100,
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];

  // Personal = 100 EUR (el gasto privado de 250 EUR se excluye completamente).
  // Alex's 60% share = 60 EUR. Alex paid 100 -> Saldo_A = +40 EUR -> Marta debe 40 € a Alex
  const bal = calculateCoupleBalance(txs, memberA, memberB);
  assert.equal(bal.totalSpent, 950);
  assert.equal(bal.paidComun, 850);
  assert.equal(bal.balanceA, 40);
  assert.equal(bal.owesDirection, 'b_owes_a');
  assert.match(bal.summaryText, /Marta debe/);

  // Adding settlement from Marta -> Alex for 40 EUR leaves them at peace
  const settled = calculateCoupleBalance(
    [
      ...txs,
      makeTx({
        id: 't3',
        concept: 'Liquidación noviembre',
        category: 'liquidacion',
        amount: 40,
        date: '2026-11-28',
        paidBy: 'uid_marta',
        splitPctA: 60,
        isSettlement: true,
        settlementTo: 'uid_alex',
        createdBy: 'uid_marta',
      }),
    ],
    memberA,
    memberB
  );
  assert.equal(settled.balanceA, 0);
  assert.equal(settled.owesDirection, 'peace');
  assert.equal(settled.summaryText, 'Estáis en paz');

  // splitPctA === 0 must be preserved as 0 (never converted to 50%)
  assert.equal(clampSplitPct(0, 50), 0);
  const zeroSplitBal = calculateCoupleBalance(
    [
      makeTx({
        id: 't_zero',
        concept: 'Capricho B pagado por A',
        category: 'ocio',
        amount: 100,
        date: '2026-11-10',
        paidBy: 'uid_alex',
        splitPctA: 0,
      }),
    ],
    memberA,
    memberB
  );
  assert.equal(zeroSplitBal.shareA, 0);
  assert.equal(zeroSplitBal.shareB, 100);
  assert.equal(zeroSplitBal.balanceA, 100);
  assert.equal(zeroSplitBal.owesDirection, 'b_owes_a');
});

test('formatLocalDateISO usa fecha local sin desplazamiento UTC', () => {
  const localMidnight = new Date(2026, 10, 18, 0, 5, 0); // 18 Nov 2026 00:05 local
  assert.equal(formatLocalDateISO(localMidnight), '2026-11-18');
  assert.equal(formatDateES('2026-11-18'), '18/11/2026');
  assert.match(formatEUR(1234.5), /1\.234,50\s*€/);
});

test('plantillas recurrentes no se duplican y calculan equivalente mensual y colchón 3x/6x', () => {
  const recs: RecurringExpense[] = [
    {
      id: 'r_rent',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 900,
      frequency: 'mensual',
      dayOfMonth: 1,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r_home_ins',
      concept: 'Seguro hogar',
      category: 'seguros',
      amount: 240,
      frequency: 'anual',
      dayOfMonth: 15,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
  ];
  assert.equal(monthlyEquivalent(240, 'anual'), 20);
  assert.equal(computeEmergencyTarget(recs, 3), (900 + 20) * 3);
  assert.equal(computeEmergencyTarget(recs, 6), (900 + 20) * 6);

  const missingFirst = findMissingRecurringForMonth(recs, [], '2026-11');
  assert.equal(missingFirst.length, 1);
  assert.equal(missingFirst[0].id, 'r_rent');

  const alreadyGenerated: Transaction[] = [
    makeTx({
      id: 'tx_1',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 900,
      date: '2026-11-01',
      paidBy: 'cuenta_comun',
      recurringId: 'r_rent',
    }),
  ];
  const missingSecond = findMissingRecurringForMonth(recs, alreadyGenerated, '2026-11');
  assert.equal(missingSecond.length, 0);
});

test('semáforo presupuesto (sin contar personales), mobiliario IKEA y metas de ahorro calculan correctamente', () => {
  const txs: Transaction[] = [
    makeTx({
      id: 't1',
      concept: 'Compra',
      category: 'supermercado',
      amount: 340,
      date: '2026-11-10',
      paidBy: 'uid_alex',
    }),
    makeTx({
      id: 't_priv_super',
      concept: 'Compra personal',
      category: 'supermercado',
      amount: 100,
      date: '2026-11-11',
      paidBy: 'uid_alex',
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];
  const progress = computeBudgetProgress(txs, {
    monthKey: '2026-11',
    limits: { supermercado: 400 },
    updatedAt: '',
  });
  assert.equal(progress[0].spent, 340);
  assert.equal(progress[0].pct, 85);
  assert.equal(progress[0].status, 'ambar');

  const items: FurnitureItem[] = [
    {
      id: 'f1',
      name: 'Sofá',
      room: 'salon',
      priority: 'imprescindible',
      status: 'en_carrito',
      store: 'IKEA',
      productUrl: '',
      articleNumber: '',
      unitPrice: 499,
      qty: 1,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'f2',
      name: 'Sillas',
      room: 'salon',
      priority: 'imprescindible',
      status: 'comprado',
      store: 'IKEA',
      productUrl: '',
      articleNumber: '',
      unitPrice: 50,
      qty: 4,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const fSummary = computeFurnitureSummary(items);
  assert.equal(fSummary.totalCart, 499);
  assert.equal(fSummary.totalSpent, 200);
  assert.equal(fSummary.boughtPct, 50);

  const goal: SavingsGoal = {
    id: 'g1',
    name: 'Viajes',
    icon: 'plane',
    color: '#0284C7',
    targetAmount: 1200,
    targetDate: '2027-05-18',
    type: 'viajes',
    archived: false,
    createdAt: '',
    updatedAt: '',
  };
  const movements: GoalMovement[] = [
    { id: 'm1', goalId: 'g1', amount: 600, by: 'uid_alex', date: '2026-11-18', note: '', createdAt: '' },
  ];
  const gProg = computeGoalProgress(goal, movements, '2026-11-18');
  assert.equal(gProg.savedAmount, 600);
  assert.equal(gProg.remaining, 600);
  assert.equal(gProg.monthsLeft, 6);
  assert.equal(gProg.monthlyNeeded, 100);
});

test('filterGlobalTransactions busca por texto sin tildes, notas, importe con coma/punto y categoría', () => {
  const txs: Transaction[] = [
    makeTx({
      id: 'g1',
      monthKey: '2026-11',
      concept: 'Café especialidad Sant Sadurní',
      category: 'ocio',
      amount: 14.5,
      date: '2026-11-15',
      notes: 'Desayuno estación',
    }),
    makeTx({
      id: 'g2',
      monthKey: '2026-10',
      concept: 'Alquiler mensual',
      category: 'alquiler',
      amount: 850,
      date: '2026-10-01',
      notes: 'Transferencia común',
    }),
    makeTx({
      id: 'g3',
      monthKey: '2026-09',
      concept: 'Bonpreu semanal',
      category: 'supermercado',
      amount: 145,
      date: '2026-09-20',
      notes: 'Incluye limpieza',
    }),
  ];

  // Texto sin tildes coincide con "Café especialidad"
  const byText = filterGlobalTransactions(txs, { text: 'cafe', amountQuery: '', category: 'todas' });
  assert.deepEqual(
    byText.map((t) => t.id),
    ['g1']
  );

  // Coincidencia por notas
  const byNotes = filterGlobalTransactions(txs, { text: 'limpieza', amountQuery: '', category: 'todas' });
  assert.deepEqual(
    byNotes.map((t) => t.id),
    ['g3']
  );

  // Importe con coma española ("14,50")
  const byCommaAmt = filterGlobalTransactions(txs, { text: '', amountQuery: '14,50', category: 'todas' });
  assert.deepEqual(
    byCommaAmt.map((t) => t.id),
    ['g1']
  );

  // Importe parcial + categoría
  const byAmtAndCat = filterGlobalTransactions(txs, {
    text: '',
    amountQuery: '850',
    category: 'alquiler',
  });
  assert.deepEqual(
    byAmtAndCat.map((t) => t.id),
    ['g2']
  );
});

test('computeCategoryComparison compara mes actual vs anterior y media de 6 meses excluyendo personales y liquidaciones', () => {
  const txs: Transaction[] = [
    // Mes actual: 2026-11
    makeTx({ id: 'c1', monthKey: '2026-11', category: 'supermercado', amount: 300, date: '2026-11-05' }),
    makeTx({ id: 'c2', monthKey: '2026-11', category: 'ocio', amount: 60, date: '2026-11-10' }),
    makeTx({
      id: 'c_priv',
      monthKey: '2026-11',
      category: 'ocio',
      amount: 500,
      date: '2026-11-12',
      isPrivate: true,
    }),
    makeTx({
      id: 'c_set',
      monthKey: '2026-11',
      category: 'liquidacion',
      amount: 40,
      date: '2026-11-13',
      isSettlement: true,
      settlementTo: 'uid_marta',
    }),
    // Mes anterior: 2026-10
    makeTx({ id: 'p1', monthKey: '2026-10', category: 'supermercado', amount: 250, date: '2026-10-05' }),
    makeTx({ id: 'p2', monthKey: '2026-10', category: 'ocio', amount: 120, date: '2026-10-12' }),
    // Dos meses atrás: 2026-09 (2 meses previos activos => media 6m divide por 2)
    makeTx({ id: 'p3', monthKey: '2026-09', category: 'supermercado', amount: 150, date: '2026-09-05' }),
    // Mes fuera de la ventana de 6 meses: 2026-04 (no debe contar)
    makeTx({ id: 'old', monthKey: '2026-04', category: 'supermercado', amount: 999, date: '2026-04-05' }),
  ];

  const comp = computeCategoryComparison(txs, '2026-11');
  assert.equal(comp.activePriorMonths, 2);

  const superRow = comp.rows.find((r) => r.category === 'supermercado');
  assert.ok(superRow);
  assert.equal(superRow.current, 300);
  assert.equal(superRow.prev, 250);
  assert.equal(superRow.avg6, 200); // (250 + 150) / 2
  assert.equal(superRow.vsPrevDir, 'up');
  assert.equal(superRow.vsPrevPct, 20);
  assert.equal(superRow.vsAvg6Dir, 'up');
  assert.equal(superRow.vsAvg6Pct, 50);

  const ocioRow = comp.rows.find((r) => r.category === 'ocio');
  assert.ok(ocioRow);
  assert.equal(ocioRow.current, 60); // Excluye gasto privado de 500 €
  assert.equal(ocioRow.vsPrevDir, 'down');
  assert.equal(ocioRow.vsPrevPct, -50);
  assert.equal(ocioRow.avg6, 60); // (120 + 0) / 2
  assert.equal(ocioRow.vsAvg6Dir, 'flat');
});

test('avisos en Inicio: presupuesto (excluye solo recurrentes salvo >100% y distingue 80-99, =100, >100) y cargos en 3 días', () => {
  const txs: Transaction[] = [
    // 79 sobre 100 (no recurrente) => NO salta
    makeTx({ id: 'b_79', category: 'transporte', amount: 79 }),
    // 80 exactos sobre 100 (no recurrente) => SÍ salta (tramo 80-99 %)
    makeTx({ id: 'b_80', category: 'otros', amount: 80 }),
    // 100 exactos sobre 100 (no recurrente) => SÍ salta (=100 %)
    makeTx({ id: 'b_100', category: 'supermercado', amount: 100 }),
    // 110 sobre 100 (no recurrente) => SÍ salta (>100 %, overAmount = 10)
    makeTx({ id: 'b_110', category: 'ocio', amount: 110 }),
    // 850 sobre 850 SOLO plantilla recurrente => NO salta
    makeTx({ id: 'b_rent', category: 'alquiler', amount: 850, recurringId: 'rec_rent' }),
    // 48 sobre 50 (96%) SOLO plantilla recurrente => NO salta
    makeTx({ id: 'b_net', category: 'internet', amount: 48, recurringId: 'rec_net' }),
    // 105 sobre 100 (105%) SOLO plantilla recurrente => SÍ salta (>100 %)
    makeTx({ id: 'b_ins', category: 'seguros', amount: 105, recurringId: 'rec_ins' }),
    // Mixto (60 recurrente + 25 manual = 85%) => SÍ salta (no es solo de plantillas)
    makeTx({ id: 'b_luz_rec', category: 'luz', amount: 60, recurringId: 'rec_luz' }),
    makeTx({ id: 'b_luz_man', category: 'luz', amount: 25, recurringId: null }),
    // 50 privados en agua + 50 compartidos sobre 100 => 50% (NO salta)
    makeTx({ id: 'b_w1', category: 'agua', amount: 50 }),
    makeTx({ id: 'b_w2', category: 'agua', amount: 50, isPrivate: true }),
  ];

  const budgetAlerts = getBudgetThresholdAlerts(
    txs,
    {
      monthKey: '2026-11',
      limits: {
        transporte: 100,
        otros: 100,
        supermercado: 100,
        ocio: 100,
        alquiler: 850,
        internet: 50,
        seguros: 100,
        luz: 100,
        agua: 100,
      },
      updatedAt: '',
    },
    80
  );
  assert.deepEqual(
    budgetAlerts.map((a) => ({
      category: a.category,
      pct: a.pct,
      atLimit: a.atLimit,
      exceeded: a.exceeded,
      overAmount: a.overAmount,
    })),
    [
      { category: 'ocio', pct: 110, atLimit: false, exceeded: true, overAmount: 10 },
      { category: 'seguros', pct: 105, atLimit: false, exceeded: true, overAmount: 5 },
      { category: 'supermercado', pct: 100, atLimit: true, exceeded: false, overAmount: 0 },
      { category: 'luz', pct: 85, atLimit: false, exceeded: false, overAmount: 0 },
      { category: 'otros', pct: 80, atLimit: false, exceeded: false, overAmount: 0 },
    ]
  );

  // Recurrentes en próximos 3 días con cambio de mes (2026-11-29 -> 2026-12-01 y 2026-11-30)
  const recs: RecurringExpense[] = [
    {
      id: 'r_day31',
      concept: 'Luz fin de mes',
      category: 'luz',
      amount: 68,
      frequency: 'mensual',
      dayOfMonth: 31, // en noviembre (30 días) se ajusta al 2026-11-30 => +1 día
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r_day1',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      frequency: 'mensual',
      dayOfMonth: 1, // 2026-12-01 => +2 días desde 2026-11-29
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r_day5',
      concept: 'Fibra',
      category: 'internet',
      amount: 45,
      frequency: 'mensual',
      dayOfMonth: 5, // 2026-12-05 => +6 días (fuera de ventana de 3 días)
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r_inactive',
      concept: 'Inactiva',
      category: 'otros',
      amount: 10,
      frequency: 'mensual',
      dayOfMonth: 30,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const existingDecTx = [
    makeTx({ id: 'tx_dec_rent', monthKey: '2026-12', recurringId: 'r_day1', date: '2026-12-01' }),
  ];

  // A4: r_day1 ya tiene transacción en diciembre (existingDecTx), así que NO debe aparecer en los avisos
  const upcoming = getUpcomingChargesWithinDays(recs, '2026-11-29', 3, existingDecTx);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].recurringId, 'r_day31');
  assert.equal(upcoming[0].dueDate, '2026-11-30');
  assert.equal(upcoming[0].daysUntil, 1);
});

test('backup JSON round-trip conserva isPrivate y createdBy y migra copias antiguas', () => {
  const validBackup: NidoBackupV1 = {
    schemaVersion: 1,
    app: 'nido',
    exportedAt: '2026-11-18T10:00:00Z',
    householdName: 'Piso Sant Sadurní',
    settings: {
      splitMode: 'income',
      presetA: 55,
      presetB: 45,
      incomeA: 2200,
      incomeB: 1800,
      currency: 'EUR',
    },
    initialCosts: [],
    checklist: [],
    items: [],
    recurring: [],
    transactions: [
      {
        id: 'tx1',
        monthKey: '2026-11',
        concept: 'Alquiler',
        category: 'alquiler',
        amount: 850,
        date: '2026-11-01',
        paidBy: 'cuenta_comun',
        recurringId: null,
        splitPctA: 55,
        isSettlement: false,
        settlementTo: '',
        isPrivate: false,
        createdBy: 'uid_alex',
        notes: '',
      },
      {
        id: 'tx2_priv',
        monthKey: '2026-11',
        concept: 'Regalo pareja',
        category: 'ocio',
        amount: 75,
        date: '2026-11-14',
        paidBy: 'uid_alex',
        recurringId: null,
        splitPctA: 100,
        isSettlement: false,
        settlementTo: '',
        isPrivate: true,
        createdBy: 'uid_alex',
        notes: 'Privado',
      },
    ],
    budgets: [],
    monthClosures: [],
    goals: [],
    goalMovements: [],
  };

  const parsed = validateAndMigrateBackup(JSON.parse(JSON.stringify(validBackup)));
  assert.equal(parsed.transactions[0].amount, 850);
  assert.equal(parsed.transactions[0].isPrivate, false);
  assert.equal(parsed.transactions[1].isPrivate, true);
  assert.equal(parsed.transactions[1].createdBy, 'uid_alex');

  // Copia antigua sin isPrivate/createdBy + pagador 'comun' + splitPctA=0
  const legacyTx = {
    id: 'tx1',
    monthKey: '2026-11',
    concept: 'Alquiler',
    category: 'alquiler',
    amount: 850,
    date: '2026-11-01',
    paidBy: 'comun',
    recurringId: null,
    splitPctA: 0,
    isSettlement: false,
    settlementTo: '',
    notes: '',
  };
  const legacyBackup = validateAndMigrateBackup({
    ...validBackup,
    initialCosts: [
      {
        id: 'ic1',
        concept: 'Fianza',
        category: 'fianza',
        amount: 850,
        paidBy: 'comun',
        status: 'pendiente',
        dueDate: '',
        notes: '',
      },
    ],
    transactions: [legacyTx],
  });
  assert.equal(legacyBackup.initialCosts[0].paidBy, 'cuenta_comun');
  assert.equal(legacyBackup.transactions[0].paidBy, 'cuenta_comun');
  assert.equal(legacyBackup.transactions[0].splitPctA, 0);
  assert.equal(legacyBackup.transactions[0].isPrivate, false);
  assert.equal(legacyBackup.transactions[0].createdBy, '');

  // Settings with presetA + presetB != 100 must be rejected
  assert.throws(() =>
    validateAndMigrateBackup({
      ...validBackup,
      settings: { ...validBackup.settings, presetA: 60, presetB: 60 },
    })
  );

  assert.throws(() => validateAndMigrateBackup({ ...validBackup, schemaVersion: 99 }));
  assert.throws(() =>
    validateAndMigrateBackup({
      ...validBackup,
      transactions: [{ ...validBackup.transactions[0], amount: -10 }],
    })
  );

  const csv = generateSpanishCSV(['Concepto', 'Importe'], [['Café; té', 12.5]]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Café; té";12,50'));
});

test('formatCoupleBalanceSecondPerson usa displayName real para cada miembro y estado en paz', () => {
  const alexViewingB_owes_A = formatCoupleBalanceSecondPerson(
    {
      totalSpent: 100,
      personalTotalSpent: 100,
      paidA: 82,
      paidB: 18,
      paidComun: 0,
      shareA: 50,
      shareB: 50,
      balanceA: 32,
      owesDirection: 'b_owes_a',
      owesAmount: 32,
      summaryText: 'Marta debe 32,00 € a Alex',
    },
    memberA,
    memberA,
    memberB
  );
  assert.match(alexViewingB_owes_A, /^Marta te debe 32,00\s*€$/);

  const martaViewingB_owes_A = formatCoupleBalanceSecondPerson(
    {
      totalSpent: 100,
      personalTotalSpent: 100,
      paidA: 82,
      paidB: 18,
      paidComun: 0,
      shareA: 50,
      shareB: 50,
      balanceA: 32,
      owesDirection: 'b_owes_a',
      owesAmount: 32,
      summaryText: 'Marta debe 32,00 € a Alex',
    },
    memberB,
    memberA,
    memberB
  );
  assert.match(martaViewingB_owes_A, /^Le debes 32,00\s*€ a Alex$/);

  const alexViewingPeace = formatCoupleBalanceSecondPerson(
    {
      totalSpent: 100,
      personalTotalSpent: 100,
      paidA: 50,
      paidB: 50,
      paidComun: 0,
      shareA: 50,
      shareB: 50,
      balanceA: 0,
      owesDirection: 'peace',
      owesAmount: 0,
      summaryText: 'Estáis en paz',
    },
    memberA,
    memberA,
    memberB
  );
  assert.equal(alexViewingPeace, 'Estáis en paz');

  const soloMember = formatCoupleBalanceSecondPerson(
    {
      totalSpent: 0,
      personalTotalSpent: 0,
      paidA: 0,
      paidB: 0,
      paidComun: 0,
      shareA: 0,
      shareB: 0,
      balanceA: 0,
      owesDirection: 'peace',
      owesAmount: 0,
      summaryText: 'Estáis en paz',
    },
    memberA,
    memberA,
    undefined
  );
  assert.equal(soloMember, 'Aún no se ha unido nadie más al hogar');
});

test('DemoHouseholdRepository borrado masivo, conservación de splitPctA=0 y aislamiento de gastos personales', async () => {
  const repo = new DemoHouseholdRepository();
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };
  let latestAlexMonthIds: string[] = [];
  let latestMartaMonthIds: string[] = [];
  let latestFurnitureIds: string[] = [];
  let latestActivityCount = 0;
  let latestZeroTxSplit: number | undefined;

  const unsubTxAlex = repo.subscribeTransactionsByMonth(
    'demo_hogar_santsadurni',
    'demo_alex',
    '2026-11',
    (txs) => {
      latestAlexMonthIds = txs.map((t) => t.id);
      const found = txs.find((t) => t.concept === 'Prueba cero porciento');
      latestZeroTxSplit = found?.splitPctA;
    }
  );
  const unsubTxMarta = repo.subscribeTransactionsByMonth(
    'demo_hogar_santsadurni',
    'demo_marta',
    '2026-11',
    (txs) => {
      latestMartaMonthIds = txs.map((t) => t.id);
    }
  );
  const unsubActivity = repo.subscribeActivity('demo_hogar_santsadurni', 50, (acts) => {
    latestActivityCount = acts.length;
  });
  const unsubFur = repo.subscribeFurniture('demo_hogar_santsadurni', (items) => {
    latestFurnitureIds = items.map((i) => i.id);
  });

  const txId1 = await repo.upsertTransaction(
    'demo_hogar_santsadurni',
    {
      monthKey: '2026-11',
      concept: 'Prueba cero porciento',
      category: 'ocio',
      amount: 25,
      date: '2026-11-18',
      paidBy: 'demo_alex',
      recurringId: null,
      splitPctA: 0,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'demo_alex',
      notes: '',
    },
    actorAlex
  );
  assert.equal(latestZeroTxSplit, 0);

  const txId2 = await repo.upsertTransaction(
    'demo_hogar_santsadurni',
    {
      monthKey: '2026-11',
      concept: 'Otro gasto bulk',
      category: 'otros',
      amount: 10,
      date: '2026-11-18',
      paidBy: 'cuenta_comun',
      recurringId: null,
      splitPctA: 55,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'demo_alex',
      notes: '',
    },
    actorAlex
  );
  assert.ok(latestAlexMonthIds.includes(txId1) && latestAlexMonthIds.includes(txId2));

  // Gasto personal de Alex: visible para Alex, invisible para Marta, sin registrar actividad compartida
  const activityBeforePriv = latestActivityCount;
  const privAlexId = await repo.upsertTransaction(
    'demo_hogar_santsadurni',
    {
      monthKey: '2026-11',
      concept: 'Secreto Alex',
      category: 'ocio',
      amount: 90,
      date: '2026-11-18',
      paidBy: 'cuenta_comun', // debe normalizarse a demo_alex
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'demo_alex',
      notes: '',
    },
    actorAlex
  );
  assert.equal(latestActivityCount, activityBeforePriv);
  assert.ok(latestAlexMonthIds.includes(privAlexId));
  assert.ok(!latestMartaMonthIds.includes(privAlexId));
  let allAlex = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_alex');
  let allMarta = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_marta');
  assert.ok(allAlex.some((t) => t.id === privAlexId));
  assert.ok(!allMarta.some((t) => t.id === privAlexId));

  // Gasto personal de Marta: visible para Marta, invisible para Alex
  const privMartaId = await repo.upsertTransaction(
    'demo_hogar_santsadurni',
    {
      monthKey: '2026-11',
      concept: 'Secreto Marta',
      category: 'ocio',
      amount: 40,
      date: '2026-11-18',
      paidBy: 'demo_marta',
      recurringId: null,
      splitPctA: 0,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'demo_marta',
      notes: '',
    },
    actorMarta
  );
  allAlex = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_alex');
  allMarta = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_marta');
  assert.ok(allMarta.some((t) => t.id === privMartaId));
  assert.ok(!allAlex.some((t) => t.id === privMartaId));

  // Exportación excluye gastos privados del otro miembro
  const exportAlex = await repo.exportBackup('demo_hogar_santsadurni', 'demo_alex');
  assert.ok(exportAlex.transactions.some((t) => t.id === privAlexId));
  assert.ok(!exportAlex.transactions.some((t) => t.id === privMartaId));

  const exportMarta = await repo.exportBackup('demo_hogar_santsadurni', 'demo_marta');
  assert.ok(exportMarta.transactions.some((t) => t.id === privMartaId));
  assert.ok(!exportMarta.transactions.some((t) => t.id === privAlexId));

  // Importación de Alex NO borra el gasto personal de Marta
  await repo.importBackup('demo_hogar_santsadurni', exportAlex, actorAlex);
  allAlex = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_alex');
  allMarta = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_marta');
  assert.ok(allMarta.some((t) => t.id === privMartaId));
  assert.ok(!allAlex.some((t) => t.id === privMartaId));

  // Borrado privado de Alex no genera actividad compartida
  const activityBeforePrivDelete = latestActivityCount;
  await repo.deleteTransaction('demo_hogar_santsadurni', privAlexId, 'Secreto Alex', actorAlex, {
    isPrivate: true,
  });
  assert.equal(latestActivityCount, activityBeforePrivDelete);
  allAlex = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_alex');
  assert.ok(!allAlex.some((t) => t.id === privAlexId));

  await repo.deleteTransactionsBulk(
    'demo_hogar_santsadurni',
    [
      { id: txId1, concept: 'Prueba cero porciento' },
      { id: txId2, concept: 'Otro gasto bulk' },
    ],
    actorAlex
  );
  assert.ok(!latestAlexMonthIds.includes(txId1) && !latestAlexMonthIds.includes(txId2));

  const fId1 = await repo.upsertFurnitureItem(
    'demo_hogar_santsadurni',
    {
      name: 'Taburete bulk 1',
      room: 'cocina',
      priority: 'algun_dia',
      status: 'pendiente',
      store: 'IKEA',
      productUrl: '',
      articleNumber: '',
      unitPrice: 15,
      qty: 1,
      notes: '',
    },
    actorAlex
  );
  const fId2 = await repo.upsertFurnitureItem(
    'demo_hogar_santsadurni',
    {
      name: 'Taburete bulk 2',
      room: 'cocina',
      priority: 'algun_dia',
      status: 'pendiente',
      store: 'IKEA',
      productUrl: '',
      articleNumber: '',
      unitPrice: 15,
      qty: 1,
      notes: '',
    },
    actorAlex
  );
  assert.ok(latestFurnitureIds.includes(fId1) && latestFurnitureIds.includes(fId2));

  await repo.deleteFurnitureItemsBulk(
    'demo_hogar_santsadurni',
    [
      { id: fId1, name: 'Taburete bulk 1' },
      { id: fId2, name: 'Taburete bulk 2' },
    ],
    actorAlex
  );
  assert.ok(!latestFurnitureIds.includes(fId1) && !latestFurnitureIds.includes(fId2));

  unsubTxAlex();
  unsubTxMarta();
  unsubActivity();
  unsubFur();
});

test('A1. Deshacer exacto (restoreTransaction y restoreInitialCost) conserva createdBy, createdAt, isPrivate y splitPctA', async () => {
  const repo = new DemoHouseholdRepository();
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };

  let monthTxs: Transaction[] = [];
  let initialCostsCount = 0;
  let activityCount = 0;
  const unsubTx = repo.subscribeTransactionsByMonth('demo_hogar_santsadurni', 'demo_alex', '2026-11', (txs) => {
    monthTxs = txs;
  });
  const unsubIc = repo.subscribeInitialCosts('demo_hogar_santsadurni', (ics) => {
    initialCostsCount = ics.length;
  });
  const unsubAct = repo.subscribeActivity('demo_hogar_santsadurni', 50, (acts) => {
    activityCount = acts.length;
  });

  // 1) Gasto compartido creado por Alex con splitPctA=0, borrado por Marta y restaurado por Marta
  const originalTx: Transaction = {
    id: 'tx_restore_shared',
    monthKey: '2026-11',
    concept: 'Cena cumpleaños pareja',
    category: 'ocio',
    amount: 72,
    date: '2026-11-10',
    paidBy: 'demo_alex',
    recurringId: null,
    splitPctA: 0,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'demo_alex',
    notes: 'Original note',
    createdAt: '2026-11-10T18:00:00.000Z',
    updatedAt: '2026-11-10T18:00:00.000Z',
  };
  await repo.restoreTransaction('demo_hogar_santsadurni', originalTx, actorAlex);
  await repo.deleteTransaction('demo_hogar_santsadurni', originalTx.id, originalTx.concept, actorMarta, {
    isPrivate: false,
  });
  assert.ok(!monthTxs.some((t) => t.id === originalTx.id));

  await repo.restoreTransaction('demo_hogar_santsadurni', originalTx, actorMarta);
  const restoredShared = monthTxs.find((t) => t.id === originalTx.id);
  assert.ok(restoredShared);
  assert.equal(restoredShared.createdBy, 'demo_alex');
  assert.equal(restoredShared.createdAt, '2026-11-10T18:00:00.000Z');
  assert.equal(restoredShared.splitPctA, 0);
  assert.equal(restoredShared.isPrivate, false);
  assert.equal(restoredShared.paidBy, 'demo_alex');

  // 2) Gasto privado restaurado por su autor NO registra actividad compartida y conserva fecha original
  const privTx: Transaction = {
    ...originalTx,
    id: 'tx_restore_priv',
    concept: 'Capricho privado',
    isPrivate: true,
    splitPctA: 100,
    createdAt: '2026-11-02T09:15:00.000Z',
  };
  const actBeforePriv = activityCount;
  await repo.restoreTransaction('demo_hogar_santsadurni', privTx, actorAlex);
  assert.equal(activityCount, actBeforePriv);
  const restoredPriv = monthTxs.find((t) => t.id === privTx.id);
  assert.ok(restoredPriv);
  assert.equal(restoredPriv.isPrivate, true);
  assert.equal(restoredPriv.createdBy, 'demo_alex');
  assert.equal(restoredPriv.createdAt, '2026-11-02T09:15:00.000Z');

  // 3) Gasto inicial restaurado conserva createdAt original
  const icBefore = initialCostsCount;
  await repo.restoreInitialCost(
    'demo_hogar_santsadurni',
    {
      id: 'ic_restore_1',
      concept: 'Copia llaves',
      category: 'cerrajeria',
      amount: 24,
      paidBy: 'demo_marta',
      status: 'pagado',
      dueDate: '2026-11-05',
      notes: '2 juegos',
      createdAt: '2026-11-05T11:00:00.000Z',
      updatedAt: '2026-11-05T11:00:00.000Z',
    },
    actorMarta
  );
  assert.equal(initialCostsCount, icBefore + 1);

  unsubTx();
  unsubIc();
  unsubAct();
});

test('7 y 8. computeSavingsCapacity realista (3 meses históricos / fallback presupuestos variables) y sugerencias frente a capacidad', () => {
  const settings: HouseholdSettings = {
    splitMode: 'income',
    presetA: 60,
    presetB: 40,
    incomeA: 2100,
    incomeB: 1500,
    currency: 'EUR',
  };
  const recs: RecurringExpense[] = [
    {
      id: 'r1',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 900,
      frequency: 'mensual',
      dayOfMonth: 1,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r2',
      concept: 'Seguro anual',
      category: 'seguros',
      amount: 360,
      frequency: 'anual',
      dayOfMonth: 15,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r3_off',
      concept: 'Gimnasio pausado',
      category: 'suscripciones',
      amount: 50,
      frequency: 'mensual',
      dayOfMonth: 5,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  // 1) Sin histórico ni presupuestos: fijos = 900 + 30 = 930; capacidad = 3600 - 930 = 2670
  const capNoHist = computeSavingsCapacity(settings, recs, {
    currentMonthKey: '2026-11',
    transactions: [],
    monthClosures: [],
    budget: null,
  });
  assert.equal(capNoHist.totalIncome, 3600);
  assert.equal(capNoHist.activeFixedMonthly, 930);
  assert.equal(capNoHist.hasHistory, false);
  assert.equal(capNoHist.habitualSpend, 930);
  assert.equal(capNoHist.variableMonthly, 0);
  assert.equal(capNoHist.capacity, 2670);

  // 2) Sin histórico, CON presupuestos de categorías variables (supermercado, ocio, transporte, otros)
  // Fijos = 930 + variables (350 + 120 + 80 + 50 = 600) = 1530 => capacidad = 3600 - 1530 = 2070
  const capBudgetFallback = computeSavingsCapacity(settings, recs, {
    currentMonthKey: '2026-11',
    transactions: [makeTx({ id: 'cur_1', monthKey: '2026-11', amount: 300 })],
    monthClosures: [],
    budget: {
      monthKey: '2026-11',
      limits: { alquiler: 900, luz: 70, supermercado: 350, ocio: 120, transporte: 80, otros: 50 },
      updatedAt: '',
    },
  });
  assert.equal(capBudgetFallback.hasHistory, false);
  assert.equal(capBudgetFallback.fixedMonthly, 930);
  assert.equal(capBudgetFallback.variableMonthly, 600);
  assert.equal(capBudgetFallback.habitualSpend, 1530);
  assert.equal(capBudgetFallback.capacity, 2070);

  // 3) Con histórico de 3 últimos meses (excluye mes en curso 2026-11, privados, liquidaciones y meses más antiguos)
  const histTxs: Transaction[] = [
    makeTx({ id: 'm_cur', monthKey: '2026-11', amount: 400 }),
    makeTx({ id: 'm10_1', monthKey: '2026-10', amount: 1300 }),
    makeTx({ id: 'm10_priv', monthKey: '2026-10', amount: 500, isPrivate: true }),
    makeTx({ id: 'm10_set', monthKey: '2026-10', amount: 200, isSettlement: true, category: 'liquidacion' }),
    makeTx({ id: 'm09_1', monthKey: '2026-09', amount: 1100 }),
    makeTx({ id: 'm08_1', monthKey: '2026-08', amount: 1200 }),
    makeTx({ id: 'm07_old', monthKey: '2026-07', amount: 4000 }), // 4º mes anterior: ignorado
  ];
  // Media últimos 3 meses = (1300 + 1100 + 1200) / 3 = 1200; habitual = max(930, 1200) = 1200 (fijos 930 + variables 270)
  const capWithHist = computeSavingsCapacity(settings, recs, {
    currentMonthKey: '2026-11',
    transactions: histTxs,
    monthClosures: [],
    budget: { monthKey: '2026-11', limits: { supermercado: 350 }, updatedAt: '' },
  });
  assert.equal(capWithHist.hasHistory, true);
  assert.equal(capWithHist.historyMonthsUsed, 3);
  assert.equal(capWithHist.historyAvg3Months, 1200);
  assert.equal(capWithHist.habitualSpend, 1200);
  assert.equal(capWithHist.fixedMonthly, 930);
  assert.equal(capWithHist.variableMonthly, 270);
  assert.equal(capWithHist.capacity, 2400);

  // 4) Si fijos activos > media histórica, prevalecen los fijos activos (variables = 0)
  const capFixedDominates = computeSavingsCapacity(settings, recs, {
    currentMonthKey: '2026-11',
    transactions: [makeTx({ id: 'm10_low', monthKey: '2026-10', amount: 700 })],
  });
  assert.equal(capFixedDominates.habitualSpend, 930);
  assert.equal(capFixedDominates.variableMonthly, 0);
  assert.equal(capFixedDominates.capacity, 2670);

  // 5) Metas cuyas sugerencias superan la nueva capacidad realista
  const lowCap = computeSavingsCapacity({ ...settings, incomeA: 1450, incomeB: 0 }, recs, {
    currentMonthKey: '2026-11',
    transactions: histTxs, // gasto habitual 1200 => capacidad realista = 250 € (vs 520 € con solo fijos)
  });
  assert.equal(lowCap.capacity, 250);

  const g1: SavingsGoal = {
    id: 'g_viaje',
    name: 'Viaje Japón',
    icon: 'plane',
    color: '#0284C7',
    targetAmount: 1200,
    targetDate: '2027-05-18',
    type: 'viajes',
    archived: false,
    createdAt: '',
    updatedAt: '',
  };
  const g2: SavingsGoal = {
    id: 'g_colchon',
    name: 'Colchón',
    icon: 'shield',
    color: '#0E5A64',
    targetAmount: 600,
    targetDate: '2027-02-18',
    type: 'emergencia',
    archived: false,
    createdAt: '',
    updatedAt: '',
  };
  const p1 = computeGoalProgress(g1, [], '2026-11-18'); // 6 meses => 200 €/mes
  const p2 = computeGoalProgress(g2, [], '2026-11-18'); // 3 meses => 200 €/mes
  const sumSuggested = (p1.monthlyNeeded ?? 0) + (p2.monthlyNeeded ?? 0);
  assert.equal(sumSuggested, 400);
  assert.ok(sumSuggested > lowCap.capacity);
});

test('9 y 10. deleteGoalWithMovements sin huérfanos, archivado y lista de la compra sin log de actividad', async () => {
  const repo = new DemoHouseholdRepository();
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  let goals: SavingsGoal[] = [];
  let movements: GoalMovement[] = [];
  let shoppingIds: string[] = [];
  let activityCount = 0;

  const uG = repo.subscribeGoals('demo_hogar_santsadurni', (g) => {
    goals = g;
  });
  const uM = repo.subscribeGoalMovements('demo_hogar_santsadurni', (m) => {
    movements = m;
  });
  const uS = repo.subscribeShopping('demo_hogar_santsadurni', (s) => {
    shoppingIds = s.map((item) => item.id);
  });
  const uA = repo.subscribeActivity('demo_hogar_santsadurni', 50, (a) => {
    activityCount = a.length;
  });

  // Crear meta + 2 movimientos asociados y borrar todo junto (0 huérfanos)
  const gId = await repo.upsertGoal(
    'demo_hogar_santsadurni',
    {
      name: 'Meta temporal',
      icon: 'piggy-bank',
      color: '#0E5A64',
      targetAmount: 500,
      targetDate: '',
      type: 'custom',
      archived: false,
    },
    actorAlex
  );
  await repo.addGoalMovement(
    'demo_hogar_santsadurni',
    { goalId: gId, amount: 120, by: 'demo_alex', date: '2026-11-18', note: 'Aporte 1' },
    'Meta temporal',
    actorAlex
  );
  await repo.addGoalMovement(
    'demo_hogar_santsadurni',
    { goalId: gId, amount: 80, by: 'demo_marta', date: '2026-11-18', note: 'Aporte 2' },
    'Meta temporal',
    actorAlex
  );
  assert.equal(movements.filter((m) => m.goalId === gId).length, 2);

  await repo.deleteGoalWithMovements('demo_hogar_santsadurni', gId, 'Meta temporal', actorAlex);
  assert.ok(!goals.some((g) => g.id === gId));
  assert.equal(movements.filter((m) => m.goalId === gId).length, 0);

  // Shopping list: CRUD y borrado masivo SIN escribir entradas en activity
  const actBeforeShop = activityCount;
  const s1 = await repo.upsertShoppingItem(
    'demo_hogar_santsadurni',
    { text: 'Leche entera', qty: 2, done: false },
    actorAlex
  );
  const s2 = await repo.upsertShoppingItem(
    'demo_hogar_santsadurni',
    { text: 'Pan integral', qty: 1, done: true },
    actorAlex
  );
  assert.ok(shoppingIds.includes(s1) && shoppingIds.includes(s2));
  assert.equal(activityCount, actBeforeShop);

  await repo.deleteShoppingItemsBulk('demo_hogar_santsadurni', [s1, s2]);
  assert.ok(!shoppingIds.includes(s1) && !shoppingIds.includes(s2));
  assert.equal(activityCount, actBeforeShop);

  uG();
  uM();
  uS();
  uA();
});

test('11. Importación bancaria CSV: separador, decimales españoles, duplicados, palabras clave e importación privada', async () => {
  const csvSample = [
    'Fecha operación;Concepto;Importe',
    '15/11/2026;COMPRA MERCADONA SANT SADURNI;-64,35 €',
    '16/11/2026;NOMINA EMPRESA;2.100,00',
    '17/11/2026;FACTURA ENDESA LUZ;(78,90)',
    '15/11/2026;COMPRA MERCADONA SANT SADURNI;-64,35',
  ].join('\n');

  const delimiter = detectCsvDelimiter(csvSample);
  assert.equal(delimiter, ';');

  const matrix = parseCsvMatrix(csvSample, delimiter);
  assert.equal(matrix.length, 5);

  const mapping = guessCsvColumns(matrix[0]);
  assert.deepEqual(mapping, { dateIndex: 0, conceptIndex: 1, amountIndex: 2 });

  assert.equal(parseBankDateToISO('15/11/2026'), '2026-11-15');
  assert.equal(parseBankDateToISO('2026-11-17'), '2026-11-17');
  assert.equal(parseBankAmount('-64,35 €'), -64.35);
  assert.equal(parseBankAmount('2.100,00'), 2100);
  assert.equal(parseBankAmount('(78,90)'), -78.9);

  const existing: Transaction[] = [
    makeTx({
      id: 'existing_1',
      date: '2026-11-17',
      amount: 78.9,
      concept: 'FACTURA ENDESA LUZ',
    }),
  ];
  const rows = buildParsedBankRows(matrix.slice(1), mapping, existing, {
    supermercado: 'mercadona, bonpreu',
    luz: 'endesa',
  });

  assert.equal(rows[0].dateISO, '2026-11-15');
  assert.equal(rows[0].absAmount, 64.35);
  assert.equal(rows[0].isIncome, false);
  assert.equal(rows[0].isDuplicate, false);
  assert.equal(rows[0].suggestedCategory, 'supermercado');

  // Ingreso positivo detectado
  assert.equal(rows[1].isIncome, true);
  assert.equal(rows[1].absAmount, 2100);

  // Duplicado contra existente en el hogar
  assert.equal(rows[2].isDuplicate, true);
  assert.equal(rows[2].suggestedCategory, 'luz');

  // Duplicado dentro del propio CSV (fila 3 repite fila 0)
  assert.equal(rows[3].isDuplicate, true);

  // Palabra clave personalizada
  assert.equal(matchCategoryFromKeywords('Tienda especial Nido', { ocio: 'especial nido' }), 'ocio');

  // Repositorio demo: actualizar palabras clave + importar fila privada sin activity
  const repo = new DemoHouseholdRepository();
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  let actCount = 0;
  const uA = repo.subscribeActivity('demo_hogar_santsadurni', 50, (a) => {
    actCount = a.length;
  });

  await repo.updateCsvKeywords('demo_hogar_santsadurni', { supermercado: 'mercadona, caprabo' });
  const beforePrivImport = actCount;
  const importedPrivCount = await repo.importBankTransactions(
    'demo_hogar_santsadurni',
    [
      {
        monthKey: '2026-11',
        concept: 'Movimiento privado CSV',
        category: 'ocio',
        amount: 22.5,
        date: '2026-11-18',
        paidBy: 'demo_alex',
        splitPctA: 100,
        isPrivate: true,
        notes: 'Importado CSV',
      },
    ],
    actorAlex
  );
  assert.equal(importedPrivCount, 1);
  assert.equal(actCount, beforePrivImport);
  const allAlex = await repo.fetchAllTransactions('demo_hogar_santsadurni', 'demo_alex');
  assert.ok(allAlex.some((t) => t.concept === 'Movimiento privado CSV' && t.isPrivate));
  uA();
});

test('12. Catálogo de gastos habituales: siembra en hogar nuevo, idempotencia, no recrear borrados y efecto financiero cero si inactivos/0 €', async () => {
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'uid_alex', displayName: 'Alex', photoURL: '' };

  let currentHousehold: Household | null = null;
  let recurringList: RecurringExpense[] = [];
  let txs: Transaction[] = [];

  const uH = repo.subscribeHousehold('unused', (h) => {
    currentHousehold = h;
  });
  const uR = repo.subscribeRecurring('unused', (r) => {
    recurringList = r;
  });
  const uT = repo.subscribeTransactionsByMonth('unused', 'uid_alex', '2026-11', (list) => {
    txs = list;
  });

  // 1) Crear hogar nuevo siembra automáticamente las 12 plantillas del catálogo a 0 € e inactivas, sin transacciones
  const hid = await repo.createHousehold(actor, 'Piso Nuevo');
  assert.equal(recurringList.length, RECURRING_CATALOG_PRESETS.length);
  assert.equal(RECURRING_CATALOG_PRESETS.length, 12);
  assert.equal(txs.length, 0);
  const householdSnap = currentHousehold as Household | null;
  assert.equal(householdSnap?.seedPending, false);
  assert.equal(householdSnap?.recurringSeedVersion, RECURRING_CATALOG_SEED_VERSION);
  assert.equal(repo.hasPendingDefaultSeed(), false);

  for (const rec of recurringList) {
    assert.equal(rec.amount, 0);
    assert.equal(rec.active, false);
    assert.equal(rec.paidByDefault, COMMON_ACCOUNT_ID);
    assert.equal(rec.splitOverride, null);
    assert.equal(isRecurringTemplatePending(rec), true);
  }

  // 2) Impacto financiero cero mientras estén inactivas / a 0 € (y también si alguna activa tuviera amount=0)
  const sampleSettings: HouseholdSettings = {
    splitMode: 'preset',
    presetA: 50,
    presetB: 50,
    incomeA: 2200,
    incomeB: 1800,
    currency: 'EUR',
  };
  const recurringPlusActiveZero: RecurringExpense[] = [
    ...recurringList,
    {
      ...recurringList[0],
      id: 'rec_active_zero_guard',
      amount: 0,
      active: true,
    },
  ];
  assert.equal(findMissingRecurringForMonth(recurringPlusActiveZero, [], '2026-11').length, 0);
  assert.equal(getUpcomingCharges(recurringPlusActiveZero, '2026-11-01', 10).length, 0);
  assert.equal(getUpcomingChargesWithinDays(recurringPlusActiveZero, '2026-11-01', 31, []).length, 0);
  assert.equal(computeEmergencyTarget(recurringPlusActiveZero, 3), 0);
  const capEmpty = computeSavingsCapacity(sampleSettings, recurringPlusActiveZero);
  assert.equal(capEmpty.activeFixedMonthly, 0);
  assert.equal(capEmpty.capacity, 4000);

  // 3) Configurar Alquiler (850 €, activo) y dejar Comunidad inactiva
  const alquilerSeed = recurringList.find((r) => r.id === 'seed_rec_alquiler')!;
  const comunidadSeed = recurringList.find((r) => r.id === 'seed_rec_comunidad')!;
  await repo.upsertRecurring(
    hid,
    {
      ...alquilerSeed,
      amount: 850,
      active: true,
      dayOfMonth: 5,
    },
    actor
  );

  // Impacto financiero real tras activar Alquiler
  assert.equal(findMissingRecurringForMonth(recurringList, [], '2026-11').length, 1);
  assert.equal(getUpcomingCharges(recurringList, '2026-11-03', 3).length, 1);
  assert.equal(getUpcomingChargesWithinDays(recurringList, '2026-11-03', 3, []).length, 1);
  assert.equal(computeEmergencyTarget(recurringList, 3), 2550);
  const capWithRent = computeSavingsCapacity(sampleSettings, recurringList);
  assert.equal(capWithRent.activeFixedMonthly, 850);
  assert.equal(capWithRent.capacity, 3150);

  // 4) Reintentar seedDefaultLists NO duplica ni sobrescribe Alquiler ni reactiva inactivas
  const addedOnRetry = await repo.seedDefaultLists(hid, actor);
  assert.equal(addedOnRetry, 0);
  assert.equal(recurringList.length, 12);
  const alquilerAfterRetry = recurringList.find((r) => r.id === 'seed_rec_alquiler')!;
  assert.equal(alquilerAfterRetry.amount, 850);
  assert.equal(alquilerAfterRetry.active, true);

  // 5) Eliminar voluntariamente Comunidad y reintentar seedDefaultLists NO la recrea
  await repo.deleteRecurring(hid, comunidadSeed.id, comunidadSeed.concept, actor);
  assert.equal(recurringList.length, 11);
  await repo.seedDefaultLists(hid, actor);
  assert.equal(recurringList.length, 11);
  assert.ok(!recurringList.some((r) => r.id === 'seed_rec_comunidad'));

  // 6) En un hogar ya existente, addHabitualRecurringTemplates conserva las configuradas y solo añade las que faltan
  const existingRepo = new DemoHouseholdRepository();
  let existingRecs: RecurringExpense[] = [];
  const uER = existingRepo.subscribeRecurring('demo_hogar_santsadurni', (r) => {
    existingRecs = r;
  });
  // En Sant Sadurní ya existe "Alquiler piso" (alias de alquiler) y "Electricidad" (luz)
  const rentPreset = RECURRING_CATALOG_PRESETS.find((p) => p.id === 'seed_rec_alquiler')!;
  const lightPreset = RECURRING_CATALOG_PRESETS.find((p) => p.id === 'seed_rec_electricidad')!;
  const waterPreset = RECURRING_CATALOG_PRESETS.find((p) => p.id === 'seed_rec_agua')!;
  const musicPreset = RECURRING_CATALOG_PRESETS.find((p) => p.id === 'seed_rec_musica')!;
  const cloudPreset = RECURRING_CATALOG_PRESETS.find((p) => p.id === 'seed_rec_nube')!;

  assert.ok(findMatchingRecurringForPreset(rentPreset, existingRecs));
  assert.ok(findMatchingRecurringForPreset(lightPreset, existingRecs));
  assert.ok(findMatchingRecurringForPreset(waterPreset, existingRecs));
  assert.equal(findMatchingRecurringForPreset(musicPreset, existingRecs), undefined);

  const countBefore = existingRecs.length;
  const addedHabitual = await existingRepo.addHabitualRecurringTemplates(
    'demo_hogar_santsadurni',
    [rentPreset, lightPreset, musicPreset, cloudPreset],
    actor
  );
  assert.equal(addedHabitual, 2);
  assert.equal(existingRecs.length, countBefore + 2);
  const existingRent = existingRecs.find((r) => r.id === 'rec_rent')!;
  assert.equal(existingRent.amount, 850);
  assert.equal(existingRent.active, true);
  const addedMusic = existingRecs.find((r) => r.id === 'seed_rec_musica')!;
  assert.equal(addedMusic.amount, 0);
  assert.equal(addedMusic.active, false);

  // 7) Partidas variables son orientativas: ninguna pertenece al catálogo periódico y los items de "otros" comparten categoría
  const otrosVar = VARIABLE_BUDGET_SUGGESTIONS.filter((v) => v.category === 'otros');
  assert.equal(otrosVar.length, 5);
  assert.ok(
    VARIABLE_BUDGET_SUGGESTIONS.every(
      (v) => !RECURRING_CATALOG_PRESETS.some((p) => p.id === v.id)
    )
  );
  // El cálculo de saldo con lista de gastos vacía y 12 plantillas a 0 € sigue en paz (0 €)
  const emptyBal = calculateCoupleBalance([], memberA, memberB);
  assert.equal(emptyBal.totalSpent, 0);
  assert.equal(emptyBal.owesDirection, 'peace');

  uER();
  uH();
  uR();
  uT();
});

test('13. Presupuesto vs real (computeBudgetProgress): fijos dentro de límite en verde, superados en rojo y mixtos/variables en ámbar', () => {
  const txs: Transaction[] = [
    makeTx({ id: 'p_rent', category: 'alquiler', amount: 850, recurringId: 'rec_rent' }),
    makeTx({ id: 'p_net', category: 'internet', amount: 48, recurringId: 'rec_net' }),
    makeTx({ id: 'p_ins', category: 'seguros', amount: 105, recurringId: 'rec_ins' }),
    makeTx({ id: 'p_luz_r', category: 'luz', amount: 60, recurringId: 'rec_luz' }),
    makeTx({ id: 'p_luz_m', category: 'luz', amount: 25, recurringId: null }),
    makeTx({ id: 'p_super', category: 'supermercado', amount: 340, recurringId: null }),
    makeTx({ id: 'p_priv_rent', category: 'alquiler', amount: 200, isPrivate: true, createdBy: 'uid_alex' }),
  ];

  const progress = computeBudgetProgress(txs, {
    monthKey: '2026-11',
    limits: {
      alquiler: 850,
      internet: 50,
      seguros: 100,
      luz: 100,
      supermercado: 400,
    },
    updatedAt: '',
  });

  const byCat = Object.fromEntries(progress.map((row) => [row.category, row]));
  assert.equal(byCat.alquiler.spent, 850);
  assert.equal(byCat.alquiler.pct, 100);
  assert.equal(byCat.alquiler.isRecurringOnly, true);
  assert.equal(byCat.alquiler.status, 'verde');

  assert.equal(byCat.internet.spent, 48);
  assert.equal(byCat.internet.pct, 96);
  assert.equal(byCat.internet.isRecurringOnly, true);
  assert.equal(byCat.internet.status, 'verde');

  assert.equal(byCat.seguros.spent, 105);
  assert.equal(byCat.seguros.pct, 105);
  assert.equal(byCat.seguros.isRecurringOnly, true);
  assert.equal(byCat.seguros.status, 'rojo');

  assert.equal(byCat.luz.spent, 85);
  assert.equal(byCat.luz.pct, 85);
  assert.equal(byCat.luz.isRecurringOnly, false);
  assert.equal(byCat.luz.status, 'ambar');

  assert.equal(byCat.supermercado.spent, 340);
  assert.equal(byCat.supermercado.pct, 85);
  assert.equal(byCat.supermercado.isRecurringOnly, false);
  assert.equal(byCat.supermercado.status, 'ambar');
});

test('14. Fase 1: motor unificado de recurrencias (startMonth, bisiestos/días 29-31, legado sin ancla y anti-duplicados)', async () => {
  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'r_base',
    concept: 'Plantilla',
    category: 'otros',
    amount: 100,
    frequency: 'mensual',
    dayOfMonth: 1,
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  // 1) Anual anclada a octubre -> solo vence en octubre (no enero)
  const anualOct = mkRec({
    id: 'r_oct',
    concept: 'IBI / Seguro anual',
    category: 'seguros',
    amount: 240,
    frequency: 'anual',
    dayOfMonth: 15,
    startMonth: '2026-10',
  });
  assert.equal(isRecurringDueInMonth(anualOct, '2026-09'), false);
  assert.equal(isRecurringDueInMonth(anualOct, '2026-10'), true);
  assert.equal(isRecurringDueInMonth(anualOct, '2026-11'), false);
  assert.equal(isRecurringDueInMonth(anualOct, '2027-01'), false);
  assert.equal(isRecurringDueInMonth(anualOct, '2027-10'), true);
  assert.equal(getNextRecurringDueDate(anualOct, '2026-11-01', 12), '2027-10-15');
  assert.equal(getNextRecurringDueDate(anualOct, '2026-10-10', 12), '2026-10-15');

  // 2) Bimestral con salto de año (2026-12 -> 2027-02 -> 2027-04) y día 31 en febrero bisiesto vs no bisiesto
  const bimFinMes = mkRec({
    id: 'r_bim31',
    concept: 'Agua bimestral',
    category: 'agua',
    amount: 55,
    frequency: 'bimestral',
    dayOfMonth: 31,
    startMonth: '2024-02',
  });
  assert.equal(isRecurringDueInMonth(bimFinMes, '2024-02'), true);
  assert.equal(isRecurringDueInMonth(bimFinMes, '2024-03'), false);
  assert.equal(isRecurringDueInMonth(bimFinMes, '2024-04'), true);
  assert.equal(isRecurringDueInMonth(bimFinMes, '2026-12'), true);
  assert.equal(isRecurringDueInMonth(bimFinMes, '2027-01'), false);
  assert.equal(isRecurringDueInMonth(bimFinMes, '2027-02'), true);

  assert.equal(getRecurringDueDateForMonth(bimFinMes, '2024-02'), '2024-02-29'); // bisiesto
  assert.equal(getRecurringDueDateForMonth(bimFinMes, '2025-02'), '2025-02-28'); // no bisiesto
  assert.equal(getRecurringDueDateForMonth(bimFinMes, '2026-04'), '2026-04-30'); // 30 días

  // 3) Trimestral (2026-11 -> 2027-02 -> 2027-05)
  const trim = mkRec({
    id: 'r_trim',
    frequency: 'trimestral',
    dayOfMonth: 29,
    startMonth: '2026-11',
  });
  assert.equal(isRecurringDueInMonth(trim, '2026-11'), true);
  assert.equal(isRecurringDueInMonth(trim, '2026-12'), false);
  assert.equal(isRecurringDueInMonth(trim, '2027-02'), true);
  assert.equal(getRecurringDueDateForMonth(trim, '2027-02'), '2027-02-28');

  // 4) Inactiva o importe 0 nunca vence
  assert.equal(isRecurringDueInMonth(mkRec({ active: false }), '2026-11'), false);
  assert.equal(isRecurringDueInMonth(mkRec({ amount: 0 }), '2026-11'), false);

  // 5) Plantilla periódica heredada sin startMonth se marca pendiente de confirmar y NO inventa fecha
  const legacyNoStart = mkRec({
    id: 'r_legacy_anual',
    frequency: 'anual',
    startMonth: '',
    active: true,
  });
  assert.equal(isRecurringMissingStartMonth(legacyNoStart), true);
  assert.equal(isRecurringDueInMonth(legacyNoStart, '2026-11'), false);
  assert.equal(getNextRecurringDueDate(legacyNoStart, '2026-11-01', 12), null);

  // 6) ID determinista siempre cumple ^[a-zA-Z0-9_-]{1,128}$ incluso con IDs largos o especiales
  const det1 = buildDeterministicRecurringTxId('2026-11', 'seed_rec_alquiler');
  assert.match(det1, /^[a-zA-Z0-9_-]{1,128}$/);
  const longRecId = 'rec_' + 'x'.repeat(200) + ' áéí';
  const detLong = buildDeterministicRecurringTxId('2026-11', longRecId);
  assert.match(detLong, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.equal(detLong, buildDeterministicRecurringTxId('2026-11', longRecId));

  // 7) Concurrencia / doble clic en generateMonthTransactions no crea duplicados
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  let txsInDec: Transaction[] = [];
  const uT = repo.subscribeTransactionsByMonth('demo_hogar_santsadurni', 'demo_alex', '2027-02', (list) => {
    txsInDec = list;
  });
  const missingFeb = [
    mkRec({ id: 'rec_conc_1', concept: 'Alquiler conc', category: 'alquiler', amount: 850, frequency: 'mensual', dayOfMonth: 1 }),
    mkRec({ id: 'rec_conc_2', concept: 'Luz conc', category: 'luz', amount: 65, frequency: 'mensual', dayOfMonth: 10 }),
  ];
  const [c1, c2] = await Promise.all([
    repo.generateMonthTransactions('demo_hogar_santsadurni', '2027-02', missingFeb, 55, actor),
    repo.generateMonthTransactions('demo_hogar_santsadurni', '2027-02', missingFeb, 55, actor),
  ]);
  assert.equal(c1 + c2, 2);
  assert.equal(txsInDec.filter((t) => t.recurringId === 'rec_conc_1').length, 1);
  assert.equal(txsInDec.filter((t) => t.recurringId === 'rec_conc_2').length, 1);
  uT();

  // 8) Backup JSON conserva startMonth y rechaza startMonth inválido
  const sampleBackup: NidoBackupV1 = {
    schemaVersion: 1,
    app: 'nido',
    exportedAt: '2026-11-18T10:00:00Z',
    householdName: 'Piso',
    settings: { splitMode: 'preset', presetA: 50, presetB: 50, incomeA: 0, incomeB: 0, currency: 'EUR' },
    initialCosts: [],
    checklist: [],
    items: [],
    recurring: [
      {
        id: 'r_b1',
        concept: 'Seguro',
        category: 'seguros',
        amount: 200,
        frequency: 'anual',
        dayOfMonth: 10,
        startMonth: '2026-10',
        splitOverride: null,
        paidByDefault: COMMON_ACCOUNT_ID,
        active: true,
      },
    ],
    transactions: [],
    budgets: [],
    monthClosures: [],
    goals: [],
    goalMovements: [],
  };
  const parsedB = validateAndMigrateBackup(JSON.parse(JSON.stringify(sampleBackup)));
  assert.equal(parsedB.recurring[0].startMonth, '2026-10');
  assert.throws(() =>
    validateAndMigrateBackup({
      ...sampleBackup,
      recurring: [{ ...sampleBackup.recurring[0], startMonth: '2026-99-01' }],
    })
  );
});

test('15. Fase 2: calendario mensual (lunes-domingo, previstos vs registrados, futuro y legado) y paleta compartida', async () => {
  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'r_cal',
    concept: 'Plantilla',
    category: 'otros',
    amount: 100,
    frequency: 'mensual',
    dayOfMonth: 1,
    startMonth: '2026-01',
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  // Noviembre 2026 empieza en domingo (01/11/2026) -> 6 celdas vacías al principio en cuadrícula Lun-Dom
  // Febrero 2024 (bisiesto): 29 días, empieza en jueves -> 3 celdas vacías
  const feb2024 = buildMonthCalendarGrid('2024-02', [], [], '2024-02-10');
  assert.equal(feb2024.leadingEmptyCells, 3);
  assert.equal(feb2024.days.length, 29);

  const novTxs: Transaction[] = [
    // Alquiler ya registrado (no debe duplicarse como previsto)
    makeTx({
      id: 'tx_rent_nov',
      monthKey: '2026-11',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      date: '2026-11-01',
      recurringId: 'rec_rent',
    }),
    // Gasto con fecha futura respecto a todayISO ('2026-11-10')
    makeTx({
      id: 'tx_future_dinner',
      monthKey: '2026-11',
      concept: 'Reserva aniversario',
      category: 'ocio',
      amount: 95,
      date: '2026-11-22',
    }),
    // Gasto privado también visible para su autor en calendario pero sin afectar a otros
    makeTx({
      id: 'tx_priv_nov',
      monthKey: '2026-11',
      concept: 'Detalle privado',
      category: 'otros',
      amount: 30,
      date: '2026-11-10',
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];

  const recs: RecurringExpense[] = [
    mkRec({ id: 'rec_rent', concept: 'Alquiler', category: 'alquiler', amount: 850, dayOfMonth: 1 }),
    mkRec({ id: 'rec_luz', concept: 'Luz', category: 'luz', amount: 65, dayOfMonth: 15 }),
    // Anual sin startMonth: no inventa fecha, se expone en unanchoredActiveTemplates
    mkRec({
      id: 'rec_legacy_no_ref',
      concept: 'IBI legado',
      category: 'seguros',
      amount: 300,
      frequency: 'anual',
      dayOfMonth: 20,
      startMonth: '',
    }),
    // Inactiva 0 €: nunca genera evento previsto
    mkRec({ id: 'rec_inactive', concept: 'Agua', category: 'agua', amount: 0, active: false, dayOfMonth: 18 }),
  ];

  const grid = buildMonthCalendarGrid('2026-11', novTxs, recs, '2026-11-10');
  assert.equal(grid.leadingEmptyCells, 6);
  assert.equal(grid.days.length, 30);
  // Apuntado compartido = 850 + 95 = 945 (excluye el gasto privado de 30 € y la prevista de 65 €)
  assert.equal(grid.totalRegistered, 945);
  assert.equal(grid.totalPlannedPending, 65);
  assert.equal(grid.unanchoredActiveTemplates.length, 1);
  assert.equal(grid.unanchoredActiveTemplates[0].id, 'rec_legacy_no_ref');

  const day1 = grid.days[0];
  assert.equal(day1.events.length, 1);
  assert.equal(day1.events[0].kind, 'registered');
  assert.equal(day1.events[0].recurring?.id, undefined); // es transacción real, no prevista

  const day15 = grid.days[14];
  assert.equal(day15.events.length, 1);
  assert.equal(day15.events[0].kind, 'planned');
  assert.equal(day15.events[0].amount, 65);

  const day22 = grid.days[21];
  assert.equal(day22.events[0].kind, 'future_registered');

  // Agenda del mes en Sencillo ordena días cronológicamente con los eventos reales y previstos
  const agenda = buildMonthAgendaGroups('2026-11', novTxs, recs, '2026-11-10');
  assert.deepEqual(
    agenda.groups.map((g) => g.dateISO),
    ['2026-11-01', '2026-11-10', '2026-11-15', '2026-11-22']
  );

  // Paleta de categorías compartida: sanitización, respaldo por defecto y persistencia
  const sanitized = sanitizeCategoryColors({
    alquiler: '#1d4ed8',
    luz: 'javascript:alert(1)',
    inventada: '#FFFFFF',
  } as Record<string, string>);
  assert.deepEqual(sanitized, { alquiler: '#1D4ED8' });
  assert.equal(resolveCategoryColor('alquiler', sanitized), '#1D4ED8');
  assert.equal(resolveCategoryColor('luz', sanitized), DEFAULT_CATEGORY_COLORS.luz);

  const backupWithColors: NidoBackupV1 = {
    schemaVersion: 1,
    app: 'nido',
    exportedAt: '2026-11-18T10:00:00Z',
    householdName: 'Piso',
    settings: { splitMode: 'preset', presetA: 50, presetB: 50, incomeA: 0, incomeB: 0, currency: 'EUR' },
    categoryColors: { alquiler: '#1D4ED8', supermercado: '#0F766E' },
    initialCosts: [],
    checklist: [],
    items: [],
    recurring: [],
    transactions: [],
    budgets: [],
    monthClosures: [],
    goals: [],
    goalMovements: [],
  };
  const parsedColors = validateAndMigrateBackup(JSON.parse(JSON.stringify(backupWithColors)));
  assert.deepEqual(parsedColors.categoryColors, { alquiler: '#1D4ED8', supermercado: '#0F766E' });

  assert.throws(() =>
    validateAndMigrateBackup({
      ...backupWithColors,
      categoryColors: { alquiler: 'rojo' },
    })
  );

  // DemoHouseholdRepository.updateCategoryColors actualiza y exporta colores compartidos
  const repo = new DemoHouseholdRepository();
  await repo.updateCategoryColors('demo_hogar_santsadurni', {
    alquiler: '#7C3AED',
    luz: '#D97706',
  });
  const exportedAfter = await repo.exportBackup('demo_hogar_santsadurni', 'demo_alex');
  assert.deepEqual(exportedAfter.categoryColors, { alquiler: '#7C3AED', luz: '#D97706' });
});

test('16. Fase 3: Radar de cuenta común (próximos 5 días vs resto de mes, saldo manual, reparto orientativo y sin generar deudas)', () => {
  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'r_radar',
    concept: 'Plantilla',
    category: 'otros',
    amount: 100,
    frequency: 'mensual',
    dayOfMonth: 1,
    startMonth: '2026-01',
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  const txs: Transaction[] = [
    // Ya pagado en cuenta común hasta hoy (2026-11-10)
    makeTx({
      id: 'tx_rent_done',
      monthKey: '2026-11',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      date: '2026-11-01',
      paidBy: COMMON_ACCOUNT_ID,
      recurringId: 'rec_rent',
    }),
    // Gasto futuro ya apuntado en cuenta común (2026-11-13 -> dentro de próximos 5 días desde 2026-11-10)
    makeTx({
      id: 'tx_future_com',
      monthKey: '2026-11',
      concept: 'Compra mensual común',
      category: 'supermercado',
      amount: 120,
      date: '2026-11-13',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
    }),
    // Pagado por miembro A (NO cuenta para el radar de cuenta común)
    makeTx({
      id: 'tx_alex_only',
      monthKey: '2026-11',
      concept: 'Cena Alex',
      category: 'ocio',
      amount: 60,
      date: '2026-11-12',
      paidBy: 'uid_alex',
      splitPctA: 60,
    }),
    // Privado (excluido siempre)
    makeTx({
      id: 'tx_priv',
      monthKey: '2026-11',
      concept: 'Privado',
      category: 'otros',
      amount: 99,
      date: '2026-11-12',
      paidBy: COMMON_ACCOUNT_ID,
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];

  const recs: RecurringExpense[] = [
    // Alquiler ya registrado en txs -> no debe duplicarse
    mkRec({ id: 'rec_rent', concept: 'Alquiler', category: 'alquiler', amount: 850, dayOfMonth: 1 }),
    // Luz el día 14 -> dentro de próximos 5 días (2026-11-10 .. 2026-11-15)
    mkRec({ id: 'rec_luz', concept: 'Electricidad', category: 'luz', amount: 70, dayOfMonth: 14 }),
    // Internet el día 24 -> resto del mes (> 2026-11-15)
    mkRec({ id: 'rec_net', concept: 'Fibra', category: 'internet', amount: 40, dayOfMonth: 24 }),
    // Plantilla cuyo pagador por defecto es Alex (NO cuenta común)
    mkRec({ id: 'rec_alex', concept: 'Móvil Alex', category: 'movil', amount: 25, dayOfMonth: 15, paidByDefault: 'uid_alex' }),
  ];

  // Caso 1: saldo insuficiente (150 € frente a 120 + 70 + 40 = 230 € -> faltan 80 €)
  const shortRadar = computeCommonAccountRadar('2026-11', txs, recs, 60, {
    todayISO: '2026-11-10',
    currentCommonBalance: 150,
  });
  assert.equal(shortRadar.registeredToDateTotal, 850);
  assert.equal(shortRadar.next5DaysTotal, 190); // 120 + 70
  assert.equal(shortRadar.restOfMonthTotal, 40);
  assert.equal(shortRadar.requiredAvailableTotal, 230);
  assert.equal(shortRadar.balanceStatus, 'shortfall');
  assert.equal(shortRadar.shortfallAmount, 80);
  // Orientativo: 120*50% (60) + (70+40)*60% (66) = 126 A; 104 B
  assert.equal(shortRadar.orientativeShareA, 126);
  assert.equal(shortRadar.orientativeShareB, 104);

  // Caso 2: saldo suficiente (300 € -> margen 70 €)
  const coveredRadar = computeCommonAccountRadar('2026-11', txs, recs, 60, {
    todayISO: '2026-11-10',
    currentCommonBalance: 300,
  });
  assert.equal(coveredRadar.balanceStatus, 'covered');
  assert.equal(coveredRadar.marginAmount, 70);

  // Comprobar que el radar no altera calculateCoupleBalance (los pagos comunes siguen sin generar deuda)
  const bal = calculateCoupleBalance(txs, memberA, memberB);
  assert.equal(bal.balanceA, 24); // solo por tx_alex_only (60 - 60*0.60 = 24)
});

test('Fase 4: exportación .ics RFC 5545 y notificaciones locales en primer plano', () => {
  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'rec_base',
    concept: 'Plantilla',
    category: 'otros',
    amount: 100,
    frequency: 'mensual',
    dayOfMonth: 1,
    startMonth: '2026-10',
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  const recs: RecurringExpense[] = [
    mkRec({
      id: 'rec_luz',
      concept: 'Electricidad, piso; norte',
      category: 'luz',
      amount: 72.5,
      frequency: 'mensual',
      dayOfMonth: 12,
      startMonth: '2026-10',
    }),
    mkRec({
      id: 'rec_agua',
      concept: 'Agua bimestral',
      category: 'agua',
      amount: 45,
      frequency: 'bimestral',
      dayOfMonth: 20,
      startMonth: '2026-11', // Nov 2026, Ene 2027 (NO Dic 2026)
    }),
    mkRec({
      id: 'rec_sin_ancla',
      concept: 'Sin startMonth',
      category: 'seguros',
      amount: 180,
      frequency: 'anual',
      dayOfMonth: 5,
      startMonth: '',
    }),
    mkRec({
      id: 'rec_inactiva',
      concept: 'Inactiva',
      category: 'otros',
      amount: 30,
      frequency: 'mensual',
      dayOfMonth: 15,
      active: false,
    }),
  ];

  // 1) Exportación .ics a 3 meses desde 2026-11 con alarma 1 día antes
  const ics3m = buildRecurringIcsCalendar({
    householdName: 'Nido Alex & Sara',
    recurring: recs,
    fromMonthKey: '2026-11',
    monthsHorizon: 3, // 2026-11, 2026-12, 2027-01
    alarmDaysBefore: 1,
    now: new Date('2026-11-10T10:00:00Z'),
  });

  // CRLF obligatorio y estructura VCALENDAR
  assert.ok(ics3m.icsContent.includes('\r\n'));
  assert.ok(ics3m.icsContent.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics3m.icsContent.trimEnd().endsWith('END:VCALENDAR'));
  // Luz (3 meses: Nov, Dic, Ene) + Agua bimestral (Nov y Ene = 2) = 5 eventos
  assert.equal(ics3m.eventsCount, 5);
  assert.equal(ics3m.skippedUnanchoredCount, 1);
  // UID determinista + fecha todo el día + alarma -P1D + texto escapado
  assert.ok(ics3m.icsContent.includes('UID:nido-2026-11-rec_luz@nido.local'));
  assert.ok(ics3m.icsContent.includes('DTSTART;VALUE=DATE:20261112'));
  assert.ok(ics3m.icsContent.includes('DTEND;VALUE=DATE:20261113'));
  assert.ok(ics3m.icsContent.includes('TRIGGER:-P1D'));
  assert.ok(ics3m.icsContent.includes('Electricidad\\, piso\\; norte'));

  // Horizonte 1 mes con alarma el mismo día (-PT0S)
  const ics1m = buildRecurringIcsCalendar({
    householdName: 'Nido',
    recurring: recs,
    fromMonthKey: '2026-11',
    monthsHorizon: 1,
    alarmDaysBefore: 0,
    now: new Date('2026-11-10T10:00:00Z'),
  });
  assert.equal(ics1m.eventsCount, 2);
  assert.ok(ics1m.icsContent.includes('TRIGGER:-PT0S'));

  // 2) Notificaciones locales en primer plano
  const txs: Transaction[] = [
    // Agua aún NO registrada -> debe avisar si entra en ventana; Luz SÍ registrada -> no avisar
    makeTx({
      id: 'tx_luz_paid',
      monthKey: '2026-11',
      concept: 'Electricidad',
      category: 'luz',
      amount: 72.5,
      date: '2026-11-10',
      recurringId: 'rec_luz',
    }),
    // Transacción privada con recurringId de rec_agua -> NO debe bloquear el aviso compartido
    makeTx({
      id: 'tx_priv_ignored',
      monthKey: '2026-11',
      concept: 'Privado',
      category: 'agua',
      amount: 45,
      date: '2026-11-10',
      recurringId: 'rec_agua',
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];

  // Hoy 2026-11-19 -> Agua vence mañana (2026-11-20), dentro de 2 días
  const hiddenAmountPayload = getDueNotificationsForDevice(recs, txs, '2026-11-19', 2, false);
  assert.equal(hiddenAmountPayload.count, 1);
  assert.equal(hiddenAmountPayload.items[0].recurringId, 'rec_agua');
  assert.ok(hiddenAmountPayload.body.includes('Mañana'));
  assert.ok(!hiddenAmountPayload.body.includes('45'));

  const visibleAmountPayload = getDueNotificationsForDevice(recs, txs, '2026-11-19', 2, true);
  assert.equal(visibleAmountPayload.count, 1);
  assert.ok(visibleAmountPayload.body.includes('45'));
});

test('Fase 5: media de últimas 3 facturas, sugerencia de palabra clave CSV y recordatorio 30 días', () => {
  // 1) Media de las últimas 3 facturas compartidas de una plantilla (ignorando privadas y las más antiguas)
  const history: Transaction[] = [
    makeTx({ id: 'old', recurringId: 'rec_luz', amount: 200, date: '2026-07-05', monthKey: '2026-07' }),
    makeTx({ id: 'm1', recurringId: 'rec_luz', amount: 60, date: '2026-08-05', monthKey: '2026-08' }),
    makeTx({ id: 'm2', recurringId: 'rec_luz', amount: 75, date: '2026-09-05', monthKey: '2026-09' }),
    makeTx({ id: 'm3', recurringId: 'rec_luz', amount: 90, date: '2026-10-05', monthKey: '2026-10' }),
    makeTx({
      id: 'priv',
      recurringId: 'rec_luz',
      amount: 999,
      date: '2026-10-10',
      monthKey: '2026-10',
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
  ];
  const avg = computeRecurringHistoricalAverage(history, 'rec_luz', 3);
  assert.ok(avg);
  assert.equal(avg.sampleCount, 3);
  assert.equal(avg.average, 75); // (60 + 75 + 90) / 3 = 75 (ignora 'old'=200 y 'priv'=999)
  assert.equal(avg.lastDate, '2026-10-05');
  assert.equal(computeRecurringHistoricalAverage(history, 'rec_inexistente', 3), null);

  // 2) Sugerencia limpia de palabra clave CSV desde descripciones bancarias reales
  assert.equal(
    suggestKeywordTokenFromDescription('COMPRA TARJETA 14/11/2026 ES9121000418450200051332 CONSUM SUPERMERCADO'),
    'consum supermercado'
  );
  assert.equal(
    suggestKeywordTokenFromDescription('ADEUDO SEPA ENDESA ENERGIA XXI 9988776655'),
    'endesa energia'
  );
  assert.equal(suggestKeywordTokenFromDescription('12345 2026-11-10'), '');

  // 3) Recordatorio de copia JSON cada 30 días en fecha local
  assert.equal(daysSinceLastBackup(null, '2026-11-20'), null);
  assert.equal(shouldShowBackupReminder(null, '2026-11-20', 30), true);
  assert.equal(daysSinceLastBackup('2026-11-01', '2026-11-20'), 19);
  assert.equal(shouldShowBackupReminder('2026-11-01', '2026-11-20', 30), false);
  assert.equal(daysSinceLastBackup('2026-10-21', '2026-11-20'), 30);
  assert.equal(shouldShowBackupReminder('2026-10-21', '2026-11-20', 30), true);
});

test('17. Lista de la compra + autocompletado gratuito (ranking, sin precios, duplicados, decimales/unidad y sin spam de activity)', async () => {
  // 1) Básicos genéricos sin precios ni marca Mercadona
  assert.ok(GENERIC_STAPLES_CATALOG.length >= 25);
  for (const item of GENERIC_STAPLES_CATALOG) {
    assert.ok(item.name.trim().length > 0);
    assert.ok(!/€|\beur\b|\d+[,.]\d{2}\s*€/i.test(item.name));
  }

  // 2) Formato decimal y unidad
  assert.equal(formatShoppingQtyUnit(0.5, 'kg'), '0,5 kg');
  assert.equal(formatShoppingQtyUnit(2, 'ud'), '2 ud');
  assert.equal(formatShoppingQtyUnit(3, ''), '3');

  // 3) Ranking insensible a tildes/mayúsculas + catálogo del hogar antes que Mercadona/genérico
  const sampleMercadona: StaticMercadonaCatalogEntry[] = [
    {
      id: 'mc_atun_1',
      name: 'Atún claro al natural',
      brand: 'Hacendado',
      format: 'Pack 6x80 g',
      section: 'Despensa, arroz, pasta y conservas',
      defaultUnit: 'paq',
      sourceRef: '848000018001',
      source: 'openfoodfacts_odbl',
      addedAt: '2026-11-01',
    },
    ...Array.from({ length: 14 }, (_, idx) => ({
      id: `mc_atun_extra_${idx}`,
      name: `Atún variedad ${idx + 1}`,
      brand: 'Hacendado',
      section: 'Despensa, arroz, pasta y conservas' as const,
      sourceRef: `extra_${idx}`,
      source: 'openfoodfacts_odbl',
      addedAt: '2026-11-01',
    })),
  ];
  const preindexedMercadona = preindexMercadonaCatalog(sampleMercadona);

  const householdCatalog = [
    {
      id: buildShoppingCatalogId('Atún al natural casa'),
      text: 'Atún al natural casa',
      defaultUnit: 'lata',
      usageCount: 4,
      lastUsedAt: '2026-11-15T10:00:00.000Z',
      createdBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
    },
  ];
  const atunMatches = searchShoppingSuggestions('atun', householdCatalog, preindexedMercadona);
  assert.ok(atunMatches.length >= 2);
  assert.equal(atunMatches[0].source, 'hogar');
  assert.equal(atunMatches[0].text, 'Atún al natural casa');
  assert.ok(
    atunMatches.some(
      (s) => s.source === 'mercadona' && s.sourceType === 'mercadona' && s.text.includes('Atún')
    )
  );

  // Paginación ("Ver más resultados")
  const page1 = searchShoppingSuggestionsPaginated('atun', householdCatalog, preindexedMercadona, {
    limit: 6,
    offset: 0,
  });
  assert.equal(page1.items.length, 6);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.totalCount, 16);

  // Genéricos no se etiquetan como Mercadona
  const platanoMatches = searchShoppingSuggestions('platano', [], preindexedMercadona);
  assert.equal(platanoMatches[0].source, 'generico');
  assert.equal(platanoMatches[0].sourceType, 'generic');

  // Con input vacío solo sugiere ítems frecuentes del hogar (máximo limit)
  const quickPicks = searchShoppingSuggestions('   ', householdCatalog, preindexedMercadona);
  assert.equal(quickPicks.length, 1);
  assert.equal(quickPicks[0].source, 'hogar');

  // 4) Detección de duplicados pendientes:
  // - misma palabra y unidad -> exactSameUnitMatch
  // - distinta unidad -> differentUnitMatch (no auto-fusionar)
  // - variante distinta ("Leche" vs "Leche desnatada") -> ningún match
  const pending = [
    {
      id: 's1',
      text: 'Leche entera',
      qty: 2,
      unit: 'L',
      done: false,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 's2',
      text: 'Tomates',
      qty: 1,
      unit: 'kg',
      done: false,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 's_done',
      text: 'Café molido',
      qty: 1,
      unit: 'paq',
      done: true,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ];
  const sameMatch = findPendingDuplicateMatch('  leche   entera ', 'L', pending);
  assert.equal(sameMatch.exactSameUnitMatch?.id, 's1');
  assert.equal(sameMatch.differentUnitMatch, null);

  const diffUnit = findPendingDuplicateMatch('Tomates', 'ud', pending);
  assert.equal(diffUnit.exactSameUnitMatch, null);
  assert.equal(diffUnit.differentUnitMatch?.id, 's2');

  const variant = findPendingDuplicateMatch('Leche desnatada', 'L', pending);
  assert.equal(variant.exactSameUnitMatch, null);
  assert.equal(variant.differentUnitMatch, null);

  // Ítems ya comprados (done: true) no provocan prompt de duplicado pendiente
  const boughtAgain = findPendingDuplicateMatch('Café molido', 'paq', pending);
  assert.equal(boughtAgain.exactSameUnitMatch, null);

  // 5) Repositorio: decimal qty/unit, upsertShoppingCatalogItem solo al confirmar y sin ensuciar activity
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  let beforeActivityLen = 0;
  repo.subscribeActivity('demo_hogar_santsadurni', 50, (a) => {
    beforeActivityLen = a.length;
  })();

  const shopId = await repo.upsertShoppingItem(
    'demo_hogar_santsadurni',
    { text: 'Aguacates maduros', qty: 0.75, unit: 'kg', done: false },
    actor
  );
  await repo.upsertShoppingCatalogItem(
    'demo_hogar_santsadurni',
    { text: 'Aguacates maduros', defaultUnit: 'kg' },
    actor
  );
  await repo.upsertShoppingCatalogItem(
    'demo_hogar_santsadurni',
    { text: 'Aguacates maduros', defaultUnit: 'kg' },
    actor
  );

  let catalogItems: ReturnType<typeof searchShoppingSuggestions> = [];
  repo.subscribeShoppingCatalog('demo_hogar_santsadurni', (items) => {
    catalogItems = searchShoppingSuggestions('aguacates mad', items);
    assert.ok(searchShoppingSuggestions('aguacates', items).some((s) => s.source === 'hogar'));
    assert.equal(items[0].usageCount, 2);
  })();
  assert.equal(catalogItems[0].source, 'hogar');

  let currentShopping: ShoppingItem[] = [];
  repo.subscribeShopping('demo_hogar_santsadurni', (items) => {
    currentShopping = items;
  })();
  const added = currentShopping.find((s) => s.id === shopId);
  assert.equal(added?.qty, 0.75);
  assert.equal(added?.unit, 'kg');

  await repo.deleteShoppingItemsBulk('demo_hogar_santsadurni', [shopId]);
  let afterActivityLen = 0;
  repo.subscribeActivity('demo_hogar_santsadurni', 50, (a) => {
    afterActivityLen = a.length;
  })();
  assert.equal(afterActivityLen, beforeActivityLen);
});

test('18. Categorías personalizadas (IDs estables, duplicados, Simple top-8, presupuestos, CSV keywords, archivo vs borrado y round-trip backup)', async () => {
  const customGym: CustomCategory = {
    id: 'cat_gimnasio',
    name: 'Gimnasio y deporte',
    color: '#0284C7',
    icon: 'dumbbell',
    order: 0,
    archived: false,
    csvKeywords: 'vivagym, decathlon',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
  const customArchived: CustomCategory = {
    id: 'cat_mascotas',
    name: 'Mascotas',
    color: '#B45309',
    icon: 'paw-print',
    order: 1,
    archived: true,
    csvKeywords: 'kiwoko',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  // 1) Generación de ID estable y detección de duplicados (insensible a tildes/mayúsculas)
  assert.equal(generateCustomCategoryId('Gimnasio y deporte', []), 'cat_gimnasio_y_deporte');
  assert.equal(
    generateCustomCategoryId('Gimnasio y deporte', ['cat_gimnasio_y_deporte']),
    'cat_gimnasio_y_deporte_2'
  );
  assert.equal(isCategoryDuplicateName('  Supermércado ', [customGym]), true); // choca con sistema
  assert.equal(isCategoryDuplicateName('gimnasio y deporte', [customGym]), true);
  assert.equal(isCategoryDuplicateName('gimnasio y deporte', [customGym], 'cat_gimnasio'), false);
  assert.equal(isCategoryDuplicateName('Viajes', [customGym]), false);

  // Las sugerencias nunca se auto-activan y filtran las ya existentes
  const avail = getAvailableCategorySuggestions([customGym]);
  assert.ok(!avail.some((s) => s.name === 'Gimnasio y deporte'));
  assert.ok(avail.some((s) => s.name === 'Mascotas'));

  // 2) Registry, archivada y fallback seguro para IDs desconocidos
  const reg = buildCategoryRegistry([customGym, customArchived], { alquiler: '#7C3AED' });
  assert.equal(reg.getLabel('cat_gimnasio'), 'Gimnasio y deporte');
  assert.equal(reg.getColor('cat_gimnasio'), '#0284C7');
  assert.equal(reg.getColor('alquiler'), '#7C3AED');
  assert.equal(reg.isArchived('cat_mascotas'), true);
  assert.ok(!reg.activeCategories.some((c) => c.id === 'cat_mascotas'));
  const unknownMeta = reg.getMeta('cat_legacy_borrada');
  assert.equal(unknownMeta.isUnknown, true);
  assert.ok(unknownMeta.label.includes('legacy borrada'));

  // 3) Modo Sencillo: top 8 + overflowCategories
  const manyTxs: Transaction[] = [
    makeTx({ id: 'g1', category: 'cat_gimnasio', monthKey: '2026-11' }),
    makeTx({ id: 'g2', category: 'cat_gimnasio', monthKey: '2026-11' }),
    makeTx({ id: 'g3', category: 'cat_gimnasio', monthKey: '2026-11' }),
  ];
  const { primaryCategories, overflowCategories } = pickSimpleWizardCategories(
    reg.activeCategories,
    manyTxs,
    8
  );
  assert.equal(primaryCategories.length, 8);
  assert.ok(primaryCategories.some((c) => c.id === 'cat_gimnasio'));
  assert.equal(overflowCategories.length, reg.activeCategories.length - 8);

  // 4) Presupuestos fusionados, alertas, comparativa, búsqueda global y CSV keywords
  const mergedBudget = mergeMonthlyAndCustomBudgetLimits(
    { monthKey: '2026-11', limits: { supermercado: 300 }, updatedAt: '' },
    [{ id: '2026-11__cat_gimnasio', monthKey: '2026-11', categoryId: 'cat_gimnasio', limit: 100, updatedAt: '' }],
    '2026-11'
  );
  const gymTx = makeTx({
    id: 'tx_gym',
    concept: 'Cuota mensual',
    category: 'cat_gimnasio',
    amount: 90,
    date: '2026-11-10',
    monthKey: '2026-11',
  });
  const prog = computeBudgetProgress([gymTx], mergedBudget);
  const gymProg = prog.find((p) => p.category === 'cat_gimnasio');
  assert.equal(gymProg?.limit, 100);
  assert.equal(gymProg?.pct, 90);
  assert.equal(gymProg?.status, 'ambar');

  const alerts = getBudgetThresholdAlerts([gymTx], mergedBudget, 80);
  assert.equal(alerts[0].category, 'cat_gimnasio');

  const comp = computeCategoryComparison(
    [
      gymTx,
      makeTx({ id: 'tx_gym_prev', category: 'cat_gimnasio', amount: 60, date: '2026-10-10', monthKey: '2026-10' }),
    ],
    '2026-11'
  );
  const compGym = comp.rows.find((r) => r.category === 'cat_gimnasio');
  assert.equal(compGym?.current, 90);
  assert.equal(compGym?.prev, 60);

  const searchRes = filterGlobalTransactions(
    [gymTx],
    { text: 'deporte', amountQuery: '', category: 'todas' },
    reg.labelsMap
  );
  assert.equal(searchRes.length, 1);

  assert.equal(matchCategoryFromKeywords('ADEUDO VIVAGYM CLUB', {}, [customGym]), 'cat_gimnasio');

  assert.equal(
    isCategoryUsedInHouseholdData('cat_gimnasio', { transactions: [gymTx] }),
    true
  );
  assert.equal(
    isCategoryUsedInHouseholdData('cat_gimnasio', { transactions: [] }),
    false
  );

  // 5) Repositorio Demo + round-trip export/import JSON + compatibilidad retroactiva con backup antiguo
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const createdCatId = await repo.upsertCustomCategory(
    'demo_hogar_santsadurni',
    {
      name: 'Viajes y escapadas',
      color: '#2563EB',
      icon: 'plane',
      order: 0,
      archived: false,
      csvKeywords: 'renfe, vueling',
    },
    actor
  );
  await repo.saveAllBudgets(
    'demo_hogar_santsadurni',
    '2026-11',
    { supermercado: 400, [createdCatId]: 250 },
    [createdCatId],
    actor
  );
  const exported = await repo.exportBackup('demo_hogar_santsadurni', 'demo_alex');
  assert.ok(exported.customCategories?.some((c) => c.id === createdCatId && c.name === 'Viajes y escapadas'));
  assert.ok(
    exported.categoryBudgets?.some(
      (b) => b.monthKey === '2026-11' && b.categoryId === createdCatId && b.limit === 250
    )
  );

  // Validar migración de JSON exportado y también de un backup v1 antiguo sin campos nuevos
  const revalidated = validateAndMigrateBackup(JSON.parse(JSON.stringify(exported)));
  assert.equal(revalidated.customCategories?.length, 1);
  assert.equal(revalidated.categoryBudgets?.length, 1);

  const legacyValidated = validateAndMigrateBackup({
    schemaVersion: 1,
    app: 'nido',
    exportedAt: '2026-01-01T00:00:00.000Z',
    householdName: 'Piso antiguo',
    settings: {
      splitMode: 'preset',
      presetA: 50,
      presetB: 50,
      incomeA: 0,
      incomeB: 0,
      currency: 'EUR',
    },
    initialCosts: [],
    checklist: [],
    items: [],
    recurring: [],
    transactions: [],
    budgets: [],
    monthClosures: [],
    goals: [],
    goalMovements: [],
  });
  assert.equal(legacyValidated.householdName, 'Piso antiguo');
  assert.equal(legacyValidated.shopping, undefined);
  assert.equal(legacyValidated.customCategories, undefined);
});

test('19. Seguridad de categorías personalizadas y saneamiento de presupuestos del mes', async () => {
  // 1) canSafelyDeleteCustomCategory bloquea si hay >1 miembro o si hay categoryBudgets históricos
  const blockedPrivacy = canSafelyDeleteCustomCategory('cat_gym', {
    memberCount: 2,
    transactions: [],
    recurring: [],
    initialCosts: [],
    categoryBudgets: [],
  });
  assert.equal(blockedPrivacy.canDelete, false);
  assert.equal(blockedPrivacy.reason, 'multi_member_privacy');

  const blockedBudget = canSafelyDeleteCustomCategory('cat_gym', {
    memberCount: 1,
    transactions: [],
    recurring: [],
    initialCosts: [],
    categoryBudgets: [{ categoryId: 'cat_gym', limit: 45 }],
  });
  assert.equal(blockedBudget.canDelete, false);
  assert.equal(blockedBudget.reason, 'in_use');

  const safeSingle = canSafelyDeleteCustomCategory('cat_gym', {
    memberCount: 1,
    transactions: [],
    recurring: [],
    initialCosts: [],
    categoryBudgets: [],
  });
  assert.equal(safeSingle.canDelete, true);

  // 2) DemoHouseholdRepository: saveBudget filtra claves cat_* (evita PERMISSION_DENIED en /budgets/{monthKey})
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  await repo.saveBudget(
    'demo_hogar_santsadurni',
    '2026-11',
    { supermercado: 320, cat_inventada: 90 } as Record<string, number>,
    actor
  );
  let latestBudgetLimits: Record<string, number | undefined> = {};
  repo.subscribeBudget('demo_hogar_santsadurni', '2026-11', (b) => {
    latestBudgetLimits = b?.limits ?? {};
  })();
  assert.equal(latestBudgetLimits.supermercado, 320);
  assert.equal('cat_inventada' in latestBudgetLimits, false);

  // 3) DemoHouseholdRepository: deleteUnusedCustomCategory rechaza en hogar compartido y no borra categoryBudgets
  const catId = await repo.upsertCustomCategory(
    'demo_hogar_santsadurni',
    {
      name: 'Padel',
      color: '#0284C7',
      icon: 'dumbbell',
      order: 0,
      archived: false,
      csvKeywords: 'padel',
    },
    actor
  );
  await repo.saveAllBudgets('demo_hogar_santsadurni', '2025-05', { [catId]: 60 }, [catId], actor);
  await assert.rejects(
    () => repo.deleteUnusedCustomCategory('demo_hogar_santsadurni', catId, 'Padel', actor),
    /hogar compartido|presupuestos/i
  );
  const allCb = await repo.fetchAllCategoryBudgets('demo_hogar_santsadurni');
  assert.ok(allCb.some((b) => b.categoryId === catId && b.monthKey === '2025-05'));
});

test('20. Mercadona metadata, favoritos, secciones y round-trip backup en lista de la compra', async () => {
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  const catEntryId = await repo.upsertShoppingCatalogItem(
    'demo_hogar_santsadurni',
    {
      text: 'Leche entera Hacendado',
      defaultUnit: 'L',
      catalogId: 'mc_leche_01',
      brand: 'Hacendado',
      format: 'Brick 1 L',
      section: 'Lácteos, quesos y bebidas vegetales',
      sourceType: 'mercadona',
    },
    actor
  );
  await repo.toggleShoppingCatalogFavorite('demo_hogar_santsadurni', catEntryId, true);

  await repo.upsertShoppingItem(
    'demo_hogar_santsadurni',
    {
      text: 'Leche entera Hacendado',
      qty: 6,
      unit: 'L',
      done: false,
      catalogId: 'mc_leche_01',
      brand: 'Hacendado',
      format: 'Brick 1 L',
      section: 'Lácteos, quesos y bebidas vegetales',
      sourceType: 'mercadona',
    },
    actor
  );

  // Formatos distintos no colisionan como duplicado idéntico
  const pending: ShoppingItem[] = [];
  repo.subscribeShopping('demo_hogar_santsadurni', (items) => {
    pending.splice(0, pending.length, ...items);
  })();
  const sameFmt = findPendingDuplicateMatch('Leche entera Hacendado', 'L', pending, {
    format: 'Brick 1 L',
  });
  assert.ok(sameFmt.exactSameUnitMatch);
  const diffFmt = findPendingDuplicateMatch('Leche entera Hacendado', 'L', pending, {
    format: 'Pack 6x1 L',
  });
  assert.equal(diffFmt.exactSameUnitMatch, null);

  // Agrupación por secciones
  const grouped = groupShoppingItemsBySection(pending);
  assert.ok(grouped.some((g) => g.section === 'Lácteos, quesos y bebidas vegetales'));

  // Round-trip backup v1 conserva metadata Mercadona y favorito
  const exported = await repo.exportBackup('demo_hogar_santsadurni', 'demo_alex');
  const validated = validateAndMigrateBackup(JSON.parse(JSON.stringify(exported)));
  const backedItem = validated.shopping?.find((s) => s.catalogId === 'mc_leche_01');
  assert.equal(backedItem?.brand, 'Hacendado');
  assert.equal(backedItem?.sourceType, 'mercadona');
  assert.equal(backedItem?.section, 'Lácteos, quesos y bebidas vegetales');
  const backedCat = validated.shoppingCatalog?.find((c) => c.id === catEntryId);
  assert.equal(backedCat?.favorite, true);
  assert.equal(backedCat?.sourceType, 'mercadona');
});

test('21. Bloque 2 — Copiar presupuestos del mes anterior (sin/con sobrescritura, límite 0, archivadas y separación colecciones)', async () => {
  const customCats: CustomCategory[] = [
    {
      id: 'cat_gimnasio',
      name: 'Gimnasio',
      color: '#0284C7',
      icon: 'dumbbell',
      order: 0,
      archived: false,
      csvKeywords: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'cat_archivada',
      name: 'Curso antiguo',
      color: '#64748B',
      icon: 'book',
      order: 1,
      archived: true,
      csvKeywords: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  // Mes anterior tiene: supermercado 350, ocio 0 (límite válido!), transporte 90, cat_gimnasio 0, cat_archivada 45
  // Mes actual ya tiene: supermercado 400, transporte 90 (igual)
  const prevLimits = {
    supermercado: 350,
    ocio: 0,
    transporte: 90,
    cat_gimnasio: 0,
    cat_archivada: 45,
  };
  const currentLimits = {
    supermercado: 400,
    transporte: 90,
  };

  // A) Por defecto NO sobrescribe existentes; rellena vacíos incluyendo 0; omite archivadas
  const planNoOverwrite = planCopyPreviousMonthBudgets({
    prevLimits,
    currentLimits,
    customCategories: customCats,
    overwriteExisting: false,
  });
  assert.equal(planNoOverwrite.hasPreviousBudgets, true);
  assert.equal(planNoOverwrite.toFill.length, 2);
  assert.equal(planNoOverwrite.toOverwrite.length, 1);
  assert.equal(planNoOverwrite.toOverwrite[0].categoryId, 'supermercado');
  assert.equal(planNoOverwrite.unchanged.length, 1);
  assert.equal(planNoOverwrite.skippedArchived.length, 1);
  assert.equal(planNoOverwrite.skippedArchived[0].categoryId, 'cat_archivada');
  assert.equal(planNoOverwrite.mergedLimits.supermercado, 400); // conservado
  assert.equal(planNoOverwrite.mergedLimits.ocio, 0); // 0 copiado como válido
  assert.equal(planNoOverwrite.mergedLimits.cat_gimnasio, 0); // 0 personalizado copiado
  assert.equal('cat_archivada' in planNoOverwrite.mergedLimits, false);

  // B) Con sobrescritura explícita sí actualiza supermercado a 350 y sigue omitiendo archivada
  const planOverwrite = planCopyPreviousMonthBudgets({
    prevLimits,
    currentLimits,
    customCategories: customCats,
    overwriteExisting: true,
  });
  assert.equal(planOverwrite.mergedLimits.supermercado, 350);
  assert.equal(planOverwrite.mergedLimits.ocio, 0);
  assert.equal('cat_archivada' in planOverwrite.mergedLimits, false);

  // C) Si el mes actual tiene límite 0 explícito, cuenta como existente (no vacío)
  const planExistingZero = planCopyPreviousMonthBudgets({
    prevLimits: { ocio: 120 },
    currentLimits: { ocio: 0 },
    customCategories: [],
    overwriteExisting: false,
  });
  assert.equal(planExistingZero.toFill.length, 0);
  assert.equal(planExistingZero.toOverwrite.length, 1);
  assert.equal(planExistingZero.toOverwrite[0].previousCurrentLimit, 0);
  assert.equal(planExistingZero.mergedLimits.ocio, 0);

  // D) Persistencia en DemoHouseholdRepository: 0 se guarda y lee en sistema y personalizadas sin mezclar colecciones
  const repo = new DemoHouseholdRepository();
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const gymId = await repo.upsertCustomCategory(
    'demo_hogar_santsadurni',
    {
      name: 'Deporte Cero',
      color: '#0284C7',
      icon: 'dumbbell',
      order: 0,
      archived: false,
      csvKeywords: '',
    },
    actor
  );
  await repo.saveAllBudgets(
    'demo_hogar_santsadurni',
    '2026-08',
    { ocio: 0, supermercado: 310, [gymId]: 0 },
    [gymId],
    actor
  );
  const fetchedPrev = await repo.fetchMonthBudgets('demo_hogar_santsadurni', '2026-08');
  assert.equal(fetchedPrev.systemBudget?.limits.ocio, 0);
  assert.equal(fetchedPrev.systemBudget?.limits.supermercado, 310);
  assert.equal(gymId in (fetchedPrev.systemBudget?.limits ?? {}), false); // cat_* nunca en /budgets
  const gymBudgetDoc = fetchedPrev.categoryBudgets.find((b) => b.categoryId === gymId);
  assert.ok(gymBudgetDoc);
  assert.equal(gymBudgetDoc?.limit, 0);

  // E) computeBudgetProgress y getBudgetThresholdAlerts respetan límite 0
  const merged = mergeMonthlyAndCustomBudgetLimits(
    fetchedPrev.systemBudget,
    fetchedPrev.categoryBudgets,
    '2026-08'
  );
  const progressNoSpend = computeBudgetProgress([], merged);
  const ocioNoSpend = progressNoSpend.find((p) => p.category === 'ocio');
  assert.ok(ocioNoSpend);
  assert.equal(ocioNoSpend?.hasLimit, true);
  assert.equal(ocioNoSpend?.limit, 0);
  assert.equal(ocioNoSpend?.status, 'verde');
  assert.equal(getBudgetThresholdAlerts([], merged, 80).length, 0);

  const txOverZero: Transaction = {
    id: 'tx_over_zero',
    monthKey: '2026-08',
    concept: 'Cine',
    category: 'ocio',
    amount: 14,
    date: '2026-08-10',
    paidBy: 'uid_alex',
    recurringId: null,
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    notes: '',
    createdAt: '2026-08-10',
    updatedAt: '2026-08-10',
  };
  const progressWithSpend = computeBudgetProgress([txOverZero], merged);
  const ocioOver = progressWithSpend.find((p) => p.category === 'ocio');
  assert.equal(ocioOver?.status, 'rojo');
  const alertsOver = getBudgetThresholdAlerts([txOverZero], merged, 80);
  assert.equal(alertsOver.length, 1);
  assert.equal(alertsOver[0].exceeded, true);
  assert.equal(alertsOver[0].overAmount, 14);
});

test('22. Bloque 3 — Exploración del catálogo por secciones (combinada con texto, sin texto, paginación y favoritos)', () => {
  const sampleMercadona = preindexMercadonaCatalog([
    {
      id: 'mc_1',
      name: 'Leche entera',
      brand: 'Hacendado',
      format: '1 L',
      section: 'Lácteos, quesos y bebidas vegetales',
      defaultUnit: 'L',
      sourceRef: 'off:1',
      source: 'openfoodfacts_odbl',
      addedAt: '2026-11-23',
    },
    {
      id: 'mc_2',
      name: 'Yogur natural',
      brand: 'Hacendado',
      format: '6x125 g',
      section: 'Lácteos, quesos y bebidas vegetales',
      defaultUnit: 'paq',
      sourceRef: 'off:2',
      source: 'openfoodfacts_odbl',
      addedAt: '2026-11-23',
    },
    {
      id: 'mc_3',
      name: 'Agua mineral natural',
      brand: 'Cortes',
      format: '1,5 L',
      section: 'Bebidas',
      defaultUnit: 'botella',
      sourceRef: 'off:3',
      source: 'openfoodfacts_odbl',
      addedAt: '2026-11-23',
    },
  ]);

  const householdCatalog = [
    {
      id: 'hc_fav_queso',
      text: 'Queso fresco batido',
      defaultUnit: 'ud',
      favorite: true,
      usageCount: 12,
      lastUsedAt: '2026-11-20',
      section: 'Lácteos, quesos y bebidas vegetales' as const,
      sourceType: 'custom' as const,
      createdBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z',
    },
  ];

  // A) Navegar sección sin texto devuelve favoritos primero + productos de esa sección únicamente
  const browseDairy = searchShoppingSuggestionsPaginated('', householdCatalog, sampleMercadona, {
    section: 'Lácteos, quesos y bebidas vegetales',
    limit: 2,
    offset: 0,
  });
  assert.equal(browseDairy.totalCount, 3);
  assert.equal(browseDairy.hasMore, true);
  assert.equal(browseDairy.items.length, 2);
  assert.equal(browseDairy.items[0].text, 'Queso fresco batido'); // favorito del hogar primero
  assert.ok(
    browseDairy.items.every((i) => i.section === 'Lácteos, quesos y bebidas vegetales')
  );

  // Página siguiente
  const browseDairyPage2 = searchShoppingSuggestionsPaginated('', householdCatalog, sampleMercadona, {
    section: 'Lácteos, quesos y bebidas vegetales',
    limit: 2,
    offset: 2,
  });
  assert.equal(browseDairyPage2.items.length, 1);
  assert.equal(browseDairyPage2.hasMore, false);

  // B) Combinar sección + texto filtra exactamente por ambos
  const combined = searchShoppingSuggestionsPaginated('natural', householdCatalog, sampleMercadona, {
    section: 'Bebidas',
  });
  assert.equal(combined.totalCount, 1);
  assert.equal(combined.items[0].text, 'Agua mineral natural');

  // C) "todas" busca en todas las secciones
  const allNatural = searchShoppingSuggestionsPaginated('natural', householdCatalog, sampleMercadona, {
    section: 'todas',
  });
  assert.equal(allNatural.totalCount, 2);
});

test('23. Bloque 4 — Finalizar compra: bloqueo doble clic y reintento de limpieza sin duplicar gasto', async () => {
  const item1: ShoppingItem = {
    id: 'shop_1',
    text: 'Leche entera',
    qty: 2,
    unit: 'L',
    done: true,
    addedBy: 'uid_alex',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:05:00Z',
  };
  const item2: ShoppingItem = {
    id: 'shop_2',
    text: 'Plátanos',
    qty: 1,
    unit: 'kg',
    done: true,
    addedBy: 'uid_alex',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:06:00Z',
  };

  let liveItems: ShoppingItem[] = [item1, item2];
  const session: ShoppingCheckoutSession = {
    createdExpenseId: null,
    snapshots: captureShoppingCheckoutSnapshots(liveItems),
  };
  const inFlightRef = { current: false };

  let createExpenseCalls = 0;
  let deleteCalls = 0;
  let shouldFailDelete = true;

  // 1) Doble confirmación simultánea: la segunda llamada queda bloqueada (ignored_in_flight)
  const p1 = executeShoppingCheckout({
    session,
    inFlightRef,
    createExpense: async () => {
      createExpenseCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 'tx_compra_01';
    },
    getLiveShoppingItems: () => liveItems,
    deleteItemsBulk: async (ids) => {
      deleteCalls += 1;
      if (shouldFailDelete) throw new Error('network error');
      liveItems = liveItems.filter((i) => !ids.includes(i.id));
    },
  });

  const p2 = executeShoppingCheckout({
    session,
    inFlightRef,
    createExpense: async () => {
      createExpenseCalls += 1;
      return 'tx_duplicado';
    },
    getLiveShoppingItems: () => liveItems,
    deleteItemsBulk: async () => {
      deleteCalls += 1;
    },
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r2.status, 'ignored_in_flight');
  assert.equal(r1.status, 'cleanup_failed');
  assert.equal(createExpenseCalls, 1);
  assert.equal(deleteCalls, 1);
  assert.equal(session.createdExpenseId, 'tx_compra_01');

  // 2) Reintento tras fallo de limpieza: NO vuelve a crear el gasto; solo limpia
  shouldFailDelete = false;
  const r3 = await executeShoppingCheckout({
    session,
    inFlightRef,
    createExpense: async () => {
      createExpenseCalls += 1;
      return 'tx_no_deberia_crearse';
    },
    getLiveShoppingItems: () => liveItems,
    deleteItemsBulk: async (ids) => {
      deleteCalls += 1;
      liveItems = liveItems.filter((i) => !ids.includes(i.id));
    },
  });

  assert.equal(r3.status, 'completed');
  if (r3.status === 'completed') {
    assert.equal(r3.expenseId, 'tx_compra_01');
    assert.equal(r3.reusedExistingExpense, true);
    assert.equal(r3.deletedCount, 2);
  }
  assert.equal(createExpenseCalls, 1); // NUNCA duplicado
  assert.equal(deleteCalls, 2);
  assert.equal(liveItems.length, 0);
});

test('24. Bloque 4 — Concurrencia de pareja en lista de la compra al finalizar compra', () => {
  const initialChecked: ShoppingItem[] = [
    {
      id: 'i_unchanged',
      text: 'Pan integral',
      qty: 1,
      unit: 'paq',
      done: true,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:01:00Z',
    },
    {
      id: 'i_modified_by_partner',
      text: 'Leche entera',
      qty: 2,
      unit: 'L',
      done: true,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:01:00Z',
    },
    {
      id: 'i_unchecked_by_partner',
      text: 'Huevos L',
      qty: 1,
      unit: 'docena',
      done: true,
      addedBy: 'uid_alex',
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:01:00Z',
    },
  ];
  const snapshots = captureShoppingCheckoutSnapshots(initialChecked);

  // Estado en vivo mientras el usuario confirmaba:
  // - Pareja añadió 'Aceite de oliva' (nuevo, no estaba en snapshots)
  // - Pareja cambió qty de 'Leche entera' de 2 a 6 y updatedAt
  // - Pareja desmarcó 'Huevos L' (done: false)
  // - 'Pan integral' sigue igual y marcado
  const liveNow: ShoppingItem[] = [
    initialChecked[0],
    {
      ...initialChecked[1],
      qty: 6,
      updatedAt: '2026-11-01T10:04:00Z',
    },
    {
      ...initialChecked[2],
      done: false,
      updatedAt: '2026-11-01T10:04:30Z',
    },
    {
      id: 'i_added_by_partner',
      text: 'Aceite de oliva',
      qty: 1,
      unit: 'botella',
      done: true, // incluso si la pareja ya lo marcó después, no estaba en esta compra
      addedBy: 'uid_pareja',
      createdAt: '2026-11-01T10:04:45Z',
      updatedAt: '2026-11-01T10:04:45Z',
    },
  ];

  const reconciled = reconcileShoppingItemsForCleanup(snapshots, liveNow);
  assert.deepEqual(reconciled.safeToDeleteIds, ['i_unchanged']);
  assert.equal(reconciled.skippedModified.length, 1);
  assert.equal(reconciled.skippedModified[0].id, 'i_modified_by_partner');
  assert.equal(reconciled.skippedUnchecked.length, 1);
  assert.equal(reconciled.skippedUnchecked[0].id, 'i_unchecked_by_partner');
  assert.equal(reconciled.safeToDeleteIds.includes('i_added_by_partner'), false);
});

test('25. Bloque 5 — Búsqueda global ampliada (origen, pagador, subtotales separados, privacidad y caché aislada)', async () => {
  const txs: Transaction[] = [
    {
      id: 'tx_1',
      monthKey: '2026-11',
      concept: 'Compra Mercadona',
      category: 'supermercado',
      amount: 85.4,
      date: '2026-11-12',
      paidBy: 'comun', // legado -> debe normalizar a COMMON_ACCOUNT_ID
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: 'Semana',
      createdAt: '2026-11-12',
      updatedAt: '2026-11-12',
    },
    {
      id: 'tx_liq',
      monthKey: '2026-11',
      concept: 'Ajuste noviembre',
      category: 'liquidacion',
      amount: 40,
      date: '2026-11-15',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: true,
      settlementTo: 'uid_pareja',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: '2026-11-15',
      updatedAt: '2026-11-15',
    },
    {
      id: 'tx_priv_other',
      monthKey: '2026-11',
      concept: 'Regalo sorpresa',
      category: 'ocio',
      amount: 60,
      date: '2026-11-14',
      paidBy: 'uid_pareja',
      recurringId: null,
      splitPctA: 0,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_pareja',
      notes: '',
      createdAt: '2026-11-14',
      updatedAt: '2026-11-14',
    },
  ];

  const costs: InitialCost[] = [
    {
      id: 'ic_1',
      concept: 'Fianza piso',
      category: 'fianza',
      amount: 900,
      paidBy: COMMON_ACCOUNT_ID,
      status: 'pagado',
      dueDate: '2026-11-01',
      notes: '2 meses',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'ic_2',
      concept: 'Cerrajero bombín',
      category: 'cerrajeria',
      amount: 140,
      paidBy: 'uid_alex',
      status: 'pendiente',
      dueDate: '2026-11-03',
      notes: '',
      createdAt: '2026-11-03',
      updatedAt: '2026-11-03',
    },
  ];

  // A) Filtro por pagador Cuenta común (incluye legado 'comun' + mudanza), subtotales separados y privacidad respetada
  const comunRes = filterGlobalExpenses(
    txs,
    costs,
    { origin: 'todos', payer: COMMON_ACCOUNT_ID, text: '', amountQuery: '', category: 'todas' },
    { viewerUid: 'uid_alex' }
  );
  assert.equal(comunRes.monthlyCount, 1);
  assert.equal(comunRes.monthlyExpenseTotal, 85.4);
  assert.equal(comunRes.movingCount, 1);
  assert.equal(comunRes.movingTotal, 900);
  assert.equal(comunRes.movingPaidTotal, 900);
  assert.equal(comunRes.movingPendingTotal, 0);

  // B) Filtro por origen 'mudanza' solo devuelve InitialCost
  const mudanzaOnly = filterGlobalExpenses(
    txs,
    costs,
    { origin: 'mudanza', payer: 'todos', text: '', amountQuery: '', category: 'todas' },
    { viewerUid: 'uid_alex' }
  );
  assert.equal(mudanzaOnly.monthlyCount, 0);
  assert.equal(mudanzaOnly.movingCount, 2);
  assert.equal(mudanzaOnly.movingTotal, 1040);
  assert.equal(mudanzaOnly.movingPaidTotal, 900);
  assert.equal(mudanzaOnly.movingPendingTotal, 140);

  // C) Privado de uid_pareja nunca se filtra para uid_alex aunque coincida todo
  const allForAlex = filterGlobalExpenses(
    txs,
    costs,
    { origin: 'mensual', payer: 'todos', text: '', amountQuery: '', category: 'todas' },
    { viewerUid: 'uid_alex' }
  );
  assert.equal(
    allForAlex.items.some((r) => r.kind === 'mensual' && r.tx.id === 'tx_priv_other'),
    false
  );
  // Liquidación aparece en listado pero no suma al subtotal de gastos mensuales
  assert.equal(allForAlex.monthlyCount, 2);
  assert.equal(allForAlex.monthlyExpenseTotal, 85.4);

  // D) Caché aislada por (householdId, viewerUid) + invalidación
  const cache = createScopedGlobalSearchCache();
  cache.set('h_1', 'uid_alex', { transactions: [txs[0]], initialCosts: [costs[0]] });
  cache.set('h_1', 'uid_pareja', { transactions: [txs[0], txs[2]], initialCosts: [costs[0]] });
  cache.set('h_2', 'uid_alex', { transactions: [], initialCosts: [costs[1]] });

  assert.equal(cache.get('h_1', 'uid_alex')?.transactions.length, 1);
  assert.equal(cache.get('h_1', 'uid_pareja')?.transactions.length, 2);
  assert.equal(cache.get('h_2', 'uid_alex')?.initialCosts[0].id, 'ic_2');

  cache.invalidateScope('h_1', 'uid_alex');
  assert.equal(cache.get('h_1', 'uid_alex'), null);
  assert.ok(cache.get('h_1', 'uid_pareja')); // otro usuario aislado

  cache.invalidateHousehold('h_1');
  assert.equal(cache.get('h_1', 'uid_pareja'), null);
  assert.ok(cache.get('h_2', 'uid_alex')); // otro hogar aislado

  cache.clearAll();
  assert.equal(cache.size(), 0);

  // E) DemoHouseholdRepository.fetchAllInitialCosts funciona bajo demanda
  const repo = new DemoHouseholdRepository();
  const demoCosts = await repo.fetchAllInitialCosts('demo_hogar_santsadurni');
  assert.ok(demoCosts.length > 0);
});

test('26. Fiabilidad — Finalizar compra: idempotencia duradera (recarga/respuesta perdida), sin falsos duplicados y solapamiento entre pareja', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };

  let liveShopping: ShoppingItem[] = [];
  let novTxs: Transaction[] = [];
  const uShop = repo.subscribeShopping(hid, (items) => {
    liveShopping = items;
  });
  const uTx = repo.subscribeTransactionsByMonth(hid, 'demo_alex', '2026-11', (txs) => {
    novTxs = txs;
  });

  // Limpiar previos de la demo para tener carrito controlado
  if (liveShopping.length > 0) {
    await repo.deleteShoppingItemsBulk(
      hid,
      liveShopping.map((i) => i.id)
    );
  }

  const idA = await repo.upsertShoppingItem(hid, { text: 'Leche entera', qty: 2, unit: 'L', done: true }, actorAlex);
  const idB = await repo.upsertShoppingItem(hid, { text: 'Pan molde', qty: 1, unit: 'ud', done: true }, actorAlex);

  const snaps1 = captureShoppingCheckoutSnapshots(liveShopping.filter((i) => i.id === idA || i.id === idB));
  assert.equal(snaps1.length, 2);

  // A) Idempotencia tras fallo de red / recarga de app con el MISMO checkoutId
  const checkoutId1 = generateShoppingCheckoutId();
  assert.equal(isValidShoppingCheckoutId(checkoutId1), true);
  const expectedExpenseId1 = buildCheckoutExpenseId(checkoutId1);

  const txsBefore = novTxs.length;
  const phase1First = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: checkoutId1,
      monthKey: '2026-11',
      concept: 'Compra Mercadona',
      amount: 32.4,
      date: '2026-11-18',
      paidBy: 'demo_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: 'Lista de la compra: Leche entera, Pan molde',
      snapshots: snaps1,
    },
    actorAlex
  );
  assert.equal(phase1First.status, 'committed');
  assert.equal(phase1First.expenseId, expectedExpenseId1);
  assert.equal(phase1First.deletedIds.length, 2);
  assert.equal(novTxs.length, txsBefore + 1);

  // Simular que la respuesta se perdió en red y tras recargar se reintenta con el MISMO checkoutId
  const phase1RetryAfterReload = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: checkoutId1,
      monthKey: '2026-11',
      concept: 'Compra Mercadona',
      amount: 32.4,
      date: '2026-11-18',
      paidBy: 'demo_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: 'Lista de la compra: Leche entera, Pan molde',
      snapshots: snaps1,
    },
    actorAlex
  );
  assert.equal(phase1RetryAfterReload.status, 'already_committed');
  assert.equal(phase1RetryAfterReload.expenseId, expectedExpenseId1);
  // Cero duplicados
  assert.equal(novTxs.length, txsBefore + 1);

  // B) Dos compras reales distintas con MISMA fecha, MISMO importe y MISMO concepto NO deben deduplicarse erróneamente
  const idC = await repo.upsertShoppingItem(hid, { text: 'Fruta', qty: 1, unit: 'kg', done: true }, actorAlex);
  const snaps2 = captureShoppingCheckoutSnapshots(liveShopping.filter((i) => i.id === idC));
  const checkoutId2 = generateShoppingCheckoutId();
  assert.notEqual(checkoutId2, checkoutId1);

  const phase1SecondRealPurchase = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: checkoutId2,
      monthKey: '2026-11',
      concept: 'Compra Mercadona',
      amount: 32.4,
      date: '2026-11-18',
      paidBy: 'demo_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: 'Lista de la compra: Fruta',
      snapshots: snaps2,
    },
    actorAlex
  );
  assert.equal(phase1SecondRealPurchase.status, 'committed');
  assert.equal(novTxs.length, txsBefore + 2);

  // C) Ambos miembros intentan finalizar los mismos productos simultáneamente:
  // Alex confirma y elimina idD/idE; Marta intenta luego con snapshots capturados antes -> overlap_conflict, 0 gasto extra
  const idD = await repo.upsertShoppingItem(hid, { text: 'Huevos', qty: 1, unit: 'docena', done: true }, actorAlex);
  const idE = await repo.upsertShoppingItem(hid, { text: 'Yogures', qty: 6, unit: 'ud', done: true }, actorMarta);
  const sharedSnaps = captureShoppingCheckoutSnapshots(liveShopping.filter((i) => i.id === idD || i.id === idE));

  const alexCheckoutId = generateShoppingCheckoutId();
  const martaCheckoutId = generateShoppingCheckoutId();

  const alexRes = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: alexCheckoutId,
      monthKey: '2026-11',
      concept: 'Compra conjunta',
      amount: 14.2,
      date: '2026-11-19',
      paidBy: 'demo_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: 'Huevos, Yogures',
      snapshots: sharedSnaps,
    },
    actorAlex
  );
  assert.equal(alexRes.status, 'committed');
  assert.equal(novTxs.length, txsBefore + 3);

  const martaRes = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: martaCheckoutId,
      monthKey: '2026-11',
      concept: 'Compra conjunta',
      amount: 14.2,
      date: '2026-11-19',
      paidBy: 'demo_marta',
      splitPctA: 50,
      isPrivate: false,
      notes: 'Huevos, Yogures',
      snapshots: sharedSnaps,
    },
    actorMarta
  );
  assert.equal(martaRes.status, 'overlap_conflict');
  assert.equal(martaRes.alreadyGoneIds.length, 2);
  // Marta NO creó gasto duplicado
  assert.equal(novTxs.length, txsBefore + 3);

  // D) Cancelar antes de confirmar no toca ni la lista ni los gastos
  const idKeep = await repo.upsertShoppingItem(hid, { text: 'Café molido', qty: 1, unit: 'paquete', done: true }, actorAlex);
  const cancelSnapshots = captureShoppingCheckoutSnapshots(liveShopping.filter((i) => i.id === idKeep));
  assert.equal(cancelSnapshots.length, 1);
  // Sin invocar commitShoppingCheckoutPhase1 -> artículo intacto y transacciones iguales
  assert.ok(liveShopping.some((i) => i.id === idKeep && i.done === true));
  assert.equal(novTxs.length, txsBefore + 3);

  uShop();
  uTx();
});

test('27. Fiabilidad — Limpieza multi-lote (>10 productos), fallo intermedio, ediciones concurrentes de pareja y reanudación desde segundo dispositivo', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };

  let liveShopping: ShoppingItem[] = [];
  let pendingCheckouts: import('../types/nido').PendingShoppingCheckout[] = [];
  let novTxs: Transaction[] = [];

  const uShop = repo.subscribeShopping(hid, (items) => {
    liveShopping = items;
  });
  const uPend = repo.subscribePendingShoppingCheckouts(hid, 'demo_alex', (list) => {
    pendingCheckouts = list;
  });
  const uTx = repo.subscribeTransactionsByMonth(hid, 'demo_alex', '2026-11', (txs) => {
    novTxs = txs;
  });

  if (liveShopping.length > 0) {
    await repo.deleteShoppingItemsBulk(
      hid,
      liveShopping.map((i) => i.id)
    );
  }

  // Crear 14 productos marcados (10 en lote 1 + 4 en lote 2) + 1 pendiente sin marcar
  const createdIds: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const id = await repo.upsertShoppingItem(
      hid,
      { text: `Producto ${String(i).padStart(2, '0')}`, qty: 1, unit: 'ud', done: true },
      actorAlex
    );
    createdIds.push(id);
  }
  const uncheckedId = await repo.upsertShoppingItem(
    hid,
    { text: 'Artículo pendiente sin coger', qty: 1, unit: 'ud', done: false },
    actorAlex
  );

  // Asegurar que las fechas de los artículos quedan estrictamente antes de la compra (para el chequeo cross-device)
  await new Promise((r) => setTimeout(r, 15));

  const snaps = captureShoppingCheckoutSnapshots(liveShopping.filter((i) => i.done));
  assert.equal(snaps.length, 14);
  assert.equal(MAX_CHECKOUT_BATCH_ITEMS, 10);

  const checkoutId = generateShoppingCheckoutId();
  const inFlightRef = { current: false };
  const txsBefore = novTxs.length;

  // Primer intento: Fase 1 compromete gasto + 10 borrados + crea pendingShoppingCheckouts con 4 pendientes;
  // pero el lote 2 falla por corte de red simulado.
  const firstRun = await executeDurableShoppingCheckout({
    input: {
      checkoutId,
      monthKey: '2026-11',
      concept: 'Compra grande semanal',
      amount: 112.8,
      date: '2026-11-20',
      paidBy: 'demo_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: '14 artículos',
      snapshots: snaps,
    },
    inFlightRef,
    commitPhase1: (inp) => repo.commitShoppingCheckoutPhase1(hid, inp, actorAlex),
    cleanupBatch: async () => {
      throw new Error('Corte de red simulado en lote 2');
    },
  });

  assert.equal(firstRun.status, 'cleanup_partial');
  assert.equal(firstRun.deletedCount, 10);
  assert.equal(firstRun.remainingItemIds.length, 4);
  assert.equal(novTxs.length, txsBefore + 1);
  assert.equal(pendingCheckouts.length, 1);
  assert.equal(pendingCheckouts[0].id, checkoutId);
  assert.equal(pendingCheckouts[0].pendingItemIds.length, 4);

  // Antes de reanudar el lote 2, la pareja (Marta) modifica concurrentemente los 4 restantes:
  // - remaining[0]: Marta edita cantidad (1 -> 3) -> debe conservarse
  // - remaining[1]: Marta desmarca (done: false) -> debe conservarse
  // - remaining[2] y remaining[3]: sin tocar -> deben borrarse
  // - Marta añade un producto nuevo marcado -> jamás debe borrarse
  const remainingIds = [...pendingCheckouts[0].pendingItemIds];
  const editedTarget = liveShopping.find((i) => i.id === remainingIds[0])!;
  const uncheckedTarget = liveShopping.find((i) => i.id === remainingIds[1])!;

  await new Promise((r) => setTimeout(r, 15));
  await repo.upsertShoppingItem(
    hid,
    { id: editedTarget.id, text: editedTarget.text, qty: 3, unit: editedTarget.unit, done: true },
    actorMarta
  );
  await repo.upsertShoppingItem(
    hid,
    { id: uncheckedTarget.id, text: uncheckedTarget.text, qty: uncheckedTarget.qty, unit: uncheckedTarget.unit, done: false },
    actorMarta
  );
  const partnerNewId = await repo.upsertShoppingItem(
    hid,
    { text: 'Nuevo artículo de Marta', qty: 1, unit: 'ud', done: true },
    actorMarta
  );

  // Reanudar desde un SEGUNDO DISPOSITIVO (sin snapshotsById local -> usa verificación por updatedAt <= checkout.createdAt)
  const batch2Res = await repo.cleanupShoppingCheckoutBatch(hid, checkoutId, undefined);
  assert.equal(batch2Res.completed, true);
  assert.equal(batch2Res.remainingItemIds.length, 0);
  assert.deepEqual(
    [...batch2Res.deletedIds].sort(),
    [remainingIds[2], remainingIds[3]].sort()
  );
  assert.deepEqual(
    [...batch2Res.skippedConcurrentIds].sort(),
    [editedTarget.id, uncheckedTarget.id].sort()
  );

  // El gasto NO se duplicó y el documento pendingShoppingCheckouts se eliminó al terminar
  assert.equal(novTxs.length, txsBefore + 1);
  assert.equal(pendingCheckouts.length, 0);

  // Verificar exactamente qué sobrevivió en la lista viva
  const survivingIds = new Set(liveShopping.map((i) => i.id));
  assert.equal(survivingIds.has(uncheckedId), true);
  assert.equal(survivingIds.has(editedTarget.id), true);
  assert.equal(liveShopping.find((i) => i.id === editedTarget.id)?.qty, 3);
  assert.equal(survivingIds.has(uncheckedTarget.id), true);
  assert.equal(liveShopping.find((i) => i.id === uncheckedTarget.id)?.done, false);
  assert.equal(survivingIds.has(partnerNewId), true);
  assert.equal(survivingIds.has(remainingIds[2]), false);
  assert.equal(survivingIds.has(remainingIds[3]), false);

  // Comprobar también función pura isShoppingItemSafeForCrossDeviceCleanup
  assert.equal(
    isShoppingItemSafeForCrossDeviceCleanup(
      { done: true, updatedAt: '2026-11-20T10:00:00.000Z' },
      '2026-11-20T10:00:05.000Z'
    ),
    true
  );
  assert.equal(
    isShoppingItemSafeForCrossDeviceCleanup(
      { done: true, updatedAt: '2026-11-20T10:00:06.000Z' },
      '2026-11-20T10:00:05.000Z'
    ),
    false
  );
  assert.equal(
    isShoppingItemSafeForCrossDeviceCleanup(
      { done: false, updatedAt: '2026-11-20T09:59:00.000Z' },
      '2026-11-20T10:00:05.000Z'
    ),
    false
  );

  uShop();
  uPend();
  uTx();
});

test('28. Fiabilidad — Estado local de checkout pendiente aislado por (householdId, viewerUid)', () => {
  const mem = new Map<string, string>();
  const prevStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return mem.size;
      },
      key(index: number) {
        return Array.from(mem.keys())[index] ?? null;
      },
      getItem(k: string) {
        return mem.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        mem.set(k, v);
      },
      removeItem(k: string) {
        mem.delete(k);
      },
      clear() {
        mem.clear();
      },
    },
  });

  try {
    const cid = generateShoppingCheckoutId();
    saveLocalPendingCheckout({
      checkoutId: cid,
      expenseId: buildCheckoutExpenseId(cid),
      householdId: 'h_1',
      viewerUid: 'uid_alex',
      monthKey: '2026-11',
      concept: 'Compra',
      amount: 45,
      date: '2026-11-20',
      paidBy: 'uid_alex',
      splitPctA: 50,
      isPrivate: true,
      notes: '',
      snapshots: [],
      state: 'committing',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z',
    });

    assert.equal(loadLocalPendingCheckout('h_1', 'uid_alex')?.checkoutId, cid);
    // Aislamiento estricto: otro usuario u otro hogar no lo ve
    assert.equal(loadLocalPendingCheckout('h_1', 'uid_marta'), null);
    assert.equal(loadLocalPendingCheckout('h_2', 'uid_alex'), null);

    clearLocalPendingCheckout('h_1', 'uid_alex');
    assert.equal(loadLocalPendingCheckout('h_1', 'uid_alex'), null);

    saveLocalPendingCheckout({
      checkoutId: cid,
      expenseId: buildCheckoutExpenseId(cid),
      householdId: 'h_1',
      viewerUid: 'uid_alex',
      monthKey: '2026-11',
      concept: 'Compra',
      amount: 45,
      date: '2026-11-20',
      paidBy: 'uid_alex',
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: [],
      state: 'committing',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z',
    });
    clearAllLocalPendingCheckouts();
    assert.equal(loadLocalPendingCheckout('h_1', 'uid_alex'), null);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: prevStorage,
    });
  }
});

test('29. Fiabilidad — Meses cerrados protegidos en capa de datos (gastos, presupuestos, checkout e importación)', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  let octTxs: Transaction[] = [];
  const uTx = repo.subscribeTransactionsByMonth(hid, 'demo_alex', '2026-10', (txs) => {
    octTxs = txs;
  });

  // Crear gasto y presupuesto en 2026-10 estando abierto
  const txOctId = await repo.upsertTransaction(
    hid,
    {
      monthKey: '2026-10',
      concept: 'Gasto octubre abierto',
      category: 'supermercado',
      amount: 50,
      date: '2026-10-12',
      paidBy: 'demo_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'demo_alex',
      notes: '',
    },
    actorAlex
  );
  await repo.saveBudget(hid, '2026-10', { supermercado: 400 }, actorAlex);

  // Cerrar 2026-10
  await repo.closeMonth(
    hid,
    {
      monthKey: '2026-10',
      totalSpent: 50,
      paidA: 50,
      paidB: 0,
      paidComun: 0,
      shareA: 25,
      shareB: 25,
      balanceA: 25,
      settlementText: 'Cerrado prueba',
      closedBy: 'demo_alex',
    },
    actorAlex
  );

  // Crear, editar, borrar gasto y guardar presupuesto o finalizar compra en mes cerrado deben fallar
  await assert.rejects(
    () =>
      repo.upsertTransaction(
        hid,
        {
          monthKey: '2026-10',
          concept: 'Intento en mes cerrado',
          category: 'ocio',
          amount: 20,
          date: '2026-10-15',
          paidBy: 'demo_alex',
          recurringId: null,
          splitPctA: 50,
          isSettlement: false,
          settlementTo: '',
          isPrivate: false,
          createdBy: 'demo_alex',
          notes: '',
        },
        actorAlex
      ),
    /cerrado/i
  );

  await assert.rejects(
    () => repo.deleteTransaction(hid, txOctId, 'Gasto octubre abierto', actorAlex),
    /cerrado/i
  );

  await assert.rejects(
    () => repo.saveBudget(hid, '2026-10', { supermercado: 999 }, actorAlex),
    /cerrado/i
  );

  const shopForClosedId = await repo.upsertShoppingItem(
    hid,
    { text: 'Pan octubre', qty: 1, unit: 'ud', done: true },
    actorAlex
  );
  await assert.rejects(
    () =>
      repo.commitShoppingCheckoutPhase1(
        hid,
        {
          checkoutId: generateShoppingCheckoutId(),
          monthKey: '2026-10',
          concept: 'Compra en mes cerrado',
          amount: 30,
          date: '2026-10-18',
          paidBy: 'demo_alex',
          splitPctA: 50,
          isPrivate: false,
          notes: '',
          snapshots: [
            {
              id: shopForClosedId,
              text: 'Pan octubre',
              qty: 1,
              unit: 'ud',
              done: true,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        actorAlex
      ),
    /cerrado/i
  );

  // importBackup NO sobrescribe el mes ya cerrado 2026-10
  const backup = await repo.exportBackup(hid, 'demo_alex');
  const modifiedBackup: NidoBackupV1 = {
    ...backup,
    transactions: [
      ...backup.transactions,
      {
        id: 'tx_injected_closed_oct',
        monthKey: '2026-10',
        concept: 'Inyectado en mes cerrado',
        category: 'otros',
        amount: 999,
        date: '2026-10-25',
        paidBy: 'demo_alex',
        recurringId: null,
        splitPctA: 50,
        isSettlement: false,
        settlementTo: '',
        isPrivate: false,
        createdBy: 'demo_alex',
        notes: '',
      },
    ],
  };
  await repo.importBackup(hid, modifiedBackup, actorAlex);
  assert.equal(
    octTxs.some((t) => t.id === 'tx_injected_closed_oct'),
    false
  );

  // Reabrir 2026-10 vuelve a permitir editar
  await repo.reopenMonth(hid, '2026-10', actorAlex);
  await repo.saveBudget(hid, '2026-10', { supermercado: 420 }, actorAlex);

  uTx();
});

test('30. Fiabilidad — PWA update guard: bloqueos de edición/escritura, detección de chunk obsoleto y anti-bucle de recarga', () => {
  resetPwaGuardForTests();
  assert.equal(getPwaReloadBlockStatus().blocked, false);

  const releaseEdit = acquirePwaEditLock();
  assert.equal(getPwaReloadBlockStatus().blocked, true);
  assert.equal(getPwaReloadBlockStatus().reason, 'unsaved_form');

  // Escritura pendiente tiene prioridad sobre formulario abierto
  const releaseWrite = acquirePwaWriteLock();
  assert.equal(getPwaReloadBlockStatus().reason, 'pending_write');

  releaseWrite();
  assert.equal(getPwaReloadBlockStatus().reason, 'unsaved_form');

  releaseEdit();
  assert.equal(getPwaReloadBlockStatus().blocked, false);

  // Anti-bucle de recarga ante chunks obsoletos
  const mem = new Map<string, string>();
  const mockSession = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  const t0 = 1_700_000_000_000;
  assert.equal(canTriggerSafeChunkReload(t0, mockSession), true);
  assert.equal(recordSafeChunkReloadAttempt(t0, mockSession), true);
  // 2º intento dentro de 60s queda bloqueado para evitar bucles infinitos
  assert.equal(canTriggerSafeChunkReload(t0 + 10_000, mockSession), false);
  assert.equal(recordSafeChunkReloadAttempt(t0 + 10_000, mockSession), false);
  // Pasada la ventana de 60s vuelve a permitirse
  assert.equal(canTriggerSafeChunkReload(t0 + 61_000, mockSession), true);

  clearSafeChunkReloadAttempts(mockSession);
  assert.equal(canTriggerSafeChunkReload(t0 + 5_000, mockSession), true);

  // Detección de errores de chunks obsoletos
  assert.equal(
    isLikelyStaleChunkError(new Error('Failed to fetch dynamically imported module: /assets/AhorrosView-abc.js')),
    true
  );
  assert.equal(isLikelyStaleChunkError(new Error('Importing a module script failed.')), true);
  assert.equal(isLikelyStaleChunkError(new Error('Error genérico de validación')), false);
});

test('31. Fiabilidad — Recuperación ≤10 artículos: servidor confirma, respuesta perdida, cierre de sesión y reentrada sin duplicar gasto', async () => {
  const mem = new Map<string, string>();
  const prevStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return mem.size;
      },
      key(index: number) {
        return Array.from(mem.keys())[index] ?? null;
      },
      getItem(k: string) {
        return mem.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        mem.set(k, v);
      },
      removeItem(k: string) {
        mem.delete(k);
      },
      clear() {
        mem.clear();
      },
    },
  });

  try {
    const repo = new DemoHouseholdRepository();
    const hid = 'demo_hogar_santsadurni';
    const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

    let liveShop: ShoppingItem[] = [];
    let liveTxs: Transaction[] = [];
    let livePending: PendingShoppingCheckout[] = [];
    const uShop = repo.subscribeShopping(hid, (s) => {
      liveShop = s;
    });
    const uTx = repo.subscribeTransactionsByMonth(hid, 'demo_alex', '2026-11', (txs) => {
      liveTxs = txs;
    });
    const uPend = repo.subscribePendingShoppingCheckouts(hid, 'demo_alex', (p) => {
      livePending = p;
    });

    // Crear 4 artículos marcados (≤ 10, se liquidan atómicamente en Fase 1 sin documento shoppingCheckouts)
    const itemIds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = await repo.upsertShoppingItem(
        hid,
        { text: `Básico cierre ${i}`, qty: 1, unit: 'ud', done: true },
        actorAlex
      );
      itemIds.push(id);
    }
    const snapshots = captureShoppingCheckoutSnapshots(
      liveShop.filter((s) => itemIds.includes(s.id))
    );
    assert.equal(snapshots.length, 4);

    const txCountBefore = liveTxs.length;
    const checkoutId1 = generateShoppingCheckoutId();
    const inFlight = { current: false };

    // 1) El cliente guarda el estado local antes de enviar y el servidor CONFIRMA la transacción,
    // pero la respuesta de red se pierde en el camino de vuelta al cliente.
    const lostResponseRes = await executeDurableShoppingCheckout({
      input: {
        checkoutId: checkoutId1,
        monthKey: '2026-11',
        concept: 'Compra semanal ≤10',
        amount: 34.8,
        date: '2026-11-21',
        paidBy: COMMON_ACCOUNT_ID,
        splitPctA: 50,
        isPrivate: true,
        notes: 'Privado sensible',
        snapshots,
      },
      inFlightRef: inFlight,
      onPhase1Persisting: () => {
        saveLocalPendingCheckout({
          checkoutId: checkoutId1,
          expenseId: buildCheckoutExpenseId(checkoutId1),
          householdId: hid,
          viewerUid: actorAlex.uid,
          monthKey: '2026-11',
          concept: 'Compra semanal ≤10',
          amount: 34.8,
          date: '2026-11-21',
          paidBy: COMMON_ACCOUNT_ID,
          splitPctA: 50,
          isPrivate: true,
          notes: 'Privado sensible',
          snapshots,
          state: 'committing',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      },
      commitPhase1: async (inp) => {
        const committed = await repo.commitShoppingCheckoutPhase1(hid, inp, actorAlex);
        assert.equal(committed.status, 'committed');
        // Simulamos pérdida de respuesta tras confirmar el servidor
        throw new Error('network-lost-after-server-commit');
      },
      cleanupBatch: (id, snapsById) => repo.cleanupShoppingCheckoutBatch(hid, id, snapsById),
    });

    assert.equal(lostResponseRes.status, 'phase1_failed');
    // En servidor el gasto YA existe una sola vez, los 4 productos ya están borrados y NO hay shoppingCheckouts pendientes
    assert.equal(liveTxs.length, txCountBefore + 1);
    assert.equal(livePending.length, 0);
    assert.equal(liveShop.filter((s) => itemIds.includes(s.id)).length, 0);
    // Mientras siga logueado, existe el registro local
    assert.ok(loadLocalPendingCheckout(hid, actorAlex.uid));

    // 2) El usuario cierra sesión (o cambia de hogar): se limpia todo rastro local de checkout (0 fuga de datos privados)
    clearAllLocalPendingCheckouts();
    const remainingPendingKeys = Array.from(mem.keys()).filter((k) =>
      k.startsWith('nido_pending_checkout_v1:')
    );
    assert.equal(remainingPendingKeys.length, 0);
    assert.equal(loadLocalPendingCheckout(hid, actorAlex.uid), null);

    // 3) Al volver a entrar:
    // a) La lista sincronizada ya no tiene esos 4 artículos marcados y el gasto aparece una única vez.
    assert.equal(liveShop.filter((s) => itemIds.includes(s.id)).length, 0);
    assert.equal(
      liveTxs.filter((t) => t.id === buildCheckoutExpenseId(checkoutId1)).length,
      1
    );

    // b) Incluso si un cliente desactualizado o pestaña en caché reintenta con un NUEVO checkoutId
    //    sobre las mismas instantáneas, el servidor detecta que ya fueron retirados y aborta con overlap_conflict
    //    SIN crear ningún gasto duplicado.
    const retryAfterRelogin = await executeDurableShoppingCheckout({
      input: {
        checkoutId: generateShoppingCheckoutId(),
        monthKey: '2026-11',
        concept: 'Compra semanal ≤10',
        amount: 34.8,
        date: '2026-11-21',
        paidBy: COMMON_ACCOUNT_ID,
        splitPctA: 50,
        isPrivate: true,
        notes: 'Privado sensible',
        snapshots,
      },
      inFlightRef: { current: false },
      commitPhase1: (inp) => repo.commitShoppingCheckoutPhase1(hid, inp, actorAlex),
      cleanupBatch: (id, snapsById) => repo.cleanupShoppingCheckoutBatch(hid, id, snapsById),
    });

    assert.equal(retryAfterRelogin.status, 'overlap_conflict');
    if (retryAfterRelogin.status === 'overlap_conflict') {
      assert.equal(retryAfterRelogin.alreadyGoneIds.length, 4);
    }
    // El número total de gastos permanece estrictamente en txCountBefore + 1 (0 duplicados)
    assert.equal(liveTxs.length, txCountBefore + 1);

    uShop();
    uTx();
    uPend();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: prevStorage,
    });
  }
});

test('32. Fiabilidad — Cierres >10 artículos con solapamiento exclusivo en lote 2+ (secuencial y carrera simultánea)', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };

  let liveShop: ShoppingItem[] = [];
  let liveTxs: Transaction[] = [];
  let livePending: PendingShoppingCheckout[] = [];
  const uShop = repo.subscribeShopping(hid, (s) => {
    liveShop = s;
  });
  const uTx = repo.subscribeTransactionsByMonth(hid, 'demo_alex', '2026-11', (txs) => {
    liveTxs = txs;
  });
  const uPend = repo.subscribePendingShoppingCheckouts(hid, 'demo_alex', (p) => {
    livePending = p;
  });

  // Helper para crear conjuntos de artículos con IDs deterministas que separen lote 1 (1..10) y lote 2 (z01, z02)
  const seedDisjointWithBatch2Overlap = async (prefix: string) => {
    const aIds: string[] = [];
    const bIds: string[] = [];
    const sharedIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const idA = await repo.upsertShoppingItem(
        hid,
        { id: `${prefix}_a_${String(i).padStart(2, '0')}`, text: `LoteA ${i}`, qty: 1, unit: 'ud', done: true },
        actorAlex
      );
      aIds.push(idA);
      const idB = await repo.upsertShoppingItem(
        hid,
        { id: `${prefix}_b_${String(i).padStart(2, '0')}`, text: `LoteB ${i}`, qty: 1, unit: 'ud', done: true },
        actorMarta
      );
      bIds.push(idB);
    }
    for (let i = 1; i <= 2; i++) {
      const idZ = await repo.upsertShoppingItem(
        hid,
        { id: `${prefix}_z_${String(i).padStart(2, '0')}`, text: `SolapadoLote2 ${i}`, qty: 1, unit: 'ud', done: true },
        actorAlex
      );
      sharedIds.push(idZ);
    }
    const snapsA = captureShoppingCheckoutSnapshots(
      liveShop.filter((s) => aIds.includes(s.id) || sharedIds.includes(s.id))
    );
    const snapsB = captureShoppingCheckoutSnapshots(
      liveShop.filter((s) => bIds.includes(s.id) || sharedIds.includes(s.id))
    );
    assert.equal(snapsA.length, 12);
    assert.equal(snapsB.length, 12);
    // Comprobar que el lote 1 de A y el lote 1 de B son completamente disjuntos y que sharedIds caen en lote 2 (índices 10 y 11)
    assert.deepEqual(
      snapsA.slice(10).map((s) => s.id),
      sharedIds
    );
    assert.deepEqual(
      snapsB.slice(10).map((s) => s.id),
      sharedIds
    );
    return { aIds, bIds, sharedIds, snapsA, snapsB };
  };

  // === SUBCASO B1: Alex completa su cierre de 12 artículos (borrando z_01 y z_02 en lote 2).
  //     Marta inicia Fase 1 con sus 12 artículos (lote 1 100% intacto, solapamiento SOLO en lote 2).
  //     Fase 1 debe leer también lotes posteriores y abortar con overlap_conflict sin crear gasto para Marta. ===
  const case1 = await seedDisjointWithBatch2Overlap('seq');
  const txBeforeB1 = liveTxs.length;

  const alexRes1 = await executeDurableShoppingCheckout({
    input: {
      checkoutId: generateShoppingCheckoutId(),
      monthKey: '2026-11',
      concept: 'Compra Alex B1',
      amount: 72,
      date: '2026-11-21',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: case1.snapsA,
    },
    inFlightRef: { current: false },
    commitPhase1: (inp) => repo.commitShoppingCheckoutPhase1(hid, inp, actorAlex),
    cleanupBatch: (id, snapsById) => repo.cleanupShoppingCheckoutBatch(hid, id, snapsById),
  });
  assert.equal(alexRes1.status, 'completed');
  if (alexRes1.status === 'completed') {
    assert.equal(alexRes1.deletedCount, 12);
    assert.equal(alexRes1.alreadyGoneCount, 0);
  }
  assert.equal(liveTxs.length, txBeforeB1 + 1);

  const martaRes1 = await executeDurableShoppingCheckout({
    input: {
      checkoutId: generateShoppingCheckoutId(),
      monthKey: '2026-11',
      concept: 'Compra Marta B1',
      amount: 68,
      date: '2026-11-21',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: case1.snapsB,
    },
    inFlightRef: { current: false },
    commitPhase1: (inp) => repo.commitShoppingCheckoutPhase1(hid, inp, actorMarta),
    cleanupBatch: (id, snapsById) => repo.cleanupShoppingCheckoutBatch(hid, id, snapsById),
  });
  assert.equal(martaRes1.status, 'overlap_conflict');
  if (martaRes1.status === 'overlap_conflict') {
    assert.deepEqual(martaRes1.alreadyGoneIds, case1.sharedIds);
  }
  // Cero gasto duplicado para Marta y los 10 artículos propios de Marta siguen intactos en la lista
  assert.equal(liveTxs.length, txBeforeB1 + 1);
  assert.equal(liveShop.filter((s) => case1.bIds.includes(s.id)).length, 10);

  // === SUBCASO B2: Carrera real simultánea en Fase 1 sobre lotes 1 disjuntos que colisionan SOLO en lote 2.
  //     Tanto Alex como Marta comprometen Fase 1 antes de que ninguno ejecute Fase 2.
  //     Alex limpia lote 2 primero; al limpiar Marta su lote 2, executeDurableShoppingCheckout
  //     debe contabilizar alreadyGoneCount === 2, cerrar su shoppingCheckouts y avisar explícitamente. ===
  const case2 = await seedDisjointWithBatch2Overlap('race');
  const chkAlex = generateShoppingCheckoutId();
  const chkMarta = generateShoppingCheckoutId();

  const phase1Alex = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: chkAlex,
      monthKey: '2026-11',
      concept: 'Compra Alex B2',
      amount: 55,
      date: '2026-11-21',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: case2.snapsA,
    },
    actorAlex
  );
  const phase1Marta = await repo.commitShoppingCheckoutPhase1(
    hid,
    {
      checkoutId: chkMarta,
      monthKey: '2026-11',
      concept: 'Compra Marta B2',
      amount: 60,
      date: '2026-11-21',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: case2.snapsB,
    },
    actorMarta
  );
  assert.equal(phase1Alex.status, 'committed');
  assert.equal(phase1Marta.status, 'committed');

  // Alex ejecuta su lote 2 primero -> retira los 2 artículos solapados limpiamente
  const alexBatch2 = await repo.cleanupShoppingCheckoutBatch(
    hid,
    chkAlex,
    Object.fromEntries(case2.snapsA.map((s) => [s.id, s]))
  );
  assert.equal(alexBatch2.completed, true);
  assert.deepEqual(alexBatch2.deletedIds, case2.sharedIds);
  assert.equal(alexBatch2.alreadyGoneIds.length, 0);

  // Marta completa su operación vía executeDurableShoppingCheckout (reutilizando su Fase 1 ya comprometida):
  // NO duplica su gasto, cierra shoppingCheckouts/chkMarta y reporta alreadyGoneCount === 2
  const txCountBeforeMartaPhase2 = liveTxs.length;
  const martaPhase2Res = await executeDurableShoppingCheckout({
    input: {
      checkoutId: chkMarta,
      monthKey: '2026-11',
      concept: 'Compra Marta B2',
      amount: 60,
      date: '2026-11-21',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isPrivate: false,
      notes: '',
      snapshots: case2.snapsB,
    },
    inFlightRef: { current: false },
    commitPhase1: (inp) => repo.commitShoppingCheckoutPhase1(hid, inp, actorMarta),
    cleanupBatch: (id, snapsById) => repo.cleanupShoppingCheckoutBatch(hid, id, snapsById),
  });

  assert.equal(martaPhase2Res.status, 'completed');
  if (martaPhase2Res.status === 'completed') {
    assert.equal(martaPhase2Res.reusedExistingExpense, true);
    assert.equal(martaPhase2Res.deletedCount, 0);
    assert.equal(martaPhase2Res.alreadyGoneCount, 2);
  }
  assert.equal(liveTxs.length, txCountBeforeMartaPhase2);
  assert.equal(livePending.length, 0);

  uShop();
  uTx();
  uPend();
});

test('33. Categorías — Creación manual/sugerida, 14 visibles iniciales idempotentes, orden personalizable y edición segura', async () => {
  // 1) IDs seguros incluso con nombres de 1 carácter o símbolos
  const singleCharId = generateCustomCategoryId('A', []);
  assert.ok(isCustomCategoryId(singleCharId));
  assert.ok(singleCharId.length >= 6);
  assert.equal(singleCharId, 'cat_a_cat');

  const symbolOnlyId = generateCustomCategoryId('!!!', []);
  assert.ok(isCustomCategoryId(symbolOnlyId));
  assert.equal(symbolOnlyId, 'cat_custom');

  const dupId = generateCustomCategoryId('A', [singleCharId]);
  assert.ok(isCustomCategoryId(dupId));
  assert.notEqual(dupId, singleCharId);

  // 2) Flujo en repositorio: creación manual + sugerida + reintento idempotente
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const actorMarta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };

  let customCats: CustomCategory[] = [];
  let prefsAlex: MemberCategoryPreferences | null = null;
  let prefsMarta: MemberCategoryPreferences | null = null;
  const uCats = repo.subscribeCustomCategories(hid, (c) => {
    customCats = c;
  });
  const uPrefA = repo.subscribeMemberCategoryPreferences(hid, 'demo_alex', (p) => {
    prefsAlex = p;
  });
  const uPrefM = repo.subscribeMemberCategoryPreferences(hid, 'demo_marta', (p) => {
    prefsMarta = p;
  });

  // Inicialización de las 14 visibles iniciales (sistema + sugerencias) sin duplicar sugerencias existentes
  const suggestionGym = CUSTOM_CATEGORY_SUGGESTIONS.find((s) => s.key === 'gimnasio_deporte')!;
  const manualSuggestedId = await repo.upsertCustomCategory(
    hid,
    {
      id: `cat_${suggestionGym.key}`,
      name: suggestionGym.name,
      color: suggestionGym.color,
      icon: suggestionGym.icon,
      order: 1,
      archived: false,
      csvKeywords: suggestionGym.csvKeywords,
    },
    actorAlex
  );
  assert.equal(manualSuggestedId, 'cat_gimnasio_deporte');

  const firstSetup = await repo.ensureInitialVisibleCategoriesSetup(hid, 'demo_alex', actorAlex);
  assert.equal(firstSetup.selectorVersion, CATEGORY_SELECTOR_PREFS_VERSION);
  assert.equal(firstSetup.visibleCategoryIds.length, INITIAL_VISIBLE_CATEGORY_SPEC.length);
  assert.equal(firstSetup.visibleCategoryIds.length, 14);
  assert.deepEqual(
    firstSetup.visibleCategoryIds,
    INITIAL_VISIBLE_CATEGORY_SPEC.map((e) => (e.type === 'system' ? e.id : `cat_${e.id}`))
  );
  assert.equal(
    customCats.filter((c) => c.id === 'cat_gimnasio_deporte').length,
    1,
    'No debe duplicar una categoría sugerida ya existente'
  );

  // Personalización por usuario: Alex oculta y reordena; asegurar que ensureInitialVisibleCategoriesSetup no sobrescribe
  await repo.saveMemberCategoryPreferences(hid, 'demo_alex', {
    selectorVersion: CATEGORY_SELECTOR_PREFS_VERSION,
    visibleCategoryIds: ['otros', 'supermercado'],
  });
  const afterCustomSetup = await repo.ensureInitialVisibleCategoriesSetup(hid, 'demo_alex', actorAlex);
  assert.deepEqual(afterCustomSetup.visibleCategoryIds, ['otros', 'supermercado']);
  assert.deepEqual((prefsAlex as MemberCategoryPreferences | null)?.visibleCategoryIds, [
    'otros',
    'supermercado',
  ]);

  // Marta conserva su configuración independiente (no se filtra ni pisa la de Alex)
  assert.equal(prefsMarta, null);
  await repo.ensureInitialVisibleCategoriesSetup(hid, 'demo_marta', actorMarta);
  assert.equal((prefsMarta as MemberCategoryPreferences | null)?.visibleCategoryIds.length, 14);

  // Crear categoría manual de 1 letra y verificar visibilidad + edición segura de oculta/archivada
  const tinyId = await repo.upsertCustomCategory(
    hid,
    {
      name: 'X',
      color: '#0f766e',
      icon: 'tag',
      order: 99,
      archived: false,
      csvKeywords: '',
    },
    actorAlex
  );
  assert.equal(tinyId, 'cat_x_cat');

  const regActive = buildCategoryRegistry(customCats);
  const sel = resolveSelectorCategories(regActive, prefsAlex, tinyId);
  assert.deepEqual(
    sel.visibleCategories.map((c) => c.id),
    ['otros', 'supermercado']
  );
  assert.equal(sel.selectedOutsideVisible?.id, tinyId);
  assert.ok(sel.hiddenCategories.some((c) => c.id === tinyId));

  // Archivar la categoría oculta y comprobar que resolveSelectorCategories la mantiene accesible al editar un gasto histórico
  await repo.upsertCustomCategory(
    hid,
    {
      id: tinyId,
      name: 'X',
      color: '#0f766e',
      icon: 'tag',
      order: 99,
      archived: true,
      csvKeywords: '',
    },
    actorAlex
  );
  const regArchived = buildCategoryRegistry(customCats);
  const selArchivedEdit = resolveSelectorCategories(regArchived, prefsAlex, tinyId);
  assert.equal(selArchivedEdit.selectedOutsideVisible?.id, tinyId);
  assert.equal(selArchivedEdit.selectedOutsideVisible?.archived, true);

  uCats();
  uPrefA();
  uPrefM();
});

test('34. Iconos de categorías — Todas las categorías de sistema, liquidación y personalizadas tienen icono válido y fallback seguro', () => {
  const validIcons = new Set<string>([...CATEGORY_ICON_KEYS, 'arrow-left-right']);
  const reg = buildCategoryRegistry([
    {
      id: 'cat_valida',
      name: 'Válida',
      color: '#112233',
      icon: 'coffee',
      order: 1,
      archived: false,
      csvKeywords: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'cat_corrupta',
      name: 'Corrupta',
      color: '#112233',
      icon: 'icono-inexistente' as unknown as CustomCategory['icon'],
      order: 2,
      archived: false,
      csvKeywords: '',
      createdAt: '',
      updatedAt: '',
    },
  ]);

  for (const cat of reg.allKnownCategories) {
    assert.ok(validIcons.has(cat.icon), `Icono inválido en ${cat.id}: ${cat.icon}`);
  }
  assert.equal(reg.getIcon('liquidacion'), 'arrow-left-right');
  assert.equal(reg.getIcon('cat_valida'), 'coffee');
  assert.equal(reg.getIcon('cat_corrupta'), 'tag');
  assert.equal(reg.getIcon('cat_desconocida'), 'tag');
});

test('35. Catálogo Mercadona depurado — Clasificación real, Sin clasificar y exclusión de ruido', () => {
  const catalogPath = path.resolve(process.cwd(), 'public/data/mercadona-catalog.v1.json');
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    license: string;
    source: string;
    count: number;
    sectionCounts?: Record<string, number>;
    items: StaticMercadonaCatalogEntry[];
  };

  assert.equal(raw.items.length, 9890);
  assert.equal(raw.count, 9890);
  assert.match(raw.license, /ODbL/i);

  const byName = new Map(raw.items.map((e) => [e.name, e]));

  const huevos = byName.get('12 huevos frescos');
  assert.ok(huevos, 'Debe existir 12 huevos frescos');
  assert.equal(huevos.section, 'Carne, charcutería y huevos');

  const mandarinas = byName.get('1 KG Mandarinas');
  assert.ok(mandarinas, 'Debe existir 1 KG Mandarinas');
  assert.equal(mandarinas.section, 'Fruta y verdura');

  const entrepinares = raw.items.find((e) => e.name.toLowerCase().includes('entrepinares'));
  assert.ok(entrepinares, 'Debe existir queso Entrepinares');
  assert.equal(entrepinares.section, 'Lácteos, quesos y bebidas vegetales');

  const sinClasificarCount = raw.items.filter((e) => e.section === 'Sin clasificar').length;
  assert.ok(sinClasificarCount > 0, 'Debe existir la sección Sin clasificar para ambiguos reales');

  // Términos cortos válidos siguen activos; palabras ruido quedan excluidas
  const excludedNames = new Set(
    raw.items.filter((e) => e.excludedFromSuggestions).map((e) => e.name.toLowerCase())
  );
  assert.ok(excludedNames.has('no'));
  assert.ok(excludedNames.has('se'));
  assert.ok(excludedNames.has('ghn'));

  const teaEntry = raw.items.find((e) => e.name.toLowerCase() === 'té');
  if (teaEntry) {
    assert.ok(!teaEntry.excludedFromSuggestions);
  }

  const preindexed = preindexMercadonaCatalog(raw.items);
  const noMatches = searchShoppingSuggestions('no', [], preindexed, 50);
  assert.ok(
    !noMatches.some((s) => s.text.toLowerCase() === 'no'),
    'Los registros excluidos no deben aparecer en sugerencias'
  );
  assert.equal(inferShoppingSection('Producto inventado xyz123'), 'Sin clasificar');
});

test('36. Listas reutilizables de compra — Sin ejemplos pre-creados, modos de aplicación y unidades incompatibles', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  let templates: ShoppingListTemplate[] = [];
  let shopping: ShoppingItem[] = [];
  const uTpl = repo.subscribeShoppingTemplates(hid, (t) => {
    templates = t;
  });
  const uShop = repo.subscribeShopping(hid, (s) => {
    shopping = s;
  });

  // Sin ejemplos pre-creados
  assert.equal(templates.length, 0);

  // Limpiar lista activa para probar con control total
  if (shopping.length > 0) {
    await repo.deleteShoppingItemsBulk(
      hid,
      shopping.map((i) => i.id)
    );
  }
  assert.equal(shopping.length, 0);

  // Crear plantilla NO altera la lista activa
  const tplId = await repo.upsertShoppingTemplate(
    hid,
    {
      name: 'Compra semanal',
      items: [
        { text: 'Leche entera', qty: 2, unit: 'L', section: 'Lácteos, quesos y bebidas vegetales' },
        { text: 'Leche desnatada', qty: 1, unit: 'L', section: 'Lácteos, quesos y bebidas vegetales' },
        { text: 'Tomates', qty: 1, unit: 'kg', section: 'Fruta y verdura' },
      ],
    },
    actorAlex
  );
  assert.equal(templates.length, 1);
  assert.equal(shopping.length, 0);

  // Ya existe Tomates en unidad incompatible ('ud') -> modo missing_only lo omite
  await repo.upsertShoppingItem(
    hid,
    { text: 'Tomates', qty: 4, unit: 'ud', done: false, section: 'Fruta y verdura' },
    actorAlex
  );

  const plan1 = planApplyShoppingTemplate({
    templateItems: templates[0].items,
    livePendingItems: shopping.filter((i) => !i.done),
    mode: 'missing_only',
  });
  assert.equal(plan1.toCreate.length, 2);
  assert.equal(plan1.skippedAlreadyPendingCount, 1);
  assert.equal(plan1.skippedIncompatibleUnitCount, 1);

  await repo.applyShoppingTemplate(hid, plan1, actorAlex);
  assert.equal(shopping.length, 3);
  assert.ok(shopping.every((i) => i.done === false));

  // Reaplicar missing_only otra vez -> 0 duplicados
  const planRepeat = planApplyShoppingTemplate({
    templateItems: templates[0].items,
    livePendingItems: shopping.filter((i) => !i.done),
    mode: 'missing_only',
  });
  assert.equal(planRepeat.toCreate.length, 0);
  assert.equal(planRepeat.toUpdate.length, 0);

  // Modo sum_quantities -> suma solo misma unidad/variante; añade aparte unidad incompatible sin mezclar
  const planSum = planApplyShoppingTemplate({
    templateItems: templates[0].items,
    livePendingItems: shopping.filter((i) => !i.done),
    mode: 'sum_quantities',
  });
  assert.equal(planSum.toUpdate.length, 2); // Leche entera (2->4) y Leche desnatada (1->2)
  assert.equal(planSum.toCreate.length, 1); // Tomates 1 kg separado de Tomates 4 ud
  assert.equal(planSum.addedSeparateIncompatibleUnitCount, 1);

  await repo.applyShoppingTemplate(hid, planSum, actorAlex);
  const lecheEntera = shopping.find((i) => i.text === 'Leche entera');
  const lecheDesnatada = shopping.find((i) => i.text === 'Leche desnatada');
  const tomatesRows = shopping.filter((i) => i.text === 'Tomates');
  assert.equal(lecheEntera?.qty, 4);
  assert.equal(lecheDesnatada?.qty, 2);
  assert.equal(tomatesRows.length, 2);

  uTpl();
  uShop();
});

test('37. Sobrescritura manual de sección de producto — Persiste en hogar, se aplica y se restaura sin tocar catálogo estático', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  let overrides: ShoppingSectionOverride[] = [];
  const uOv = repo.subscribeShoppingSectionOverrides(hid, (o) => {
    overrides = o;
  });

  const staticEntry: StaticMercadonaCatalogEntry = {
    id: 'mc_test_gazpacho',
    name: 'Gazpacho suave Hacendado',
    brand: 'Hacendado',
    section: 'Platos preparados y refrigerados',
    defaultUnit: 'L',
    sourceRef: 'test',
    source: 'Mercadona',
    addedAt: '2026-11-23',
  };

  const productKey = resolveShoppingProductKey({
    catalogId: staticEntry.id,
    text: staticEntry.name,
    brand: staticEntry.brand,
  });
  assert.equal(productKey, 'mc_test_gazpacho');

  await repo.setShoppingSectionOverride(hid, productKey, 'Bebidas', actorAlex);
  const ovMap = buildSectionOverridesMap(overrides);
  assert.equal(ovMap.get('mc_test_gazpacho'), 'Bebidas');

  // Sugerencias y agrupación usan la sección sobrescrita
  const suggestions = searchShoppingSuggestions('gazpacho', [], [staticEntry], 10, 'todas', ovMap);
  assert.equal(suggestions[0].section, 'Bebidas');
  assert.equal(suggestions[0].hasSectionOverride, true);
  assert.equal(staticEntry.section, 'Platos preparados y refrigerados');

  const grouped = groupShoppingItemsBySection(
    [
      {
        id: 's1',
        text: staticEntry.name,
        qty: 1,
        unit: 'L',
        done: false,
        catalogId: staticEntry.id,
        section: 'Platos preparados y refrigerados',
        addedBy: 'demo_alex',
        createdAt: '',
        updatedAt: '',
      },
    ],
    ovMap
  );
  assert.equal(grouped[0].section, 'Bebidas');

  // Restaurar sección del catálogo
  await repo.clearShoppingSectionOverride(hid, productKey);
  const ovMapAfter = buildSectionOverridesMap(overrides);
  assert.equal(
    resolveEffectiveShoppingSection(
      { catalogId: staticEntry.id, text: staticEntry.name, section: staticEntry.section },
      ovMapAfter
    ),
    'Platos preparados y refrigerados'
  );

  uOv();
});

test('38. Copias de seguridad — Round-trip de plantillas/secciones, compatibilidad hacia atrás y cero fuga de preferencias', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  await repo.saveMemberCategoryPreferences(hid, 'demo_alex', {
    selectorVersion: CATEGORY_SELECTOR_PREFS_VERSION,
    visibleCategoryIds: ['supermercado', 'otros'],
  });
  await repo.saveMemberCategoryPreferences(hid, 'demo_marta', {
    selectorVersion: CATEGORY_SELECTOR_PREFS_VERSION,
    visibleCategoryIds: ['ocio', 'alquiler'],
  });

  await repo.upsertShoppingTemplate(
    hid,
    {
      name: 'Despensa básica',
      items: [{ text: 'Arroz redondo', qty: 1, unit: 'kg', section: 'Despensa, arroz, pasta y conservas' }],
    },
    actorAlex
  );
  await repo.setShoppingSectionOverride(hid, 'gen_platanos', 'Sin clasificar', actorAlex);

  const backup = await repo.exportBackup(hid, 'demo_alex');
  assert.ok(!('memberPreferences' in (backup as unknown as Record<string, unknown>)));
  assert.equal(backup.shoppingTemplates?.length, 1);
  assert.equal(backup.shoppingSectionOverrides?.length, 1);

  const validated = validateAndMigrateBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(validated.shoppingTemplates?.length, 1);
  assert.equal(validated.shoppingSectionOverrides?.[0].section, 'Sin clasificar');

  // Copia antigua sin los nuevos campos sigue siendo importable
  const legacyRaw = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
  delete legacyRaw.shoppingTemplates;
  delete legacyRaw.shoppingSectionOverrides;
  const legacyValidated = validateAndMigrateBackup(legacyRaw);
  assert.equal(legacyValidated.shoppingTemplates, undefined);

  const targetRepo = new DemoHouseholdRepository();
  await targetRepo.importBackup(hid, validated, actorAlex);
  let importedTpls: ShoppingListTemplate[] = [];
  let importedOvs: ShoppingSectionOverride[] = [];
  const u1 = targetRepo.subscribeShoppingTemplates(hid, (t) => {
    importedTpls = t;
  });
  const u2 = targetRepo.subscribeShoppingSectionOverrides(hid, (o) => {
    importedOvs = o;
  });
  assert.equal(importedTpls.length, 1);
  assert.equal(importedTpls[0].name, 'Despensa básica');
  assert.equal(importedOvs.length, 1);
  assert.equal(importedOvs[0].section, 'Sin clasificar');
  u1();
  u2();
});

test('39. Planificación mensual: presupuesto + recurrente sin doble conteo, transición previsto->registrado, exceso y 0 € explícito vs sin presupuesto', () => {
  const mkTx = (over: Partial<Transaction>): Transaction => ({
    id: 'tx_1',
    monthKey: '2026-11',
    concept: 'Gasto',
    category: 'otros',
    amount: 0,
    date: '2026-11-05',
    paidBy: 'uid_alex',
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    recurringId: null,
    notes: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'rec_1',
    concept: 'Recibo',
    category: 'luz',
    amount: 68,
    frequency: 'mensual',
    dayOfMonth: 12,
    startMonth: '2026-01',
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  const budget: MonthlyBudget = {
    monthKey: '2026-11',
    limits: {
      luz: 80,
      supermercado: 350,
      ocio: 0, // Presupuesto explícito de 0 € (NO es "sin presupuesto")
    },
    updatedAt: '',
  };

  // Escenario A: luz tiene presupuesto 80 € y plantilla pendiente 68 €; supermercado supera presupuesto (410 > 350);
  // agua tiene plantilla 52 € sin presupuesto -> presupuesto parcial; ocio tiene 0 € explícito y 0 € gastado;
  // privados y liquidaciones se excluyen.
  const recs: RecurringExpense[] = [
    mkRec({ id: 'rec_luz', concept: 'Electricidad', category: 'luz', amount: 68, dayOfMonth: 12 }),
    mkRec({ id: 'rec_agua', concept: 'Agua', category: 'agua', amount: 52, dayOfMonth: 24, paidByDefault: 'uid_marta' }),
  ];

  const txsBefore: Transaction[] = [
    mkTx({ id: 'tx_sup', concept: 'Compra', category: 'supermercado', amount: 410 }),
    mkTx({ id: 'tx_priv', concept: 'Regalo secreto', category: 'ocio', amount: 90, isPrivate: true }),
    mkTx({ id: 'tx_liq', concept: 'Liquidación', category: 'liquidacion', amount: 200, isSettlement: true }),
  ];

  const sumA = computeMonthlyPlanSummary({
    monthKey: '2026-11',
    transactions: txsBefore,
    recurring: recs,
    budget,
  });

  assert.equal(sumA.hasAnyBudget, true);
  assert.equal(sumA.configuredBudgetTotal, 430); // 80 + 350 + 0
  assert.equal(sumA.budgetCoverage, 'partial'); // agua tiene 52 € previstos sin presupuesto
  assert.equal(sumA.registeredTotal, 410); // excluye privado (90) y liquidación (200)
  assert.equal(sumA.pendingPlannedTotal, 120); // 68 (luz) + 52 (agua)
  assert.equal(sumA.unconsumedBudgetMarginTotal, 12); // solo luz: 80 - 68 = 12; supermercado 0; ocio 0
  assert.equal(sumA.estimatedCloseTotal, 542); // 410 + 120 + 12 = 542 (80 + 410 + 52 + 0)

  const luzRowA = sumA.categories.find((c) => c.categoryId === 'luz')!;
  assert.equal(luzRowA.estimatedClose, 80); // nunca 80 + 68 = 148
  assert.equal(luzRowA.unconsumedBudgetMargin, 12);

  const ocioRowA = sumA.categories.find((c) => c.categoryId === 'ocio')!;
  assert.equal(ocioRowA.hasExplicitBudget, true);
  assert.equal(ocioRowA.budgetLimit, 0);
  assert.equal(ocioRowA.budgetStatus, 'zero_ok');

  const aguaRowA = sumA.categories.find((c) => c.categoryId === 'agua')!;
  assert.equal(aguaRowA.hasExplicitBudget, false);
  assert.equal(aguaRowA.budgetLimit, null);
  assert.equal(aguaRowA.budgetStatus, 'none');

  const supRowA = sumA.categories.find((c) => c.categoryId === 'supermercado')!;
  assert.equal(supRowA.budgetStatus, 'over');
  assert.equal(supRowA.estimatedClose, 410);

  // Escenario B: la plantilla rec_luz pasa de prevista a registrada con importe distinto (74 €)
  // y además se registra un gasto de 25 € en ocio (límite explícito 0 € -> pasa a 'over')
  const txsAfter: Transaction[] = [
    ...txsBefore,
    mkTx({ id: 'tx_luz', concept: 'Electricidad', category: 'luz', amount: 74, recurringId: 'rec_luz', paidBy: COMMON_ACCOUNT_ID }),
    mkTx({ id: 'tx_ocio', concept: 'Cine', category: 'ocio', amount: 25 }),
  ];

  const sumB = computeMonthlyPlanSummary({
    monthKey: '2026-11',
    transactions: txsAfter,
    recurring: recs,
    budget,
  });

  assert.equal(sumB.registeredTotal, 509); // 410 + 74 + 25
  assert.equal(sumB.pendingPlannedTotal, 52); // rec_luz ya NO está pendiente, solo agua (52)
  assert.equal(sumB.unconsumedBudgetMarginTotal, 6); // luz: 80 - 74 = 6
  assert.equal(sumB.estimatedCloseTotal, 567); // 509 + 52 + 6 = 567 (80 + 410 + 52 + 25)
  assert.equal(sumB.categories.find((c) => c.categoryId === 'ocio')!.budgetStatus, 'over');

  // Escenario C: sin ningún presupuesto -> budgetCoverage = 'none'
  const sumNoBudget = computeMonthlyPlanSummary({
    monthKey: '2026-11',
    transactions: txsAfter,
    recurring: recs,
    budget: null,
  });
  assert.equal(sumNoBudget.hasAnyBudget, false);
  assert.equal(sumNoBudget.budgetCoverage, 'none');
  assert.equal(sumNoBudget.estimatedCloseTotal, 561); // 509 + 52
});

test('40. Planificación mensual: categorías personalizadas y archivadas con actividad/previsiones siguen incluidas correctamente', () => {
  const customCats: CustomCategory[] = [
    {
      id: 'cat_mascotas',
      name: 'Mascotas',
      color: '#16A34A',
      icon: 'paw-print',
      order: 1,
      archived: false,
      csvKeywords: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'cat_obra_antigua',
      name: 'Obra antigua',
      color: '#DC2626',
      icon: 'wrench',
      order: 2,
      archived: true,
      csvKeywords: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const registry = buildCategoryRegistry(customCats);

  const txs: Transaction[] = [
    {
      id: 'tx_pet',
      monthKey: '2026-11',
      concept: 'Veterinario',
      category: 'cat_mascotas',
      amount: 45,
      date: '2026-11-04',
      paidBy: 'uid_alex',
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      recurringId: null,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'tx_arch',
      monthKey: '2026-11',
      concept: 'Remate pintura',
      category: 'cat_obra_antigua',
      amount: 120,
      date: '2026-11-06',
      paidBy: 'uid_marta',
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_marta',
      recurringId: null,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const budget: MonthlyBudget = {
    monthKey: '2026-11',
    limits: { cat_mascotas: 80 },
    updatedAt: '',
  };

  const summary = computeMonthlyPlanSummary({
    monthKey: '2026-11',
    transactions: txs,
    recurring: [],
    budget,
    categoryRegistry: registry,
  });

  assert.equal(summary.registeredTotal, 165); // 45 + 120
  assert.equal(summary.unconsumedBudgetMarginTotal, 35); // 80 - 45
  assert.equal(summary.estimatedCloseTotal, 200); // 80 + 120
  assert.equal(summary.archivedWithActivityCount, 1);
  assert.equal(summary.budgetCoverage, 'partial'); // cat_obra_antigua no tiene presupuesto

  const archRow = summary.categories.find((c) => c.categoryId === 'cat_obra_antigua')!;
  assert.equal(archRow.isArchived, true);
  assert.equal(archRow.label, 'Obra antigua');
  assert.equal(archRow.registered, 120);
});

test('41. Cuenta común: categorías variables sin doble conteo, pagadores individuales intactos, 50/50 + ingresos + splitOverride y redondeo exacto al céntimo', () => {
  const mkTx = (over: Partial<Transaction>): Transaction => ({
    id: 'tx_base',
    monthKey: '2026-11',
    concept: 'Gasto',
    category: 'otros',
    amount: 0,
    date: '2026-11-05',
    paidBy: COMMON_ACCOUNT_ID,
    splitPctA: 55,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    recurringId: null,
    notes: '',
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  const mkRec = (over: Partial<RecurringExpense>): RecurringExpense => ({
    id: 'rec_base',
    concept: 'Recibo',
    category: 'luz',
    amount: 68,
    frequency: 'mensual',
    dayOfMonth: 15,
    startMonth: '2026-01',
    splitOverride: null,
    paidByDefault: COMMON_ACCOUNT_ID,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  // Reparto proporcional por ingresos: 2200 vs 1800 -> 55% / 45%
  const incomePctA = computeEffectiveSplitPctA({
    splitMode: 'income',
    presetA: 50,
    presetB: 50,
    incomeA: 2200,
    incomeB: 1800,
    currency: 'EUR',
  });
  assert.equal(incomePctA, 55);

  const txs: Transaction[] = [
    // Alquiler ya registrado desde Cuenta común (con reparto base 55/45)
    mkTx({ id: 'tx_rent', concept: 'Alquiler', category: 'alquiler', amount: 850, date: '2026-11-01', recurringId: 'rec_rent', splitPctA: 55 }),
    // Supermercado pagado individualmente por Alex (NO Cuenta común) -> no cambia pagador ni se cuenta como gasto de Cuenta común, pero reduce el margen variable restante
    mkTx({ id: 'tx_sup_alex', concept: 'Compra Alex', category: 'supermercado', amount: 206.8, date: '2026-11-06', paidBy: 'uid_alex', splitPctA: 55 }),
    // Privado y liquidación excluidos
    mkTx({ id: 'tx_priv', concept: 'Privado', category: 'otros', amount: 50, isPrivate: true }),
    mkTx({ id: 'tx_liq', concept: 'Liquidación', category: 'liquidacion', amount: 100, isSettlement: true }),
  ];

  const recs: RecurringExpense[] = [
    mkRec({ id: 'rec_rent', concept: 'Alquiler', category: 'alquiler', amount: 850, dayOfMonth: 1 }),
    // Luz con splitOverride 50/50 distinto del 55/45 del hogar
    mkRec({ id: 'rec_luz', concept: 'Luz', category: 'luz', amount: 68, dayOfMonth: 14, splitOverride: 50 }),
    // Agua pagada por Marta -> NO entra en Cuenta común
    mkRec({ id: 'rec_agua', concept: 'Agua', category: 'agua', amount: 52, dayOfMonth: 22, paidByDefault: 'uid_marta' }),
  ];

  const budget: MonthlyBudget = {
    monthKey: '2026-11',
    limits: { luz: 80, supermercado: 350 },
    updatedAt: '',
  };

  // Seleccionamos 'luz' y 'supermercado' como categorías variables financiadas desde Cuenta común
  const radar = computeCommonAccountRadar('2026-11', txs, recs, incomePctA, {
    todayISO: '2026-11-10',
    budget,
    plannedCommonCategoryIds: ['luz', 'supermercado'],
  });

  // Sin doble conteo:
  // - registrado común: 850 € (alquiler)
  // - pendiente común: 68 € (luz)
  // - margen variable planificado: luz (80 - 68 = 12 €) + supermercado (350 - 206.80 = 143.20 €) = 155.20 €
  assert.equal(radar.registeredCommonTotal, 850);
  assert.equal(radar.pendingCommonRecurringTotal, 68);
  assert.equal(radar.plannedVariableMarginTotal, 155.2);
  assert.equal(radar.totalMonthlyNeed, 1073.2); // 850 + 68 + 155.20
  assert.equal(radar.hasCustomSplitOverrides, true);

  // Comprobación exacta de reparto respetando splitOverride en luz (50/50) y 55/45 en el resto:
  // 850 * 55% = 467.50 | 68 * 50% = 34.00 | 155.20 * 55% = 85.36 -> total A = 586.86; B = 486.34
  assert.equal(radar.monthlyShareA, 586.86);
  assert.equal(radar.monthlyShareB, 486.34);
  assert.equal(roundCents(radar.monthlyShareA + radar.monthlyShareB), radar.totalMonthlyNeed);

  // Redondeo exacto al céntimo con importes impares en 50/50 y proporcional
  const odd50 = splitAmountExactCents(100.01, 50);
  assert.equal(odd50.shareA, 50.01);
  assert.equal(odd50.shareB, 50.0);
  assert.equal(roundCents(odd50.shareA + odd50.shareB), 100.01);

  const oddInc = allocateExactMemberShares(
    [
      { amount: 33.33, splitPctA: 55 },
      { amount: 17.77, splitPctA: 33.3 },
    ],
    55
  );
  assert.equal(roundCents(oddInc.shareA + oddInc.shareB), oddInc.total);
});

test('42. Cuenta común: saldo manual ausente, desactualizado, de otro mes y sin doble resta de gastos anteriores a la fecha del saldo', () => {
  const txs: Transaction[] = [
    // Gasto del día 5 (anterior al saldo del día 10) -> NO debe volver a restarse del saldo manual
    {
      id: 'tx_past',
      monthKey: '2026-11',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      date: '2026-11-05',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      recurringId: 'rec_rent',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    // Gasto registrado con fecha futura (día 20 > fecha saldo día 10) -> SÍ cuenta como necesidad futura
    {
      id: 'tx_future',
      monthKey: '2026-11',
      concept: 'Comunidad programada',
      category: 'comunidad',
      amount: 90,
      date: '2026-11-20',
      paidBy: COMMON_ACCOUNT_ID,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      recurringId: null,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const recs: RecurringExpense[] = [
    {
      id: 'rec_rent',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      frequency: 'mensual',
      dayOfMonth: 5,
      startMonth: '2026-01',
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    // Plantilla vencida ANTES de la fecha del saldo (día 4 < día 10) aún sin registrar -> avisada aparte, no restada a ciegas
    {
      id: 'rec_overdue',
      concept: 'Suscripción',
      category: 'suscripciones',
      amount: 15,
      frequency: 'mensual',
      dayOfMonth: 4,
      startMonth: '2026-01',
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '',
      updatedAt: '',
    },
    // Plantilla futura (día 14 >= día 10) -> SÍ entra en necesidad futura desde el saldo
    {
      id: 'rec_luz',
      concept: 'Luz',
      category: 'luz',
      amount: 70,
      frequency: 'mensual',
      dayOfMonth: 14,
      startMonth: '2026-01',
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '',
      updatedAt: '',
    },
  ];

  // A) Sin saldo manual -> not_provided
  const noBal = computeCommonAccountRadar('2026-11', txs, recs, 50, {
    todayISO: '2026-11-10',
    manualBalance: null,
  });
  assert.equal(noBal.balanceStatus, 'not_provided');
  assert.equal(noBal.requiredAvailableTotal, 160); // 90 (futuro) + 70 (luz día 14)

  // B) Saldo manual del 2026-11-10 por 100 € -> NO vuelve a restar los 850 € del día 5; faltan 160 - 100 = 60 €
  const withBal = computeCommonAccountRadar('2026-11', txs, recs, 50, {
    todayISO: '2026-11-16', // 6 días después -> isBalanceStale = true
    manualBalance: {
      amount: 100,
      referenceDate: '2026-11-10',
      updatedBy: 'uid_alex',
      updatedAt: '2026-11-10T09:00:00.000Z',
    },
  });
  assert.equal(withBal.registeredToDateTotal, 850);
  assert.equal(withBal.requiredAvailableTotal, 160); // 90 + 70 (sin restar 850 otra vez)
  assert.equal(withBal.balanceStatus, 'shortfall');
  assert.equal(withBal.shortfallAmount, 60);
  assert.equal(withBal.shortfallShareA, 30);
  assert.equal(withBal.shortfallShareB, 30);
  assert.equal(withBal.isBalanceStale, true);
  assert.equal(withBal.balanceAgeDays, 6);
  assert.equal(withBal.unregisteredBeforeRefItems.length, 1);
  assert.equal(withBal.unregisteredBeforeRefTotal, 15);

  // C) Saldo de otro mes (2026-10-28 mirando 2026-11) -> outdated_month (no inventa falta de saldo)
  const otherMonthBal = computeCommonAccountRadar('2026-11', txs, recs, 50, {
    todayISO: '2026-11-10',
    manualBalance: {
      amount: 50,
      referenceDate: '2026-10-28',
      updatedBy: 'uid_alex',
      updatedAt: '2026-10-28T09:00:00.000Z',
    },
  });
  assert.equal(otherMonthBal.balanceStatus, 'outdated_month');
  assert.equal(otherMonthBal.isBalanceOutdatedMonth, true);
  assert.equal(otherMonthBal.shortfallAmount, 0);
});

test('43. Paridad Demo (Sencillo/Avanzado) y round-trip de backup para planificación de Cuenta común', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actorAlex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const currentMonth = getCurrentMonthKeyLocal();

  let household: Household | null = null;
  let txs: Transaction[] = [];
  let recs: RecurringExpense[] = [];
  let budget: MonthlyBudget | null = null;

  const uH = repo.subscribeHousehold(hid, (h) => { household = h; });
  const uT = repo.subscribeTransactionsByMonth(hid, 'demo_alex', currentMonth, (t) => { txs = t; });
  const uR = repo.subscribeRecurring(hid, (r) => { recs = r; });
  const uB = repo.subscribeBudget(hid, currentMonth, (b) => { budget = b; });

  // Configurar preferencias compartidas de Cuenta común
  await repo.updateCommonAccountPlannedCategories(hid, ['supermercado']);
  await repo.updateCommonAccountManualBalance(
    hid,
    { amount: 300, referenceDate: `${currentMonth}-10` },
    actorAlex
  );

  // Tanto Sencillo como Avanzado invocan los mismos cálculos sobre los mismos datos
  const summarySencillo = computeMonthlyPlanSummary({
    monthKey: currentMonth,
    transactions: txs,
    recurring: recs,
    budget,
  });
  const summaryAvanzado = computeMonthlyPlanSummary({
    monthKey: currentMonth,
    transactions: txs,
    recurring: recs,
    budget,
  });
  assert.deepEqual(summarySencillo, summaryAvanzado);
  assert.equal(summarySencillo.registeredTotal, 1160.8);
  assert.equal(summarySencillo.pendingPlannedTotal, 288);
  assert.equal(summarySencillo.unconsumedBudgetMarginTotal, 221.2);
  assert.equal(summarySencillo.estimatedCloseTotal, 1670);
  assert.equal(summarySencillo.budgetCoverage, 'partial');

  const radar = computeCommonAccountRadar(currentMonth, txs, recs, 55, {
    todayISO: `${currentMonth}-10`,
    budget,
    plannedCommonCategoryIds: household!.commonAccountPlannedCategories,
    manualBalance: household!.commonAccountManualBalance,
  });
  // Demo: 850 alquiler + 68 luz + 168 seguro + 143.20 margen supermercado = 1229.20
  assert.equal(radar.registeredCommonTotal, 850);
  assert.equal(radar.pendingCommonRecurringTotal, 236);
  assert.equal(radar.plannedVariableMarginTotal, 143.2);
  assert.equal(radar.totalMonthlyNeed, 1229.2);
  assert.equal(roundCents(radar.monthlyShareA + radar.monthlyShareB), 1229.2);

  // Round-trip de backup y compatibilidad con copias antiguas sin estos campos
  const exported = await repo.exportBackup(hid, 'demo_alex');
  assert.deepEqual(exported.commonAccountPlannedCategories, ['supermercado']);
  assert.equal(exported.commonAccountManualBalance?.amount, 300);

  const validated = validateAndMigrateBackup(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(validated.commonAccountPlannedCategories, ['supermercado']);
  assert.equal(validated.commonAccountManualBalance?.referenceDate, `${currentMonth}-10`);

  const legacyRaw = JSON.parse(JSON.stringify(exported)) as Record<string, unknown>;
  delete legacyRaw.commonAccountPlannedCategories;
  delete legacyRaw.commonAccountManualBalance;
  const legacyValidated = validateAndMigrateBackup(legacyRaw);
  assert.equal(legacyValidated.commonAccountPlannedCategories, undefined);
  assert.equal(legacyValidated.commonAccountManualBalance, undefined);

  const targetRepo = new DemoHouseholdRepository();
  await targetRepo.importBackup(hid, validated, actorAlex);
  let targetHousehold: Household | null = null;
  const uTH = targetRepo.subscribeHousehold(hid, (h) => { targetHousehold = h; });
  assert.deepEqual(targetHousehold!.commonAccountPlannedCategories, ['supermercado']);
  assert.equal(targetHousehold!.commonAccountManualBalance?.amount, 300);

  uTH();
  uH();
  uT();
  uR();
  uB();
});

test('44. Cierre guiado — Pendientes: registrar con media histórica/importe editable y "No se ha producido este mes" solo afecta al mes seleccionado', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  const monthKey = '2028-04';
  const nextMonthKey = '2028-05';

  // Creamos dos plantillas activas nuevas en Demo para tener un entorno controlado
  const luzId = await repo.upsertRecurring(
    hid,
    {
      concept: 'Luz prueba cierre',
      category: 'luz',
      amount: 65,
      frequency: 'mensual',
      dayOfMonth: 10,
      startMonth: '2028-01',
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
    },
    actor
  );
  const gymId = await repo.upsertRecurring(
    hid,
    {
      concept: 'Clases yoga cierre',
      category: 'ocio',
      amount: 50,
      frequency: 'mensual',
      dayOfMonth: 15,
      startMonth: '2028-01',
      splitOverride: null,
      paidByDefault: 'demo_alex',
      active: true,
    },
    actor
  );

  // Histórico previo de 3 facturas de luz: 70, 80, 90 -> media exacta 80 € (excluyendo un gasto privado)
  const histTxs: Transaction[] = [
    makeTx({ id: 'h1', monthKey: '2028-01', date: '2028-01-10', recurringId: luzId, amount: 70, category: 'luz' }),
    makeTx({ id: 'h2', monthKey: '2028-02', date: '2028-02-10', recurringId: luzId, amount: 80, category: 'luz' }),
    makeTx({ id: 'h3', monthKey: '2028-03', date: '2028-03-10', recurringId: luzId, amount: 90, category: 'luz' }),
    makeTx({
      id: 'h_priv',
      monthKey: '2028-03',
      date: '2028-03-11',
      recurringId: luzId,
      amount: 999,
      category: 'luz',
      isPrivate: true,
      createdBy: 'demo_alex',
    }),
  ];

  let recs: RecurringExpense[] = [];
  let monthTxs: Transaction[] = [];
  const uR = repo.subscribeRecurring(hid, (r) => { recs = r; });
  const uT = repo.subscribeTransactionsByMonth(hid, 'demo_alex', monthKey, (t) => { monthTxs = t; });

  const controlledRecs = recs.filter((r) => r.id === luzId || r.id === gymId);
  const initialPending = buildGuidedClosePendingItems({
    monthKey,
    monthTransactions: monthTxs,
    recurring: controlledRecs,
    historicalTransactions: histTxs,
  });
  assert.equal(initialPending.pending.length, 2);
  const luzPending = initialPending.pending.find((p) => p.recurring.id === luzId)!;
  const gymPending = initialPending.pending.find((p) => p.recurring.id === gymId)!;
  assert.equal(luzPending.suggestedAmount, 80); // media histórica (70+80+90)/3
  assert.equal(luzPending.historicalSampleCount, 3);
  assert.equal(gymPending.suggestedAmount, 50); // sin histórico -> importe de plantilla
  assert.equal(gymPending.historicalAverage, null);

  // 1) Registrar la luz con importe editado (82,50 €) mediante el motor idempotente existente
  const created1 = await repo.generateMonthTransactions(
    hid,
    monthKey,
    [{ ...luzPending.recurring, amount: 82.5 }],
    50,
    actor
  );
  assert.equal(created1, 1);
  // Segundo intento no duplica
  const createdDup = await repo.generateMonthTransactions(
    hid,
    monthKey,
    [{ ...luzPending.recurring, amount: 82.5 }],
    50,
    actor
  );
  assert.equal(createdDup, 0);
  const luzTx = monthTxs.find((t) => t.recurringId === luzId);
  assert.ok(luzTx);
  assert.equal(luzTx.amount, 82.5);

  // 2) Marcar yoga como "No se ha producido este mes"
  const txCountBeforeSkip = monthTxs.length;
  await repo.setRecurringMonthSkipped(hid, gymId, monthKey, true, actor);
  assert.equal(monthTxs.length, txCountBeforeSkip); // NO crea ningún gasto

  const gymRecAfter = recs.find((r) => r.id === gymId)!;
  assert.equal(gymRecAfter.active, true); // NO desactiva la plantilla
  assert.equal(isRecurringSkippedInMonth(gymRecAfter, monthKey), true);
  assert.equal(isRecurringDueInMonth(gymRecAfter, monthKey), false);
  assert.equal(isRecurringDueInMonth(gymRecAfter, nextMonthKey), true); // SÍ aparece al mes siguiente

  // Desaparece de pendientes, resumen mensual, radar Cuenta común y calendario en `monthKey`
  const controlledAfter = recs.filter((r) => r.id === luzId || r.id === gymId);
  assert.equal(findMissingRecurringForMonth(controlledAfter, monthTxs, monthKey).length, 0);
  const summarySep = computeMonthlyPlanSummary({
    monthKey,
    transactions: monthTxs,
    recurring: controlledAfter,
    budget: null,
  });
  assert.equal(summarySep.pendingPlannedTotal, 0);
  assert.equal(summarySep.registeredTotal, 82.5);

  const radarSep = computeCommonAccountRadar(monthKey, monthTxs, controlledAfter, 50, {
    todayISO: `${monthKey}-28`,
  });
  assert.equal(radarSep.pendingCommonRecurringTotal, 0);

  const calSep = buildMonthCalendarGrid(monthKey, monthTxs, controlledAfter);
  const calSepPlannedIds = calSep.days.flatMap((d) =>
    d.events.filter((e) => e.kind === 'planned').map((e) => e.recurring?.id)
  );
  assert.ok(!calSepPlannedIds.includes(gymId));

  // Pero EN EL MES SIGUIENTE sigue apareciendo normalmente en pendientes y calendario
  const missingOct = findMissingRecurringForMonth(controlledAfter, [], nextMonthKey);
  assert.ok(missingOct.some((r) => r.id === gymId));
  const calOct = buildMonthCalendarGrid(nextMonthKey, [], controlledAfter);
  const calOctPlannedIds = calOct.days.flatMap((d) =>
    d.events.filter((e) => e.kind === 'planned').map((e) => e.recurring?.id)
  );
  assert.ok(calOctPlannedIds.includes(gymId));

  // Paso 1 expone la lista de omitidos de este mes para poder deshacer mientras esté abierto
  const pendingAfter = buildGuidedClosePendingItems({
    monthKey,
    monthTransactions: monthTxs,
    recurring: controlledAfter,
    historicalTransactions: histTxs,
  });
  assert.equal(pendingAfter.pending.length, 0);
  assert.equal(pendingAfter.skippedThisMonth.length, 1);
  assert.equal(pendingAfter.skippedThisMonth[0].recurring.id, gymId);

  // Deshacer omisión vuelve a mostrarla en pendientes
  await repo.setRecurringMonthSkipped(hid, gymId, monthKey, false, actor);
  const afterUndo = buildGuidedClosePendingItems({
    monthKey,
    monthTransactions: monthTxs,
    recurring: recs.filter((r) => r.id === luzId || r.id === gymId),
    historicalTransactions: histTxs,
  });
  assert.equal(afterUndo.pending.length, 1);
  assert.equal(afterUndo.skippedThisMonth.length, 0);

  // Sanitización de skippedMonths (ordenado, sin duplicados, máximo 120)
  assert.deepEqual(sanitizeSkippedMonths(['2026-10', 'bad', '2026-09', '2026-10']), [
    '2026-09',
    '2026-10',
  ]);

  uR();
  uT();
});

test('45. Cierre guiado — Revisión presupuesto vs real con desviaciones y copia al mes siguiente sin sobrescribir por defecto', () => {
  const monthKey = '2026-10';
  const txs: Transaction[] = [
    makeTx({ id: 't1', monthKey, category: 'supermercado', amount: 460, date: '2026-10-12' }),
    makeTx({ id: 't2', monthKey, category: 'ocio', amount: 40, date: '2026-10-18' }),
    makeTx({ id: 't3', monthKey, category: 'transporte', amount: 55, date: '2026-10-20' }),
    makeTx({ id: 't4', monthKey, category: 'alquiler', amount: 850, date: '2026-10-01' }),
    // Privado y liquidación deben quedar fuera
    makeTx({
      id: 't_priv',
      monthKey,
      category: 'ocio',
      amount: 300,
      date: '2026-10-22',
      isPrivate: true,
      createdBy: 'uid_alex',
    }),
    makeTx({
      id: 't_set',
      monthKey,
      category: 'liquidacion',
      amount: 100,
      date: '2026-10-25',
      isSettlement: true,
      settlementTo: 'uid_marta',
    }),
  ];

  const sourceBudget: MonthlyBudget = {
    monthKey,
    limits: {
      alquiler: 850,
      supermercado: 350, // superado en +110 € (+31%)
      ocio: 150, // ahorro significativo -110 € (-73%)
      cat_gym: 60,
    },
    updatedAt: '2026-10-01T10:00:00.000Z',
  };

  const summary = computeMonthlyPlanSummary({
    monthKey,
    transactions: txs,
    recurring: [],
    budget: sourceBudget,
  });
  const review = computeGuidedCloseReview(summary);

  assert.equal(review.totalRegistered, 1405); // 850 + 460 + 40 + 55
  assert.equal(review.totalBudget, 1410); // 850 + 350 + 150 + 60
  assert.equal(review.overBudgetCount, 1);
  assert.equal(review.unbudgetedCount, 1);
  assert.equal(review.rows[0].row.categoryId, 'supermercado'); // sobre presupuesto destacado primero
  assert.equal(review.rows[0].deviationKind, 'over_budget');
  assert.equal(review.rows[0].isSignificant, true);
  assert.equal(review.rows[0].delta, 110);

  const ocioRow = review.rows.find((r) => r.row.categoryId === 'ocio')!;
  assert.equal(ocioRow.deviationKind, 'under_significant');
  assert.equal(ocioRow.isSignificant, true);

  const transpRow = review.rows.find((r) => r.row.categoryId === 'transporte')!;
  assert.equal(transpRow.deviationKind, 'unbudgeted');
  assert.equal(transpRow.isSignificant, true);

  // Copiar presupuestos al mes siguiente SIN sobrescribir lo ya configurado en el mes destino
  const targetBudget: MonthlyBudget = {
    monthKey: '2026-11',
    limits: {
      supermercado: 400, // ya configurado en noviembre -> debe preservarse
    },
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
  const customCategories: CustomCategory[] = [
    {
      id: 'cat_gym',
      name: 'Gimnasio',
      color: '#0284C7',
      icon: 'dumbbell',
      order: 0,
      archived: false,
      csvKeywords: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const planNoOverwrite = buildNextMonthBudgetCopyPlan({
    sourceBudget,
    targetBudget,
    customCategories,
    overwriteExisting: false,
  });
  assert.equal(planNoOverwrite.mergedLimits.supermercado, 400); // NO sobrescrito
  assert.equal(planNoOverwrite.mergedLimits.alquiler, 850);
  assert.equal(planNoOverwrite.mergedLimits.ocio, 150);
  assert.equal(planNoOverwrite.mergedLimits.cat_gym, 60);
  assert.deepEqual(
    planNoOverwrite.toOverwrite.map((e) => e.categoryId),
    ['supermercado']
  );

  // Con confirmación explícita de sobrescribir
  const planOverwrite = buildNextMonthBudgetCopyPlan({
    sourceBudget,
    targetBudget,
    customCategories,
    overwriteExisting: true,
  });
  assert.equal(planOverwrite.mergedLimits.supermercado, 350);
  assert.deepEqual(
    planOverwrite.toOverwrite.map((e) => e.categoryId),
    ['supermercado']
  );
});

test('46. Cierre guiado — Retomar a mitad (progreso derivado), liquidación, cierre, bloqueo de mes cerrado y backup round-trip', async () => {
  const repo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const actor = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const memberA: HouseholdMember = {
    uid: 'demo_alex',
    displayName: 'Alex',
    photoURL: '',
    role: 'member_a',
    uiMode: 'avanzado',
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const memberB: HouseholdMember = {
    uid: 'demo_marta',
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'avanzado',
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mk = '2028-07';
  const recId = await repo.upsertRecurring(
    hid,
    {
      concept: 'Internet prueba',
      category: 'internet',
      amount: 40,
      frequency: 'mensual',
      dayOfMonth: 5,
      startMonth: '2028-07',
      splitOverride: 50,
      paidByDefault: 'demo_alex',
      active: true,
    },
    actor
  );

  // Gasto pagado solo por Alex (100 €, 50/50 -> Marta debe 50 € a Alex)
  await repo.upsertTransaction(
    hid,
    {
      monthKey: mk,
      concept: 'Compra casa',
      category: 'supermercado',
      amount: 100,
      date: '2028-07-02',
      paidBy: 'demo_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'demo_alex',
      notes: '',
    },
    actor
  );

  let recs: RecurringExpense[] = [];
  let txs: Transaction[] = [];
  let closures: MonthClosure[] = [];
  const uR = repo.subscribeRecurring(hid, (r) => { recs = r; });
  const uT = repo.subscribeTransactionsByMonth(hid, 'demo_alex', mk, (t) => { txs = t; });
  const uC = repo.subscribeMonthClosures(hid, (c) => { closures = c; });

  const myRecs = recs.filter((r) => r.id === recId);
  const bal1 = calculateCoupleBalance(txs, memberA, memberB);
  assert.equal(bal1.owesDirection, 'b_owes_a');
  assert.equal(bal1.owesAmount, 50);

  // Al abrir al inicio: hay 1 pendiente -> arranca en 'pendientes'
  assert.equal(
    deriveGuidedCloseInitialStep({
      uiMode: 'avanzado',
      isClosed: false,
      pendingCount: 1,
      balance: bal1,
    }),
    'pendientes'
  );

  // Marcamos la plantilla como no producida en 2028-07 y simulamos salir y volver a entrar
  await repo.setRecurringMonthSkipped(hid, recId, mk, true, actor);
  assert.equal(
    deriveGuidedCloseInitialStep({
      uiMode: 'avanzado',
      isClosed: false,
      pendingCount: findMissingRecurringForMonth(
        recs.filter((r) => r.id === recId),
        txs,
        mk
      ).length,
      balance: bal1,
    }),
    'cuentas' // retoma directamente en cuentas al no haber pendientes
  );

  // Registramos liquidación con el flujo existente -> saldo pasa a 'peace'
  await repo.upsertTransaction(
    hid,
    {
      monthKey: mk,
      concept: 'Liquidación entre pareja',
      category: 'liquidacion',
      amount: bal1.owesAmount,
      date: '2028-07-28',
      paidBy: 'demo_marta',
      recurringId: null,
      splitPctA: 50,
      isSettlement: true,
      settlementTo: 'demo_alex',
      isPrivate: false,
      createdBy: 'demo_alex',
      notes: 'Liquidación de saldo entre pareja',
    },
    actor
  );
  const bal2 = calculateCoupleBalance(txs, memberA, memberB);
  assert.equal(bal2.owesDirection, 'peace');

  // Reanudar ahora salta directo a 'cerrar' (o 'proximo_mes' si hay presupuesto sin copiar)
  assert.equal(
    deriveGuidedCloseInitialStep({
      uiMode: 'sencillo',
      isClosed: false,
      pendingCount: 0,
      balance: bal2,
    }),
    'cerrar'
  );
  assert.equal(
    deriveGuidedCloseInitialStep({
      uiMode: 'avanzado',
      isClosed: false,
      pendingCount: 0,
      balance: bal2,
      sourceHasBudgets: true,
      nextMonthHasBudgets: false,
    }),
    'proximo_mes'
  );

  // Copiar presupuestos al mes siguiente vía saveAllBudgets
  await repo.saveAllBudgets(hid, mk, { supermercado: 300 }, [], actor);
  await repo.saveAllBudgets(hid, '2028-08', { supermercado: 320 }, [], actor);
  const srcBudRaw = await repo.fetchMonthBudgets(hid, mk);
  const dstBudRaw = await repo.fetchMonthBudgets(hid, '2028-08');
  const srcBud = mergeMonthlyAndCustomBudgetLimits(
    srcBudRaw.systemBudget,
    srcBudRaw.categoryBudgets,
    mk
  );
  const dstBud = mergeMonthlyAndCustomBudgetLimits(
    dstBudRaw.systemBudget,
    dstBudRaw.categoryBudgets,
    '2028-08'
  );
  const copyPlan = buildNextMonthBudgetCopyPlan({
    sourceBudget: srcBud,
    targetBudget: dstBud,
    customCategories: [],
    overwriteExisting: false,
  });
  assert.equal(copyPlan.mergedLimits.supermercado, 320); // conservó 320 € de agosto

  // Cerrar mes mediante repo.closeMonth existente
  await repo.closeMonth(
    hid,
    {
      monthKey: mk,
      totalSpent: bal2.totalSpent,
      paidA: bal2.paidA,
      paidB: bal2.paidB,
      paidComun: bal2.paidComun,
      shareA: bal2.shareA,
      shareB: bal2.shareB,
      balanceA: bal2.balanceA,
      settlementText: bal2.summaryText,
      closedBy: actor.uid,
    },
    actor
  );
  assert.ok(closures.some((c) => c.monthKey === mk));

  // Mes cerrado bloquea cambios de omisión y generación de recurrentes en la capa de datos
  await assert.rejects(
    () => repo.setRecurringMonthSkipped(hid, recId, mk, false, actor),
    /cerrado/i
  );
  await assert.rejects(
    () => repo.generateMonthTransactions(hid, mk, myRecs, 50, actor),
    /cerrado/i
  );

  // Round-trip de backup conserva skippedMonths y sigue admitiendo backups antiguos sin skippedMonths
  const exported = await repo.exportBackup(hid, 'demo_alex');
  const expRec = exported.recurring.find((r) => r.id === recId)!;
  assert.deepEqual(expRec.skippedMonths, [mk]);

  const validated = validateAndMigrateBackup(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(validated.recurring.find((r) => r.id === recId)?.skippedMonths, [mk]);

  const legacyRaw = JSON.parse(JSON.stringify(exported)) as {
    recurring: Array<Record<string, unknown>>;
  };
  for (const r of legacyRaw.recurring) delete r.skippedMonths;
  const legacyValidated = validateAndMigrateBackup(legacyRaw);
  assert.equal(legacyValidated.recurring.find((r) => r.id === recId)?.skippedMonths, undefined);

  const restoredRepo = new DemoHouseholdRepository();
  await restoredRepo.importBackup(hid, validated, actor);
  let restoredRecs: RecurringExpense[] = [];
  const uRR = restoredRepo.subscribeRecurring(hid, (r) => { restoredRecs = r; });
  assert.deepEqual(restoredRecs.find((r) => r.id === recId)?.skippedMonths, [mk]);

  uRR();
  uR();
  uT();
  uC();
});

test('47. Cierre guiado — Pasos Sencillo (3) vs Avanzado (5) y aviso discreto en Inicio los primeros días del mes', () => {
  // Sencillo: 3 pasos; Avanzado: 5 pasos
  assert.deepEqual(
    computeGuidedCloseSteps('sencillo').map((s) => s.id),
    ['pendientes', 'cuentas', 'cerrar']
  );
  assert.deepEqual(
    computeGuidedCloseSteps('avanzado').map((s) => s.id),
    ['pendientes', 'revision', 'cuentas', 'proximo_mes', 'cerrar']
  );

  const prevTx = [
    makeTx({ id: 'p1', monthKey: '2026-10', date: '2026-10-15', amount: 80 }),
  ];

  // Día 3 de noviembre con octubre abierto y movimientos -> mostrar aviso discreto
  const day3 = shouldShowPreviousMonthCloseReminder({
    todayISO: '2026-11-03',
    monthClosures: [],
    recentTransactions: prevTx,
    recurring: [],
  });
  assert.equal(day3.show, true);
  assert.equal(day3.prevMonthKey, '2026-10');

  // Día 7 (límite incluido) -> mostrar
  const day7 = shouldShowPreviousMonthCloseReminder({
    todayISO: '2026-11-07',
    monthClosures: [],
    recentTransactions: prevTx,
    recurring: [],
  });
  assert.equal(day7.show, true);

  // Día 8 -> ya no mostrar
  const day8 = shouldShowPreviousMonthCloseReminder({
    todayISO: '2026-11-08',
    monthClosures: [],
    recentTransactions: prevTx,
    recurring: [],
  });
  assert.equal(day8.show, false);

  // Octubre ya cerrado -> no mostrar aunque sea día 2
  const closedOct = shouldShowPreviousMonthCloseReminder({
    todayISO: '2026-11-02',
    monthClosures: [
      {
        monthKey: '2026-10',
        totalSpent: 80,
        paidA: 80,
        paidB: 0,
        paidComun: 0,
        shareA: 40,
        shareB: 40,
        balanceA: 40,
        settlementText: 'Marta debe 40 € a Alex',
        closedBy: 'uid_alex',
        closedAt: '2026-11-01T10:00:00.000Z',
      },
    ],
    recentTransactions: prevTx,
    recurring: [],
  });
  assert.equal(closedOct.show, false);

  // Hogar vacío sin actividad ni plantillas en el mes anterior -> no molestar
  const emptyHousehold = shouldShowPreviousMonthCloseReminder({
    todayISO: '2026-11-02',
    monthClosures: [],
    recentTransactions: [],
    recurring: [],
  });
  assert.equal(emptyHousehold.show, false);

  // Cambio de año: 2027-01-02 apunta a 2026-12
  const newYear = shouldShowPreviousMonthCloseReminder({
    todayISO: '2027-01-02',
    monthClosures: [],
    recentTransactions: [makeTx({ id: 'd1', monthKey: '2026-12', date: '2026-12-10', amount: 50 })],
    recurring: [],
  });
  assert.equal(newYear.show, true);
  assert.equal(newYear.prevMonthKey, '2026-12');
});

test('48. Balance anual — Mes cerrado con 0 €, mes sin datos, año incompleto y exclusión de privados/liquidaciones', () => {
  const makeTx = (overrides: Partial<Transaction>): Transaction => ({
    id: overrides.id ?? 'tx_1',
    monthKey: overrides.monthKey ?? '2026-01',
    concept: overrides.concept ?? 'Gasto',
    category: overrides.category ?? 'supermercado',
    amount: overrides.amount ?? 100,
    date: overrides.date ?? '2026-01-10',
    paidBy: overrides.paidBy ?? 'uid_alex',
    recurringId: overrides.recurringId ?? null,
    splitPctA: overrides.splitPctA ?? 50,
    isSettlement: overrides.isSettlement ?? false,
    settlementTo: overrides.settlementTo ?? '',
    isPrivate: overrides.isPrivate ?? false,
    createdBy: overrides.createdBy ?? 'uid_alex',
    notes: '',
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
  });

  const makeClosure = (monthKey: string, totalSpent: number): MonthClosure => ({
    monthKey,
    totalSpent,
    paidA: totalSpent,
    paidB: 0,
    paidComun: 0,
    shareA: roundCents(totalSpent / 2),
    shareB: roundCents(totalSpent / 2),
    balanceA: roundCents(totalSpent / 2),
    settlementText: 'En paz',
    closedBy: 'uid_alex',
    closedAt: `${monthKey}-28T20:00:00.000Z`,
  });

  // Escenario en 2026-04-15:
  // - 2026-01: CERRADO con 300 € (entra en media; NO debe sumarse closure.totalSpent + txs)
  // - 2026-02: CERRADO con 0 € (sí cuenta como 0 € en la media!)
  // - 2026-03: SIN DATOS (abierto sin gastos -> NO se convierte en 0 € para la media!)
  // - 2026-04: Mes en curso ABIERTO con 250 € (sí entra en total anual, pero NO en la media!)
  // - Además: un gasto privado (999 €) y una liquidación (150 €) -> ambos excluidos siempre
  const txs: Transaction[] = [
    makeTx({ id: 'jan_1', monthKey: '2026-01', date: '2026-01-10', amount: 300 }),
    makeTx({ id: 'jan_priv', monthKey: '2026-01', date: '2026-01-11', amount: 999, isPrivate: true }),
    makeTx({
      id: 'jan_settle',
      monthKey: '2026-01',
      date: '2026-01-20',
      amount: 150,
      category: 'liquidacion',
      isSettlement: true,
      settlementTo: 'uid_marta',
    }),
    makeTx({ id: 'apr_1', monthKey: '2026-04', date: '2026-04-05', amount: 250 }),
  ];

  const closures: MonthClosure[] = [makeClosure('2026-01', 300), makeClosure('2026-02', 0)];

  const res = computeAnnualBalance({
    year: 2026,
    sharedTransactions: txs,
    systemBudgets: [],
    categoryBudgets: [],
    monthClosures: closures,
    recurring: [],
    todayISO: '2026-04-15',
  });

  // Total anual: 300 + 250 = 550 (privado 999 y liquidación 150 excluidos; cierre 300 NO duplicado)
  assert.equal(res.totalSharedSpent, 550);
  assert.equal(res.totalSharedCount, 2);

  // Estados por mes
  const jan = res.months[0];
  const feb = res.months[1];
  const mar = res.months[2];
  const apr = res.months[3];
  const may = res.months[4];
  assert.equal(jan.status, 'cerrado');
  assert.equal(jan.includedInAverage, true);
  assert.equal(feb.status, 'cerrado');
  assert.equal(feb.spent, 0);
  assert.equal(feb.includedInAverage, true);
  assert.equal(mar.status, 'sin_datos');
  assert.equal(mar.includedInAverage, false);
  assert.equal(apr.status, 'abierto');
  assert.equal(apr.isCurrentMonth, true);
  assert.equal(apr.includedInAverage, false);
  assert.equal(may.status, 'sin_datos');
  assert.equal(may.isFutureMonth, true);

  // Media: (300 + 0) / 2 = 150 € sobre 2 meses (ene y feb); mar sin datos y abr abierto excluidos
  assert.equal(res.monthsInAverageCount, 2);
  assert.deepEqual(res.monthsInAverageKeys, ['2026-01', '2026-02']);
  assert.equal(res.averageMonthlySpent, 150);
  assert.equal(res.currentMonthExcludedFromAverage, true);
  assert.equal(res.closedZeroMonthsCount, 1);

  // Si abril (mes en curso) se cierra, entonces SÍ entra en la media: (300 + 0 + 250) / 3 = 183.33
  const resWithClosedCurrent = computeAnnualBalance({
    year: 2026,
    sharedTransactions: txs,
    systemBudgets: [],
    categoryBudgets: [],
    monthClosures: [...closures, makeClosure('2026-04', 250)],
    recurring: [],
    todayISO: '2026-04-30',
  });
  assert.equal(resWithClosedCurrent.monthsInAverageCount, 3);
  assert.equal(resWithClosedCurrent.currentMonthExcludedFromAverage, false);
  assert.equal(resWithClosedCurrent.averageMonthlySpent, 183.33);
});

test('49. Balance anual — Presupuesto parcial, límite explícito de 0 €, sin mezclar previsiones y categoría archivada', () => {
  const archivedCat: CustomCategory = {
    id: 'cat_reforma_antigua',
    name: 'Reforma antigua',
    icon: 'wrench',
    color: '#9333EA',
    order: 1,
    archived: true,
    csvKeywords: '',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };
  const registry = buildCategoryRegistry([archivedCat]);

  const txs: Transaction[] = [
    // Enero: supermercado 320 € (presupuesto 350 €), ocio 45 € (límite explícito 0 €), reforma archivada 200 € (sin presupuesto)
    {
      id: 't1',
      monthKey: '2026-01',
      concept: 'Compra',
      category: 'supermercado',
      amount: 320,
      date: '2026-01-12',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: '2026-01-12T10:00:00.000Z',
      updatedAt: '2026-01-12T10:00:00.000Z',
    },
    {
      id: 't2',
      monthKey: '2026-01',
      concept: 'Cine',
      category: 'ocio',
      amount: 45,
      date: '2026-01-15',
      paidBy: 'uid_marta',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_marta',
      notes: '',
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
    },
    {
      id: 't3',
      monthKey: '2026-01',
      concept: 'Pintura pasillo',
      category: 'cat_reforma_antigua',
      amount: 200,
      date: '2026-01-18',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: '2026-01-18T10:00:00.000Z',
      updatedAt: '2026-01-18T10:00:00.000Z',
    },
  ];

  // Plantilla recurrente NO registrada en enero (NO debe mezclarse con gasto registrado en la comparativa presupuestaria)
  const recurring: RecurringExpense[] = [
    {
      id: 'rec_luz',
      concept: 'Luz',
      category: 'luz',
      amount: 90,
      frequency: 'mensual',
      dayOfMonth: 10,
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const budgets: MonthlyBudget[] = [
    {
      monthKey: '2026-01',
      limits: {
        supermercado: 350,
        ocio: 0, // Límite explícito de 0 € válido
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const res = computeAnnualBalance({
    year: 2026,
    sharedTransactions: txs,
    systemBudgets: budgets,
    categoryBudgets: [],
    monthClosures: [],
    recurring,
    categoryRegistry: registry,
    todayISO: '2026-02-10',
  });

  // Total registrado = 320 + 45 + 200 = 565 € (la previsión de 90 € de luz NO se suma)
  assert.equal(res.totalSharedSpent, 565);

  // Cobertura presupuestaria parcial: solo 365 € (320 + 45) tienen presupuesto frente a 350 € (350 + 0)
  // Desviación comparable SOLO sobre la parte presupuestada = 365 - 350 = +15 € (NO 565 - 350 = +215 €!)
  assert.equal(res.budgetSummary.coverage, 'partial');
  assert.equal(res.budgetSummary.configuredBudgetTotal, 350);
  assert.equal(res.budgetSummary.budgetedSpentTotal, 365);
  assert.equal(res.budgetSummary.unbudgetedSpentTotal, 200);
  assert.equal(res.budgetSummary.comparableDeviation, 15);

  // Categoría ocio con límite explícito de 0 €: desviación +45 €, sin porcentaje sobre base 0 €
  const ocioRow = res.categories.find((c) => c.categoryId === 'ocio');
  assert.ok(ocioRow);
  assert.equal(ocioRow.budgetCoverage, 'complete');
  assert.equal(ocioRow.budgetTotal, 0);
  assert.equal(ocioRow.comparableDeviation, 45);
  assert.equal(ocioRow.comparableDeviationPct, null);

  // Categoría archivada preservada en el histórico con etiqueta real y sin presupuesto
  const archRow = res.categories.find((c) => c.categoryId === 'cat_reforma_antigua');
  assert.ok(archRow);
  assert.equal(archRow.isArchived, true);
  assert.equal(archRow.label, 'Reforma antigua');
  assert.equal(archRow.totalSpent, 200);
  assert.equal(archRow.budgetCoverage, 'none');
  assert.equal(res.archivedCategoriesWithActivityCount, 1);

  // Caso límite: mes con ÚNICAMENTE límite de 0 € y 0 € de gasto -> presupuesto completo, desviación 0 €, sin % sobre 0
  const zeroOnlyRes = computeAnnualBalance({
    year: 2026,
    sharedTransactions: [],
    systemBudgets: [{ monthKey: '2026-01', limits: { ocio: 0 }, updatedAt: '2026-01-01T00:00:00Z' }],
    categoryBudgets: [],
    monthClosures: [],
    recurring: [],
    todayISO: '2026-02-10',
  });
  assert.equal(zeroOnlyRes.budgetSummary.hasAnyBudget, true);
  assert.equal(zeroOnlyRes.budgetSummary.coverage, 'complete');
  assert.equal(zeroOnlyRes.budgetSummary.configuredBudgetTotal, 0);
  assert.equal(zeroOnlyRes.budgetSummary.comparableDeviation, 0);
  assert.equal(zeroOnlyRes.budgetSummary.comparableDeviationPct, null);
});

test('50. Balance anual — Comparativa interanual mismo tramo, periodo incompleto y sin % sobre base 0 €', () => {
  const mkTx = (id: string, monthKey: string, category: string, amount: number): Transaction => ({
    id,
    monthKey,
    concept: `${category} ${monthKey}`,
    category,
    amount,
    date: `${monthKey}-10`,
    paidBy: 'uid_alex',
    recurringId: null,
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    notes: '',
    createdAt: `${monthKey}-10T10:00:00.000Z`,
    updatedAt: `${monthKey}-10T10:00:00.000Z`,
  });

  // Hoy es 2026-03-20 -> tramo comparable es ene–mar (2026 vs 2025)
  // En 2025 también hubo gasto en diciembre (500 €) -> NO debe entrar en el tramo ene–mar!
  const txs: Transaction[] = [
    mkTx('p1', '2025-01', 'supermercado', 200),
    mkTx('p2', '2025-02', 'supermercado', 200),
    mkTx('p3', '2025-12', 'supermercado', 500), // fuera del tramo ene–mar
    mkTx('c1', '2026-01', 'supermercado', 250),
    mkTx('c2', '2026-02', 'supermercado', 350), // pico en febrero
    mkTx('c3', '2026-03', 'ocio', 100), // categoría nueva en 2026 (base 0 € en 2025)
  ];

  const res = computeAnnualBalance({
    year: 2026,
    sharedTransactions: txs,
    systemBudgets: [],
    categoryBudgets: [],
    monthClosures: [],
    recurring: [],
    todayISO: '2026-03-20',
  });

  assert.equal(res.yoyComparison.hasSufficientData, true);
  assert.equal(res.yoyComparison.isIncompletePeriod, true);
  assert.equal(res.yoyComparison.spanEndMonth, 3);
  assert.equal(res.yoyComparison.spanLabel, 'ene–mar');
  assert.equal(res.yoyComparison.currentSpanSpent, 700); // 250 + 350 + 100
  assert.equal(res.yoyComparison.prevSpanSpent, 400); // 200 + 200 (dic 500 excluido!)
  assert.equal(res.yoyComparison.deltaAmount, 300);
  assert.equal(res.yoyComparison.deltaPct, 75);

  // Supermercado subió +200 € (+50%), pico en 2026-02 (350 €)
  const superRow = res.categories.find((c) => c.categoryId === 'supermercado');
  assert.ok(superRow);
  assert.equal(superRow.yoyDelta, 200);
  assert.equal(superRow.yoyDeltaPct, 50);
  assert.equal(superRow.peakMonthKey, '2026-02');
  assert.equal(superRow.peakMonthAmount, 350);

  // Ocio tenía base 0 € en 2025 -> yoyDelta = +100 €, pero yoyDeltaPct MUST be null!
  const ocioRow = res.categories.find((c) => c.categoryId === 'ocio');
  assert.ok(ocioRow);
  assert.equal(ocioRow.prevYearSpanSpent, 0);
  assert.equal(ocioRow.yoyDelta, 100);
  assert.equal(ocioRow.yoyDeltaPct, null);

  // Top subidas ordenado por mayor aumento YoY
  assert.equal(res.topRisingCategories[0].categoryId, 'supermercado');
  assert.equal(res.topRisingCategories[0].basis, 'yoy');
  assert.equal(res.topRisingCategories[1].categoryId, 'ocio');
  assert.equal(res.topRisingCategories[1].deltaPct, null);
});

test('51. Balance anual — Recibos no mensuales (previsto -> registrado sin duplicar, skippedMonths y plantillas sin startMonth)', () => {
  const recurring: RecurringExpense[] = [
    {
      id: 'rec_seguro',
      concept: 'Seguro de hogar',
      category: 'seguros',
      amount: 180,
      frequency: 'anual',
      dayOfMonth: 15,
      startMonth: '2026-06',
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'rec_comunidad',
      concept: 'Comunidad trimestral',
      category: 'comunidad',
      amount: 120,
      frequency: 'trimestral',
      dayOfMonth: 5,
      startMonth: '2026-01',
      skippedMonths: ['2026-04'], // abril omitido explícitamente
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'rec_sin_ref',
      concept: 'IBI antiguo',
      category: 'otros',
      amount: 340,
      frequency: 'anual',
      dayOfMonth: 20,
      // Sin startMonth -> NO debe inventar fecha!
      splitOverride: null,
      paidByDefault: 'uid_alex',
      active: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'rec_mensual_ignorado',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      frequency: 'mensual',
      dayOfMonth: 1,
      splitOverride: null,
      paidByDefault: COMMON_ACCOUNT_ID,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  // A) Antes de registrar el seguro anual: aparece como previsto
  const beforeRes = computeAnnualBalance({
    year: 2026,
    sharedTransactions: [],
    systemBudgets: [],
    categoryBudgets: [],
    monthClosures: [],
    recurring,
    todayISO: '2026-05-01',
  });

  // Plantilla sin startMonth detectada aparte sin inventar fechas
  assert.equal(beforeRes.nonMonthlyReceipts.unanchoredTemplates.length, 1);
  assert.equal(beforeRes.nonMonthlyReceipts.unanchoredTemplates[0].id, 'rec_sin_ref');
  assert.equal(
    beforeRes.nonMonthlyReceipts.occurrences.some((o) => o.recurringId === 'rec_sin_ref'),
    false
  );

  // Mensual no entra en recibos no mensuales
  assert.equal(
    beforeRes.nonMonthlyReceipts.occurrences.some((o) => o.recurringId === 'rec_mensual_ignorado'),
    false
  );

  // Comunidad trimestral: ene, jul, oct (abril omitido por skippedMonths -> skippedInYearCount === 1)
  assert.equal(beforeRes.nonMonthlyReceipts.skippedInYearCount, 1);
  const comMonths = beforeRes.nonMonthlyReceipts.occurrences
    .filter((o) => o.recurringId === 'rec_comunidad')
    .map((o) => o.monthKey);
  assert.deepEqual(comMonths, ['2026-01', '2026-07', '2026-10']);

  // Seguro anual en junio como previsto
  const seguroBefore = beforeRes.nonMonthlyReceipts.occurrences.filter(
    (o) => o.recurringId === 'rec_seguro'
  );
  assert.equal(seguroBefore.length, 1);
  assert.equal(seguroBefore[0].status, 'previsto');
  assert.equal(seguroBefore[0].amount, 180);
  assert.equal(beforeRes.nonMonthlyReceipts.plannedTotal, 540); // 180 + 3*120
  assert.equal(beforeRes.nonMonthlyReceipts.registeredTotal, 0);

  // B) Al registrar la transacción vinculada del seguro anual (importe real 192,50 €):
  // pasa a registrado y NO se duplica como previsto
  const registeredSeguroTx: Transaction = {
    id: 'tx_seguro_2026',
    monthKey: '2026-06',
    concept: 'Seguro de hogar',
    category: 'seguros',
    amount: 192.5,
    date: '2026-06-14',
    paidBy: COMMON_ACCOUNT_ID,
    recurringId: 'rec_seguro',
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    notes: '',
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  };

  const afterRes = computeAnnualBalance({
    year: 2026,
    sharedTransactions: [registeredSeguroTx],
    systemBudgets: [],
    categoryBudgets: [],
    monthClosures: [],
    recurring,
    todayISO: '2026-06-20',
  });

  const seguroAfter = afterRes.nonMonthlyReceipts.occurrences.filter(
    (o) => o.recurringId === 'rec_seguro'
  );
  assert.equal(seguroAfter.length, 1); // NUNCA duplicado
  assert.equal(seguroAfter[0].status, 'registrado');
  assert.equal(seguroAfter[0].amount, 192.5);
  assert.equal(seguroAfter[0].templateAmount, 180);
  assert.equal(seguroAfter[0].transactionId, 'tx_seguro_2026');
  assert.equal(afterRes.nonMonthlyReceipts.plannedTotal, 360); // solo los 3 de comunidad
  assert.equal(afterRes.nonMonthlyReceipts.registeredTotal, 192.5);
});

test('52. Balance anual — DemoHouseholdRepository.fetchAnnualBalanceData (privacidad) y caché aislada por usuario/hogar', async () => {
  const demo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const alex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const marta = { uid: 'demo_marta', displayName: 'Marta', photoURL: '' };
  const currentMonth = getCurrentMonthKeyLocal();

  // Añadir gasto privado de Marta y gasto privado de Alex -> ninguno debe salir en fetchAnnualBalanceData
  await demo.upsertTransaction(
    hid,
    {
      monthKey: currentMonth,
      concept: 'Regalo sorpresa Marta',
      category: 'ocio',
      amount: 140,
      date: `${currentMonth}-10`,
      paidBy: marta.uid,
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: marta.uid,
      notes: '',
    },
    marta
  );
  await demo.upsertTransaction(
    hid,
    {
      monthKey: currentMonth,
      concept: 'Regalo sorpresa Alex',
      category: 'ocio',
      amount: 85,
      date: `${currentMonth}-11`,
      paidBy: alex.uid,
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: alex.uid,
      notes: '',
    },
    alex
  );

  const raw = await demo.fetchAnnualBalanceData(hid);
  assert.equal(
    raw.sharedTransactions.some((t) => t.isPrivate),
    false,
    'fetchAnnualBalanceData nunca debe devolver gastos privados'
  );
  assert.equal(
    raw.sharedTransactions.some((t) => t.concept.includes('Regalo sorpresa')),
    false
  );
  assert.ok(raw.systemBudgets.length >= 1);

  const years = extractAvailableYears({
    sharedTransactions: raw.sharedTransactions,
    monthClosures: [],
    systemBudgets: raw.systemBudgets,
    categoryBudgets: raw.categoryBudgets,
    todayISO: `${currentMonth}-15`,
  });
  assert.ok(years.includes(Number(currentMonth.slice(0, 4))));

  // Aislamiento estricto de caché por (householdId, viewerUid)
  const cache = createScopedAnnualBalanceCache();
  cache.set('hogar_1', 'uid_a', {
    sharedTransactions: raw.sharedTransactions,
    systemBudgets: raw.systemBudgets,
    categoryBudgets: raw.categoryBudgets,
    loadedAt: 1000,
  });
  assert.ok(cache.get('hogar_1', 'uid_a'));
  assert.equal(cache.get('hogar_1', 'uid_b'), null);
  assert.equal(cache.get('hogar_2', 'uid_a'), null);
  cache.invalidateHousehold('hogar_1');
  assert.equal(cache.get('hogar_1', 'uid_a'), null);
});

test('53. Plan de ahorro mensual — importe insuficiente, orden de prioridad, excedente sin asignar y tope por restante', () => {
  const refDateISO = '2026-11-10';
  // 10 meses exactos desde 2026-11-10 hasta 2027-09-10:
  // g_a: faltan 1.500 € -> 150 €/mes
  // g_b: faltan 1.300 € -> 130 €/mes
  // g_c: faltan 600 €   -> 60 €/mes
  const mkGoal = (over: Partial<SavingsGoal> & { id: string; name: string }): SavingsGoal => ({
    icon: 'piggy-bank',
    color: '#0E5A64',
    targetAmount: 1000,
    targetDate: '2027-09-10',
    type: 'custom',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  const goals: SavingsGoal[] = [
    mkGoal({ id: 'g_a', name: 'Viaje verano', targetAmount: 1500 }),
    mkGoal({ id: 'g_b', name: 'Coche', targetAmount: 1300 }),
    mkGoal({ id: 'g_c', name: 'Escapada', targetAmount: 600 }),
  ];

  // A) Importe insuficiente: 250 € con cuotas 150 €, 130 €, 60 € -> propone 150 €, 100 €, 0 €
  const shortProp = proposeMonthlySavingsDistribution({
    targetAmount: 250,
    orderedGoalIds: ['g_a', 'g_b', 'g_c'],
    goals,
    movements: [],
    refDateISO,
  });
  assert.equal(shortProp.totalAssigned, 250);
  assert.equal(shortProp.unassignedAmount, 0);
  assert.deepEqual(
    shortProp.allocations.map((a) => ({
      goalId: a.goalId,
      proposed: a.proposedAmount,
      recommended: a.recommendedAmount,
      shortfall: a.shortfallAmount,
    })),
    [
      { goalId: 'g_a', proposed: 150, recommended: 150, shortfall: 0 },
      { goalId: 'g_b', proposed: 100, recommended: 130, shortfall: 30 },
      { goalId: 'g_c', proposed: 0, recommended: 60, shortfall: 60 },
    ]
  );
  assert.equal(shortProp.underfunded.length, 2);

  // B) Cambiar el orden de prioridad (g_c, g_a, g_b) cambia el reparto determinísticamente
  const reorderedProp = proposeMonthlySavingsDistribution({
    targetAmount: 250,
    orderedGoalIds: ['g_c', 'g_a', 'g_b'],
    goals,
    movements: [],
    refDateISO,
  });
  assert.deepEqual(
    reorderedProp.allocations.map((a) => [a.goalId, a.proposedAmount]),
    [
      ['g_c', 60],
      ['g_a', 150],
      ['g_b', 40],
    ]
  );
  assert.equal(reorderedProp.unassignedAmount, 0);

  // C) Excedente sin asignar: 400 € frente a 340 € sugeridos -> 60 € quedan "Sin asignar", no se mueven a ninguna meta
  const surplusProp = proposeMonthlySavingsDistribution({
    targetAmount: 400,
    orderedGoalIds: ['g_a', 'g_b', 'g_c'],
    goals,
    movements: [],
    refDateISO,
  });
  assert.equal(surplusProp.totalAssigned, 340);
  assert.equal(surplusProp.unassignedAmount, 60);
  assert.equal(surplusProp.underfunded.length, 0);

  // D) Tope por restante: si a una meta que vence este mes solo le faltan 25 € para completarse,
  // propone 25 € aunque el pool disponible sea 100 € (deja 75 € sin asignar)
  const nearDueGoal = mkGoal({
    id: 'g_near',
    name: 'Último tramo',
    targetAmount: 600,
    targetDate: '2026-11-30',
  });
  const nearDoneMoves: GoalMovement[] = [
    {
      id: 'm_c_prev',
      goalId: 'g_near',
      amount: 575,
      by: 'uid_alex',
      date: '2026-10-05',
      note: 'Ahorro previo',
      createdAt: '2026-10-05T00:00:00.000Z',
    },
  ];
  const cappedProp = proposeMonthlySavingsDistribution({
    targetAmount: 100,
    orderedGoalIds: ['g_near'],
    goals: [...goals, nearDueGoal],
    movements: nearDoneMoves,
    refDateISO,
  });
  assert.equal(cappedProp.allocations[0].proposedAmount, 25);
  assert.equal(cappedProp.unassignedAmount, 75);
});

test('54. Plan de ahorro mensual — metas sin fecha objetivo (0 € en propuesta), asignación manual y objetivo 0 €', () => {
  const refDateISO = '2026-11-10';
  const goals: SavingsGoal[] = [
    {
      id: 'g_nodate',
      name: 'Colchón de emergencia',
      icon: 'shield',
      color: '#15803D',
      targetAmount: 3000,
      targetDate: '',
      type: 'emergencia',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'g_dated',
      name: 'Viajes',
      icon: 'plane',
      color: '#0E5A64',
      targetAmount: 1000,
      targetDate: '2027-09-10', // 10 meses -> 100 €/mes
      type: 'viajes',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  // Propuesta: NO inventa cuota para meta sin fecha (propone 0 € y marca needsManualAmount)
  const prop = proposeMonthlySavingsDistribution({
    targetAmount: 300,
    orderedGoalIds: ['g_nodate', 'g_dated'],
    goals,
    movements: [],
    refDateISO,
  });
  assert.equal(prop.allocations[0].goalId, 'g_nodate');
  assert.equal(prop.allocations[0].proposedAmount, 0);
  assert.equal(prop.allocations[0].recommendedAmount, null);
  assert.equal(prop.allocations[0].needsManualAmount, true);
  assert.equal(prop.allocations[1].goalId, 'g_dated');
  assert.equal(prop.allocations[1].proposedAmount, 100);
  assert.equal(prop.unassignedAmount, 200);

  // Asignación manual en la meta sin fecha y evaluación con parte sin asignar
  const manualPlan: MonthlySavingsPlan = {
    monthKey: '2026-11',
    targetAmount: 300,
    allocations: sanitizeSavingsPlanAllocations([
      { goalId: 'g_nodate', plannedAmount: 150, priority: 0 },
      { goalId: 'g_dated', plannedAmount: 100, priority: 1 },
    ]),
    updatedBy: 'uid_alex',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };
  const evalManual = evaluateMonthlySavingsPlan({
    monthKey: '2026-11',
    plan: manualPlan,
    goals,
    movements: [],
    refDateISO,
  });
  assert.equal(evalManual.hasPlan, true);
  assert.equal(evalManual.targetAmount, 300);
  assert.equal(evalManual.totalAssigned, 250);
  assert.equal(evalManual.unassignedAmount, 50);
  assert.equal(evalManual.totalContributedPlanned, 0);
  assert.equal(evalManual.totalPending, 250);

  // Plan con 0 € es válido (respeta 0 como valor legítimo)
  assert.equal(parseNonNegativeAmountInput('0'), 0);
  assert.equal(parseNonNegativeAmountInput('0,00'), 0);
  assert.equal(formatDecimalInputES(125.5), '125,50');
  const zeroPlan: MonthlySavingsPlan = {
    monthKey: '2026-11',
    targetAmount: 0,
    allocations: [{ goalId: 'g_nodate', plannedAmount: 0, priority: 0 }],
    updatedBy: 'uid_alex',
    updatedAt: '2026-11-10T10:00:00.000Z',
  };
  const evalZero = evaluateMonthlySavingsPlan({
    monthKey: '2026-11',
    plan: zeroPlan,
    goals,
    movements: [],
    refDateISO,
  });
  assert.equal(evalZero.hasPlan, true);
  assert.equal(evalZero.targetAmount, 0);
  assert.equal(evalZero.totalAssigned, 0);
  assert.equal(evalZero.totalPending, 0);
});

test('55. Plan de ahorro mensual — aportación previa, retirada separada y exceso sobre lo planificado', () => {
  const refDateISO = '2026-11-15';
  const goals: SavingsGoal[] = [
    {
      id: 'g_1',
      name: 'Colchón',
      icon: 'shield',
      color: '#15803D',
      targetAmount: 3000,
      targetDate: '',
      type: 'emergencia',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'g_2',
      name: 'Viajes',
      icon: 'plane',
      color: '#0E5A64',
      targetAmount: 1500,
      targetDate: '2027-05-15',
      type: 'viajes',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'g_3',
      name: 'Navidad',
      icon: 'gift',
      color: '#D97706',
      targetAmount: 600,
      targetDate: '',
      type: 'custom',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const plan: MonthlySavingsPlan = {
    monthKey: '2026-11',
    targetAmount: 350,
    allocations: [
      { goalId: 'g_1', plannedAmount: 200, priority: 0 },
      { goalId: 'g_2', plannedAmount: 150, priority: 1 },
    ],
    updatedBy: 'uid_alex',
    updatedAt: '2026-11-15T10:00:00.000Z',
  };

  const movements: GoalMovement[] = [
    // Aportación previa en el mismo mes a g_1 (80 €) + retirada de 50 € en el mismo mes
    {
      id: 'm1',
      goalId: 'g_1',
      amount: 80,
      by: 'uid_alex',
      date: '2026-11-02',
      note: 'Aportación previa al plan',
      createdAt: '2026-11-02T09:00:00.000Z',
    },
    {
      id: 'm2',
      goalId: 'g_1',
      amount: -50,
      by: 'uid_marta',
      date: '2026-11-08',
      note: 'Imprevisto taller',
      createdAt: '2026-11-08T09:00:00.000Z',
    },
    // Exceso sobre lo planificado en g_2: planificado 150 €, aportado 220 € -> exceso 70 €, pendiente 0 €
    {
      id: 'm3',
      goalId: 'g_2',
      amount: 220,
      by: 'uid_marta',
      date: '2026-11-05',
      note: 'Extra viajes',
      createdAt: '2026-11-05T09:00:00.000Z',
    },
    // Movimiento en otro mes (NO debe contar en 2026-11)
    {
      id: 'm_oct',
      goalId: 'g_1',
      amount: 500,
      by: 'uid_alex',
      date: '2026-10-20',
      note: 'Mes anterior',
      createdAt: '2026-10-20T09:00:00.000Z',
    },
    // Actividad en meta fuera del plan (g_3)
    {
      id: 'm_unplanned',
      goalId: 'g_3',
      amount: 40,
      by: 'uid_alex',
      date: '2026-11-12',
      note: 'Aporte suelto Navidad',
      createdAt: '2026-11-12T09:00:00.000Z',
    },
  ];

  const ev = evaluateMonthlySavingsPlan({
    monthKey: '2026-11',
    plan,
    goals,
    movements,
    refDateISO,
  });

  const row1 = ev.rowsByGoalId.get('g_1')!;
  const row2 = ev.rowsByGoalId.get('g_2')!;

  // g_1: Aportado = 80 € (la retirada de 50 € NO se resta de Aportado, se muestra aparte)
  assert.equal(row1.plannedAmount, 200);
  assert.equal(row1.contributedAmount, 80);
  assert.equal(row1.pendingAmount, 120);
  assert.equal(row1.excessAmount, 0);
  assert.equal(row1.withdrawnAmount, 50);

  // g_2: Exceso de 70 €, pendiente = 0 € (nunca negativo)
  assert.equal(row2.plannedAmount, 150);
  assert.equal(row2.contributedAmount, 220);
  assert.equal(row2.pendingAmount, 0);
  assert.equal(row2.excessAmount, 70);
  assert.equal(row2.withdrawnAmount, 0);

  // Totales: el exceso de g_2 NO cancela los 120 € pendientes de g_1
  assert.equal(ev.totalContributedPlanned, 300); // 80 + 220
  assert.equal(ev.totalPending, 120); // 120 + 0
  assert.equal(ev.totalExcess, 70);
  assert.equal(ev.totalWithdrawnAll, 50);
  assert.equal(ev.totalContributedAll, 340); // 80 + 220 + 40
  assert.equal(ev.unplannedActivity.length, 1);
  assert.equal(ev.unplannedActivity[0].goalId, 'g_3');
  assert.equal(ev.unplannedActivity[0].contributedAmount, 40);
});

test('56. Plan de ahorro mensual — excluye archivadas/completadas por defecto y conserva planes históricos al archivar', () => {
  const refDateISO = '2026-11-10';
  const goals: SavingsGoal[] = [
    {
      id: 'g_active',
      name: 'Activa',
      icon: 'piggy-bank',
      color: '#0E5A64',
      targetAmount: 1000,
      targetDate: '',
      type: 'custom',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'g_completed',
      name: 'Completada',
      icon: 'piggy-bank',
      color: '#15803D',
      targetAmount: 500,
      targetDate: '',
      type: 'custom',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'g_archived',
      name: 'Meta archivada',
      icon: 'piggy-bank',
      color: '#64748B',
      targetAmount: 800,
      targetDate: '',
      type: 'viajes',
      archived: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const movements: GoalMovement[] = [
    {
      id: 'm_comp',
      goalId: 'g_completed',
      amount: 500,
      by: 'uid_alex',
      date: '2026-09-10',
      note: 'Completada',
      createdAt: '2026-09-10T00:00:00.000Z',
    },
    {
      id: 'm_arch_oct',
      goalId: 'g_archived',
      amount: 120,
      by: 'uid_marta',
      date: '2026-10-15',
      note: 'Aportación antes de archivar',
      createdAt: '2026-10-15T00:00:00.000Z',
    },
  ];

  // Por defecto al planificar un mes nuevo, solo se seleccionan activas y no completadas
  const selectable = getDefaultSelectableSavingsGoals(goals, movements, refDateISO);
  assert.deepEqual(selectable.map((g) => g.id), ['g_active']);

  const freshDraft = buildInitialSavingsPlanDraft({
    existingPlan: null,
    allPlans: [],
    goals,
    movements,
    refDateISO,
  });
  assert.equal(freshDraft.targetInput, '');
  assert.deepEqual(
    freshDraft.items.map((i) => ({ goalId: i.goalId, selected: i.selected })),
    [{ goalId: 'g_active', selected: true }]
  );

  // Plan histórico de octubre que incluía g_archived sigue siendo legible y conserva su asignación y aportación
  const pastPlan: MonthlySavingsPlan = {
    monthKey: '2026-10',
    targetAmount: 200,
    allocations: [
      { goalId: 'g_archived', plannedAmount: 150, priority: 0 },
      { goalId: 'g_active', plannedAmount: 50, priority: 1 },
    ],
    updatedBy: 'uid_alex',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  const pastEval = evaluateMonthlySavingsPlan({
    monthKey: '2026-10',
    plan: pastPlan,
    goals,
    movements,
    refDateISO,
  });
  assert.equal(pastEval.rows.length, 2);
  assert.equal(pastEval.rows[0].goalId, 'g_archived');
  assert.equal(pastEval.rows[0].goalName, 'Meta archivada');
  assert.equal(pastEval.rows[0].isArchived, true);
  assert.equal(pastEval.rows[0].plannedAmount, 150);
  assert.equal(pastEval.rows[0].contributedAmount, 120);
  assert.equal(pastEval.rows[0].pendingAmount, 30);
});

test('57. Plan de ahorro mensual — DemoHouseholdRepository, round-trip de backups, compatibilidad hacia atrás y cero impacto en saldos', async () => {
  const demo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const alex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
  const currentMonth = getCurrentMonthKeyLocal();

  // Capturar movimientos y balance antes de guardar el plan
  let beforeMovements: GoalMovement[] = [];
  const unsubMoves = demo.subscribeGoalMovements(hid, (m) => {
    beforeMovements = m;
  });
  let beforePlans: MonthlySavingsPlan[] = [];
  const unsubPlans = demo.subscribeSavingsPlans(hid, (p) => {
    beforePlans = p;
  });
  let beforeTxs: Transaction[] = [];
  const unsubTxs = demo.subscribeTransactionsByMonth(hid, currentMonth, alex.uid, (t) => {
    beforeTxs = t;
  });

  const initialMoveCount = beforeMovements.length;
  const initialTxCount = beforeTxs.length;
  const balanceBefore = calculateCoupleBalance(beforeTxs, memberA, memberB);
  assert.equal(beforePlans.length, 0);

  // Guardar un plan mensual NUNCA crea movimientos de ahorro ni transacciones ni altera saldos
  await demo.saveSavingsPlan(
    hid,
    {
      monthKey: currentMonth,
      targetAmount: 400,
      allocations: [
        { goalId: 'goal_1', plannedAmount: 200, priority: 0 },
        { goalId: 'goal_3', plannedAmount: 150, priority: 1 },
      ],
    },
    alex
  );

  assert.equal(beforePlans.length, 1);
  assert.equal(beforePlans[0].monthKey, currentMonth);
  assert.equal(beforePlans[0].targetAmount, 400);
  assert.equal(beforePlans[0].allocations.length, 2);
  assert.equal(beforeMovements.length, initialMoveCount, 'Guardar plan no debe crear movimientos de ahorro');
  assert.equal(beforeTxs.length, initialTxCount, 'Guardar plan no debe crear gastos');
  assert.deepEqual(calculateCoupleBalance(beforeTxs, memberA, memberB), balanceBefore);

  // Round-trip de backup: exportar, validar, eliminar plan y reimportar
  const exported = await demo.exportBackup(hid, alex.uid);
  assert.ok(Array.isArray(exported.savingsPlans));
  assert.equal(exported.savingsPlans?.length, 1);
  assert.equal(exported.savingsPlans?.[0].monthKey, currentMonth);
  assert.equal(exported.savingsPlans?.[0].targetAmount, 400);

  const validated = validateAndMigrateBackup(exported);
  assert.equal(validated.savingsPlans?.length, 1);
  assert.equal(validated.savingsPlans?.[0].allocations[0].goalId, 'goal_1');

  await demo.deleteSavingsPlan(hid, currentMonth, alex);
  assert.equal(beforePlans.length, 0);

  await demo.importBackup(hid, validated, alex);
  assert.equal(beforePlans.length, 1);
  assert.equal(beforePlans[0].targetAmount, 400);

  // Compatibilidad hacia atrás: backup antiguo SIN campo savingsPlans sigue siendo válido e importable
  // y conserva los planes existentes en lugar de destruirlos
  const legacyBackup = { ...exported } as Record<string, unknown>;
  delete legacyBackup.savingsPlans;
  const validatedLegacy = validateAndMigrateBackup(legacyBackup);
  assert.equal(validatedLegacy.savingsPlans, undefined);
  await demo.importBackup(hid, validatedLegacy, alex);
  assert.equal(beforePlans.length, 1);
  assert.equal(beforePlans[0].targetAmount, 400);

  unsubMoves();
  unsubPlans();
  unsubTxs();
});

test('Reorganización de navegación y enlaces anteriores: equivalencia al cambiar modo y atajos PWA', () => {
  assert.equal(isValidNavTab('compra'), true);
  assert.equal(isValidNavTab('mudanza'), true);
  assert.equal(isValidNavTab('hogar'), false);

  // Al cambiar entre Sencillo y Avanzado se conserva la sección equivalente sin saltar a otra salvo Ajustes -> Inicio
  assert.equal(resolveTabForUiMode('compra', 'sencillo'), 'compra');
  assert.equal(resolveTabForUiMode('mensual', 'sencillo'), 'mensual');
  assert.equal(resolveTabForUiMode('ahorros', 'sencillo'), 'ahorros');
  assert.equal(resolveTabForUiMode('mudanza', 'sencillo'), 'mudanza');
  assert.equal(resolveTabForUiMode('ayuda', 'sencillo'), 'ayuda');
  assert.equal(resolveTabForUiMode('ajustes', 'sencillo'), 'inicio');
  assert.equal(resolveTabForUiMode('ajustes', 'avanzado'), 'ajustes');

  // Atajos PWA y enlaces anteriores
  assert.deepEqual(
    resolveDeepLinkNavigation({ action: 'add-expense' }, 'sencillo'),
    { targetTab: null, openQuickExpense: true }
  );
  assert.deepEqual(
    resolveDeepLinkNavigation({ tab: 'inicio', open: 'shopping' }, 'sencillo'),
    { targetTab: 'compra', openQuickExpense: false }
  );
  assert.deepEqual(
    resolveDeepLinkNavigation({ tab: 'compra' }, 'avanzado'),
    { targetTab: 'compra', openQuickExpense: false }
  );
  assert.deepEqual(
    resolveDeepLinkNavigation({ tab: 'mudanza' }, 'sencillo'),
    { targetTab: 'mudanza', openQuickExpense: false }
  );
  assert.deepEqual(
    resolveDeepLinkNavigation({ tab: 'mensual' }, 'sencillo'),
    { targetTab: 'mensual', openQuickExpense: false }
  );
  // Enlace a ajustes en Sencillo no cambia de modo silenciosamente
  assert.deepEqual(
    resolveDeepLinkNavigation({ tab: 'ajustes' }, 'sencillo'),
    { targetTab: 'inicio', openQuickExpense: false }
  );
});

test('Fin de etapa de mudanza: estado compartido reversible, aviso sin mutar pendientes, búsqueda global y backup', async () => {
  const demo = new DemoHouseholdRepository();
  const hid = 'demo_hogar_santsadurni';
  const alex = { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };

  let currentHousehold: Household | null = null;
  let furniture: FurnitureItem[] = [];
  let checklist: ChecklistItem[] = [];
  let initialCosts: InitialCost[] = [];

  const unsubH = demo.subscribeHousehold(hid, (h) => { currentHousehold = h; });
  const unsubF = demo.subscribeFurniture(hid, (f) => { furniture = f; });
  const unsubC = demo.subscribeChecklist(hid, (c) => { checklist = c; });
  const unsubI = demo.subscribeInitialCosts(hid, (ic) => { initialCosts = ic; });

  // 1) Los hogares existentes sin mudanzaCompleted mantienen Mudanza activa por defecto
  assert.equal(isMudanzaCompleted(currentHousehold), false);
  assert.equal(isMudanzaCompleted(null), false);

  const pendingBefore = countPendingMudanzaItems(furniture, checklist);
  assert.equal(pendingBefore.hasPending, true);
  assert.ok(pendingBefore.pendingFurnitureCount > 0 || pendingBefore.pendingChecklistCount > 0);
  const warningText = buildMudanzaCompletionDescription(pendingBefore);
  assert.ok(warningText.includes('Aviso: todavía quedan'));
  assert.ok(warningText.includes('No se borrará ningún gasto'));

  const initialFurnitureSnapshot = furniture.map((f) => ({ id: f.id, status: f.status }));
  const initialChecklistSnapshot = checklist.map((c) => ({ id: c.id, done: c.done }));
  const initialCostsCount = initialCosts.length;

  // 2) Dar por terminada la mudanza: persiste estado compartido sin alterar ni borrar datos
  await demo.setMudanzaCompleted(hid, true, alex);
  assert.equal(isMudanzaCompleted(currentHousehold), true);
  assert.equal((currentHousehold as Household | null)?.mudanzaCompletedBy, alex.uid);
  assert.ok(Boolean((currentHousehold as Household | null)?.mudanzaCompletedAt));
  assert.deepEqual(
    furniture.map((f) => ({ id: f.id, status: f.status })),
    initialFurnitureSnapshot,
    'Terminar mudanza no debe marcar muebles como comprados ni borrarlos'
  );
  assert.deepEqual(
    checklist.map((c) => ({ id: c.id, done: c.done })),
    initialChecklistSnapshot,
    'Terminar mudanza no debe marcar tareas como hechas ni borrarlas'
  );
  assert.equal(initialCosts.length, initialCostsCount);

  // 3) Búsqueda global sigue encontrando gastos iniciales de mudanza cuando la etapa está terminada
  const allTx = await demo.fetchAllTransactions(hid, alex.uid);
  const allIc = await demo.fetchAllInitialCosts(hid);
  const searchSummary = filterGlobalExpenses(
    allTx,
    allIc,
    {
      origin: 'todos',
      payer: 'todos',
      text: allIc[0]?.concept.slice(0, 5) || 'fianza',
      amountQuery: '',
      category: 'todas',
    },
    { viewerUid: alex.uid }
  );
  assert.ok(
    searchSummary.items.some((r) => r.kind === 'mudanza'),
    'La búsqueda global debe conservar los gastos iniciales de mudanza'
  );

  // 4) Backup JSON conserva mudanzaCompleted y acepta copias antiguas sin ese campo
  const exportedCompleted = await demo.exportBackup(hid, alex.uid);
  assert.equal(exportedCompleted.mudanzaCompleted, true);
  assert.equal(exportedCompleted.mudanzaCompletedBy, alex.uid);
  const validatedCompleted = validateAndMigrateBackup(exportedCompleted);
  assert.equal(validatedCompleted.mudanzaCompleted, true);

  // Reabrir mudanza: reversible sin reinicializar ni borrar datos
  await demo.setMudanzaCompleted(hid, false, alex);
  assert.equal(isMudanzaCompleted(currentHousehold), false);
  assert.equal((currentHousehold as Household | null)?.mudanzaCompletedAt, null);
  assert.equal((currentHousehold as Household | null)?.mudanzaCompletedBy, null);
  assert.equal(initialCosts.length, initialCostsCount);

  // Restaurar copia con mudanzaCompleted=true vuelve a marcarla completada
  await demo.importBackup(hid, validatedCompleted, alex);
  assert.equal(isMudanzaCompleted(currentHousehold), true);

  // Copia antigua SIN mudanzaCompleted sigue siendo 100 % importable
  const legacyJson = { ...exportedCompleted } as Record<string, unknown>;
  delete legacyJson.mudanzaCompleted;
  delete legacyJson.mudanzaCompletedAt;
  delete legacyJson.mudanzaCompletedBy;
  const validatedLegacy = validateAndMigrateBackup(legacyJson);
  assert.equal(validatedLegacy.mudanzaCompleted, undefined);
  await demo.importBackup(hid, validatedLegacy, alex);
  assert.equal(isMudanzaCompleted(currentHousehold), true);

  // Aviso sin pendientes
  const cleanMsg = buildMudanzaCompletionDescription({
    pendingFurnitureCount: 0,
    pendingChecklistCount: 0,
    hasPending: false,
  });
  assert.ok(!cleanMsg.includes('todavía quedan'));
  assert.ok(cleanMsg.includes('Histórico de mudanza'));

  unsubH();
  unsubF();
  unsubC();
  unsubI();
});










