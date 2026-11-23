import React from 'react';
import { Minus, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { CategoryTag } from '../CategoryTag';
import {
  formatEUR,
  formatMonthLabelES,
  formatPctES,
  roundCents,
  shiftMonthKey,
  type CategoryBudgetProgress,
  type CategoryComparisonResult,
  type ComparisonDirection,
} from '../../domain/finance';

function statusBadge(bp: CategoryBudgetProgress) {
  const remaining = roundCents(bp.limit - bp.spent);
  switch (bp.status) {
    case 'verde':
      if (bp.limit === 0 && (bp.hasLimit ?? false)) {
        return {
          bar: 'bg-[#15803D]',
          text: 'text-[#15803D] dark:text-[#4ADE80]',
          label: 'Límite 0 € · sin gasto',
        };
      }
      if (bp.isRecurringOnly) {
        return {
          bar: 'bg-[#15803D]',
          text: 'text-[#15803D] dark:text-[#4ADE80]',
          label: 'Gasto fijo previsto',
        };
      }
      return {
        bar: 'bg-[#15803D]',
        text: 'text-[#15803D] dark:text-[#4ADE80]',
        label: remaining > 0 ? `En presupuesto · quedan ${formatEUR(remaining)}` : 'En presupuesto',
      };
    case 'ambar':
      return {
        bar: 'bg-amber-500',
        text: 'text-amber-800 dark:text-amber-300',
        label:
          Math.abs(remaining) < 0.005
            ? 'En el límite'
            : `Cerca del límite · quedan ${formatEUR(remaining)}`,
      };
    case 'rojo':
      return {
        bar: 'bg-[#B42318]',
        text: 'text-[#B42318] dark:text-[#FCA5A5]',
        label: `Superado por ${formatEUR(roundCents(bp.spent - bp.limit))}`,
      };
    default:
      return {
        bar: 'bg-slate-400',
        text: 'text-slate-500 dark:text-slate-400',
        label: 'Sin límite',
      };
  }
}

interface BudgetProgressCardProps {
  budgetProgress: CategoryBudgetProgress[];
  isClosed: boolean;
  onOpenBudgetEditor: () => void;
}

export const BudgetProgressCard: React.FC<BudgetProgressCardProps> = ({
  budgetProgress,
  isClosed,
  onOpenBudgetEditor,
}) => {
  return (
    <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Presupuesto vs real</h2>
        {!isClosed && (
          <button
            type="button"
            onClick={onOpenBudgetEditor}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Editar límites</span>
          </button>
        )}
      </div>

      {budgetProgress.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Define límites mensuales por categoría para activar el semáforo de control.
        </p>
      ) : (
        <div className="space-y-3.5">
          {budgetProgress.map((bp) => {
            const hasLimit = bp.hasLimit ?? bp.limit > 0;
            const badge = statusBadge(bp);
            const barWidth = hasLimit ? Math.min(100, bp.pct) : 0;
            return (
              <div key={bp.category} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs gap-2">
                  <CategoryTag category={bp.category} size="xs" />
                  <span className="tabular-nums">
                    <strong>{formatEUR(bp.spent)}</strong>
                    {hasLimit ? ` / ${formatEUR(bp.limit)}` : ''}
                  </span>
                </div>
                {hasLimit && (
                  <>
                    <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${badge.bar}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className={`font-medium ${badge.text}`}>{badge.label}</span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">
                        {bp.limit === 0 ? (bp.spent > 0 ? 'Superado' : '0%') : `${bp.pct}%`}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

interface CategoryComparisonSectionProps {
  selectedMonthKey: string;
  categoryComparison: CategoryComparisonResult;
}

export const CategoryComparisonSection: React.FC<CategoryComparisonSectionProps> = ({
  selectedMonthKey,
  categoryComparison,
}) => {
  const renderDelta = (
    pct: number | null,
    dir: ComparisonDirection,
    hasBaseline: boolean,
    alignRight = false
  ) => {
    if (!hasBaseline) {
      return <span className="text-[11px] text-slate-500 dark:text-slate-400">Sin datos</span>;
    }
    const color =
      dir === 'up'
        ? 'text-[#B42318] dark:text-[#FCA5A5]'
        : dir === 'down'
          ? 'text-[#15803D] dark:text-[#4ADE80]'
          : 'text-slate-500 dark:text-slate-400';
    return (
      <span
        className={`inline-flex items-center ${
          alignRight ? 'justify-end gap-1' : 'gap-0.5 text-xs'
        } font-bold tabular-nums ${color}`}
      >
        {dir === 'up' ? (
          <TrendingUp className="w-3.5 h-3.5" />
        ) : dir === 'down' ? (
          <TrendingDown className="w-3.5 h-3.5" />
        ) : (
          <Minus className="w-3.5 h-3.5" />
        )}
        <span>
          {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '='}{' '}
          {pct === null ? 'Nuevo' : `${pct > 0 ? '+' : ''}${formatPctES(pct)}`}
        </span>
      </span>
    );
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold">Comparativa por categoría</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {formatMonthLabelES(selectedMonthKey)} frente a{' '}
            {formatMonthLabelES(shiftMonthKey(selectedMonthKey, -1))} y media de{' '}
            {categoryComparison.activePriorMonths > 0
              ? `${categoryComparison.activePriorMonths} ${
                  categoryComparison.activePriorMonths === 1 ? 'mes previo' : 'meses previos'
                } (máx. 6)`
              : '6 meses'}
            . Excluye gastos personales y liquidaciones.
          </p>
        </div>
      </div>

      {categoryComparison.rows.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No hay gastos compartidos en este periodo para comparar categorías.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {categoryComparison.rows.map((row) => (
              <div
                key={row.category}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <CategoryTag category={row.category} size="xs" />
                  <span className="font-mono-num text-sm font-bold">{formatEUR(row.current)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ant. ({formatEUR(row.prev)})
                    </p>
                    {renderDelta(row.vsPrevPct, row.vsPrevDir, true)}
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Media 6m ({formatEUR(row.avg6)})
                    </p>
                    {renderDelta(
                      row.vsAvg6Pct,
                      row.vsAvg6Dir,
                      categoryComparison.activePriorMonths > 0
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Categoría</th>
                  <th className="py-2 pr-3 font-semibold text-right">Este mes</th>
                  <th className="py-2 pr-3 font-semibold text-right">Mes anterior</th>
                  <th className="py-2 pr-3 font-semibold text-right">Vs anterior</th>
                  <th className="py-2 pr-3 font-semibold text-right">Media 6 m.</th>
                  <th className="py-2 font-semibold text-right">Vs media 6 m.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {categoryComparison.rows.map((row) => (
                  <tr key={row.category}>
                    <td className="py-2.5 pr-3">
                      <CategoryTag category={row.category} size="xs" />
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono-num font-bold">
                      {formatEUR(row.current)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono-num text-slate-500 dark:text-slate-400">
                      {formatEUR(row.prev)}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                      {renderDelta(row.vsPrevPct, row.vsPrevDir, true, true)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono-num text-slate-500 dark:text-slate-400">
                      {categoryComparison.activePriorMonths > 0 ? formatEUR(row.avg6) : '—'}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {renderDelta(
                        row.vsAvg6Pct,
                        row.vsAvg6Dir,
                        categoryComparison.activePriorMonths > 0,
                        true
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
