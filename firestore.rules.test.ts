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

async function joinHouseholdSecondMember(
  uid: string,
  hid = 'h1',
  inviteCode = 'SNT26A',
  displayName = 'Marta'
) {
  const db = dbForUser(uid, true);
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const joinBatch = db.batch();

  joinBatch.update(db.doc(`households/${hid}`), {
    memberUids: firebase.firestore.FieldValue.arrayUnion(uid),
    updatedAt: ts,
  });
  joinBatch.update(db.doc(`invites/${inviteCode}`), {
    memberCount: 2,
  });
  joinBatch.set(db.doc(`households/${hid}/members/${uid}`), {
    displayName,
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatch.set(db.doc(`users/${uid}`), {
    householdId: hid,
    updatedAt: ts,
  });
  joinBatch.set(db.doc(`households/${hid}/activity/act_join_${uid}`), {
    uid,
    actorName: displayName,
    action: 'join',
    entity: 'hogar',
    entityId: hid,
    summary: `${displayName} se unió al hogar`,
    timestamp: ts,
  });

  await joinBatch.commit();
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

test('12. seedPending / recurringSeedVersion en households y semillas inactivas de recurring', async () => {
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Fase A creando hogar con seedPending=true y recurringSeedVersion=0
  const batchA = dbAlex.batch();
  batchA.set(dbAlex.doc('invites/SEED01'), {
    householdId: 'h_seed',
    householdName: 'Nido Semilla',
    createdBy: 'uid_alex',
    memberCount: 1,
    createdAt: ts,
  });
  batchA.set(dbAlex.doc('households/h_seed'), {
    name: 'Nido Semilla',
    memberUids: ['uid_alex'],
    inviteCode: 'SEED01',
    settings: {
      splitMode: 'income',
      presetA: 50,
      presetB: 50,
      incomeA: 0,
      incomeB: 0,
      currency: 'EUR',
    },
    seedPending: true,
    recurringSeedVersion: 0,
    createdAt: ts,
    updatedAt: ts,
  });
  batchA.set(dbAlex.doc('households/h_seed/members/uid_alex'), {
    displayName: 'Alex',
    photoURL: '',
    role: 'member_a',
    uiMode: 'avanzado',
    joinedAt: ts,
    updatedAt: ts,
  });
  batchA.set(dbAlex.doc('users/uid_alex'), { householdId: 'h_seed', updatedAt: ts });
  await assertSucceeds(batchA.commit());

  // Fase B creando plantilla habitual inactiva a 0 € y cerrando seedPending=false, recurringSeedVersion=1
  const batchB = dbAlex.batch();
  batchB.set(dbAlex.doc('households/h_seed/recurring/seed_rec_alquiler'), {
    concept: 'Alquiler',
    category: 'alquiler',
    amount: 0,
    frequency: 'mensual',
    dayOfMonth: 1,
    splitOverride: null,
    paidByDefault: 'cuenta_comun',
    active: false,
    createdAt: ts,
    updatedAt: ts,
  });
  batchB.update(dbAlex.doc('households/h_seed'), {
    seedPending: false,
    recurringSeedVersion: 1,
    updatedAt: ts,
  });
  await assertSucceeds(batchB.commit());

  // Rechazar recurringSeedVersion negativo o float
  await assertFails(
    dbAlex.doc('households/h_seed').update({
      recurringSeedVersion: -1,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h_seed').update({
      recurringSeedVersion: 1.5,
      updatedAt: ts,
    })
  );

  // Rechazar seedPending no booleano
  await assertFails(
    dbAlex.doc('households/h_seed').update({
      seedPending: 'false',
      updatedAt: ts,
    })
  );

  // Rechazar mezclar seedPending con name/memberUids
  await assertFails(
    dbAlex.doc('households/h_seed').update({
      seedPending: true,
      name: 'Hack',
      updatedAt: ts,
    })
  );

  // Intruso no puede modificar seedPending
  await assertFails(
    dbIntruder.doc('households/h_seed').update({
      seedPending: true,
      recurringSeedVersion: 0,
      updatedAt: ts,
    })
  );
});

test('13. recurring.startMonth acepta YYYY-MM o vacío y rechaza formatos inválidos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);

  // Crear con startMonth válido YYYY-MM
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_bim').set({
      concept: 'Agua',
      category: 'agua',
      amount: 45,
      frequency: 'bimestral',
      dayOfMonth: 10,
      startMonth: '2026-11',
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Actualizar startMonth a vacío ('') y luego a otro mes válido
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_bim').update({
      startMonth: '',
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_bim').update({
      startMonth: '2027-01',
      updatedAt: ts,
    })
  );

  // Crear sin startMonth (legado / opcional) permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_no_start').set({
      concept: 'Alquiler',
      category: 'alquiler',
      amount: 900,
      frequency: 'mensual',
      dayOfMonth: 1,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Rechazar formatos inválidos en create y update
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_bad1').set({
      concept: 'Luz',
      category: 'luz',
      amount: 60,
      frequency: 'mensual',
      dayOfMonth: 5,
      startMonth: '2026-11-01',
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_bad2').set({
      concept: 'Gas',
      category: 'gas',
      amount: 40,
      frequency: 'bimestral',
      dayOfMonth: 5,
      startMonth: '202611',
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_bim').update({
      startMonth: 'nov-26',
      updatedAt: ts,
    })
  );
});

test('14. households Action 6: categoryColors compartidos por miembro, hex #RRGGBB estricto y rechazo de claves/campos ajenos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Unir a Marta como segundo miembro
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

  // Miembro actualiza categoryColors con hex válido y categorías permitidas
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      categoryColors: {
        alquiler: '#3A7D5C',
        supermercado: '#D97706',
        luz: '#eab308',
      },
      updatedAt: ts,
    })
  );

  // Hex inválido rechazado ('red', '#123', '#GGGGGG')
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { alquiler: 'red' },
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { alquiler: '#123' },
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { alquiler: '#GGGGGG' },
      updatedAt: ts,
    })
  );

  // Clave de categoría desconocida o 'liquidacion' rechazada
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { liquidacion: '#3A7D5C' },
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { inventada: '#3A7D5C' },
      updatedAt: ts,
    })
  );

  // No se permite mezclar categoryColors con settings ni inviteCode
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { alquiler: '#3A7D5C' },
      inviteCode: 'HACK99',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      categoryColors: { alquiler: '#3A7D5C' },
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

  // Intruso no miembro rechazado
  await assertFails(
    dbIntruder.doc('households/h1').update({
      categoryColors: { alquiler: '#3A7D5C' },
      updatedAt: ts,
    })
  );
});

test('15. Categorías personalizadas (/categories/{catId}): CRUD, formato hex/icono/id estricto e inmutabilidad de createdAt', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Crear categoría válida
  await assertSucceeds(
    dbAlex.doc('households/h1/categories/cat_gimnasio').set({
      name: 'Gimnasio',
      color: '#16A34A',
      icon: 'dumbbell',
      order: 1,
      archived: false,
      csvKeywords: 'basic-fit, dir, gimnasio',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // ID inválido sin prefijo cat_ -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/categories/not_cat_1').set({
      name: 'Mal ID',
      color: '#16A34A',
      icon: 'tag',
      order: 2,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Color hex inválido -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/categories/cat_bad_hex').set({
      name: 'Mal color',
      color: 'verde',
      icon: 'tag',
      order: 2,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Icono inválido -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/categories/cat_bad_icon').set({
      name: 'Mal icono',
      color: '#16A34A',
      icon: 'icono_inventado',
      order: 2,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Editar nombre, color y archivar permitido; cambiar createdAt rechazado
  await assertSucceeds(
    dbAlex.doc('households/h1/categories/cat_gimnasio').update({
      name: 'Deporte y gym',
      color: '#0D9488',
      archived: true,
      updatedAt: ts,
    })
  );
  const pastTs = firebase.firestore.Timestamp.fromMillis(Date.now() - 60_000);
  await assertFails(
    dbAlex.doc('households/h1/categories/cat_gimnasio').update({
      createdAt: pastTs,
      updatedAt: ts,
    })
  );

  // Intruso no puede leer ni escribir
  await assertFails(dbIntruder.doc('households/h1/categories/cat_gimnasio').get());
  await assertFails(
    dbIntruder.doc('households/h1/categories/cat_hack').set({
      name: 'Hack',
      color: '#16A34A',
      icon: 'tag',
      order: 1,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Miembro puede eliminar una categoría personalizada sin uso
  await assertSucceeds(dbAlex.doc('households/h1/categories/cat_gimnasio').delete());
});

test('16. Aislamiento entre hogares de categorías personalizadas y categoryBudgets/{monthKey}__{catId}', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await seedHouseholdPhaseA('uid_marta', 'h2', 'MRTA26');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);

  // Alex crea cat_gimnasio en h1
  await assertSucceeds(
    dbAlex.doc('households/h1/categories/cat_gimnasio').set({
      name: 'Gimnasio',
      color: '#16A34A',
      icon: 'dumbbell',
      order: 1,
      archived: false,
      csvKeywords: 'basic-fit',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Alex puede usar cat_gimnasio en transactions, recurring, initialCosts y categoryBudgets dentro de h1
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_gym').set({
      monthKey: '2026-11',
      concept: 'Cuota Basic-Fit',
      category: 'cat_gimnasio',
      amount: 35,
      date: '2026-11-05',
      paidBy: 'uid_alex',
      recurringId: null,
      splitPctA: 100,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_alex',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_gym').set({
      concept: 'Mensualidad gimnasio',
      category: 'cat_gimnasio',
      amount: 35,
      frequency: 'mensual',
      dayOfMonth: 5,
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/initialCosts/ic_gym').set({
      concept: 'Matrícula club',
      category: 'cat_gimnasio',
      amount: 50,
      paidBy: 'uid_alex',
      status: 'pagado',
      dueDate: '',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/categoryBudgets/2026-11__cat_gimnasio').set({
      monthKey: '2026-11',
      categoryId: 'cat_gimnasio',
      limit: 60,
      updatedAt: ts,
    })
  );

  // Clave de categoryBudgets mal formada o colocada en budgets/{monthKey} -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/categoryBudgets/doc_malo').set({
      monthKey: '2026-11',
      categoryId: 'cat_gimnasio',
      limit: 60,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/budgets/2026-11').set({
      monthKey: '2026-11',
      limits: { cat_gimnasio: 60 },
      updatedAt: ts,
    })
  );

  // Marta (hogar h2) NO puede referenciar cat_gimnasio de h1 en ninguna colección de h2
  await assertFails(
    dbMarta.doc('households/h2/transactions/tx_cross').set({
      monthKey: '2026-11',
      concept: 'Intento cruzado',
      category: 'cat_gimnasio',
      amount: 20,
      date: '2026-11-05',
      paidBy: 'uid_marta',
      recurringId: null,
      splitPctA: 50,
      isSettlement: false,
      settlementTo: '',
      isPrivate: false,
      createdBy: 'uid_marta',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h2/recurring/rec_cross').set({
      concept: 'Recurrente cruzada',
      category: 'cat_gimnasio',
      amount: 20,
      frequency: 'mensual',
      dayOfMonth: 5,
      splitOverride: null,
      paidByDefault: 'uid_marta',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h2/initialCosts/ic_cross').set({
      concept: 'Inicial cruzado',
      category: 'cat_gimnasio',
      amount: 20,
      paidBy: 'uid_marta',
      status: 'pendiente',
      dueDate: '',
      notes: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h2/categoryBudgets/2026-11__cat_gimnasio').set({
      monthKey: '2026-11',
      categoryId: 'cat_gimnasio',
      limit: 60,
      updatedAt: ts,
    })
  );
});

test('17. shopping con unit y qty decimal + shoppingCatalog/{prodId} con validación estricta', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Shopping con qty decimal 0.5 y unit 'kg' -> permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/shopping/shop_dec').set({
      text: 'Tomates pera',
      qty: 0.5,
      unit: 'kg',
      done: false,
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Shopping con qty <= 0, > 999 o unit > 20 -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_big').set({
      text: 'Arroz',
      qty: 1000,
      unit: 'kg',
      done: false,
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_bad_unit').set({
      text: 'Arroz',
      qty: 1,
      unit: 'unidad_demasiado_larga_para_regla',
      done: false,
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // shoppingCatalog válido con prod_
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingCatalog/prod_tomates_pera').set({
      text: 'Tomates pera',
      defaultUnit: 'kg',
      usageCount: 1,
      lastUsedAt: '2026-11-20',
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Actualizar usageCount y lastUsedAt permitido; cambiar createdBy rechazado
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingCatalog/prod_tomates_pera').update({
      usageCount: 2,
      lastUsedAt: '2026-11-21',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shoppingCatalog/prod_tomates_pera').update({
      createdBy: 'uid_intruder',
      updatedAt: ts,
    })
  );

  // ID sin prefijo prod_ o usageCount <= 0 o > 100000 -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/shoppingCatalog/tomates_pera').set({
      text: 'Tomates pera',
      defaultUnit: 'kg',
      usageCount: 1,
      lastUsedAt: '2026-11-20',
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shoppingCatalog/prod_bad_count').set({
      text: 'Patatas',
      defaultUnit: 'kg',
      usageCount: 0,
      lastUsedAt: '2026-11-20',
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // shopping con metadata válida de catálogo Mercadona -> permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/shopping/shop_mc').set({
      text: 'Leche sin lactosa',
      qty: 2,
      unit: 'L',
      done: false,
      catalogId: 'mc_leche_sin_lactosa_123',
      brand: 'Hacendado',
      format: '1 L',
      section: 'Lácteos, quesos y bebidas vegetales',
      sourceType: 'mercadona',
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // section o sourceType inventado en shopping -> rechazado
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_bad_sec').set({
      text: 'Leche',
      qty: 1,
      done: false,
      section: 'Pasillo 99 inventado',
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shopping/shop_bad_src').set({
      text: 'Leche',
      qty: 1,
      done: false,
      sourceType: 'carrefour',
      addedBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // shoppingCatalog con favorite + metadata y actualización de favorito -> permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingCatalog/prod_leche_sin_lactosa').set({
      text: 'Leche sin lactosa',
      defaultUnit: 'L',
      usageCount: 1,
      lastUsedAt: '2026-11-20',
      favorite: true,
      catalogId: 'mc_leche_sin_lactosa_123',
      brand: 'Hacendado',
      format: '1 L',
      section: 'Lácteos, quesos y bebidas vegetales',
      sourceType: 'mercadona',
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingCatalog/prod_leche_sin_lactosa').update({
      favorite: false,
      updatedAt: ts,
    })
  );

  // Intruso rechazado en shoppingCatalog
  await assertFails(dbIntruder.doc('households/h1/shoppingCatalog/prod_tomates_pera').get());
});

// ─── 18. Meses cerrados en reglas (transactions, budgets, categoryBudgets) ──
test('18. monthClosures bloquea escrituras en transactions, budgets y categoryBudgets hasta reabrir', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);

  // Creamos categoría personalizada, gasto y presupuestos en mes abierto 2026-10
  await assertSucceeds(
    dbAlex.doc('households/h1/categories/cat_mascotas').set({
      name: 'Mascotas',
      color: '#D97706',
      icon: 'paw-print',
      order: 0,
      archived: false,
      csvKeywords: 'vet',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_open_1').set({
      monthKey: '2026-10',
      concept: 'Compra octubre',
      category: 'supermercado',
      amount: 55.4,
      date: '2026-10-12',
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
  await assertSucceeds(
    dbAlex.doc('households/h1/budgets/2026-10').set({
      monthKey: '2026-10',
      limits: { supermercado: 400 },
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/categoryBudgets/2026-10__cat_mascotas').set({
      monthKey: '2026-10',
      categoryId: 'cat_mascotas',
      limit: 80,
      updatedAt: ts,
    })
  );

  // Cerramos 2026-10
  await assertSucceeds(
    dbAlex.doc('households/h1/monthClosures/2026-10').set({
      monthKey: '2026-10',
      totalSpent: 55.4,
      paidA: 55.4,
      paidB: 0,
      paidComun: 0,
      shareA: 27.7,
      shareB: 27.7,
      balanceA: 27.7,
      settlementText: 'Marta debe 27,70 € a Alex',
      closedBy: 'uid_alex',
      closedAt: ts,
    })
  );

  // Con 2026-10 cerrado: crear, editar, borrar en transactions, budgets y categoryBudgets -> RECHAZADO
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_closed_new').set({
      monthKey: '2026-10',
      concept: 'Intento tardío',
      category: 'otros',
      amount: 10,
      date: '2026-10-20',
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
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_open_1').update({
      amount: 99,
      updatedAt: ts,
    })
  );
  await assertFails(dbAlex.doc('households/h1/transactions/tx_open_1').delete());

  // Tampoco se puede mover un movimiento de un mes abierto a un mes cerrado
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_nov_1').set({
      monthKey: '2026-11',
      concept: 'Gasto noviembre',
      category: 'otros',
      amount: 20,
      date: '2026-11-05',
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
  await assertFails(
    dbAlex.doc('households/h1/transactions/tx_nov_1').update({
      monthKey: '2026-10',
      date: '2026-10-25',
      updatedAt: ts,
    })
  );

  await assertFails(
    dbAlex.doc('households/h1/budgets/2026-10').update({
      limits: { supermercado: 500 },
      updatedAt: ts,
    })
  );
  await assertFails(dbAlex.doc('households/h1/budgets/2026-10').delete());

  await assertFails(
    dbAlex.doc('households/h1/categoryBudgets/2026-10__cat_mascotas').update({
      limit: 120,
      updatedAt: ts,
    })
  );
  await assertFails(dbAlex.doc('households/h1/categoryBudgets/2026-10__cat_mascotas').delete());

  // Reabrir el mes (delete monthClosure) vuelve a permitir ediciones
  await assertSucceeds(dbAlex.doc('households/h1/monthClosures/2026-10').delete());
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_open_1').update({
      amount: 60,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/budgets/2026-10').update({
      limits: { supermercado: 450 },
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/categoryBudgets/2026-10__cat_mascotas').update({
      limit: 95,
      updatedAt: ts,
    })
  );
});

// ─── 19. shoppingCheckouts atómicos, privacidad e integridad ──────────────────
test('19. shoppingCheckouts exige gasto enlazado, progreso decreciente, privacidad y aislamiento', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Huérfano sin transacción tx_chk_* asociada -> RECHAZADO
  await assertFails(
    dbAlex.doc('households/h1/shoppingCheckouts/chk_orphan_12345').set({
      expenseId: 'tx_chk_orphan_12345',
      monthKey: '2026-11',
      amount: 42.5,
      concept: 'Compra Mercadona',
      pendingItemIds: ['item_11', 'item_12'],
      totalItemCount: 12,
      isPrivate: false,
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Creación atómica de gasto + shoppingCheckout compartido -> PERMITIDO
  const sharedBatch = dbAlex.batch();
  sharedBatch.set(dbAlex.doc('households/h1/transactions/tx_chk_shared_001'), {
    monthKey: '2026-11',
    concept: 'Compra semanal',
    category: 'supermercado',
    amount: 78.9,
    date: '2026-11-20',
    paidBy: 'uid_alex',
    recurringId: null,
    splitPctA: 50,
    isSettlement: false,
    settlementTo: '',
    isPrivate: false,
    createdBy: 'uid_alex',
    notes: 'Lista de la compra',
    createdAt: ts,
    updatedAt: ts,
  });
  sharedBatch.set(dbAlex.doc('households/h1/shoppingCheckouts/chk_shared_001'), {
    expenseId: 'tx_chk_shared_001',
    monthKey: '2026-11',
    amount: 78.9,
    concept: 'Compra semanal',
    pendingItemIds: ['item_11', 'item_12'],
    totalItemCount: 12,
    isPrivate: false,
    createdBy: 'uid_alex',
    createdAt: ts,
    updatedAt: ts,
  });
  await assertSucceeds(sharedBatch.commit());

  // Pareja (Marta) puede leer, reducir pendingItemIds y borrar al terminar un checkout compartido
  await assertSucceeds(dbMarta.doc('households/h1/shoppingCheckouts/chk_shared_001').get());
  await assertSucceeds(
    dbMarta.doc('households/h1/shoppingCheckouts/chk_shared_001').update({
      pendingItemIds: ['item_12'],
      updatedAt: ts,
    })
  );
  // Inflar pendingItemIds o cambiar expenseId -> RECHAZADO
  await assertFails(
    dbMarta.doc('households/h1/shoppingCheckouts/chk_shared_001').update({
      pendingItemIds: ['item_12', 'item_99'],
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h1/shoppingCheckouts/chk_shared_001').update({
      amount: 1,
      updatedAt: ts,
    })
  );
  await assertSucceeds(dbMarta.doc('households/h1/shoppingCheckouts/chk_shared_001').delete());

  // Checkout privado de Alex: requiere amount 0 y concept 'Compra privada', invisible para Marta
  const privBatch = dbAlex.batch();
  privBatch.set(dbAlex.doc('households/h1/transactions/tx_chk_priv_001'), {
    monthKey: '2026-11',
    concept: 'Capricho privado',
    category: 'supermercado',
    amount: 19.5,
    date: '2026-11-21',
    paidBy: 'uid_alex',
    recurringId: null,
    splitPctA: 100,
    isSettlement: false,
    settlementTo: '',
    isPrivate: true,
    createdBy: 'uid_alex',
    notes: '',
    createdAt: ts,
    updatedAt: ts,
  });
  privBatch.set(dbAlex.doc('households/h1/shoppingCheckouts/chk_priv_001'), {
    expenseId: 'tx_chk_priv_001',
    monthKey: '2026-11',
    amount: 0,
    concept: 'Compra privada',
    pendingItemIds: ['item_p1'],
    totalItemCount: 11,
    isPrivate: true,
    createdBy: 'uid_alex',
    createdAt: ts,
    updatedAt: ts,
  });
  await assertSucceeds(privBatch.commit());

  await assertSucceeds(dbAlex.doc('households/h1/shoppingCheckouts/chk_priv_001').get());
  await assertFails(dbMarta.doc('households/h1/shoppingCheckouts/chk_priv_001').get());
  await assertFails(dbMarta.doc('households/h1/shoppingCheckouts/chk_priv_001').delete());
  await assertFails(dbIntruder.doc('households/h1/shoppingCheckouts/chk_priv_001').get());
});

// ─── 20. Compatibilidad de consultas reales del repositorio con las reglas ───
test('20. Consultas reales de FirestoreHouseholdRepository cumplen las reglas y privacidad', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_pub_q').set({
      monthKey: '2026-11',
      concept: 'Luz',
      category: 'luz',
      amount: 65,
      date: '2026-11-10',
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
  await assertSucceeds(
    dbAlex.doc('households/h1/transactions/tx_priv_q').set({
      monthKey: '2026-11',
      concept: 'Regalo sorpresa',
      category: 'otros',
      amount: 40,
      date: '2026-11-11',
      paidBy: 'uid_alex',
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

  // Consultas de campo único usadas por subscribeVisibleTransactions / fetchVisibleTransactionsMap
  await assertSucceeds(
    dbMarta.collection('households/h1/transactions').where('isPrivate', '==', false).get()
  );
  await assertSucceeds(
    dbMarta.collection('households/h1/transactions').where('createdBy', '==', 'uid_marta').get()
  );
  // Consulta sin filtro o pidiendo los privados de la pareja -> RECHAZADO
  await assertFails(dbMarta.collection('households/h1/transactions').get());
  await assertFails(
    dbMarta.collection('households/h1/transactions').where('createdBy', '==', 'uid_alex').get()
  );

  // Consultas de campo único usadas por subscribePendingShoppingCheckouts
  await assertSucceeds(
    dbMarta.collection('households/h1/shoppingCheckouts').where('isPrivate', '==', false).get()
  );
  await assertSucceeds(
    dbMarta.collection('households/h1/shoppingCheckouts').where('createdBy', '==', 'uid_marta').get()
  );
  await assertFails(dbMarta.collection('households/h1/shoppingCheckouts').get());
  await assertFails(
    dbIntruder.collection('households/h1/shoppingCheckouts').where('isPrivate', '==', false).get()
  );
});

// ─── 21. Creación de categorías manuales y sugeridas (incluidos IDs de 1 letra) ─
test('21. Categorías — Creación manual y sugerida válida, rechazo de icono/ID inválido y aislamiento del hogar', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Creación sugerida (cat_restaurantes_pedidos) por Miembro A + log de actividad
  const sugBatch = dbAlex.batch();
  sugBatch.set(dbAlex.doc('households/h1/categories/cat_restaurantes_pedidos'), {
    name: 'Restaurantes y pedidos',
    color: '#EA580C',
    icon: 'utensils',
    order: 3,
    archived: false,
    csvKeywords: 'restaurante, glovo',
    createdAt: ts,
    updatedAt: ts,
  });
  sugBatch.set(dbAlex.doc('households/h1/activity/act_cat_sug'), {
    uid: 'uid_alex',
    actorName: 'Alex',
    action: 'create',
    entity: 'categoria',
    entityId: 'cat_restaurantes_pedidos',
    summary: 'Creó categoría "Restaurantes y pedidos"',
    timestamp: ts,
  });
  await assertSucceeds(sugBatch.commit());

  // Creación manual de 1 letra normalizada (cat_a_cat) por Miembro B
  await assertSucceeds(
    dbMarta.doc('households/h1/categories/cat_a_cat').set({
      name: 'A',
      color: '#0F766E',
      icon: 'tag',
      order: 4,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Rechazar ID demasiado corto (< 6 chars), icono no permitido o color no hexadecimal
  await assertFails(
    dbAlex.doc('households/h1/categories/cat_a').set({
      name: 'A',
      color: '#0F766E',
      icon: 'tag',
      order: 5,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/categories/cat_bad_icon').set({
      name: 'Malo',
      color: '#0F766E',
      icon: 'invalid-icon',
      order: 5,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Intruso ajeno al hogar no puede leer ni escribir categorías
  await assertFails(dbIntruder.doc('households/h1/categories/cat_a_cat').get());
  await assertFails(
    dbIntruder.doc('households/h1/categories/cat_intruso').set({
      name: 'Intruso',
      color: '#0F766E',
      icon: 'tag',
      order: 6,
      archived: false,
      csvKeywords: '',
      createdAt: ts,
      updatedAt: ts,
    })
  );
});

// ─── 22. memberPreferences — Aislamiento estricto por usuario dentro del hogar ─
test('22. memberPreferences — Cada miembro solo lee/escribe sus propias preferencias y nunca lista ni borra', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  await assertSucceeds(
    dbAlex.doc('households/h1/memberPreferences/uid_alex').set({
      selectorVersion: 1,
      visibleCategoryIds: ['supermercado', 'ocio', 'otros'],
      updatedAt: ts,
    })
  );
  await assertSucceeds(dbAlex.doc('households/h1/memberPreferences/uid_alex').get());
  await assertSucceeds(
    dbAlex.doc('households/h1/memberPreferences/uid_alex').update({
      selectorVersion: 1,
      visibleCategoryIds: ['otros', 'supermercado'],
      updatedAt: ts,
    })
  );

  // Pareja e intruso no pueden leer, crear, modificar, listar ni borrar preferencias ajenas
  await assertFails(dbMarta.doc('households/h1/memberPreferences/uid_alex').get());
  await assertFails(
    dbMarta.doc('households/h1/memberPreferences/uid_alex').update({
      selectorVersion: 1,
      visibleCategoryIds: ['ocio'],
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h1/memberPreferences/uid_other').set({
      selectorVersion: 1,
      visibleCategoryIds: ['ocio'],
      updatedAt: ts,
    })
  );
  await assertFails(dbAlex.collection('households/h1/memberPreferences').get());
  await assertFails(dbAlex.doc('households/h1/memberPreferences/uid_alex').delete());
  await assertFails(dbIntruder.doc('households/h1/memberPreferences/uid_alex').get());
});

// ─── 23. shoppingTemplates y shoppingSectionOverrides — Reglas compartidas ───
test('23. shoppingTemplates y shoppingSectionOverrides — CRUD válido en hogar, validación de campos y bloqueo de suplantación/intrusos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Plantilla reutilizable creada por Alex y editada/borrada por Marta
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingTemplates/tpl_semanal').set({
      name: 'Compra semanal',
      items: [
        {
          text: 'Leche entera',
          qty: 2,
          unit: 'L',
          section: 'Lácteos, quesos y bebidas vegetales',
          sourceType: 'mercadona',
        },
      ],
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertSucceeds(dbMarta.collection('households/h1/shoppingTemplates').get());
  await assertSucceeds(
    dbMarta.doc('households/h1/shoppingTemplates/tpl_semanal').update({
      name: 'Compra semanal actualizada',
      items: [{ text: 'Leche entera', qty: 3, unit: 'L' }],
      updatedAt: ts,
    })
  );

  // Suplantación de createdBy o qty <= 0 -> RECHAZADO
  await assertFails(
    dbMarta.doc('households/h1/shoppingTemplates/tpl_spoof').set({
      name: 'Spoof',
      items: [{ text: 'Pan', qty: 1 }],
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shoppingTemplates/tpl_bad_qty').set({
      name: 'Mala cantidad',
      items: [{ text: 'Pan', qty: 0 }],
      createdBy: 'uid_alex',
      createdAt: ts,
      updatedAt: ts,
    })
  );
  await assertFails(dbIntruder.doc('households/h1/shoppingTemplates/tpl_semanal').get());

  // Sobrescritura manual de sección por producto (incluyendo 'Sin clasificar')
  await assertSucceeds(
    dbAlex.doc('households/h1/shoppingSectionOverrides/gen_platanos').set({
      productKey: 'gen_platanos',
      section: 'Sin clasificar',
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbMarta.doc('households/h1/shoppingSectionOverrides/gen_platanos').update({
      productKey: 'gen_platanos',
      section: 'Fruta y verdura',
      updatedBy: 'uid_marta',
      updatedAt: ts,
    })
  );

  // Rechaza sección vacía '', updatedBy suplantado, productKey distinto del docId e intruso
  await assertFails(
    dbAlex.doc('households/h1/shoppingSectionOverrides/gen_bad').set({
      productKey: 'gen_bad',
      section: '',
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbMarta.doc('households/h1/shoppingSectionOverrides/gen_spoof').set({
      productKey: 'gen_spoof',
      section: 'Bebidas',
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/shoppingSectionOverrides/gen_mismatch').set({
      productKey: 'otro_id',
      section: 'Bebidas',
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(dbIntruder.doc('households/h1/shoppingSectionOverrides/gen_platanos').get());

  await assertSucceeds(dbMarta.doc('households/h1/shoppingSectionOverrides/gen_platanos').delete());
  await assertSucceeds(dbMarta.doc('households/h1/shoppingTemplates/tpl_semanal').delete());
});

test('24. Planificación Cuenta común en /households/{hid}: categorías variables y saldo disponible manual (Acciones 7 y 8)', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Acción 7: miembro guarda categorías variables planificadas (válido)
  await assertSucceeds(
    dbAlex.doc('households/h1').update({
      commonAccountPlannedCategories: ['supermercado', 'cat_mascotas'],
      updatedAt: ts,
    })
  );
  // Pareja puede vaciar la lista
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      commonAccountPlannedCategories: [],
      updatedAt: ts,
    })
  );
  // Lista con más de 60 categorías rechazada
  await assertFails(
    dbAlex.doc('households/h1').update({
      commonAccountPlannedCategories: Array.from({ length: 61 }, (_, i) => `cat_${i}`),
      updatedAt: ts,
    })
  );
  // Intruso rechazado
  await assertFails(
    dbIntruder.doc('households/h1').update({
      commonAccountPlannedCategories: ['supermercado'],
      updatedAt: ts,
    })
  );

  // Acción 8: miembro guarda saldo manual con su propio uid y fecha válida
  await assertSucceeds(
    dbAlex.doc('households/h1').update({
      commonAccountManualBalance: {
        amount: 420.5,
        referenceDate: '2026-11-10',
        updatedBy: 'uid_alex',
        updatedAt: '2026-11-10T10:00:00.000Z',
      },
      updatedAt: ts,
    })
  );
  // Pareja puede actualizar con su propio uid
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      commonAccountManualBalance: {
        amount: 0,
        referenceDate: '2026-11-12',
        updatedBy: 'uid_marta',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
      updatedAt: ts,
    })
  );
  // Suplantación de updatedBy rechazada
  await assertFails(
    dbMarta.doc('households/h1').update({
      commonAccountManualBalance: {
        amount: 300,
        referenceDate: '2026-11-12',
        updatedBy: 'uid_alex',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
      updatedAt: ts,
    })
  );
  // Importe negativo o fecha inválida rechazados
  await assertFails(
    dbAlex.doc('households/h1').update({
      commonAccountManualBalance: {
        amount: -10,
        referenceDate: '2026-11-12',
        updatedBy: 'uid_alex',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      commonAccountManualBalance: {
        amount: 200,
        referenceDate: '12/11/2026',
        updatedBy: 'uid_alex',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
      updatedAt: ts,
    })
  );
  // Mezclar saldo manual con settings o inviteCode rechazado
  await assertFails(
    dbAlex.doc('households/h1').update({
      commonAccountManualBalance: null,
      inviteCode: 'HACK99',
      updatedAt: ts,
    })
  );
  // Eliminar saldo (poner a null) permitido por miembro, rechazado para intruso
  await assertFails(
    dbIntruder.doc('households/h1').update({
      commonAccountManualBalance: null,
      updatedAt: ts,
    })
  );
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      commonAccountManualBalance: null,
      updatedAt: ts,
    })
  );
});

// ─── 25. recurring.skippedMonths: formato, omisión por mes y bloqueo en mes cerrado ──
test('25. recurring.skippedMonths permite omitir/deshacer solo meses abiertos y bloquea meses cerrados o payloads inválidos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Crear plantilla activa sin skippedMonths (compatibilidad histórica)
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_luz').set({
      concept: 'Luz',
      category: 'luz',
      amount: 68,
      frequency: 'mensual',
      dayOfMonth: 10,
      startMonth: '2026-09',
      splitOverride: null,
      paidByDefault: 'cuenta_comun',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    })
  );

  // Añadir 2026-10 (mes abierto) a skippedMonths -> permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10'],
      updatedAt: ts,
    })
  );

  // Pareja añade 2026-11 (mes abierto) -> permitido
  await assertSucceeds(
    dbMarta.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026-11'],
      updatedAt: ts,
    })
  );

  // Deshacer 2026-11 mientras está abierto -> permitido
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10'],
      updatedAt: ts,
    })
  );

  // Cerrar 2026-10 y 2026-12
  await assertSucceeds(
    dbAlex.doc('households/h1/monthClosures/2026-10').set({
      monthKey: '2026-10',
      totalSpent: 100,
      paidA: 50,
      paidB: 50,
      paidComun: 0,
      shareA: 50,
      shareB: 50,
      balanceA: 0,
      settlementText: 'Estáis en paz',
      closedBy: 'uid_alex',
      closedAt: ts,
    })
  );
  await assertSucceeds(
    dbAlex.doc('households/h1/monthClosures/2026-12').set({
      monthKey: '2026-12',
      totalSpent: 100,
      paidA: 50,
      paidB: 50,
      paidComun: 0,
      shareA: 50,
      shareB: 50,
      balanceA: 0,
      settlementText: 'Estáis en paz',
      closedBy: 'uid_alex',
      closedAt: ts,
    })
  );

  // Quitar un mes cerrado (2026-10) -> RECHAZADO
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: [],
      updatedAt: ts,
    })
  );

  // Añadir un mes cerrado (2026-12) -> RECHAZADO
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026-12'],
      updatedAt: ts,
    })
  );

  // Añadir formato inválido o cambiar 2 meses a la vez o mezclar con amount -> RECHAZADO
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026/11'],
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026-11', '2027-01'],
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026-11'],
      amount: 99,
      updatedAt: ts,
    })
  );

  // Editar importe normal SIN tocar skippedMonths sigue funcionando incluso si hay meses cerrados omitidos
  await assertSucceeds(
    dbAlex.doc('households/h1/recurring/rec_luz').update({
      amount: 72,
      updatedAt: ts,
    })
  );

  // Intruso rechazado
  await assertFails(
    dbIntruder.doc('households/h1/recurring/rec_luz').update({
      skippedMonths: ['2026-10', '2026-11'],
      updatedAt: ts,
    })
  );
});

// ─── 26. savingsPlans/{monthKey} — Plan de ahorro mensual compartido ──────────
test('26. savingsPlans/{monthKey} — CRUD compartido, validación estricta y rechazo de suplantación/intrusos', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  await joinHouseholdSecondMember('uid_marta', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Crear plan válido con targetAmount >= 0 y asignaciones ordenadas (incluso 0 € válido)
  await assertSucceeds(
    dbAlex.doc('households/h1/savingsPlans/2026-11').set({
      monthKey: '2026-11',
      targetAmount: 250,
      allocations: [
        { goalId: 'goal_1', plannedAmount: 150, priority: 0, goalNameSnapshot: 'Colchón' },
        { goalId: 'goal_2', plannedAmount: 100, priority: 1, goalNameSnapshot: 'Viajes' },
        { goalId: 'goal_3', plannedAmount: 0, priority: 2 },
      ],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Ambos miembros pueden leer, listar y actualizar el plan compartido
  await assertSucceeds(dbMarta.doc('households/h1/savingsPlans/2026-11').get());
  await assertSucceeds(dbMarta.collection('households/h1/savingsPlans').get());
  await assertSucceeds(
    dbMarta.doc('households/h1/savingsPlans/2026-11').set({
      monthKey: '2026-11',
      targetAmount: 300,
      allocations: [
        { goalId: 'goal_2', plannedAmount: 180, priority: 0, goalNameSnapshot: 'Viajes' },
        { goalId: 'goal_1', plannedAmount: 70, priority: 1, goalNameSnapshot: 'Colchón' },
      ],
      updatedBy: 'uid_marta',
      updatedAt: ts,
    })
  );

  // Plan vacío a 0 € también válido
  await assertSucceeds(
    dbAlex.doc('households/h1/savingsPlans/2026-12').set({
      monthKey: '2026-12',
      targetAmount: 0,
      allocations: [],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Rechaza monthKey que no coincide con docId o formato inválido
  await assertFails(
    dbAlex.doc('households/h1/savingsPlans/2026-10').set({
      monthKey: '2026-11',
      targetAmount: 100,
      allocations: [],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/savingsPlans/bad_month').set({
      monthKey: 'bad_month',
      targetAmount: 100,
      allocations: [],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Rechaza targetAmount negativo, plannedAmount negativo o campo fantasma (ej. totalAssigned)
  await assertFails(
    dbAlex.doc('households/h1/savingsPlans/2026-09').set({
      monthKey: '2026-09',
      targetAmount: -10,
      allocations: [],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/savingsPlans/2026-09').set({
      monthKey: '2026-09',
      targetAmount: 100,
      allocations: [{ goalId: 'goal_1', plannedAmount: -5, priority: 0 }],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1/savingsPlans/2026-09').set({
      monthKey: '2026-09',
      targetAmount: 100,
      allocations: [],
      totalAssigned: 100,
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Rechaza suplantación de updatedBy
  await assertFails(
    dbMarta.doc('households/h1/savingsPlans/2026-09').set({
      monthKey: '2026-09',
      targetAmount: 100,
      allocations: [],
      updatedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Intruso no puede leer, listar, crear ni borrar
  await assertFails(dbIntruder.doc('households/h1/savingsPlans/2026-11').get());
  await assertFails(dbIntruder.collection('households/h1/savingsPlans').get());
  await assertFails(
    dbIntruder.doc('households/h1/savingsPlans/2026-09').set({
      monthKey: '2026-09',
      targetAmount: 50,
      allocations: [],
      updatedBy: 'uid_intruder',
      updatedAt: ts,
    })
  );
  await assertFails(dbIntruder.doc('households/h1/savingsPlans/2026-11').delete());

  // Miembro puede eliminar un plan
  await assertSucceeds(dbMarta.doc('households/h1/savingsPlans/2026-12').delete());
});

test('27. Fin de etapa de mudanza (Acción 9): completar/reabrir compartido, anti-suplantación y aislamiento', async () => {
  await seedHouseholdPhaseA('uid_alex', 'h1', 'SNT26A');
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const dbAlex = dbForUser('uid_alex', true);
  const dbMarta = dbForUser('uid_marta', true);
  const dbIntruder = dbForUser('uid_intruder', true);

  // Marta se une al hogar
  const joinBatch = dbMarta.batch();
  joinBatch.set(dbMarta.doc('households/h1/members/uid_marta'), {
    displayName: 'Marta',
    photoURL: '',
    role: 'member_b',
    uiMode: 'sencillo',
    joinedAt: ts,
    updatedAt: ts,
  });
  joinBatch.update(dbMarta.doc('households/h1'), {
    memberUids: ['uid_alex', 'uid_marta'],
    updatedAt: ts,
  });
  await assertSucceeds(joinBatch.commit());

  // Alex da por terminada la mudanza (estado compartido)
  await assertSucceeds(
    dbAlex.doc('households/h1').update({
      mudanzaCompleted: true,
      mudanzaCompletedAt: '2026-11-25T12:00:00.000Z',
      mudanzaCompletedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Marta puede reabrir la mudanza limpiando timestamp/autor a null
  await assertSucceeds(
    dbMarta.doc('households/h1').update({
      mudanzaCompleted: false,
      mudanzaCompletedAt: null,
      mudanzaCompletedBy: null,
      updatedAt: ts,
    })
  );

  // Rechaza suplantación de mudanzaCompletedBy
  await assertFails(
    dbMarta.doc('households/h1').update({
      mudanzaCompleted: true,
      mudanzaCompletedAt: '2026-11-25T12:05:00.000Z',
      mudanzaCompletedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Rechaza completar sin fecha válida o reabrir dejando autor/fecha no nulos
  await assertFails(
    dbAlex.doc('households/h1').update({
      mudanzaCompleted: true,
      mudanzaCompletedAt: '',
      mudanzaCompletedBy: 'uid_alex',
      updatedAt: ts,
    })
  );
  await assertFails(
    dbAlex.doc('households/h1').update({
      mudanzaCompleted: false,
      mudanzaCompletedAt: '2026-11-25T12:05:00.000Z',
      mudanzaCompletedBy: 'uid_alex',
      updatedAt: ts,
    })
  );

  // Rechaza mezclar mudanzaCompleted con cambios no permitidos (ej. inviteCode o name)
  await assertFails(
    dbAlex.doc('households/h1').update({
      mudanzaCompleted: true,
      mudanzaCompletedAt: '2026-11-25T12:05:00.000Z',
      mudanzaCompletedBy: 'uid_alex',
      inviteCode: 'HACK99',
      updatedAt: ts,
    })
  );

  // Intruso no miembro rechazado
  await assertFails(
    dbIntruder.doc('households/h1').update({
      mudanzaCompleted: true,
      mudanzaCompletedAt: '2026-11-25T12:05:00.000Z',
      mudanzaCompletedBy: 'uid_intruder',
      updatedAt: ts,
    })
  );
});










