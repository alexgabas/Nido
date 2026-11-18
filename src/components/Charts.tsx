import React from 'react';
import { formatEUR } from '../domain/finance';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export const DonutChart: React.FC<{
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
}> = ({ slices, centerLabel, centerValue }) => {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-36 h-36 shrink-0">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" aria-label={centerLabel}>
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="16"
            className="text-slate-100 dark:text-slate-800"
          />
          {total > 0 &&
            slices.map((s) => {
              if (s.value <= 0) return null;
              const fraction = s.value / total;
              const dashLength = fraction * circumference;
              const offset = -accumulated * circumference;
              accumulated += fraction;
              return (
                <circle
                  key={s.label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="16"
                  strokeDasharray={`${dashLength} ${circumference}`}
                  strokeDashoffset={offset}
                  className="transition-all duration-500"
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{centerLabel}</span>
          <span className="text-sm font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {centerValue}
          </span>
        </div>
      </div>
      <div className="flex-1 w-full space-y-2">
        {slices.filter((s) => s.value > 0).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Sin datos todavía.</p>
        ) : (
          slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="truncate text-slate-700 dark:text-slate-200">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 tabular-nums">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{pct}%</span>
                    <span className="font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
                      {formatEUR(s.value)}
                    </span>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
};

export interface BarDatum {
  label: string;
  value: number;
  highlight?: boolean;
}

export const MonthlyBarChart: React.FC<{ data: BarDatum[] }> = ({ data }) => {
  const maxVal = Math.max(100, ...data.map((d) => d.value));

  return (
    <div className="w-full">
      <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-44 pt-4">
        {data.map((d) => {
          const heightPct = Math.max(4, Math.round((d.value / maxVal) * 100));
          return (
            <div key={d.label} className="flex flex-col items-center justify-end h-full gap-1.5 group">
              <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {d.value > 0 ? `${Math.round(d.value)}€` : ''}
              </span>
              <div className="w-full flex-1 flex items-end">
                <div
                  title={`${d.label}: ${formatEUR(d.value)}`}
                  style={{ height: `${heightPct}%` }}
                  className={`w-full rounded-t-md transition-all duration-300 ${
                    d.highlight
                      ? 'bg-[#0E5A64] dark:bg-[#2AA1AE]'
                      : d.value > 0
                        ? 'bg-[#0E5A64]/35 dark:bg-[#2AA1AE]/35 hover:bg-[#0E5A64]/65'
                        : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              </div>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 capitalize">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
