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
  filterGlobalTransactions,
  findMissingRecurringForMonth,
  formatCoupleBalanceSecondPerson,
  formatDateES,
  formatEUR,
  formatLocalDateISO,
  getBudgetThresholdAlerts,
  getUpcomingChargesWithinDays,
  inferSplitChoice,
  monthlyEquivalent,
  resolveSplitPctForChoice,
} from './finance';
import { generateSpanishCSV, validateAndMigrateBackup } from './backup';
import { DemoHouseholdRepository } from '../repositories/DemoHouseholdRepository';
import type {
  FurnitureItem,
  GoalMovement,
  HouseholdMember,
  HouseholdSettings,
  NidoBackupV1,
  RecurringExpense,
  SavingsGoal,
  Transaction,
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

test('avisos en Inicio: umbral >80% de presupuesto y cargos recurrentes en próximos 3 días (incluyendo cambio de mes)', () => {
  const txs: Transaction[] = [
    // 80 exactos sobre 100 => NO debe saltar (>80% estricto)
    makeTx({ id: 'b1', category: 'luz', amount: 80 }),
    // 85 sobre 100 => SÍ salta (85%, no superado)
    makeTx({ id: 'b2', category: 'supermercado', amount: 85 }),
    // 110 sobre 100 => SÍ salta (110%, superado)
    makeTx({ id: 'b3', category: 'ocio', amount: 110 }),
    // 50 privados en agua + 50 compartidos sobre 100 => 50% (NO salta)
    makeTx({ id: 'b4', category: 'agua', amount: 50 }),
    makeTx({ id: 'b5', category: 'agua', amount: 50, isPrivate: true }),
  ];

  const budgetAlerts = getBudgetThresholdAlerts(
    txs,
    {
      monthKey: '2026-11',
      limits: { luz: 100, supermercado: 100, ocio: 100, agua: 100 },
      updatedAt: '',
    },
    80
  );
  assert.deepEqual(
    budgetAlerts.map((a) => ({ category: a.category, pct: a.pct, exceeded: a.exceeded })),
    [
      { category: 'ocio', pct: 110, exceeded: true },
      { category: 'supermercado', pct: 85, exceeded: false },
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

  const upcoming = getUpcomingChargesWithinDays(recs, '2026-11-29', 3, existingDecTx);
  assert.equal(upcoming.length, 2);
  assert.equal(upcoming[0].recurringId, 'r_day31');
  assert.equal(upcoming[0].dueDate, '2026-11-30');
  assert.equal(upcoming[0].daysUntil, 1);
  assert.equal(upcoming[0].alreadyGenerated, false);

  assert.equal(upcoming[1].recurringId, 'r_day1');
  assert.equal(upcoming[1].dueDate, '2026-12-01');
  assert.equal(upcoming[1].daysUntil, 2);
  assert.equal(upcoming[1].alreadyGenerated, true);
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
  let latestAlexAllIds: string[] = [];
  let latestMartaAllIds: string[] = [];
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
  const unsubAllAlex = repo.subscribeAllTransactions(
    'demo_hogar_santsadurni',
    'demo_alex',
    (txs) => {
      latestAlexAllIds = txs.map((t) => t.id);
    }
  );
  const unsubAllMarta = repo.subscribeAllTransactions(
    'demo_hogar_santsadurni',
    'demo_marta',
    (txs) => {
      latestMartaAllIds = txs.map((t) => t.id);
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
  assert.ok(latestAlexAllIds.includes(privAlexId));
  assert.ok(!latestMartaAllIds.includes(privAlexId));

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
  assert.ok(latestMartaAllIds.includes(privMartaId));
  assert.ok(!latestAlexAllIds.includes(privMartaId));

  // Exportación excluye gastos privados del otro miembro
  const exportAlex = await repo.exportBackup('demo_hogar_santsadurni', 'demo_alex');
  assert.ok(exportAlex.transactions.some((t) => t.id === privAlexId));
  assert.ok(!exportAlex.transactions.some((t) => t.id === privMartaId));

  const exportMarta = await repo.exportBackup('demo_hogar_santsadurni', 'demo_marta');
  assert.ok(exportMarta.transactions.some((t) => t.id === privMartaId));
  assert.ok(!exportMarta.transactions.some((t) => t.id === privAlexId));

  // Importación de Alex NO borra el gasto personal de Marta
  await repo.importBackup('demo_hogar_santsadurni', exportAlex, actorAlex);
  assert.ok(latestMartaAllIds.includes(privMartaId));
  assert.ok(!latestAlexAllIds.includes(privMartaId));

  // Borrado privado de Alex no genera actividad compartida
  const activityBeforePrivDelete = latestActivityCount;
  await repo.deleteTransaction('demo_hogar_santsadurni', privAlexId, 'Secreto Alex', actorAlex, {
    isPrivate: true,
  });
  assert.equal(latestActivityCount, activityBeforePrivDelete);
  assert.ok(!latestAlexAllIds.includes(privAlexId));

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
  unsubAllAlex();
  unsubAllMarta();
  unsubActivity();
  unsubFur();
});

