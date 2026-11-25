import React, { useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronUp,
  Info,
  Pencil,
  Repeat,
} from 'lucide-react';
import { formatEUR } from '../../domain/finance';
import type { MonthlyPlanSummary } from '../../domain/monthlyPlanning';
import { CategoryTag } from '../CategoryTag';
import type { UiMode } from '../../types/nido';

interface MonthlySummaryCardProps {
  summary: MonthlyPlanSummary;
  uiMode: UiMode;
  isClosed: boolean;
  /** Solo en modo Sencillo: frase en 2.ª persona sobre el saldo entre la pareja */
  secondPersonBalanceText?: string;
  isPeaceBalance?: boolean;
  personalMonthTotal?: number;
  /** Solo en modo Sencillo: total previsto mensual para la Cuenta común */
  commonAccountMonthlyNeed?: number;
  onOpenBudgetEditor?: () => void;
  onScrollToTemplates?: () => void;
}

export const MonthlySummaryCard: React.FC<MonthlySummaryCardProps> = ({
  summary,
  uiMode,
  isClosed,
  secondPersonBalanceText,
  isPeaceBalance = true,
  personalMonthTotal = 0,
  commonAccountMonthlyNeed = 0,
  onOpenBudgetEditor,
  onScrollToTemplates,
}) => {
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showSimpleDetail, setShowSimpleDetail] = useState(false);
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(true);

  const budgetCoverageLabel =
    summary.budgetCoverage === 'none'
      ? 'Sin presupuesto'
      : summary.budgetCoverage === 'partial'
        ? 'Presupuesto parcial'
        : 'Presupuesto completo';

  const budgetCoverageBadgeClass =
    summary.budgetCoverage === 'none'
      ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
      : summary.budgetCoverage === 'partial'
        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200'
        : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200';

  const howItWorksBox = (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
      <p className="font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
        Cómo se calcula la estimación de cierre
      </p>
      <p>
        Sumamos lo que ya lleváis registrado este mes ({formatEUR(summary.registeredTotal)}), los
        cargos previstos de plantillas activas todavía sin registrar (
        {formatEUR(summary.pendingPlannedTotal)}) y el margen de presupuesto aún no consumido (
        {formatEUR(summary.unconsumedBudgetMarginTotal)}).
      </p>
      <p>
        Sin duplicar importes: cuando una plantilla se registra como gasto, deja de contarse como
        prevista; y si una categoría tiene presupuesto y plantilla, nunca se suman dos veces. Los
        gastos privados y las liquidaciones entre vosotros quedan excluidos.
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Es una estimación orientativa para planificar el mes, no un gasto confirmado ni el saldo real
        del banco.
      </p>
    </div>
  );

  // ─── MODO SENCILLO ──────────────────────────────────────────────────────────
  if (uiMode === 'sencillo') {
    return (
      <section
        aria-label="Resumen mensual"
        className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
      >
        <div className="space-y-1.5">
          <p className="text-base text-[#0F1F24] dark:text-[#F0F5F6] leading-snug">
            Este mes lleváis{' '}
            <strong className="font-display text-xl text-[#0E5A64] dark:text-[#5EEAD4] tabular-nums">
              {formatEUR(summary.registeredTotal)}
            </strong>{' '}
            registrados.
          </p>

          {summary.pendingPlannedTotal > 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
              Quedan{' '}
              <strong className="tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                {formatEUR(summary.pendingPlannedTotal)}
              </strong>{' '}
              en cargos previstos ({summary.pendingPlannedItems.length}{' '}
              {summary.pendingPlannedItems.length === 1 ? 'recibo' : 'recibos'}).
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No quedan cargos fijos previstos pendientes de registrar este mes.
            </p>
          )}

          {summary.estimatedCloseTotal > 0 && (
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
              Estimación de cierre del mes:{' '}
              <strong className="tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
                {formatEUR(summary.estimatedCloseTotal)}
              </strong>
              {summary.budgetCoverage === 'partial' && (
                <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200">
                  Presupuesto parcial
                </span>
              )}
              {summary.budgetCoverage === 'none' && (
                <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                  (sin presupuestos configurados)
                </span>
              )}
            </p>
          )}

          {commonAccountMonthlyNeed > 0 && (
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
              Para la Cuenta común habéis previsto{' '}
              <strong className="tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
                {formatEUR(commonAccountMonthlyNeed)}
              </strong>{' '}
              este mes.
            </p>
          )}
        </div>

        {secondPersonBalanceText && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1">
            <p
              className={`font-display text-lg font-bold ${
                isPeaceBalance
                  ? 'text-[#15803D] dark:text-[#4ADE80]'
                  : 'text-[#0E5A64] dark:text-[#5EEAD4]'
              }`}
            >
              {secondPersonBalanceText}
            </p>
            {personalMonthTotal > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Además llevas {formatEUR(personalMonthTotal)} en gastos personales (solo visibles
                para ti).
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {summary.categories.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSimpleDetail((v) => !v)}
              aria-expanded={showSimpleDetail}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <span>{showSimpleDetail ? 'Ocultar detalle' : 'Ver detalle por categoría'}</span>
              {showSimpleDetail ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHowItWorks((v) => !v)}
            aria-expanded={showHowItWorks}
            className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1.5"
          >
            <Info className="w-4 h-4" />
            <span>Cómo se calcula</span>
          </button>
        </div>

        {showHowItWorks && howItWorksBox}

        {showSimpleDetail && summary.categories.length > 0 && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Estimación por categoría
            </p>
            <ul className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
              {summary.categories.map((row) => (
                <li key={row.categoryId} className="py-2 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CategoryTag category={row.categoryId} size="xs" />
                      {row.isArchived && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          Archivada
                        </span>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6] shrink-0">
                      Est. {formatEUR(row.estimatedClose)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>Registrado: {formatEUR(row.registered)}</span>
                    {row.pendingPlanned > 0 && (
                      <span>Previsto: {formatEUR(row.pendingPlanned)}</span>
                    )}
                    <span>
                      {row.hasExplicitBudget
                        ? `Presupuesto: ${formatEUR(row.budgetLimit!)}`
                        : 'Sin presupuesto'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <section
      aria-label="Resumen de planificación mensual"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold">Planificación del mes</h2>
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${budgetCoverageBadgeClass}`}
              >
                {budgetCoverageLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Estimación orientativa sin duplicar presupuestos, plantillas y gastos ya registrados.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHowItWorks((v) => !v)}
            aria-expanded={showHowItWorks}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Cómo se calcula</span>
          </button>
          {!isClosed && onOpenBudgetEditor && (
            <button
              type="button"
              onClick={onOpenBudgetEditor}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/5 inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Ajustar presupuestos</span>
            </button>
          )}
          {onScrollToTemplates && (
            <button
              type="button"
              onClick={onScrollToTemplates}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Ver plantillas</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 métricas principales coherentes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3.5 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Presupuesto configurado
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {summary.hasAnyBudget ? formatEUR(summary.configuredBudgetTotal) : 'Sin presupuesto'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {summary.budgetCoverage === 'none'
              ? 'Sin límites definidos este mes'
              : summary.budgetCoverage === 'partial'
                ? `${summary.unbudgetedActivityCategories.length} ${summary.unbudgetedActivityCategories.length === 1 ? 'categoría' : 'categorías'} con gasto sin límite`
                : 'Todas las categorías activas con límite'}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3.5 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Gasto registrado
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(summary.registeredTotal)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {summary.registeredCount} {summary.registeredCount === 1 ? 'movimiento' : 'movimientos'}{' '}
            compartidos
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-3.5 space-y-1">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Cargos previstos pendientes
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(summary.pendingPlannedTotal)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {summary.pendingPlannedItems.length}{' '}
            {summary.pendingPlannedItems.length === 1
              ? 'plantilla sin registrar'
              : 'plantillas sin registrar'}
          </p>
        </div>

        <div className="rounded-xl bg-[#0E5A64]/6 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/25 p-3.5 space-y-1">
          <p className="text-[11px] font-semibold text-[#0E5A64] dark:text-[#5EEAD4]">
            Estimación de cierre
          </p>
          <p className="font-display text-lg font-bold tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
            {formatEUR(summary.estimatedCloseTotal)}
          </p>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            +{formatEUR(summary.unconsumedBudgetMarginTotal)} margen presupuestado libre
          </p>
        </div>
      </div>

      {showHowItWorks && howItWorksBox}

      {summary.unanchoredRecurringTemplates.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p>
            Hay {summary.unanchoredRecurringTemplates.length}{' '}
            {summary.unanchoredRecurringTemplates.length === 1
              ? 'plantilla periódica sin mes de inicio configurado'
              : 'plantillas periódicas sin mes de inicio configurado'}{' '}
            que no se incluyen en esta previsión hasta que indiques su mes de referencia en{' '}
            <strong>Plantillas recurrentes</strong>.
          </p>
        </div>
      )}

      {/* Desglose por categoría */}
      {summary.categories.length > 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowCategoryBreakdown((v) => !v)}
            aria-expanded={showCategoryBreakdown}
            className="min-h-[44px] w-full flex items-center justify-between text-left px-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-[#0E5A64] dark:hover:text-[#5EEAD4]"
          >
            <span>
              Desglose por categoría ({summary.categories.length})
              {summary.archivedWithActivityCount > 0 &&
                ` · incluye ${summary.archivedWithActivityCount} archivada${summary.archivedWithActivityCount === 1 ? '' : 's'}`}
            </span>
            {showCategoryBreakdown ? (
              <ChevronUp className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0" />
            )}
          </button>

          {showCategoryBreakdown && (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                    <th className="py-2 pr-3 font-semibold">Categoría</th>
                    <th className="py-2 px-2 font-semibold text-right">Registrado</th>
                    <th className="py-2 px-2 font-semibold text-right">Previsto</th>
                    <th className="py-2 px-2 font-semibold text-right">Presupuesto</th>
                    <th className="py-2 pl-2 font-semibold text-right">Estimación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                  {summary.categories.map((row) => (
                    <tr key={row.categoryId}>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CategoryTag category={row.categoryId} size="xs" />
                          {row.isArchived && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                              Archivada
                            </span>
                          )}
                          {row.budgetStatus === 'over' && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[10px] font-semibold text-red-800 dark:text-red-300">
                              Supera límite
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium text-[#0F1F24] dark:text-[#F0F5F6]">
                        {formatEUR(row.registered)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-600 dark:text-slate-300">
                        {row.pendingPlanned > 0 ? formatEUR(row.pendingPlanned) : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        {row.hasExplicitBudget ? (
                          <span className="text-slate-700 dark:text-slate-200 font-medium">
                            {formatEUR(row.budgetLimit!)}
                          </span>
                        ) : (
                          <span className="text-amber-800 dark:text-amber-300 text-[11px] font-medium">
                            Sin presupuesto
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                        {formatEUR(row.estimatedClose)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Todavía no hay gastos registrados, plantillas previstas ni presupuestos configurados en
          este mes.
        </p>
      )}
    </section>
  );
};
