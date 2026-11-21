import type { ExpenseCategory, RecurringExpense, Transaction } from '../types/nido';
import { getTodayLocalISO, roundCents } from './finance';
import {
  daysInMonthLocal,
  getRecurringDueDateForMonth,
  isRecurringDueInMonth,
  isRecurringMissingStartMonth,
  isValidMonthKey,
} from './recurrence';

export type CalendarEventKind = 'registered' | 'future_registered' | 'planned';

export interface CalendarDayEvent {
  id: string;
  date: string; // YYYY-MM-DD
  concept: string;
  category: ExpenseCategory;
  amount: number;
  paidBy: string;
  kind: CalendarEventKind;
  isPrivate: boolean;
  tx?: Transaction;
  recurring?: RecurringExpense;
}

export interface CalendarDayCell {
  dateISO: string;
  dayNumber: number;
  isToday: boolean;
  isFutureDay: boolean;
  events: CalendarDayEvent[];
  registeredTotal: number;
  plannedTotal: number;
}

export interface MonthCalendarGrid {
  monthKey: string;
  leadingEmptyCells: number;
  trailingEmptyCells: number;
  days: CalendarDayCell[];
  unanchoredActiveTemplates: RecurringExpense[];
  totalRegistered: number;
  totalPlannedPending: number;
}

export interface MonthAgendaGroup {
  dateISO: string;
  dayNumber: number;
  isToday: boolean;
  isFutureDay: boolean;
  events: CalendarDayEvent[];
}

export function buildMonthCalendarEvents(
  monthKey: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  todayISO = getTodayLocalISO()
): { events: CalendarDayEvent[]; unanchoredActiveTemplates: RecurringExpense[] } {
  if (!isValidMonthKey(monthKey)) {
    return { events: [], unanchoredActiveTemplates: [] };
  }

  const monthExpenses = transactions.filter(
    (t) => t.monthKey === monthKey && !t.isSettlement && t.category !== 'liquidacion'
  );

  const registeredRecurringIds = new Set<string>();
  const events: CalendarDayEvent[] = [];

  for (const tx of monthExpenses) {
    if (!tx.isPrivate && tx.recurringId) {
      registeredRecurringIds.add(tx.recurringId);
    }
    const kind: CalendarEventKind = tx.date > todayISO ? 'future_registered' : 'registered';
    events.push({
      id: `tx_${tx.id}`,
      date: tx.date,
      concept: tx.concept,
      category: tx.category === 'liquidacion' ? 'otros' : tx.category,
      amount: Number(tx.amount) || 0,
      paidBy: tx.paidBy,
      kind,
      isPrivate: Boolean(tx.isPrivate),
      tx,
    });
  }

  const unanchoredActiveTemplates: RecurringExpense[] = [];

  for (const rec of recurring) {
    if (isRecurringMissingStartMonth(rec)) {
      unanchoredActiveTemplates.push(rec);
    }
    if (registeredRecurringIds.has(rec.id)) continue;
    if (!isRecurringDueInMonth(rec, monthKey)) continue;
    const dueDate = getRecurringDueDateForMonth(rec, monthKey);
    events.push({
      id: `plan_${monthKey}_${rec.id}`,
      date: dueDate,
      concept: rec.concept,
      category: rec.category,
      amount: Number(rec.amount) || 0,
      paidBy: rec.paidByDefault,
      kind: 'planned',
      isPrivate: false,
      recurring: rec,
    });
  }

  const kindOrder: Record<CalendarEventKind, number> = {
    registered: 0,
    future_registered: 1,
    planned: 2,
  };

  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.concept.localeCompare(b.concept, 'es')
  );

  return { events, unanchoredActiveTemplates };
}

export function buildMonthCalendarGrid(
  monthKey: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  todayISO = getTodayLocalISO()
): MonthCalendarGrid {
  if (!isValidMonthKey(monthKey)) {
    return {
      monthKey,
      leadingEmptyCells: 0,
      trailingEmptyCells: 0,
      days: [],
      unanchoredActiveTemplates: [],
      totalRegistered: 0,
      totalPlannedPending: 0,
    };
  }

  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const firstDayLocal = new Date(year, month - 1, 1);
  // Convert JS getDay() (0=Sun..6=Sat) to Monday-first index (0=Mon..6=Sun)
  const leadingEmptyCells = (firstDayLocal.getDay() + 6) % 7;
  const totalDays = daysInMonthLocal(monthKey);
  const trailingEmptyCells = (7 - ((leadingEmptyCells + totalDays) % 7)) % 7;

  const { events, unanchoredActiveTemplates } = buildMonthCalendarEvents(
    monthKey,
    transactions,
    recurring,
    todayISO
  );

  const byDate = new Map<string, CalendarDayEvent[]>();
  let totalRegistered = 0;
  let totalPlannedPending = 0;

  for (const ev of events) {
    const list = byDate.get(ev.date);
    if (list) list.push(ev);
    else byDate.set(ev.date, [ev]);

    if (ev.kind === 'planned') {
      totalPlannedPending += ev.amount;
    } else if (!ev.isPrivate) {
      totalRegistered += ev.amount;
    }
  }

  const days: CalendarDayCell[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const dateISO = `${monthKey}-${String(d).padStart(2, '0')}`;
    const dayEvents = byDate.get(dateISO) ?? [];
    let regSum = 0;
    let planSum = 0;
    for (const ev of dayEvents) {
      if (ev.kind === 'planned') planSum += ev.amount;
      else if (!ev.isPrivate) regSum += ev.amount;
    }
    days.push({
      dateISO,
      dayNumber: d,
      isToday: dateISO === todayISO,
      isFutureDay: dateISO > todayISO,
      events: dayEvents,
      registeredTotal: roundCents(regSum),
      plannedTotal: roundCents(planSum),
    });
  }

  return {
    monthKey,
    leadingEmptyCells,
    trailingEmptyCells,
    days,
    unanchoredActiveTemplates,
    totalRegistered: roundCents(totalRegistered),
    totalPlannedPending: roundCents(totalPlannedPending),
  };
}

export function buildMonthAgendaGroups(
  monthKey: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  todayISO = getTodayLocalISO()
): { groups: MonthAgendaGroup[]; unanchoredActiveTemplates: RecurringExpense[] } {
  const { events, unanchoredActiveTemplates } = buildMonthCalendarEvents(
    monthKey,
    transactions,
    recurring,
    todayISO
  );

  const map = new Map<string, CalendarDayEvent[]>();
  for (const ev of events) {
    const arr = map.get(ev.date);
    if (arr) arr.push(ev);
    else map.set(ev.date, [ev]);
  }

  const groups: MonthAgendaGroup[] = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateISO, dayEvents]) => ({
      dateISO,
      dayNumber: Number(dateISO.slice(8, 10)),
      isToday: dateISO === todayISO,
      isFutureDay: dateISO > todayISO,
      events: dayEvents,
    }));

  return { groups, unanchoredActiveTemplates };
}
