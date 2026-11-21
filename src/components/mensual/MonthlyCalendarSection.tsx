import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Lock,
  Palette,
  Plus,
} from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import {
  buildMonthAgendaGroups,
  buildMonthCalendarGrid,
  type CalendarDayEvent,
} from '../../domain/calendar';
import { hexToRgba, resolveCategoryColor } from '../../domain/categoryPalette';
import { formatDateES, formatEUR, getTodayLocalISO } from '../../domain/finance';
import type {
  ExpensePrefill,
  RecurringExpense,
  Transaction,
  UiMode,
} from '../../types/nido';
import { CategoryTag } from '../CategoryTag';

interface MonthlyCalendarSectionProps {
  monthKey: string;
  transactions: Transaction[];
  recurring: RecurringExpense[];
  uiMode: UiMode;
  isClosed: boolean;
  memberLabel: (uid: string) => string;
  effectiveSplitPctA: number;
  onAddExpenseForDay: (prefill: ExpensePrefill) => void;
  onEditTransaction: (tx: Transaction) => void;
  onOpenColorModal?: () => void;
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export const MonthlyCalendarSection: React.FC<MonthlyCalendarSectionProps> = ({
  monthKey,
  transactions,
  recurring,
  uiMode,
  isClosed,
  memberLabel,
  effectiveSplitPctA,
  onAddExpenseForDay,
  onEditTransaction,
  onOpenColorModal,
}) => {
  const { household } = useNido();
  const todayISO = getTodayLocalISO();
  const customColors = household?.categoryColors;

  const grid = useMemo(
    () => buildMonthCalendarGrid(monthKey, transactions, recurring, todayISO),
    [monthKey, transactions, recurring, todayISO]
  );

  const agenda = useMemo(
    () => buildMonthAgendaGroups(monthKey, transactions, recurring, todayISO),
    [monthKey, transactions, recurring, todayISO]
  );

  const [selectedDateISO, setSelectedDateISO] = useState<string>(() =>
    todayISO.startsWith(monthKey) ? todayISO : `${monthKey}-01`
  );

  useEffect(() => {
    setSelectedDateISO(todayISO.startsWith(monthKey) ? todayISO : `${monthKey}-01`);
  }, [monthKey, todayISO]);

  const buildPlannedPrefill = (ev: CalendarDayEvent): ExpensePrefill => {
    const rec = ev.recurring;
    return {
      amount: ev.amount > 0 ? String(ev.amount) : '',
      concept: ev.concept,
      category: ev.category,
      date: ev.date,
      recurringId: rec?.id ?? null,
      paidBy: rec?.paidByDefault,
      splitPctA:
        rec && rec.splitOverride !== null && rec.splitOverride !== undefined
          ? rec.splitOverride
          : effectiveSplitPctA,
      notes: 'Registrado desde previsión mensual',
    };
  };

  // ─── MODO SENCILLO: AGENDA SIMPLIFICADA DEL MES ────────────────────────────
  if (uiMode === 'sencillo') {
    return (
      <section
        aria-label="Agenda del mes"
        className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <div>
              <h2 className="font-display text-base font-bold">Agenda del mes</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gastos ya apuntados y los previstos según vuestros fijos.
              </p>
            </div>
          </div>
          {!isClosed && (
            <button
              type="button"
              onClick={() =>
                onAddExpenseForDay({
                  date: todayISO.startsWith(monthKey) ? todayISO : `${monthKey}-01`,
                })
              }
              className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir gasto</span>
            </button>
          )}
        </div>

        {agenda.groups.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
            Todavía no hay gastos apuntados ni previstos para este mes.
          </p>
        ) : (
          <ul className="space-y-3">
            {agenda.groups.map((group) => (
              <li
                key={group.dateISO}
                className={`rounded-2xl border p-3.5 space-y-2.5 ${
                  group.isToday
                    ? 'border-[#0E5A64]/45 bg-[#0E5A64]/4 dark:bg-[#0E5A64]/12'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                    {formatDateES(group.dateISO)}
                    {group.isToday ? ' · Hoy' : ''}
                  </span>
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => onAddExpenseForDay({ date: group.dateISO })}
                      className="min-h-[44px] px-2.5 -my-2 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10 inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Añadir este día</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {group.events.map((ev) => {
                    const isPlanned = ev.kind === 'planned';
                    return (
                      <div
                        key={ev.id}
                        className={`rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 ${
                          isPlanned
                            ? 'border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50'
                            : 'bg-slate-50 dark:bg-slate-900/60'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CategoryTag category={ev.category} customColors={customColors} size="xs" />
                            <span className="text-sm font-bold truncate">{ev.concept}</span>
                            {ev.isPrivate && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                <Lock className="w-3 h-3" />
                                Privado
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
                            {isPlanned ? (
                              <>
                                <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
                                <span>Previsto para este día</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] dark:text-[#4ADE80] shrink-0" />
                                <span>
                                  {ev.kind === 'future_registered'
                                    ? 'Ya apuntado (fecha futura)'
                                    : 'Ya apuntado'}
                                </span>
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono-num text-sm font-bold">
                            {formatEUR(ev.amount)}
                          </span>
                          {!isClosed && isPlanned && (
                            <button
                              type="button"
                              onClick={() => onAddExpenseForDay(buildPlannedPrefill(ev))}
                              className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-bold hover:bg-[#0E5A64]/20"
                            >
                              Registrar gasto previsto
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  // ─── MODO AVANZADO: CALENDARIO LITERAL 7 COLUMNAS (LUNES A DOMINGO) ────────
  const selectedCell =
    grid.days.find((d) => d.dateISO === selectedDateISO) ?? grid.days[0] ?? null;

  return (
    <section
      aria-label="Calendario del mes"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <h2 className="font-display text-base font-bold">Calendario del mes</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Apuntado: <strong className="tabular-nums">{formatEUR(grid.totalRegistered)}</strong>
            {grid.totalPlannedPending > 0 && (
              <>
                {' '}
                · Previsto pendiente:{' '}
                <strong className="tabular-nums text-amber-800 dark:text-amber-300">
                  {formatEUR(grid.totalPlannedPending)}
                </strong>{' '}
                (no suma al saldo hasta registrarse)
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenColorModal && (
            <button
              type="button"
              onClick={onOpenColorModal}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Palette className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <span>Personalizar colores</span>
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[#0E5A64]/20 border border-[#0E5A64]" />
          <span>Registrado</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border border-dashed border-amber-600 dark:border-amber-400 bg-amber-500/10" />
          <span>Previsto (plantilla)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-sky-500/15 border border-sky-600" />
          <span>Fecha futura</span>
        </span>
      </div>

      {grid.unanchoredActiveTemplates.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300/70 dark:border-amber-700/60 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Hay {grid.unanchoredActiveTemplates.length}{' '}
            {grid.unanchoredActiveTemplates.length === 1
              ? 'plantilla periódica activa sin mes de referencia'
              : 'plantillas periódicas activas sin mes de referencia'}{' '}
            que no se muestra en el calendario hasta confirmar su mes de inicio.
          </span>
        </div>
      )}

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {WEEKDAY_LABELS.map((dayLabel) => (
          <div key={dayLabel} className="py-1">
            {dayLabel}
          </div>
        ))}
      </div>

      {/* 7-column calendar cells */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: grid.leadingEmptyCells }).map((_, idx) => (
          <div
            key={`lead-${idx}`}
            aria-hidden="true"
            className="min-h-[54px] md:min-h-[104px] rounded-xl bg-slate-50/50 dark:bg-slate-900/25"
          />
        ))}

        {grid.days.map((cell) => {
          const isSelected = cell.dateISO === selectedDateISO;
          const totalDay = cell.registeredTotal + cell.plannedTotal;
          const visibleEvents = cell.events.slice(0, 3);
          const extraCount = cell.events.length - visibleEvents.length;

          return (
            <div
              key={cell.dateISO}
              role="button"
              tabIndex={0}
              aria-label={`${formatDateES(cell.dateISO)}, ${cell.events.length} movimientos`}
              aria-pressed={isSelected}
              onClick={() => setSelectedDateISO(cell.dateISO)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedDateISO(cell.dateISO);
                }
              }}
              className={`min-h-[58px] md:min-h-[108px] rounded-xl border p-1.5 md:p-2 flex flex-col justify-between cursor-pointer transition-colors text-left focus:outline-2 focus:outline-[#0E5A64] ${
                isSelected
                  ? 'border-[#0E5A64] ring-2 ring-[#0E5A64]/20 bg-[#0E5A64]/5 dark:bg-[#0E5A64]/15'
                  : cell.isToday
                    ? 'border-[#0E5A64]/50 bg-slate-50/80 dark:bg-slate-900/60'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`inline-flex items-center justify-center text-xs font-bold tabular-nums ${
                    cell.isToday
                      ? 'w-6 h-6 rounded-full bg-[#0E5A64] text-white'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {cell.dayNumber}
                </span>
                {totalDay > 0 && (
                  <span className="hidden lg:inline text-[10px] font-mono-num font-semibold text-slate-500 dark:text-slate-400">
                    {formatEUR(totalDay)}
                  </span>
                )}
              </div>

              {/* Mobile: compact colored dots + count */}
              <div className="flex md:hidden flex-wrap items-center gap-1 pt-1">
                {cell.events.slice(0, 4).map((ev) => {
                  const hex = resolveCategoryColor(ev.category, customColors);
                  return (
                    <span
                      key={ev.id}
                      className={`w-2 h-2 rounded-full ${
                        ev.kind === 'planned' ? 'ring-1 ring-offset-1 ring-amber-500 opacity-75' : ''
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
                {cell.events.length > 4 && (
                  <span className="text-[9px] font-bold text-slate-500">+{cell.events.length - 4}</span>
                )}
              </div>

              {/* Desktop (md+): inline tags with concept & amount */}
              <div className="hidden md:flex flex-col gap-1 mt-1 overflow-hidden">
                {visibleEvents.map((ev) => {
                  const hex = resolveCategoryColor(ev.category, customColors);
                  const isPlanned = ev.kind === 'planned';
                  const isFutureReal = ev.kind === 'future_registered';
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDateISO(cell.dateISO);
                        if (isClosed) return;
                        if (isPlanned) {
                          onAddExpenseForDay(buildPlannedPrefill(ev));
                        } else if (ev.tx) {
                          onEditTransaction(ev.tx);
                        }
                      }}
                      title={`${ev.concept} · ${formatEUR(ev.amount)}${isPlanned ? ' (Previsto)' : ''}`}
                      className={`w-full px-1.5 py-0.5 rounded-md text-[10px] leading-tight flex items-center justify-between gap-1 truncate transition-opacity hover:opacity-90 ${
                        isPlanned
                          ? 'border border-dashed'
                          : isFutureReal
                            ? 'border border-sky-600/50'
                            : 'border'
                      }`}
                      style={{
                        backgroundColor: hexToRgba(hex, isPlanned ? 0.06 : 0.14),
                        borderColor: isPlanned ? hexToRgba(hex, 0.55) : hexToRgba(hex, 0.35),
                      }}
                    >
                      <span className="flex items-center gap-1 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        <span className="truncate font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
                          {ev.concept}
                        </span>
                      </span>
                      <span className="font-mono-num font-bold shrink-0 text-[#0F1F24] dark:text-[#F0F5F6]">
                        {Math.round(ev.amount)}€
                      </span>
                    </button>
                  );
                })}
                {extraCount > 0 && (
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 px-1">
                    +{extraCount} más
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {Array.from({ length: grid.trailingEmptyCells }).map((_, idx) => (
          <div
            key={`trail-${idx}`}
            aria-hidden="true"
            className="min-h-[54px] md:min-h-[104px] rounded-xl bg-slate-50/50 dark:bg-slate-900/25"
          />
        ))}
      </div>

      {/* Selected Day Interactive Detail Panel (both mobile tap & desktop click) */}
      {selectedCell && (
        <div
          aria-label="Detalle del día seleccionado"
          className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                {formatDateES(selectedCell.dateISO)}
                {selectedCell.isToday ? ' · Hoy' : ''}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedCell.events.length === 0
                  ? 'Sin gastos registrados ni previstos este día.'
                  : `${selectedCell.events.length} ${
                      selectedCell.events.length === 1 ? 'movimiento' : 'movimientos'
                    } · Apuntado ${formatEUR(selectedCell.registeredTotal)}${
                      selectedCell.plannedTotal > 0
                        ? ` · Previsto ${formatEUR(selectedCell.plannedTotal)}`
                        : ''
                    }`}
              </p>
            </div>
            {!isClosed && (
              <button
                type="button"
                onClick={() => onAddExpenseForDay({ date: selectedCell.dateISO })}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir gasto este día</span>
              </button>
            )}
          </div>

          {selectedCell.events.length > 0 && (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {selectedCell.events.map((ev) => {
                const isPlanned = ev.kind === 'planned';
                return (
                  <li
                    key={ev.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CategoryTag category={ev.category} customColors={customColors} size="xs" />
                        <span className="text-sm font-semibold">{ev.concept}</span>
                        {isPlanned && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-900 dark:text-amber-200 text-[10px] font-bold">
                            Previsto
                          </span>
                        )}
                        {ev.kind === 'future_registered' && (
                          <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-900 dark:text-sky-200 text-[10px] font-bold">
                            Fecha futura
                          </span>
                        )}
                        {ev.isPrivate && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-[10px] font-semibold">
                            <Lock className="w-2.5 h-2.5" />
                            Privado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {ev.isPrivate ? 'Solo tú' : memberLabel(ev.paidBy)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                      <span className="font-mono-num text-sm font-bold">
                        {formatEUR(ev.amount)}
                      </span>
                      {!isClosed && isPlanned && (
                        <button
                          type="button"
                          onClick={() => onAddExpenseForDay(buildPlannedPrefill(ev))}
                          className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-semibold hover:bg-[#0E5A64]/20"
                        >
                          Registrar gasto previsto
                        </button>
                      )}
                      {!isClosed && !isPlanned && ev.tx && (
                        <button
                          type="button"
                          onClick={() => onEditTransaction(ev.tx!)}
                          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold"
                        >
                          Editar
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
