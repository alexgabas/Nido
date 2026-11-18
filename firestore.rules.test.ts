import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateAndMigrateBackup } from './src/domain/backup';

const rulesContent = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf-8')) as {
  firestore: Record<string, unknown>;
};

test('firestore.rules declara default-deny global y todas las colecciones del blueprint', () => {
  assert.ok(rulesContent.includes("rules_version = '2';"));
  assert.ok(rulesContent.includes('match /{document=**} {\n      allow read, write: if false;'));
  assert.ok(rulesContent.includes('request.auth.token.email_verified == true'));

  const expectedCollections = [
    '/users/{uid}',
    '/invites/{inviteCode}',
    '/households/{hid}',
    'match /members/{uid}',
    'match /activity/{actId}',
    'match /initialCosts/{costId}',
    'match /checklist/{taskId}',
    'match /items/{itemId}',
    'match /recurring/{recId}',
    'match /transactions/{txId}',
    'match /budgets/{monthKey}',
    'match /monthClosures/{monthKey}',
    'match /goals/{goalId}',
    'match /goalMovements/{movId}',
  ];
  for (const col of expectedCollections) {
    assert.ok(rulesContent.includes(col), `Falta bloque de reglas para ${col}`);
  }
  assert.ok(Object.keys(blueprint.firestore).length >= 13);
});

test('firestore.rules bloquea mutación de activity, límite de 2 miembros y validación en updates', () => {
  assert.ok(rulesContent.includes('data.memberUids.size() <= 2'));
  assert.ok(rulesContent.includes('existing().memberUids.size() == 1'));
  assert.ok(rulesContent.includes('allow update, delete: if false;'));
  assert.ok(rulesContent.includes('affectedKeys().hasOnly('));
  assert.ok(rulesContent.includes('isValidTransaction(incoming())'));
  assert.ok(rulesContent.includes('isValidInitialCost(incoming())'));
  assert.ok(rulesContent.includes('isValidFurnitureItem(incoming())'));
  assert.ok(rulesContent.includes('isValidGoal(incoming())'));
  assert.ok(rulesContent.includes('isValidGoalMovement(incoming())'));
});

test('Dirty Dozen: validación de entradas rechaza payloads corruptos o negativos', () => {
  const base = {
    schemaVersion: 1,
    app: 'nido',
    exportedAt: '2026-11-18T10:00:00Z',
    householdName: 'Piso',
    settings: { splitMode: 'preset', presetA: 50, presetB: 50, incomeA: 1000, incomeB: 1000, currency: 'EUR' },
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

  assert.throws(() => validateAndMigrateBackup(null));
  assert.throws(() => validateAndMigrateBackup({ ...base, app: 'otra' }));
  assert.throws(() => validateAndMigrateBackup({ ...base, schemaVersion: 2 }));
  assert.throws(() =>
    validateAndMigrateBackup({
      ...base,
      settings: { ...base.settings, presetA: 150 },
    })
  );
  assert.throws(() =>
    validateAndMigrateBackup({
      ...base,
      initialCosts: [{ id: '1', concept: 'Fianza', category: 'fianza', amount: -1, paidBy: 'comun', status: 'pendiente', dueDate: '', notes: '' }],
    })
  );
  assert.throws(() =>
    validateAndMigrateBackup({
      ...base,
      transactions: [{ id: '1', monthKey: '2026-99-99', concept: 'X', category: 'alquiler', amount: 10, date: '2026-11-01', paidBy: 'comun', recurringId: null, splitPctA: 50, isSettlement: false, settlementTo: '', notes: '' }],
    })
  );
  assert.throws(() =>
    validateAndMigrateBackup({
      ...base,
      goalMovements: [{ id: '1', goalId: 'g1', amount: 0, by: 'u1', date: '2026-11-01', note: '' }],
    })
  );
});
