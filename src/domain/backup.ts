import {
  MAX_LENGTHS,
  SHOPPING_SECTIONS,
  type NidoBackupV1,
  type SavingsPlanAllocation,
  type ShoppingSection,
  type ShoppingSourceType,
  type ShoppingTemplateItem,
} from '../types/nido';
import { MAX_SAVINGS_PLAN_ALLOCATIONS } from './savingsPlan';
import {
  buildCategoryBudgetDocId,
  isCustomCategoryId,
  isValidCategoryIcon,
} from './categories';
import { isValidHexColor } from './categoryPalette';
import { localDaysBetween, roundCents } from './finance';

const VALID_SHOPPING_SECTIONS = new Set<string>(SHOPPING_SECTIONS);
const VALID_SHOPPING_SOURCES = new Set<string>(['mercadona', 'custom', 'generic']);

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

  let mudanzaCompleted: boolean | undefined = undefined;
  let mudanzaCompletedAt: string | null | undefined = undefined;
  let mudanzaCompletedBy: string | null | undefined = undefined;
  if (raw.mudanzaCompleted !== undefined) {
    if (typeof raw.mudanzaCompleted !== 'boolean') {
      throw new Error('Campo inválido (mudanzaCompleted): debe ser booleano.');
    }
    mudanzaCompleted = raw.mudanzaCompleted;
    if (mudanzaCompleted) {
      mudanzaCompletedAt =
        raw.mudanzaCompletedAt !== undefined && raw.mudanzaCompletedAt !== null && raw.mudanzaCompletedAt !== ''
          ? assertStr(raw.mudanzaCompletedAt, 'mudanzaCompletedAt', 64, 1)
          : new Date().toISOString();
      mudanzaCompletedBy =
        raw.mudanzaCompletedBy !== undefined && raw.mudanzaCompletedBy !== null && raw.mudanzaCompletedBy !== ''
          ? assertStr(raw.mudanzaCompletedBy, 'mudanzaCompletedBy', 128, 1)
          : 'backup';
    } else {
      mudanzaCompletedAt = null;
      mudanzaCompletedBy = null;
    }
  }

  const normalizePayer = (rawPayer: unknown, label: string): string => {
    const val = assertStr(rawPayer, label, 128, 1);
    return val === 'comun' ? 'cuenta_comun' : val;
  };

  const arr = (key: string): unknown[] => {
    const val = raw[key];
    if (!Array.isArray(val)) throw new Error(`Falta la lista "${key}" en la copia.`);
    return val;
  };

  let customCategories: NidoBackupV1['customCategories'] = undefined;
  const customCategoryIdSet = new Set<string>();
  if (raw.customCategories !== undefined) {
    if (!Array.isArray(raw.customCategories)) {
      throw new Error('customCategories inválido en la copia.');
    }
    customCategories = raw.customCategories.map((item, idx) => {
      if (!isObj(item)) throw new Error(`customCategories[${idx}] inválido.`);
      const id = assertStr(item.id, `customCategories[${idx}].id`, 48, 6);
      if (!isCustomCategoryId(id)) {
        throw new Error(`ID inválido en customCategories[${idx}]: ${id}.`);
      }
      const color = assertStr(item.color, `customCategories[${idx}].color`, 7, 7);
      if (!isValidHexColor(color)) {
        throw new Error(`Color hexadecimal inválido en customCategories[${idx}].`);
      }
      const icon = assertStr(item.icon ?? 'tag', `customCategories[${idx}].icon`, MAX_LENGTHS.categoryIcon, 1);
      if (!isValidCategoryIcon(icon)) {
        throw new Error(`Icono inválido en customCategories[${idx}].`);
      }
      if (typeof item.archived !== 'boolean') {
        throw new Error(`customCategories[${idx}].archived inválido.`);
      }
      const order = assertFiniteNum(item.order ?? idx, `customCategories[${idx}].order`);
      if (order < 0 || order > 999) {
        throw new Error(`Orden fuera de rango en customCategories[${idx}].`);
      }
      customCategoryIdSet.add(id);
      return {
        id,
        name: assertStr(item.name, `customCategories[${idx}].name`, MAX_LENGTHS.categoryName, 1),
        color: color.toUpperCase(),
        icon,
        order: Math.round(order),
        archived: item.archived,
        csvKeywords: assertStr(item.csvKeywords ?? '', `customCategories[${idx}].csvKeywords`, MAX_LENGTHS.csvKeywordString),
      };
    });
  }

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

  let categoryColors: NidoBackupV1['categoryColors'] = undefined;
  if (raw.categoryColors !== undefined) {
    if (!isObj(raw.categoryColors)) {
      throw new Error('categoryColors inválido en la copia.');
    }
    const cleanColors: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.categoryColors)) {
      if (!VALID_TX_CATS.has(k) || k === 'liquidacion') {
        throw new Error(`Categoría desconocida en categoryColors: ${k}.`);
      }
      if (!isValidHexColor(v)) {
        throw new Error(`Color hexadecimal inválido en categoryColors.${k}: esperado #RRGGBB.`);
      }
      cleanColors[k] = v.toUpperCase();
    }
    categoryColors = cleanColors as NidoBackupV1['categoryColors'];
  }

  const isAllowedExpenseCategory = (cat: string): boolean => {
    if (VALID_TX_CATS.has(cat) && cat !== 'liquidacion') return true;
    return customCategoryIdSet.has(cat);
  };

  let commonAccountPlannedCategories: NidoBackupV1['commonAccountPlannedCategories'] = undefined;
  if (raw.commonAccountPlannedCategories !== undefined) {
    if (!Array.isArray(raw.commonAccountPlannedCategories)) {
      throw new Error('commonAccountPlannedCategories inválido en la copia.');
    }
    if (raw.commonAccountPlannedCategories.length > 60) {
      throw new Error('Demasiadas categorías en commonAccountPlannedCategories (máx. 60).');
    }
    const seen = new Set<string>();
    const cleanPlanned: string[] = [];
    for (let i = 0; i < raw.commonAccountPlannedCategories.length; i += 1) {
      const cat = assertStr(
        raw.commonAccountPlannedCategories[i],
        `commonAccountPlannedCategories[${i}]`,
        64,
        1
      );
      if (!isAllowedExpenseCategory(cat) && !/^cat_[a-z0-9_]{2,48}$/.test(cat)) {
        throw new Error(`Categoría inválida en commonAccountPlannedCategories[${i}]: ${cat}.`);
      }
      if (!seen.has(cat)) {
        seen.add(cat);
        cleanPlanned.push(cat);
      }
    }
    commonAccountPlannedCategories = cleanPlanned;
  }

  let commonAccountManualBalance: NidoBackupV1['commonAccountManualBalance'] = undefined;
  if (raw.commonAccountManualBalance !== undefined) {
    if (raw.commonAccountManualBalance === null) {
      commonAccountManualBalance = null;
    } else if (!isObj(raw.commonAccountManualBalance)) {
      throw new Error('commonAccountManualBalance inválido en la copia.');
    } else {
      const mb = raw.commonAccountManualBalance;
      const refDate = assertStr(mb.referenceDate, 'commonAccountManualBalance.referenceDate', 10, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(refDate)) {
        throw new Error('Fecha inválida en commonAccountManualBalance.referenceDate (esperado YYYY-MM-DD).');
      }
      commonAccountManualBalance = {
        amount: roundCents(assertNonNegNum(mb.amount, 'commonAccountManualBalance.amount')),
        referenceDate: refDate,
        updatedBy: assertStr(mb.updatedBy ?? 'backup', 'commonAccountManualBalance.updatedBy', 128, 1),
        updatedAt: assertStr(
          mb.updatedAt ?? new Date().toISOString(),
          'commonAccountManualBalance.updatedAt',
          64,
          1
        ),
      };
    }
  }

  const initialCosts = arr('initialCosts').map((item, idx) => {
    if (!isObj(item)) throw new Error(`initialCosts[${idx}] inválido.`);
    const cat = String(item.category);
    if (!VALID_INITIAL_CATS.has(cat) && !customCategoryIdSet.has(cat)) {
      throw new Error(`Categoría inválida en initialCosts[${idx}].`);
    }
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
    if (!isAllowedExpenseCategory(cat)) {
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
    let startMonth: string | undefined = undefined;
    if (item.startMonth !== undefined && item.startMonth !== null && item.startMonth !== '') {
      startMonth = assertMonthKey(item.startMonth, `recurring[${idx}].startMonth`);
    }
    let skippedMonths: string[] | undefined = undefined;
    if (item.skippedMonths !== undefined && item.skippedMonths !== null) {
      if (!Array.isArray(item.skippedMonths)) {
        throw new Error(`skippedMonths inválido en recurring[${idx}].`);
      }
      if (item.skippedMonths.length > 120) {
        throw new Error(`Demasiados meses omitidos en recurring[${idx}] (máximo 120).`);
      }
      const cleanSet = new Set<string>();
      for (let mIdx = 0; mIdx < item.skippedMonths.length; mIdx++) {
        cleanSet.add(
          assertMonthKey(item.skippedMonths[mIdx], `recurring[${idx}].skippedMonths[${mIdx}]`)
        );
      }
      const sorted = Array.from(cleanSet).sort();
      if (sorted.length > 0) skippedMonths = sorted;
    }
    return {
      id: assertStr(item.id, `recurring[${idx}].id`, 128, 1),
      concept: assertStr(item.concept, `recurring[${idx}].concept`, 120, 1),
      category: cat as NidoBackupV1['recurring'][number]['category'],
      amount: assertNonNegNum(item.amount, `recurring[${idx}].amount`),
      frequency: freq as NidoBackupV1['recurring'][number]['frequency'],
      dayOfMonth: day,
      ...(startMonth ? { startMonth } : {}),
      ...(skippedMonths ? { skippedMonths } : {}),
      splitOverride,
      paidByDefault: normalizePayer(item.paidByDefault, `recurring[${idx}].paidByDefault`),
      active: item.active,
    };
  });

  const transactions = arr('transactions').map((item, idx) => {
    if (!isObj(item)) throw new Error(`transactions[${idx}] inválido.`);
    const cat = String(item.category);
    if (!VALID_TX_CATS.has(cat) && !customCategoryIdSet.has(cat)) {
      throw new Error(`Categoría inválida en transactions[${idx}].`);
    }
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

  const extractedCustomBudgets: Array<{ id: string; monthKey: string; categoryId: string; limit: number }> = [];
  const extractedBudgetIds = new Set<string>();
  const budgets = arr('budgets').map((item, idx) => {
    if (!isObj(item)) throw new Error(`budgets[${idx}] inválido.`);
    if (!isObj(item.limits)) throw new Error(`budgets[${idx}].limits inválido.`);
    const monthKey = assertMonthKey(item.monthKey, `budgets[${idx}].monthKey`);
    const cleanLimits: Record<string, number> = {};
    for (const [k, v] of Object.entries(item.limits)) {
      if (VALID_TX_CATS.has(k) && k !== 'liquidacion') {
        cleanLimits[k] = assertNonNegNum(v, `budgets[${idx}].limits.${k}`);
      } else if (customCategoryIdSet.has(k)) {
        const val = assertNonNegNum(v, `budgets[${idx}].limits.${k}`);
        const docId = buildCategoryBudgetDocId(monthKey, k);
        if (!extractedBudgetIds.has(docId)) {
          extractedBudgetIds.add(docId);
          extractedCustomBudgets.push({ id: docId, monthKey, categoryId: k, limit: val });
        }
      }
    }
    return {
      monthKey,
      limits: cleanLimits,
    };
  });

  let categoryBudgets: NidoBackupV1['categoryBudgets'] = undefined;
  if (raw.categoryBudgets !== undefined) {
    if (!Array.isArray(raw.categoryBudgets)) {
      throw new Error('categoryBudgets inválido en la copia.');
    }
    categoryBudgets = raw.categoryBudgets.map((item, idx) => {
      if (!isObj(item)) throw new Error(`categoryBudgets[${idx}] inválido.`);
      const monthKey = assertMonthKey(item.monthKey, `categoryBudgets[${idx}].monthKey`);
      const categoryId = assertStr(item.categoryId, `categoryBudgets[${idx}].categoryId`, 48, 6);
      if (!customCategoryIdSet.has(categoryId)) {
        throw new Error(`Categoría desconocida en categoryBudgets[${idx}]: ${categoryId}.`);
      }
      const id = buildCategoryBudgetDocId(monthKey, categoryId);
      return {
        id,
        monthKey,
        categoryId,
        limit: assertNonNegNum(item.limit, `categoryBudgets[${idx}].limit`),
      };
    });
  } else if (extractedCustomBudgets.length > 0) {
    categoryBudgets = extractedCustomBudgets;
  }

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

  let savingsPlans: NidoBackupV1['savingsPlans'] = undefined;
  if (raw.savingsPlans !== undefined) {
    if (!Array.isArray(raw.savingsPlans)) {
      throw new Error('savingsPlans inválido en la copia.');
    }
    savingsPlans = raw.savingsPlans.map((planItem, idx) => {
      if (!isObj(planItem)) throw new Error(`savingsPlans[${idx}] inválido.`);
      const monthKey = assertMonthKey(planItem.monthKey, `savingsPlans[${idx}].monthKey`);
      const targetAmount = roundCents(
        assertNonNegNum(planItem.targetAmount, `savingsPlans[${idx}].targetAmount`)
      );
      if (!Array.isArray(planItem.allocations)) {
        throw new Error(`savingsPlans[${idx}].allocations inválido.`);
      }
      if (planItem.allocations.length > MAX_SAVINGS_PLAN_ALLOCATIONS) {
        throw new Error(
          `Demasiadas asignaciones en savingsPlans[${idx}] (máximo ${MAX_SAVINGS_PLAN_ALLOCATIONS}).`
        );
      }
      const seenGoals = new Set<string>();
      const allocations: SavingsPlanAllocation[] = [];
      for (let aIdx = 0; aIdx < planItem.allocations.length; aIdx++) {
        const alloc = planItem.allocations[aIdx];
        if (!isObj(alloc)) {
          throw new Error(`savingsPlans[${idx}].allocations[${aIdx}] inválido.`);
        }
        const goalId = assertStr(
          alloc.goalId,
          `savingsPlans[${idx}].allocations[${aIdx}].goalId`,
          128,
          1
        );
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(goalId)) {
          throw new Error(`goalId inválido en savingsPlans[${idx}].allocations[${aIdx}].`);
        }
        if (seenGoals.has(goalId)) continue;
        seenGoals.add(goalId);
        const plannedAmount = roundCents(
          assertNonNegNum(
            alloc.plannedAmount,
            `savingsPlans[${idx}].allocations[${aIdx}].plannedAmount`
          )
        );
        const priorityRaw = assertFiniteNum(
          alloc.priority ?? aIdx,
          `savingsPlans[${idx}].allocations[${aIdx}].priority`
        );
        if (priorityRaw < 0 || priorityRaw > 99) {
          throw new Error(`priority fuera de rango en savingsPlans[${idx}].allocations[${aIdx}].`);
        }
        const goalNameSnapshot =
          alloc.goalNameSnapshot !== undefined && alloc.goalNameSnapshot !== null && alloc.goalNameSnapshot !== ''
            ? assertStr(
                alloc.goalNameSnapshot,
                `savingsPlans[${idx}].allocations[${aIdx}].goalNameSnapshot`,
                MAX_LENGTHS.goalName
              )
            : undefined;
        allocations.push({
          goalId,
          plannedAmount,
          priority: Math.round(priorityRaw),
          ...(goalNameSnapshot ? { goalNameSnapshot } : {}),
        });
      }
      allocations.sort((a, b) => a.priority - b.priority);
      const normalizedAllocations = allocations.map((a, idxPos) => ({ ...a, priority: idxPos }));
      return {
        monthKey,
        targetAmount,
        allocations: normalizedAllocations,
        updatedBy: assertStr(planItem.updatedBy ?? 'backup', `savingsPlans[${idx}].updatedBy`, 128, 1),
      };
    });
  }

  const parseOptShoppingMeta = (item: Record<string, unknown>, prefix: string) => {
    const catalogId =
      typeof item.catalogId === 'string' && item.catalogId.trim()
        ? assertStr(item.catalogId.trim(), `${prefix}.catalogId`, MAX_LENGTHS.shoppingCatalogId)
        : '';
    const brand =
      typeof item.brand === 'string' && item.brand.trim()
        ? assertStr(item.brand.trim(), `${prefix}.brand`, MAX_LENGTHS.shoppingBrand)
        : '';
    const format =
      typeof item.format === 'string' && item.format.trim()
        ? assertStr(item.format.trim(), `${prefix}.format`, MAX_LENGTHS.shoppingFormat)
        : '';
    const rawSection = typeof item.section === 'string' ? item.section.trim() : '';
    const section: ShoppingSection | undefined =
      rawSection && VALID_SHOPPING_SECTIONS.has(rawSection)
        ? (rawSection as ShoppingSection)
        : undefined;
    const rawSource = typeof item.sourceType === 'string' ? item.sourceType.trim() : '';
    const sourceType: ShoppingSourceType | undefined =
      rawSource && VALID_SHOPPING_SOURCES.has(rawSource)
        ? (rawSource as ShoppingSourceType)
        : undefined;
    return {
      ...(catalogId ? { catalogId } : {}),
      ...(brand ? { brand } : {}),
      ...(format ? { format } : {}),
      ...(section ? { section } : {}),
      ...(sourceType ? { sourceType } : {}),
    };
  };

  const shopping = Array.isArray(raw.shopping)
    ? raw.shopping.map((item, idx) => {
        if (!isObj(item)) throw new Error(`shopping[${idx}] inválido.`);
        if (typeof item.done !== 'boolean') throw new Error(`shopping[${idx}].done inválido.`);
        const qty = assertFiniteNum(item.qty, `shopping[${idx}].qty`);
        if (qty <= 0 || qty > 999) throw new Error(`Cantidad fuera de rango en shopping[${idx}].`);
        const unit =
          item.unit !== undefined && item.unit !== null
            ? assertStr(item.unit, `shopping[${idx}].unit`, MAX_LENGTHS.shoppingUnit)
            : '';
        return {
          id: assertStr(item.id, `shopping[${idx}].id`, 128, 1),
          text: assertStr(item.text, `shopping[${idx}].text`, 120, 1),
          qty,
          ...(unit ? { unit } : {}),
          done: item.done,
          ...parseOptShoppingMeta(item, `shopping[${idx}]`),
          addedBy: assertStr(item.addedBy ?? '', `shopping[${idx}].addedBy`, 128),
        };
      })
    : undefined;

  const shoppingCatalog = Array.isArray(raw.shoppingCatalog)
    ? raw.shoppingCatalog.map((item, idx) => {
        if (!isObj(item)) throw new Error(`shoppingCatalog[${idx}] inválido.`);
        const usageCount = assertFiniteNum(item.usageCount ?? 1, `shoppingCatalog[${idx}].usageCount`);
        if (usageCount < 1 || usageCount > 100000) {
          throw new Error(`usageCount fuera de rango en shoppingCatalog[${idx}].`);
        }
        return {
          id: assertStr(item.id, `shoppingCatalog[${idx}].id`, 48, 6),
          text: assertStr(item.text, `shoppingCatalog[${idx}].text`, 120, 1),
          defaultUnit: assertStr(
            item.defaultUnit ?? '',
            `shoppingCatalog[${idx}].defaultUnit`,
            MAX_LENGTHS.shoppingUnit
          ),
          usageCount: Math.round(usageCount),
          lastUsedAt: assertStr(item.lastUsedAt ?? '', `shoppingCatalog[${idx}].lastUsedAt`, 32),
          ...(typeof item.favorite === 'boolean' ? { favorite: item.favorite } : {}),
          ...parseOptShoppingMeta(item, `shoppingCatalog[${idx}]`),
          createdBy: assertStr(item.createdBy ?? '', `shoppingCatalog[${idx}].createdBy`, 128),
        };
      })
    : undefined;

  const shoppingTemplates = Array.isArray(raw.shoppingTemplates)
    ? raw.shoppingTemplates.map((tpl, idx) => {
        if (!isObj(tpl)) throw new Error(`shoppingTemplates[${idx}] inválido.`);
        const rawItems = Array.isArray(tpl.items) ? tpl.items : [];
        if (rawItems.length > 100) {
          throw new Error(`Demasiados productos en shoppingTemplates[${idx}] (máximo 100).`);
        }
        const items: ShoppingTemplateItem[] = rawItems.map((it, itemIdx) => {
          if (!isObj(it)) throw new Error(`shoppingTemplates[${idx}].items[${itemIdx}] inválido.`);
          const qty = assertFiniteNum(it.qty, `shoppingTemplates[${idx}].items[${itemIdx}].qty`);
          if (qty <= 0 || qty > 999) {
            throw new Error(`Cantidad fuera de rango en shoppingTemplates[${idx}].items[${itemIdx}].`);
          }
          const unit =
            it.unit !== undefined && it.unit !== null
              ? assertStr(it.unit, `shoppingTemplates[${idx}].items[${itemIdx}].unit`, MAX_LENGTHS.shoppingUnit)
              : '';
          return {
            text: assertStr(
              it.text,
              `shoppingTemplates[${idx}].items[${itemIdx}].text`,
              MAX_LENGTHS.shoppingText,
              1
            ),
            qty,
            ...(unit ? { unit } : {}),
            ...parseOptShoppingMeta(it, `shoppingTemplates[${idx}].items[${itemIdx}]`),
          };
        });
        return {
          id: assertStr(tpl.id, `shoppingTemplates[${idx}].id`, 128, 1),
          name: assertStr(tpl.name, `shoppingTemplates[${idx}].name`, MAX_LENGTHS.shoppingTemplateName, 1),
          items,
          createdBy: assertStr(tpl.createdBy ?? '', `shoppingTemplates[${idx}].createdBy`, 128),
        };
      })
    : undefined;

  const shoppingSectionOverrides = Array.isArray(raw.shoppingSectionOverrides)
    ? raw.shoppingSectionOverrides.map((ov, idx) => {
        if (!isObj(ov)) throw new Error(`shoppingSectionOverrides[${idx}] inválido.`);
        const productKey = assertStr(
          ov.productKey ?? ov.id,
          `shoppingSectionOverrides[${idx}].productKey`,
          MAX_LENGTHS.shoppingOverrideKey,
          2
        );
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(productKey)) {
          throw new Error(`productKey inválido en shoppingSectionOverrides[${idx}].`);
        }
        const rawSection = assertStr(
          ov.section,
          `shoppingSectionOverrides[${idx}].section`,
          MAX_LENGTHS.shoppingSection,
          1
        );
        if (!VALID_SHOPPING_SECTIONS.has(rawSection)) {
          throw new Error(`Sección inválida en shoppingSectionOverrides[${idx}].`);
        }
        return {
          id: productKey,
          productKey,
          section: rawSection as ShoppingSection,
          updatedBy: assertStr(ov.updatedBy ?? '', `shoppingSectionOverrides[${idx}].updatedBy`, 128),
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
    ...(mudanzaCompleted !== undefined
      ? {
          mudanzaCompleted,
          mudanzaCompletedAt: mudanzaCompletedAt ?? null,
          mudanzaCompletedBy: mudanzaCompletedBy ?? null,
        }
      : {}),
    ...(csvKeywords ? { csvKeywords } : {}),
    ...(categoryColors ? { categoryColors } : {}),
    ...(commonAccountPlannedCategories !== undefined ? { commonAccountPlannedCategories } : {}),
    ...(commonAccountManualBalance !== undefined ? { commonAccountManualBalance } : {}),
    ...(customCategories ? { customCategories } : {}),
    ...(categoryBudgets ? { categoryBudgets } : {}),
    initialCosts,
    checklist,
    items,
    recurring,
    transactions,
    budgets,
    monthClosures,
    goals,
    goalMovements,
    ...(savingsPlans ? { savingsPlans } : {}),
    ...(shopping ? { shopping } : {}),
    ...(shoppingCatalog ? { shoppingCatalog } : {}),
    ...(shoppingTemplates ? { shoppingTemplates } : {}),
    ...(shoppingSectionOverrides ? { shoppingSectionOverrides } : {}),
  };
}

// ─── 30-Day JSON Backup Reminder Helpers (device-local, truthful) ───────────

export function buildLastBackupStorageKey(householdId: string, uid: string): string {
  return `nido_last_backup_v1_${householdId}_${uid}`;
}

export function loadLastBackupRequestedAt(storageKey: string): string | null {
  if (typeof window === 'undefined' || !storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveLastBackupRequestedAt(storageKey: string, isoDate: string): void {
  if (typeof window === 'undefined' || !storageKey || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
  try {
    window.localStorage.setItem(storageKey, isoDate);
  } catch {
    // Ignore private mode / quota errors
  }
}

export function daysSinceLastBackup(lastISO: string | null, todayISO: string): number | null {
  if (!lastISO || !/^\d{4}-\d{2}-\d{2}$/.test(lastISO)) return null;
  const days = localDaysBetween(lastISO, todayISO);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export function shouldShowBackupReminder(
  lastISO: string | null,
  todayISO: string,
  thresholdDays = 30
): boolean {
  if (!lastISO) return true;
  const days = daysSinceLastBackup(lastISO, todayISO);
  if (days === null) return true;
  return days >= thresholdDays;
}

