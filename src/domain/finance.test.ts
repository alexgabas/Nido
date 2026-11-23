import test from 'node:test';
import assert from 'node:assert/strict';
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
  getUpcomingCharges,
  getUpcomingChargesWithinDays,
  inferSplitChoice,
  isRecurringTemplatePending,
  monthlyEquivalent,
  resolveSplitPctForChoice,
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
} from './recurrence';
import {
  buildMonthAgendaGroups,
  buildMonthCalendarGrid,
} from './calendar';
import {
  DEFAULT_CATEGORY_COLORS,
  resolveCategoryColor,
  sanitizeCategoryColors,
} from './categoryPalette';
import { computeCommonAccountRadar } from './commonAccountRadar';
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
  buildShoppingCatalogId,
  findPendingDuplicateMatch,
  formatShoppingQtyUnit,
  groupShoppingItemsBySection,
  preindexMercadonaCatalog,
  searchShoppingSuggestions,
  searchShoppingSuggestionsPaginated,
  type StaticMercadonaCatalogEntry,
} from './shoppingCatalog';
import {
  buildCategoryRegistry,
  canSafelyDeleteCustomCategory,
  generateCustomCategoryId,
  getAvailableCategorySuggestions,
  isCategoryDuplicateName,
  isCategoryUsedInHouseholdData,
  mergeMonthlyAndCustomBudgetLimits,
  pickSimpleWizardCategories,
  planCopyPreviousMonthBudgets,
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
  type CustomCategory,
  type FurnitureItem,
  type GoalMovement,
  type Household,
  type HouseholdMember,
  type HouseholdSettings,
  type InitialCost,
  type NidoBackupV1,
  type PendingShoppingCheckout,
  type RecurringExpense,
  type SavingsGoal,
  type ShoppingItem,
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





