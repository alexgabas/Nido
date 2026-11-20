import { DEFAULT_CSV_KEYWORDS, EXPENSE_CATEGORY_LABELS } from './presets';
import { roundCents } from './finance';
import type { CsvCategoryKeywords, ExpenseCategory, Transaction } from '../types/nido';
import { MAX_LENGTHS } from '../types/nido';

export type CsvDelimiter = ';' | ',';

export interface CsvColumnMapping {
  dateIndex: number;
  conceptIndex: number;
  amountIndex: number;
}

export interface ParsedBankRow {
  rowIndex: number;
  rawDate: string;
  rawConcept: string;
  rawAmount: string;
  dateISO: string | null;
  monthKey: string | null;
  concept: string;
  signedAmount: number | null;
  absAmount: number;
  isIncome: boolean;
  isDuplicate: boolean;
  suggestedCategory: ExpenseCategory;
  error: string | null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectCsvDelimiter(text: string): CsvDelimiter {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  let semi = 0;
  let comma = 0;
  for (const line of lines) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (ch === ';') semi += 1;
        else if (ch === ',') comma += 1;
      }
    }
  }
  return semi >= comma ? ';' : ',';
}

export function parseCsvMatrix(text: string, delimiter: CsvDelimiter): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }

  return rows;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

export function parseBankDateToISO(raw: string): string | null {
  const clean = raw.trim().split(/[T\s]+/)[0];
  if (!clean) return null;

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const euMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(clean);
  if (euMatch) {
    const d = Number(euMatch[1]);
    const m = Number(euMatch[2]);
    let y = Number(euMatch[3]);
    if (y < 100) y += 2000;
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return null;
}

export function parseBankAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[€$\s\u00A0]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (!s || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is decimal separator
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    // If exactly 3 digits after comma and multiple commas or leading 0 looks like thousands?
    // In Spanish banks, amounts usually have 1-2 decimals (e.g. 45,20) or whole thousands (1,200).
    if (decimals === 3 && s.indexOf(',') !== lastComma) {
      normalized = s.replace(/,/g, '');
    } else if (decimals <= 2 || s.startsWith('0,')) {
      normalized = s.replace(',', '.');
    } else {
      normalized = s.replace(',', '.');
    }
  } else if (lastDot >= 0) {
    const dotCount = (s.match(/\./g) || []).length;
    const decimals = s.length - lastDot - 1;
    if (dotCount > 1) {
      normalized = s.replace(/\./g, '');
    } else if (decimals === 3) {
      // Spanish bank CSV often writes 1.250 without decimals -> 1250
      normalized = s.replace(/\./g, '');
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  const signed = negative ? -Math.abs(num) : num;
  return roundCents(signed);
}

export function guessCsvColumns(headers: string[]): CsvColumnMapping {
  const norm = headers.map((h) => normalizeText(h));
  let dateIndex = norm.findIndex(
    (h) => h.includes('fecha') || h === 'f.valor' || h === 'date' || h.includes('f.operacion')
  );
  let conceptIndex = norm.findIndex(
    (h) =>
      h.includes('concepto') ||
      h.includes('descripcion') ||
      h.includes('movimiento') ||
      h.includes('detalle') ||
      h.includes('description') ||
      h.includes('comercio')
  );
  let amountIndex = norm.findIndex(
    (h) =>
      h.includes('importe') ||
      h.includes('cantidad') ||
      h.includes('monto') ||
      h.includes('amount') ||
      h.includes('cargo') ||
      h.includes('eur')
  );

  if (dateIndex < 0) dateIndex = 0;
  if (conceptIndex < 0) conceptIndex = Math.min(1, Math.max(0, headers.length - 1));
  if (amountIndex < 0) amountIndex = Math.min(2, Math.max(0, headers.length - 1));

  return { dateIndex, conceptIndex, amountIndex };
}

export function resolveKeywordsMap(saved?: CsvCategoryKeywords): Record<ExpenseCategory, string> {
  const merged: Record<ExpenseCategory, string> = { ...DEFAULT_CSV_KEYWORDS };
  if (!saved) return merged;
  for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
    if (typeof saved[cat] === 'string') {
      merged[cat] = saved[cat] as string;
    }
  }
  return merged;
}

export function matchCategoryFromKeywords(
  concept: string,
  keywordsMap: CsvCategoryKeywords
): ExpenseCategory {
  const normConcept = normalizeText(concept);
  if (!normConcept) return 'otros';

  const resolved = resolveKeywordsMap(keywordsMap);
  for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
    if (cat === 'otros') continue;
    const rawList = resolved[cat] || '';
    const tokens = rawList
      .split(',')
      .map((t) => normalizeText(t))
      .filter(Boolean);
    for (const token of tokens) {
      if (normConcept.includes(token)) {
        return cat;
      }
    }
  }
  return 'otros';
}

export function buildTxDuplicateKey(dateISO: string, amount: number, concept: string): string {
  const cleanConcept = normalizeText(concept).slice(0, MAX_LENGTHS.concept);
  return `${dateISO}::${roundCents(Math.abs(amount)).toFixed(2)}::${cleanConcept}`;
}

export function buildParsedBankRows(
  dataRows: string[][],
  mapping: CsvColumnMapping,
  existingTransactions: Transaction[],
  keywordsMap: CsvCategoryKeywords
): ParsedBankRow[] {
  const seenKeys = new Set<string>();
  for (const tx of existingTransactions) {
    seenKeys.add(buildTxDuplicateKey(tx.date, tx.amount, tx.concept));
  }

  return dataRows.map((cols, idx) => {
    const rawDate = cols[mapping.dateIndex] ?? '';
    const rawConcept = cols[mapping.conceptIndex] ?? '';
    const rawAmount = cols[mapping.amountIndex] ?? '';

    const dateISO = parseBankDateToISO(rawDate);
    const monthKey = dateISO ? dateISO.slice(0, 7) : null;
    const concept = rawConcept.trim().slice(0, MAX_LENGTHS.concept);
    const signedAmount = parseBankAmount(rawAmount);
    const absAmount = signedAmount !== null ? roundCents(Math.abs(signedAmount)) : 0;
    const isIncome = signedAmount !== null && signedAmount > 0;

    let error: string | null = null;
    if (!dateISO) error = 'Fecha no reconocida';
    else if (!concept) error = 'Concepto vacío';
    else if (signedAmount === null || absAmount === 0) error = 'Importe inválido o cero';

    let isDuplicate = false;
    if (!error && dateISO && concept) {
      const key = buildTxDuplicateKey(dateISO, absAmount, concept);
      if (seenKeys.has(key)) {
        isDuplicate = true;
      } else {
        seenKeys.add(key);
      }
    }

    return {
      rowIndex: idx,
      rawDate,
      rawConcept,
      rawAmount,
      dateISO,
      monthKey,
      concept,
      signedAmount,
      absAmount,
      isIncome,
      isDuplicate,
      suggestedCategory: matchCategoryFromKeywords(concept, keywordsMap),
      error,
    };
  });
}
