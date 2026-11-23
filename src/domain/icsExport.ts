import { formatEUR, formatLocalDateISO } from './finance';
import { EXPENSE_CATEGORY_LABELS, FREQUENCY_LABELS } from './presets';
import {
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringMissingStartMonth,
  isValidMonthKey,
  shiftMonthKeyLocal,
} from './recurrence';
import { COMMON_ACCOUNT_ID, type RecurringExpense } from '../types/nido';

export type IcsHorizonMonths = 1 | 3 | 6;
export type IcsAlarmDaysBefore = 0 | 1 | 2;

export interface BuildRecurringIcsOptions {
  householdName: string;
  recurring: RecurringExpense[];
  fromMonthKey: string;
  monthsHorizon: IcsHorizonMonths;
  alarmDaysBefore: IcsAlarmDaysBefore;
  categoryLabels?: Record<string, string>;
  now?: Date;
}

export interface BuildRecurringIcsResult {
  icsContent: string;
  eventsCount: number;
  skippedUnanchoredCount: number;
  filename: string;
}

function escapeIcsText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line: string): string {
  // RFC 5545 Section 3.1: lines SHOULD NOT be longer than 75 octets excluding CRLF.
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  const maxFirst = 75;
  const maxCont = 74; // leading space takes 1 byte

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    const limit = chunks.length === 0 ? maxFirst : maxCont;
    if (currentBytes + chBytes > limit && current.length > 0) {
      chunks.push(chunks.length === 0 ? current : ` ${current}`);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(chunks.length === 0 ? current : ` ${current}`);
  }
  return chunks.join('\r\n');
}

function addOneLocalDayCompact(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return formatLocalDateISO(dt).replace(/-/g, '');
}

function formatUtcTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

export function buildRecurringIcsCalendar(
  options: BuildRecurringIcsOptions
): BuildRecurringIcsResult {
  const {
    householdName,
    recurring,
    fromMonthKey,
    monthsHorizon,
    alarmDaysBefore,
    categoryLabels,
    now = new Date(),
  } = options;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nido//Gastos Periodicos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Nido · ${householdName || 'Hogar'}`)}`,
  ];

  const skippedUnanchoredCount = recurring.filter((r) => isRecurringMissingStartMonth(r)).length;
  let eventsCount = 0;

  if (isValidMonthKey(fromMonthKey)) {
    const dtStamp = formatUtcTimestamp(now);
    const trigger = alarmDaysBefore === 0 ? '-PT0S' : `-P${alarmDaysBefore}D`;

    for (let offset = 0; offset < monthsHorizon; offset++) {
      const targetMonth = shiftMonthKeyLocal(fromMonthKey, offset);
      const dueTemplates = recurring
        .filter((rec) => isRecurringDueInMonth(rec, targetMonth))
        .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.concept.localeCompare(b.concept, 'es'));

      for (const rec of dueTemplates) {
        const dueDateISO = getRecurringDueDateForMonth(rec, targetMonth);
        const dtStart = dueDateISO.replace(/-/g, '');
        const dtEnd = addOneLocalDayCompact(dueDateISO);
        const safeRecId = rec.id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'rec';
        const uid = `nido-${targetMonth}-${safeRecId}@nido.local`;
        const summary = `${rec.concept} (${formatEUR(rec.amount)})`;
        const payerLabel =
          rec.paidByDefault === COMMON_ACCOUNT_ID ? 'Cuenta común' : 'Pago individual';
        const catLabel =
          categoryLabels?.[rec.category] ||
          EXPENSE_CATEGORY_LABELS[rec.category] ||
          rec.category ||
          'Otros';
        const description = [
          `Hogar: ${householdName || 'Nido'}`,
          `Categoría: ${catLabel}`,
          `Frecuencia: ${FREQUENCY_LABELS[rec.frequency]}`,
          `Pagador previsto: ${payerLabel}`,
          'Generado desde Nido (exportación estática puntual).',
        ].join('\n');

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${dtStamp}`,
          `DTSTART;VALUE=DATE:${dtStart}`,
          `DTEND;VALUE=DATE:${dtEnd}`,
          `SUMMARY:${escapeIcsText(summary)}`,
          `DESCRIPTION:${escapeIcsText(description)}`,
          `CATEGORIES:${escapeIcsText(catLabel)}`,
          'TRANSP:TRANSPARENT',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `TRIGGER:${trigger}`,
          `DESCRIPTION:${escapeIcsText(`Recordatorio Nido: ${rec.concept} (${formatEUR(rec.amount)})`)}`,
          'END:VALARM',
          'END:VEVENT'
        );
        eventsCount += 1;
      }
    }
  }

  lines.push('END:VCALENDAR');

  const folded = lines.map(foldIcsLine).join('\r\n') + '\r\n';
  return {
    icsContent: folded,
    eventsCount,
    skippedUnanchoredCount,
    filename: `nido-gastos-previstos-${fromMonthKey}.ics`,
  };
}
