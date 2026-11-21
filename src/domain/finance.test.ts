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
} from './csvImport';
import {
  findMatchingRecurringForPreset,
  RECURRING_CATALOG_PRESETS,
  RECURRING_CATALOG_SEED_VERSION,
  VARIABLE_BUDGET_SUGGESTIONS,
} from './presets';
import { generateSpanishCSV, validateAndMigrateBackup } from './backup';
import { DemoHouseholdRepository } from '../repositories/DemoHouseholdRepository';
import {
  COMMON_ACCOUNT_ID,
  type FurnitureItem,
  type GoalMovement,
  type Household,
  type HouseholdMember,
  type HouseholdSettings,
  type NidoBackupV1,
  type RecurringExpense,
  type SavingsGoal,
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
