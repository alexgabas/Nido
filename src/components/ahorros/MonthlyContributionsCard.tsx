import React from 'react';
import { Landmark, PiggyBank } from 'lucide-react';
import { formatEUR, formatMonthLabelES } from '../../domain/finance';
import type { MonthlyHouseholdContributionsResult } from '../../domain/savingsPlan';
import type { UiMode } from '../../types/nido';

interface MonthlyContributionsCardProps {
  contributions: MonthlyHouseholdContributionsResult;
  shortNameA: string;
  shortNameB: string;
  hasPartner: boolean;
  uiMode: UiMode;
  onOpenMensual?: () => void;
  onOpenPlanEditor?: () => void;
}

export const MonthlyContributionsCard: React.FC<MonthlyContributionsCardProps> = ({
  contributions,
  shortNameA,
  shortNameB,
  hasPartner,
  uiMode,
  onOpenMensual,
  onOpenPlanEditor,
}) => {
  const { expenses, savings, splitPctA, splitPctB, monthKey } = contributions;
  const monthLabel = formatMonthLabelES(monthKey);

  const savingsSourceBadge =
    savings.planSource === 'saved'
      ? 'Plan guardado para este mes'
      : savings.planSource === 'habitual'
        ? 'Propuesta del plan habitual'
        : 'Sin plan configurado';

  return (
    <section
      aria-label="Cuánto pone cada uno este mes"
      data-testid="monthly-contributions-card"
      className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base sm:text-lg font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
            Cuánto pone cada uno · {monthLabel}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dos cifras separadas según vuestro reparto ({shortNameA} {splitPctA}% · {shortNameB}{' '}
            {splitPctB}%): gastos de Cuenta común y ahorro. Nunca se mezclan como una deuda única.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Bloque A — Gastos de Cuenta común */}
        <div
          data-testid="contribution-expenses-block"
          className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between gap-3"
        >
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
                  <Landmark className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                    Aportación prevista para gastos
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Cuenta común</p>
                </div>
              </div>
              <span className="font-display text-base font-bold tabular-nums text-[#0E5A64] dark:text-[#5EEAD4] shrink-0">
                {formatEUR(expenses.total)}
              </span>
            </div>

            {expenses.total > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {shortNameA}
                  </p>
                  <p className="font-display text-base font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                    {formatEUR(expenses.shareA)}
                  </p>
                </div>
                {hasPartner ? (
                  <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {shortNameB}
                    </p>
                    <p className="font-display text-base font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                      {formatEUR(expenses.shareB)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5 flex items-center">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hogar de 1 miembro
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sin gastos ni previsiones asignadas a la Cuenta común en este mes.
              </p>
            )}

            {uiMode === 'avanzado' && expenses.total > 0 && (
              <p className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                Registrado: {formatEUR(expenses.registeredCommonTotal)} · Pendiente:{' '}
                {formatEUR(expenses.pendingCommonRecurringTotal)}
                {expenses.plannedVariableMarginTotal > 0
                  ? ` · Variable planificado: ${formatEUR(expenses.plannedVariableMarginTotal)}`
                  : ''}
                {expenses.hasCustomSplitOverrides ? ' · Respeta excepciones de reparto.' : ''}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Solo Cuenta común (no es «lo que falta ingresar»). Saldo disponible aparte en Mensual.
            </p>
            {onOpenMensual && (
              <button
                type="button"
                onClick={onOpenMensual}
                className="text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline min-h-[36px]"
              >
                Ver radar en Mensual
              </button>
            )}
          </div>
        </div>

        {/* Bloque B — Ahorro */}
        <div
          data-testid="contribution-savings-block"
          className="rounded-2xl bg-[#0E5A64]/5 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/20 p-4 flex flex-col justify-between gap-3"
        >
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-[#0E5A64] text-white flex items-center justify-center shrink-0">
                  <PiggyBank className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                    Aportación prevista para ahorro
                  </p>
                  <p className="text-[11px] text-[#0E5A64] dark:text-[#5EEAD4] font-medium">
                    {savingsSourceBadge}
                  </p>
                </div>
              </div>
              <span className="font-display text-base font-bold tabular-nums text-[#0E5A64] dark:text-[#5EEAD4] shrink-0">
                {formatEUR(savings.totalPlanned)}
              </span>
            </div>

            {savings.totalPlanned > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5 space-y-0.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {shortNameA}
                  </p>
                  <p className="font-display text-base font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                    {formatEUR(savings.shareA)}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    Aportado: <strong>{formatEUR(savings.contributedA)}</strong>
                  </p>
                </div>
                {hasPartner ? (
                  <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5 space-y-0.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {shortNameB}
                    </p>
                    <p className="font-display text-base font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                      {formatEUR(savings.shareB)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      Aportado: <strong>{formatEUR(savings.contributedB)}</strong>
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200/80 dark:border-slate-800 p-2.5 flex items-center">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Hogar de 1 miembro
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Aún no hay ahorro planificado para este mes.
                </p>
                {onOpenPlanEditor && (
                  <button
                    type="button"
                    onClick={onOpenPlanEditor}
                    className="min-h-[40px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold"
                  >
                    Planificar ahorro del mes
                  </button>
                )}
              </div>
            )}

            {(savings.contributedCommon > 0 ||
              savings.withdrawnTotal > 0 ||
              savings.unassignedAmount > 0) && (
              <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                {savings.contributedCommon > 0 && (
                  <p>
                    Aportado desde Cuenta común este mes:{' '}
                    <strong>{formatEUR(savings.contributedCommon)}</strong>
                  </p>
                )}
                {savings.unassignedAmount > 0 && (
                  <p className="text-amber-800 dark:text-amber-300">
                    Sin asignar a metas: <strong>{formatEUR(savings.unassignedAmount)}</strong> (no
                    cuenta como ahorro real).
                  </p>
                )}
                {savings.withdrawnTotal > 0 && (
                  <p className="text-[#B42318] dark:text-[#FCA5A5]">
                    Retiradas de huchas este mes: −{formatEUR(savings.withdrawnTotal)} (mostradas
                    aparte).
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="pt-2 border-t border-[#0E5A64]/15 text-[11px] text-slate-500 dark:text-slate-400">
            Guardar un plan orienta cuánto apartar: no mueve dinero, no crea deudas ni registra
            aportaciones reales.
          </p>
        </div>
      </div>
    </section>
  );
};
