import type { NidoBackupV1 } from '../types/nido';

export function formatCSVNumberES(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2).replace('.', ',');
}

function escapeCSVCell(value: string | number): string {
  const str = typeof value === 'number' ? formatCSVNumberES(value) : String(value ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateSpanishCSV(
  headers: string[],
  rows: Array<Array<string | number>>
): string {
  const BOM = '\uFEFF';
  const lines = [
    headers.map(escapeCSVCell).join(';'),
    ...rows.map((row) => row.map(escapeCSVCell).join(';')),
  ];
  return BOM + lines.join('\r\n');
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Strict Schema Validation & Idempotent Migration for JSON Backup ─────────

const VALID_SPLIT_MODES = new Set(['income', 'preset', 'custom']);
const VALID_INITIAL_CATS = new Set([
  'alquiler',
  'fianza',
  'garantia_adicional',
  'suministros',
  'cerrajeria',
  'mudanza',
  'mobiliario',
  'otros',
]);
const VALID_ROOMS = new Set(['salon', 'dormitorio', 'cocina', 'baño', 'entrada', 'terraza', 'otros']);
const VALID_PRIORITIES = new Set(['imprescindible', 'pronto', 'algun_dia']);
const VALID_STATUSES = new Set(['ya_lo_tenemos', 'pendiente', 'en_carrito', 'comprado']);
const VALID_FREQS = new Set(['mensual', 'bimestral', 'trimestral', 'anual']);
const VALID_TX_CATS = new Set([
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
  'liquidacion',
]);
const VALID_GOAL_TYPES = new Set([
  'navidad',
  'viajes',
  'cumpleaños',
  'ahorro_comun',
  'emergencia',
  'custom',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertNonNegNum(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`Campo inválido (${label}): debe ser un número mayor o igual a 0.`);
  }
  return v;
}

function assertFiniteNum(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Campo inválido (${label}): debe ser un número válido.`);
  }
  return v;
}

function assertStr(v: unknown, label: string, maxLen: number, minLen = 0): string {
  if (typeof v !== 'string' || v.length < minLen || v.length > maxLen) {
    throw new Error(`Campo inválido (${label}): texto fuera de rango.`);
  }
  return v;
}

function assertDateOrEmpty(v: unknown, label: string): string {
  const s = assertStr(v, label, 10, 0);
  if (s !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Fecha inválida en ${label}: formato esperado AAAA-MM-DD.`);
  }
  return s;
}

function assertMonthKey(v: unknown, label: string): string {
  const s = assertStr(v, label, 7, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) {
    throw new Error(`Mes inválido en ${label}: formato esperado AAAA-MM.`);
  }
  return s;
}

export function validateAndMigrateBackup(raw: unknown): NidoBackupV1 {
  if (!isObj(raw)) {
    throw new Error('El archivo JSON no contiene un objeto válido.');
  }
  if (raw.app !== 'nido') {
    throw new Error('La copia de seguridad no pertenece a Nido.');
  }
  if (raw.schemaVersion !== 1) {
    throw new Error(`Versión de esquema no soportada: ${String(raw.schemaVersion)}.`);
  }
  const householdName = assertStr(raw.householdName, 'householdName', 80, 1);
  if (!isObj(raw.settings)) {
    throw new Error('Falta la configuración de reparto en la copia.');
  }
  const s = raw.settings;
  if (!VALID_SPLIT_MODES.has(String(s.splitMode))) {
    throw new Error('Modo de reparto inválido en la copia.');
  }
  const presetA = assertFiniteNum(s.presetA, 'settings.presetA');
  const presetB = assertFiniteNum(s.presetB, 'settings.presetB');
  if (presetA < 0 || presetA > 100 || presetB < 0 || presetB > 100) {
    throw new Error('Los porcentajes de reparto deben estar entre 0 y 100.');
  }
  if (Math.abs(presetA + presetB - 100) > 0.01) {
    throw new Error('Los porcentajes de reparto (presetA + presetB) deben sumar 100.');
  }
  const incomeA = assertNonNegNum(s.incomeA, 'settings.incomeA');
  const incomeB = assertNonNegNum(s.incomeB, 'settings.incomeB');

  const normalizePayer = (rawPayer: unknown, label: string): string => {
    const val = assertStr(rawPayer, label, 128, 1);
    return val === 'comun' ? 'cuenta_comun' : val;
  };

  const arr = (key: string): unknown[] => {
    const val = raw[key];
    if (!Array.isArray(val)) throw new Error(`Falta la lista "${key}" en la copia.`);
    return val;
  };

  let csvKeywords: NidoBackupV1['csvKeywords'] = undefined;
  if (raw.csvKeywords !== undefined) {
    if (!isObj(raw.csvKeywords)) throw new Error('csvKeywords inválido en la copia.');
    const cleanKw: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.csvKeywords)) {
      if (VALID_TX_CATS.has(k) && k !== 'liquidacion') {
        cleanKw[k] = assertStr(v, `csvKeywords.${k}`, 300);
      }
    }
    csvKeywords = cleanKw as NidoBackupV1['csvKeywords'];
  }

  const initialCosts = arr('initialCosts').map((item, idx) => {
    if (!isObj(item)) throw new Error(`initialCosts[${idx}] inválido.`);
    const cat = String(item.category);
    if (!VALID_INITIAL_CATS.has(cat)) throw new Error(`Categoría inválida en initialCosts[${idx}].`);
    const status = String(item.status);
    if (status !== 'pendiente' && status !== 'pagado') {
      throw new Error(`Estado inválido en initialCosts[${idx}].`);
    }
    return {
      id: assertStr(item.id, `initialCosts[${idx}].id`, 128, 1),
      concept: assertStr(item.concept, `initialCosts[${idx}].concept`, 120, 1),
      category: cat as NidoBackupV1['initialCosts'][number]['category'],
      amount: assertNonNegNum(item.amount, `initialCosts[${idx}].amount`),
      paidBy: normalizePayer(item.paidBy, `initialCosts[${idx}].paidBy`),
      status: status as NidoBackupV1['initialCosts'][number]['status'],
      dueDate: assertDateOrEmpty(item.dueDate ?? '', `initialCosts[${idx}].dueDate`),
      notes: assertStr(item.notes ?? '', `initialCosts[${idx}].notes`, 500),
    };
  });

  const checklist = arr('checklist').map((item, idx) => {
    if (!isObj(item)) throw new Error(`checklist[${idx}] inválido.`);
    if (typeof item.done !== 'boolean') throw new Error(`checklist[${idx}].done inválido.`);
    return {
      id: assertStr(item.id, `checklist[${idx}].id`, 128, 1),
      text: assertStr(item.text, `checklist[${idx}].text`, 240, 1),
      done: item.done,
      doneBy: assertStr(item.doneBy ?? '', `checklist[${idx}].doneBy`, 128),
      doneAt: assertStr(item.doneAt ?? '', `checklist[${idx}].doneAt`, 32),
      group: assertStr(item.group, `checklist[${idx}].group`, 60, 1),
      order: assertNonNegNum(item.order, `checklist[${idx}].order`),
    };
  });

  const items = arr('items').map((item, idx) => {
    if (!isObj(item)) throw new Error(`items[${idx}] inválido.`);
    const room = String(item.room);
    const priority = String(item.priority);
    const status = String(item.status);
    if (!VALID_ROOMS.has(room)) throw new Error(`Estancia inválida en items[${idx}].`);
    if (!VALID_PRIORITIES.has(priority)) throw new Error(`Prioridad inválida en items[${idx}].`);
    if (!VALID_STATUSES.has(status)) throw new Error(`Estado inválido en items[${idx}].`);
    const qty = assertFiniteNum(item.qty, `items[${idx}].qty`);
    if (qty < 1 || qty > 999) throw new Error(`Cantidad fuera de rango en items[${idx}].`);
    return {
      id: assertStr(item.id, `items[${idx}].id`, 128, 1),
      name: assertStr(item.name, `items[${idx}].name`, 120, 1),
      room: room as NidoBackupV1['items'][number]['room'],
      priority: priority as NidoBackupV1['items'][number]['priority'],
      status: status as NidoBackupV1['items'][number]['status'],
      store: assertStr(item.store ?? 'IKEA', `items[${idx}].store`, 60, 1),
      productUrl: assertStr(item.productUrl ?? '', `items[${idx}].productUrl`, 500),
      articleNumber: assertStr(item.articleNumber ?? '', `items[${idx}].articleNumber`, 40),
      unitPrice: assertNonNegNum(item.unitPrice, `items[${idx}].unitPrice`),
      qty,
      notes: assertStr(item.notes ?? '', `items[${idx}].notes`, 500),
    };
  });

  const recurring = arr('recurring').map((item, idx) => {
    if (!isObj(item)) throw new Error(`recurring[${idx}] inválido.`);
    const cat = String(item.category);
    const freq = String(item.frequency);
    if (!VALID_TX_CATS.has(cat) || cat === 'liquidacion') {
      throw new Error(`Categoría inválida en recurring[${idx}].`);
    }
    if (!VALID_FREQS.has(freq)) throw new Error(`Frecuencia inválida en recurring[${idx}].`);
    const day = assertFiniteNum(item.dayOfMonth, `recurring[${idx}].dayOfMonth`);
    if (day < 1 || day > 31) throw new Error(`Día del mes inválido en recurring[${idx}].`);
    if (typeof item.active !== 'boolean') throw new Error(`recurring[${idx}].active inválido.`);
    let splitOverride: number | null = null;
    if (item.splitOverride !== null && item.splitOverride !== undefined) {
      const ov = assertFiniteNum(item.splitOverride, `recurring[${idx}].splitOverride`);
      if (ov < 0 || ov > 100) throw new Error(`splitOverride fuera de rango en recurring[${idx}].`);
      splitOverride = ov;
    }
    return {
      id: assertStr(item.id, `recurring[${idx}].id`, 128, 1),
      concept: assertStr(item.concept, `recurring[${idx}].concept`, 120, 1),
      category: cat as NidoBackupV1['recurring'][number]['category'],
      amount: assertNonNegNum(item.amount, `recurring[${idx}].amount`),
      frequency: freq as NidoBackupV1['recurring'][number]['frequency'],
      dayOfMonth: day,
      splitOverride,
      paidByDefault: normalizePayer(item.paidByDefault, `recurring[${idx}].paidByDefault`),
      active: item.active,
    };
  });

  const transactions = arr('transactions').map((item, idx) => {
    if (!isObj(item)) throw new Error(`transactions[${idx}] inválido.`);
    const cat = String(item.category);
    if (!VALID_TX_CATS.has(cat)) throw new Error(`Categoría inválida en transactions[${idx}].`);
    const splitPctA = assertFiniteNum(item.splitPctA, `transactions[${idx}].splitPctA`);
    if (splitPctA < 0 || splitPctA > 100) throw new Error(`splitPctA inválido en transactions[${idx}].`);
    if (typeof item.isSettlement !== 'boolean') {
      throw new Error(`isSettlement inválido en transactions[${idx}].`);
    }
    if (item.isPrivate !== undefined && typeof item.isPrivate !== 'boolean') {
      throw new Error(`isPrivate inválido en transactions[${idx}].`);
    }
    const isPrivate = Boolean(item.isPrivate);
    const createdBy =
      item.createdBy !== undefined
        ? assertStr(item.createdBy, `transactions[${idx}].createdBy`, 128)
        : '';
    return {
      id: assertStr(item.id, `transactions[${idx}].id`, 128, 1),
      monthKey: assertMonthKey(item.monthKey, `transactions[${idx}].monthKey`),
      concept: assertStr(item.concept, `transactions[${idx}].concept`, 120, 1),
      category: cat as NidoBackupV1['transactions'][number]['category'],
      amount: assertNonNegNum(item.amount, `transactions[${idx}].amount`),
      date: assertDateOrEmpty(item.date, `transactions[${idx}].date`),
      paidBy: normalizePayer(item.paidBy, `transactions[${idx}].paidBy`),
      recurringId:
        item.recurringId === null || item.recurringId === undefined
          ? null
          : assertStr(item.recurringId, `transactions[${idx}].recurringId`, 128),
      splitPctA,
      isSettlement: item.isSettlement,
      settlementTo: assertStr(item.settlementTo ?? '', `transactions[${idx}].settlementTo`, 128),
      isPrivate,
      createdBy,
      notes: assertStr(item.notes ?? '', `transactions[${idx}].notes`, 500),
    };
  });

  const budgets = arr('budgets').map((item, idx) => {
    if (!isObj(item)) throw new Error(`budgets[${idx}] inválido.`);
    if (!isObj(item.limits)) throw new Error(`budgets[${idx}].limits inválido.`);
    const cleanLimits: Record<string, number> = {};
    for (const [k, v] of Object.entries(item.limits)) {
      if (VALID_TX_CATS.has(k) && k !== 'liquidacion') {
        cleanLimits[k] = assertNonNegNum(v, `budgets[${idx}].limits.${k}`);
      }
    }
    return {
      monthKey: assertMonthKey(item.monthKey, `budgets[${idx}].monthKey`),
      limits: cleanLimits,
    };
  });

  const monthClosures = arr('monthClosures').map((item, idx) => {
    if (!isObj(item)) throw new Error(`monthClosures[${idx}] inválido.`);
    return {
      monthKey: assertMonthKey(item.monthKey, `monthClosures[${idx}].monthKey`),
      totalSpent: assertNonNegNum(item.totalSpent, `monthClosures[${idx}].totalSpent`),
      paidA: assertNonNegNum(item.paidA, `monthClosures[${idx}].paidA`),
      paidB: assertNonNegNum(item.paidB, `monthClosures[${idx}].paidB`),
      paidComun: assertNonNegNum(item.paidComun, `monthClosures[${idx}].paidComun`),
      shareA: assertNonNegNum(item.shareA, `monthClosures[${idx}].shareA`),
      shareB: assertNonNegNum(item.shareB, `monthClosures[${idx}].shareB`),
      balanceA: assertFiniteNum(item.balanceA, `monthClosures[${idx}].balanceA`),
      settlementText: assertStr(item.settlementText, `monthClosures[${idx}].settlementText`, 200, 1),
      closedBy: assertStr(item.closedBy, `monthClosures[${idx}].closedBy`, 128, 1),
    };
  });

  const goals = arr('goals').map((item, idx) => {
    if (!isObj(item)) throw new Error(`goals[${idx}] inválido.`);
    const type = String(item.type);
    if (!VALID_GOAL_TYPES.has(type)) throw new Error(`Tipo inválido en goals[${idx}].`);
    if (typeof item.archived !== 'boolean') throw new Error(`goals[${idx}].archived inválido.`);
    return {
      id: assertStr(item.id, `goals[${idx}].id`, 128, 1),
      name: assertStr(item.name, `goals[${idx}].name`, 80, 1),
      icon: assertStr(item.icon, `goals[${idx}].icon`, 40, 1),
      color: assertStr(item.color, `goals[${idx}].color`, 30, 1),
      targetAmount: assertNonNegNum(item.targetAmount, `goals[${idx}].targetAmount`),
      targetDate: assertDateOrEmpty(item.targetDate ?? '', `goals[${idx}].targetDate`),
      type: type as NidoBackupV1['goals'][number]['type'],
      archived: item.archived,
    };
  });

  const goalMovements = arr('goalMovements').map((item, idx) => {
    if (!isObj(item)) throw new Error(`goalMovements[${idx}] inválido.`);
    const amt = assertFiniteNum(item.amount, `goalMovements[${idx}].amount`);
    if (amt === 0) throw new Error(`El movimiento ${idx} no puede tener importe 0.`);
    return {
      id: assertStr(item.id, `goalMovements[${idx}].id`, 128, 1),
      goalId: assertStr(item.goalId, `goalMovements[${idx}].goalId`, 128, 1),
      amount: amt,
      by: assertStr(item.by, `goalMovements[${idx}].by`, 128, 1),
      date: assertDateOrEmpty(item.date, `goalMovements[${idx}].date`),
      note: assertStr(item.note ?? '', `goalMovements[${idx}].note`, 240),
    };
  });

  const shopping = Array.isArray(raw.shopping)
    ? raw.shopping.map((item, idx) => {
        if (!isObj(item)) throw new Error(`shopping[${idx}] inválido.`);
        if (typeof item.done !== 'boolean') throw new Error(`shopping[${idx}].done inválido.`);
        const qty = assertFiniteNum(item.qty, `shopping[${idx}].qty`);
        if (qty < 1 || qty > 999) throw new Error(`Cantidad fuera de rango en shopping[${idx}].`);
        return {
          id: assertStr(item.id, `shopping[${idx}].id`, 128, 1),
          text: assertStr(item.text, `shopping[${idx}].text`, 120, 1),
          qty,
          done: item.done,
          addedBy: assertStr(item.addedBy ?? '', `shopping[${idx}].addedBy`, 128),
        };
      })
    : undefined;

  return {
    schemaVersion: 1,
    app: 'nido',
    exportedAt: assertStr(raw.exportedAt ?? new Date().toISOString(), 'exportedAt', 64),
    householdName,
    settings: {
      splitMode: s.splitMode as NidoBackupV1['settings']['splitMode'],
      presetA,
      presetB,
      incomeA,
      incomeB,
      currency: 'EUR',
    },
    ...(csvKeywords ? { csvKeywords } : {}),
    initialCosts,
    checklist,
    items,
    recurring,
    transactions,
    budgets,
    monthClosures,
    goals,
    goalMovements,
    ...(shopping ? { shopping } : {}),
  };
}
