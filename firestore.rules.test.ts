import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const PROJECT_ID = 'demo-nido-rules-test';
const RULES_PATH = path.resolve('firestore.rules');

let testEnv: RulesTestEnvironment;

function parseEmulatorHost(): { host: string; port: number } | null {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) return null;
  const [host, portStr] = raw.split(':');
  const port = Number(portStr);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

function dbForUser(uid: string, emailVerified = true) {
  return testEnv
    .authenticatedContext(uid, {
      email: `${uid}@example.com`,
      email_verified: emailVerified,
    })
    .firestore();
}

async function seedHouseholdPhaseA(uid: string, hid = 'h1', inviteCode = 'SNT26A') {
  const db = dbForUser(uid, true);
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(db.doc(`invites/${inviteCode}`), {
    householdId: hid,
    householdName: 'Piso Sant Sadurní',
    createdBy: uid,
    memberCount: 1,
    createdAt: ts,
  });

  batch.set(db.doc(`households/${hid}`), {
    name: 'Piso Sant Sadurní',
    memberUids: [uid],
    inviteCode,
    settings: {
      splitMode: 'preset',
      presetA: 50,
      presetB: 50,
      incomeA: 0,
      incomeB: 0,
      currency: 'EUR',
    },
    createdAt: ts,
    updatedAt: ts,
  });

  batch.set(db.doc(`households/${hid}/members/${uid}`), {
    displayName: 'Alex',
    photoURL: '',
    role: 'member_a',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });

  batch.set(db.doc(`users/${uid}`), {
    householdId: hid,
    updatedAt: ts,
  });

  batch.set(db.doc(`households/${hid}/activity/act_create`), {
    uid,
    actorName: 'Alex',
    action: 'create',
    entity: 'hogar',
    entityId: hid,
    summary: 'Creó el hogar "Piso Sant Sadurní"',
    timestamp: ts,
  });

  await batch.commit();
}

before(async () => {
  const emulatorHost = parseEmulatorHost() ?? { host: '127.0.0.1', port: 8080 };
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: emulatorHost.host,
      port: emulatorHost.port,
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test('1. Batch A de createHousehold permitido para usuario autenticado con email verificado y denegado si no está verificado', async () => {
  await assertSucceeds(seedHouseholdPhaseA('uid_alex', 'h_ok', 'ABC123'));

  // Usuario sin email verificado rechazado
  const unverifiedDb = dbForUser('uid_unverified', false);
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const badBatch = unverifiedDb.batch();
  badBatch.set(unverifiedDb.doc('invites/UNV123'), {
    householdId: 'h_bad',
    householdName: 'Hogar no verificado',
    createdBy: 'uid_unverified',
    memberCount: 1,
    createdAt: ts,
  });
  badBatch.set(unverifiedDb.doc('households/h_bad'), {
    name: 'Hogar no verificado',
    memberUids: ['uid_unverified'],
    inviteCode: 'UNV123',
    settings: {
      splitMode: 'preset',
      presetA: 50,
      presetB: 50,
      incomeA: 0,
      incomeB: 0,
      currency: 'EUR',
    },
    createdAt: ts,
    updatedAt: ts,
  });
  await assertFails(badBatch.commit());
});

test('2. Seeds de Batch B permitidos tras A en lotes <= 15 documentos usando cuenta_comun', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const db = dbForUser('uid_alex', true);
  const ts = firebase.firestore.FieldValue.serverTimestamp();

  const batchB = db.batch();
  batchB.set(db.doc('households/h1/initialCosts/seed_ic_0'), {
    concept: 'Fianza legal',
    category: 'fianza',
    amount: 850,
    paidBy: 'cuenta_comun',
    status: 'pendiente',
    dueDate: '',
    notes: '',
    createdAt: ts,
    updatedAt: ts,
  });
  batchB.set(db.doc('households/h1/checklist/seed_cl_0'), {
    text: 'Comprobar depósito INCASÒL',
    done: false,
    doneBy: '',
    doneAt: '',
    group: 'Contrato y normativa Catalunya',
    order: 1,
    createdAt: ts,
    updatedAt: ts,
  });
  batchB.set(db.doc('households/h1/items/seed_fur_0'), {
    name: 'Sofá cama',
    room: 'salon',
    priority: 'imprescindible',
    status: 'pendiente',
    store: 'IKEA',
    productUrl: '',
    articleNumber: '',
    unitPrice: 0,
    qty: 1,
    notes: '',
    createdAt: ts,
    updatedAt: ts,
  });
  batchB.set(db.doc('households/h1/goals/seed_goal_0'), {
    name: 'Colchón de emergencia',
    icon: 'shield',
    color: '#0E5A64',
    targetAmount: 3000,
    targetDate: '',
    type: 'emergencia',
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  });

  await assertSucceeds(batchB.commit());
});

test('3. joinHouseholdByCode permitido para el segundo usuario; denegado para un tercero', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();

  // Segundo usuario (Marta) se une
  const dbMarta = dbForUser('uid_marta', true);
  const joinBatchMarta = dbMarta.batch();
  joinBatchMarta.update(dbMarta.doc('households/h1'), {
    memberUids: firebase.firestore.FieldValue.arrayUnion('uid_marta'),
    updatedAt: ts,
  });
  joinBatchMarta.update(dbMarta.doc('invites/SNT26A'), {
    memberCount: 2,
  });
  joinBatchMarta.set(dbMarta.doc('households/h1/members/uid_marta'), {
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatchMarta.set(dbMarta.doc('users/uid_marta'), {
    householdId: 'h1',
    updatedAt: ts,
  });
  joinBatchMarta.set(dbMarta.doc('households/h1/activity/act_join_marta'), {
    uid: 'uid_marta',
    actorName: 'Marta',
    action: 'join',
    entity: 'hogar',
    entityId: 'h1',
    summary: 'Marta se unió al hogar',
    timestamp: ts,
  });

  await assertSucceeds(joinBatchMarta.commit());

  // Tercer usuario intenta unirse -> denegado
  const dbThird = dbForUser('uid_third', true);
  const joinBatchThird = dbThird.batch();
  joinBatchThird.update(dbThird.doc('households/h1'), {
    memberUids: firebase.firestore.FieldValue.arrayUnion('uid_third'),
    updatedAt: ts,
  });
  joinBatchThird.set(dbThird.doc('households/h1/members/uid_third'), {
    displayName: 'Intruso',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  await assertFails(joinBatchThird.commit());
});

test('4. Usuario no miembro no puede leer ni escribir nada del hogar', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const dbAlex = dbForUser('uid_alex', true);
  const ts = firebase.firestore.FieldValue.serverTimestamp();

  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx1').set({
      monthKey: '2026-11',
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 850,
      date: '2026-11-01',
      paidBy: 'cuenta_comun',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  const dbIntruder = dbForUser('uid_intruder', true);
  await assertFails(dbIntruder.doc('households/h1').get());
  await assertFails(dbIntruder.doc('households/h1/transactions/tx1').get());
  await assertFails(dbIntruder.collection('households/h1/transactions').get());
  await assertFails(
    dbIntruder.doc('households/h1/transactions/tx_evil').set({
      monthKey: '2026-11',
      concept: 'Hack',
      category: 'otros',
      amount: 10,
      date: '2026-11-02',
      paidBy: 'cuenta_comun',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_intruder',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(dbIntruder.doc('households/h1/transactions/tx1').delete());

  // Tampoco anónimo / sin autenticar
  const unauth = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauth.doc('households/h1').get());
  await assertFails(unauth.doc('invites/SNT26A').get());
});

test('5. Activity no se puede editar ni borrar', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const dbAlex = dbForUser('uid_alex', true);

  await assertFails(
    dbAlex.doc('households/h1/activity/act_create').update({
      summary: 'Resumen manipulado',
    })
  );
  await assertFails(dbAlex.doc('households/h1/activity/act_create').delete());
});

test('6. Transacción con splitPctA = 0 se guarda como 0 y valida reglas endurecidas', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const dbAlex = dbForUser('uid_alex', true);
  const ts = firebase.firestore.FieldValue.serverTimestamp();

  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_zero_split').set({
      monthKey: '2026-11',
      concept: 'Gasto 100% pareja',
      category: 'ocio',
      amount: 45,
      date: '2026-11-18',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 0,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  const saved = await dbAlex.doc('households/h1/transactions/tx_zero_split').get();
  assert.equal(saved.data()?.splitPctA, 0);

  // Reglas endurecidas:
  // a) settings presetA + presetB != 100 -> denegado
  await assertFails(
    dbAlex.doc('households/h1').update({
      settings: {
        splitMode: 'preset',
        presetA: 60,
        presetB: 60,
        incomeA: 0,
        incomeB: 0,
        currency: 'EUR',
      },
      updatedAt: ts,
    })
  );

  // b) budgets con categoría desconocida o valor negativo -> denegado
  await assertFails(
    dbAlex.doc('households/h1/budgets/2026-11').set({
      monthKey: '2026-11',
      limits: { categoria_inventada: 100 },
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/budgets/2026-11').set({
      monthKey: '2026-11',
      limits: { supermercado: -50 },
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/budgets/2026-11').set({
      monthKey: '2026-11',
      limits: { supermercado: 400, alquiler: 850 },
      updatedAt: ts,
    })
  );

  // c) paidBy inválido (ni miembro ni 'cuenta_comun') -> denegado
  await assertFails(
    dbAlex.doc('households/h1/initialCosts/ic_bad_payer').set({
      concept: 'Fianza',
      category: 'fianza',
      amount: 800,
      paidBy: 'comun',
      status: 'pendiente',
      dueDate: '',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
});

test('7. Gastos personales (isPrivate + createdBy): aislamiento entre pareja, filtros list e inmutabilidad de createdBy', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);

  // Unir a Marta al hogar
  const joinBatch = dbMarta.batch();
  joinBatch.update(dbMarta.doc('households/h1'), {
    memberUids: firebase.firestore.FieldValue.arrayUnion('uid_marta'),
    updatedAt: ts,
  });
  joinBatch.update(dbMarta.doc('invites/SNT26A'), { memberCount: 2 });
  joinBatch.set(dbMarta.doc('households/h1/members/uid_marta'), {
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatch.set(dbMarta.doc('users/uid_marta'), { householdId: 'h1', updatedAt: ts });
  await assertSucceeds(joinBatch.commit());

  // 1) Gasto compartido creado por Alex
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_shared').set({
      monthKey: '2026-11',
      concept: 'Compra común',
      category: 'supermercado',
      amount: 60,
      date: '2026-11-10',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // 2) Gasto privado válido de Alex
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_priv_alex').set({
      monthKey: '2026-11',
      concept: 'Regalo sorpresa',
      category: 'ocio',
      amount: 95,
      date: '2026-11-12',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_alex',
      notes: 'Solo Alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // 3) Creación inválida de gasto privado: paidBy cuenta_comun, createdBy falso o liquidación -> denegado
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_priv_bad_payer').set({
      monthKey: '2026-11',
      concept: 'Privado cuenta común',
      category: 'ocio',
      amount: 20,
      date: '2026-11-12',
      paidBy: 'cuenta_comun',
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_priv_spoof').set({
      monthKey: '2026-11',
      concept: 'Suplantado',
      category: 'ocio',
      amount: 20,
      date: '2026-11-12',
      paidBy: 'uid_marta',
      recurringId: null,
      splitPctA: 0,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_marta',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_priv_settle').set({
      monthKey: '2026-11',
      concept: 'Liquidación privada',
      category: 'liquidacion',
      amount: 20,
      date: '2026-11-12',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: true,
      settlementTo: 'uid_marta',
      isPrivate: true,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // 4) Lectura / consultas: Marta NO puede hacer get ni list sin filtro; SÍ las 2 queries filtradas
  await assertFails(dbMarta.doc('households/h1/transactions/tx_priv_alex').get());
  await assertFails(dbMarta.collection('households/h1/transactions').get());

  const sharedSnap = await assertSucceeds(
    dbMarta.collection('households/h1/transactions').where('isPrivate', '==', false).get()
  );
  assert.deepEqual(
    sharedSnap.docs.map((d) => d.id),
    ['tx_shared']
  );

  const martaOwnSnap = await assertSucceeds(
    dbMarta.collection('households/h1/transactions').where('createdBy', '==', 'uid_marta').get()
  );
  assert.equal(martaOwnSnap.docs.length, 0);

  // 5) Marta NO puede apropiarse de un gasto compartido de Alex poniéndolo privado, ni editar/borrar el privado de Alex
  await assertFails(
    dbMarta.doc('households/h1/transactions/tx_shared').update({
      isPrivate: true,
      paidBy: 'uid_marta',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h1/transactions/tx_priv_alex').update({
      concept: 'Espiado',
      updatedAt: ts,
    })
  );
  await assertFails(dbMarta.doc('households/h1/transactions/tx_priv_alex').delete());

  // 6) Inmutabilidad de createdBy
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_shared').update({
      createdBy: 'uid_marta',
      updatedAt: ts,
    })
  );

  // 7) Autor puede editar y borrar su propio gasto privado
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_priv_alex').update({
      amount: 105,
      updatedAt: ts,
    })
  );
  await assertSucceeds(dbAlex.doc('households/h1/transactions/tx_priv_alex').delete());
});

test('8. A1 Deshacer exacto: restaurar gastos compartidos e iniciales con createdAt pasado y protección de privados', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const pastTs = firebase.firestore.Timestamp.fromMillis(Date.now() - 120_000);
  const futureTs = firebase.firestore.Timestamp.fromMillis(Date.now() + 86_400_000);

  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);

  // Unir a Marta
  const joinBatch = dbMarta.batch();
  joinBatch.update(dbMarta.doc('households/h1'), {
    memberUids: firebase.firestore.FieldValue.arrayUnion('uid_marta'),
    updatedAt: ts,
  });
  joinBatch.update(dbMarta.doc('invites/SNT26A'), { memberCount: 2 });
  joinBatch.set(dbMarta.doc('households/h1/members/uid_marta'), {
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatch.set(dbMarta.doc('users/uid_marta'), { householdId: 'h1', updatedAt: ts });
  await assertSucceeds(joinBatch.commit());

  // 1) Marta restaura un gasto compartido originalmente creado por Alex conservando createdBy y createdAt original
  await assertSucceeds(
    dbMarta.doc('households/h1/transactions/tx_undo_shared').set({
      monthKey: '2026-11',
      concept: 'Supermercado restaurado',
      category: 'supermercado',
      amount: 55,
      date: '2026-11-10',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: 'Original',
      createdAt: pastTs,
      updatedAt: ts,
    })
  );

  // 2) createdAt futuro es rechazado
  await assertFails(
    dbMarta.doc('households/h1/transactions/tx_undo_future').set({
      monthKey: '2026-11',
      concept: 'Fecha futura',
      category: 'supermercado',
      amount: 55,
      date: '2026-11-10',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: futureTs,
      updatedAt: ts,
    })
  );

  // 3) Marta NO puede restaurar un gasto privado cuyo createdBy sea Alex
  await assertFails(
    dbMarta.doc('households/h1/transactions/tx_undo_priv_spoof').set({
      monthKey: '2026-11',
      concept: 'Privado ajeno',
      category: 'ocio',
      amount: 30,
      date: '2026-11-10',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: pastTs,
      updatedAt: ts,
    })
  );

  // 4) Alex sí puede restaurar su propio gasto privado conservando su createdAt pasado
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_undo_priv_alex').set({
      monthKey: '2026-11',
      concept: 'Privado propio',
      category: 'ocio',
      amount: 30,
      date: '2026-11-10',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: true,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: pastTs,
      updatedAt: ts,
    })
  );

  // 5) Restaurar gasto inicial con createdAt pasado permitido; futuro rechazado
  await assertSucceeds(
    dbMarta.doc('households/h1/initialCosts/ic_undo_ok').set({
      concept: 'Copia llaves',
      category: 'cerrajeria',
      amount: 24,
      paidBy: 'uid_alex',
      status: 'pagado',
      dueDate: '',
      notes: '',
      createdAt: pastTs,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h1/initialCosts/ic_undo_future').set({
      concept: 'Copia llaves futuro',
      category: 'cerrajeria',
      amount: 24,
      paidBy: 'uid_alex',
      status: 'pagado',
      dueDate: '',
      notes: '',
      createdAt: futureTs,
      updatedAt: ts,
    })
  );
});

test('9. Lista de la compra compartida (households/{hid}/shopping): CRUD por miembros, bloqueo de inmutables y aislamiento externo', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Miembro crea elemento válido
  await assertSucceeds(
    dbAlex.doc('households/h1/shopping/shop_1').set({
      text: 'Aceite de oliva virgen',
      qty: 2,
      done: false,
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // qty <= 0 rechazado
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_bad_qty').set({
      text: 'Pan',
      qty: 0,
      done: false,
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Miembro actualiza done y qty
  await assertSucceeds(
    dbAlex.doc('households/h1/shopping/shop_1').update({
      done: true,
      qty: 3,
      updatedAt: ts,
    })
  );

  // Cambiar addedBy en update rechazado
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_1').update({
      addedBy: 'uid_intruder',
      updatedAt: ts,
    })
  );

  // Intruso no puede leer ni escribir en shopping
  await assertFails(dbIntruder.doc('households/h1/shopping/shop_1').get());
  await assertFails(dbIntruder.collection('households/h1/shopping').get());
  await assertFails(dbIntruder.doc('households/h1/shopping/shop_1').delete());

  // Miembro puede eliminar elemento
  await assertSucceeds(dbAlex.doc('households/h1/shopping/shop_1').delete());
});

test('10. Actualización de csvKeywords en households/{hid}: validación estricta de claves y bloqueo de otros campos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Actualización válida de csvKeywords por miembro
  await assertSucceeds(
    dbAlex.doc('households/h1').update({
      csvKeywords: {
        supermercado: 'mercadona, bonpreu, caprabo',
        luz: 'endesa, iberdrola',
      },
      updatedAt: ts,
    })
  );

  // Clave desconocida dentro de csvKeywords rechazada
  await assertFails(
    dbAlex.doc('households/h1').update({
      csvKeywords: {
        categoria_falsa: 'foo',
      },
      updatedAt: ts,
    })
  );

  // Intentar colar memberUids en el mismo update rechazado
  await assertFails(
    dbAlex.doc('households/h1').update({
      csvKeywords: { supermercado: 'mercadona' },
      memberUids: ['uid_alex', 'uid_intruder'],
      updatedAt: ts,
    })
  );

  // Intruso rechazado
  await assertFails(
    dbIntruder.doc('households/h1').update({
      csvKeywords: { supermercado: 'hack' },
      updatedAt: ts,
    })
  );
});

test('11. Cualquier miembro puede actualizar settings (ingresos) y csvKeywords sin tocar otros campos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Unir a Marta como member_b
  const joinBatch = dbMarta.batch();
  joinBatch.update(dbMarta.doc('households/h1'), {
    memberUids: firebase.firestore.FieldValue.arrayUnion('uid_marta'),
    updatedAt: ts,
  });
  joinBatch.update(dbMarta.doc('invites/SNT26A'), { memberCount: 2 });
  joinBatch.set(dbMarta.doc('households/h1/members/uid_marta'), {
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatch.set(dbMarta.doc('users/uid_marta'), { householdId: 'h1', updatedAt: ts });
  await assertSucceeds(joinBatch.commit());

  // 1) Marta actualiza solo settings (ingresos) sin tocar otros campos
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      settings: {
        splitMode: 'income',
        presetA: 55,
        presetB: 45,
        incomeA: 2400,
        incomeB: 1950,
        currency: 'EUR',
      },
      updatedAt: ts,
    })
  );

  // 2) Marta actualiza solo csvKeywords sin tocar settings ni name
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      csvKeywords: {
        supermercado: 'mercadona, bonpreu',
        transporte: 'renfe, tmb',
      },
      updatedAt: ts,
    })
  );

  // 3) Alex también actualiza solo settings después de existir csvKeywords
  await assertSucceeds(
    dbAlex.doc('households/h1').update({
      settings: {
        splitMode: 'preset',
        presetA: 50,
        presetB: 50,
        incomeA: 2500,
        incomeB: 2000,
        currency: 'EUR',
      },
      updatedAt: ts,
    })
  );

  // 4) No se permite mezclar csvKeywords con name en el mismo update
  await assertFails(
    dbAlex.doc('households/h1').update({
      csvKeywords: { supermercado: 'mercadona' },
      name: 'Nombre cambiado',
      updatedAt: ts,
    })
  );

  // 5) No se permite inyectar inviteCode junto a settings ni acceder si no eres miembro
  await assertFails(
    dbMarta.doc('households/h1').update({
      settings: {
        splitMode: 'preset',
        presetA: 50,
        presetB: 50,
        incomeA: 1000,
        incomeB: 1000,
        currency: 'EUR',
      },
      inviteCode: 'HACK99',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbIntruder.doc('households/h1').update({
      settings: {
        splitMode: 'preset',
        presetA: 50,
        presetB: 50,
        incomeA: 1000,
        incomeB: 1000,
        currency: 'EUR',
      },
      updatedAt: ts,
    })
  );
});



