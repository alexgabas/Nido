import React from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { formatEUR } from '../../domain/finance';
import {
  applyPaycheckPreset,
  computeMemberIncomeSummary,
  MAX_EXTRA_PAYCHECKS,
  MAX_ORDINARY_PAY_COUNT,
  MAX_OTHER_INCOMES,
  OTHER_INCOME_FREQUENCY_LABELS,
  OTHER_INCOME_KIND_LABELS,
  SPANISH_MONTH_OPTIONS,
} from '../../domain/incomeProfile';
import type {
  ExtraPaycheckItem,
  MemberIncomeMode,
  MemberIncomeProfile,
  OtherIncomeFrequency,
  OtherIncomeItem,
  OtherIncomeKind,
} from '../../types/nido';

interface DetailedIncomeEditorProps {
  memberKey: 'a' | 'b';
  memberName: string;
  profile: MemberIncomeProfile;
  onChange: (next: MemberIncomeProfile) => void;
}

function parseNonNegDecimal(raw: string): number {
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function numToInputStr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}

export const DetailedIncomeEditor: React.FC<DetailedIncomeEditorProps> = ({
  memberKey,
  memberName,
  profile,
  onChange,
}) => {
  const summary = computeMemberIncomeSummary(profile, profile.quickMonthlyNet);
  const inputIdPrefix = `income-${memberKey}`;

  const handleModeChange = (mode: MemberIncomeMode) => {
    if (mode === profile.mode) return;
    if (mode === 'detallada') {
      const seedAmount =
        profile.ordinaryPayAmount > 0 ? profile.ordinaryPayAmount : profile.quickMonthlyNet;
      onChange({
        ...profile,
        mode: 'detallada',
        ordinaryPayAmount: seedAmount,
        ordinaryPayCount: profile.ordinaryPayCount > 0 ? profile.ordinaryPayCount : 12,
      });
    } else {
      onChange({
        ...profile,
        mode: 'rapida',
        quickMonthlyNet:
          profile.quickMonthlyNet > 0
            ? profile.quickMonthlyNet
            : summary.monthlyAverageEquivalent,
      });
    }
  };

  const handleAddExtra = () => {
    if (profile.extraPaychecks.length >= MAX_EXTRA_PAYCHECKS) return;
    const idx = profile.extraPaychecks.length + 1;
    const defaultLabel =
      idx === 1 ? 'Paga extra verano' : idx === 2 ? 'Paga extra Navidad' : `Paga extra ${idx}`;
    const defaultMonth = idx === 1 ? 6 : idx === 2 ? 12 : null;
    const nextExtra: ExtraPaycheckItem = {
      id: `extra_${Date.now().toString(36)}_${idx}`,
      label: defaultLabel,
      amount: profile.ordinaryPayAmount > 0 ? profile.ordinaryPayAmount : 0,
      expectedMonth: defaultMonth,
    };
    onChange({
      ...profile,
      extraPaychecks: [...profile.extraPaychecks, nextExtra],
    });
  };

  const handleUpdateExtra = (id: string, patch: Partial<ExtraPaycheckItem>) => {
    onChange({
      ...profile,
      extraPaychecks: profile.extraPaychecks.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    });
  };

  const handleRemoveExtra = (id: string) => {
    onChange({
      ...profile,
      extraPaychecks: profile.extraPaychecks.filter((item) => item.id !== id),
    });
  };

  const handleAddOther = () => {
    if (profile.otherIncomes.length >= MAX_OTHER_INCOMES) return;
    const idx = profile.otherIncomes.length + 1;
    const nextOther: OtherIncomeItem = {
      id: `other_${Date.now().toString(36)}_${idx}`,
      concept: '',
      amount: 0,
      frequency: 'anual',
      kind: 'puntual_o_incierto',
      includeInAnnualEstimate: false,
    };
    onChange({
      ...profile,
      otherIncomes: [...profile.otherIncomes, nextOther],
    });
  };

  const handleUpdateOther = (id: string, patch: Partial<OtherIncomeItem>) => {
    onChange({
      ...profile,
      otherIncomes: profile.otherIncomes.map((item) => {
        if (item.id !== id) return item;
        const next: OtherIncomeItem = { ...item, ...patch };
        if (patch.kind && patch.includeInAnnualEstimate === undefined) {
          next.includeInAnnualEstimate = patch.kind === 'recurrente';
        }
        return next;
      }),
    });
  };

  const handleRemoveOther = (id: string) => {
    onChange({
      ...profile,
      otherIncomes: profile.otherIncomes.filter((item) => item.id !== id),
    });
  };

  return (
    <div
      data-testid={`income-editor-${memberKey}`}
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F9FBFC] dark:bg-slate-900/50 p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6]">{memberName}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Importes netos introducidos por ti (sin cálculo fiscal).
          </p>
        </div>

        <div
          role="group"
          aria-label={`Modo de ingresos de ${memberName}`}
          className="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-800 p-0.5"
        >
          <button
            type="button"
            onClick={() => handleModeChange('rapida')}
            aria-pressed={profile.mode === 'rapida'}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
              profile.mode === 'rapida'
                ? 'bg-white dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4] shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Rápida
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('detallada')}
            aria-pressed={profile.mode === 'detallada'}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
              profile.mode === 'detallada'
                ? 'bg-white dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4] shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Detallada
          </button>
        </div>
      </div>

      {profile.mode === 'rapida' ? (
        <div className="space-y-1.5">
          <label htmlFor={inputIdPrefix} className="block text-xs font-medium">
            Ingreso neto mensual · {memberName} (€)
          </label>
          <input
            id={inputIdPrefix}
            type="text"
            inputMode="decimal"
            defaultValue={numToInputStr(profile.quickMonthlyNet)}
            key={`${inputIdPrefix}-quick-${profile.mode}`}
            onChange={(e) =>
              onChange({
                ...profile,
                quickMonthlyNet: parseNonNegDecimal(e.target.value),
              })
            }
            placeholder="Ej. 1800"
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-base font-semibold"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Estimación anual: <strong>{formatEUR(summary.estimatedAnnualNet)}</strong> · Si tienes
            pagas extra no prorrateadas o ingresos variables, cambia a «Detallada».
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* Atajos anti doble cómputo */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Plantilla rápida:
            </span>
            <button
              type="button"
              onClick={() => onChange(applyPaycheckPreset(profile, '12_prorrateadas'))}
              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-[#0E5A64]"
            >
              12 pagas (extras prorrateadas)
            </button>
            <button
              type="button"
              onClick={() => onChange(applyPaycheckPreset(profile, '14_pagas'))}
              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-[#0E5A64]"
            >
              14 pagas (12 ordinarias + 2 extras)
            </button>
          </div>

          {/* Nómina ordinaria */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${inputIdPrefix}-ordinary-amount`}
                className="block text-xs font-medium mb-1"
              >
                Importe neto de 1 paga ordinaria (€)
              </label>
              <input
                id={`${inputIdPrefix}-ordinary-amount`}
                type="number"
                min={0}
                step="0.01"
                value={profile.ordinaryPayAmount === 0 ? '' : profile.ordinaryPayAmount}
                onChange={(e) =>
                  onChange({
                    ...profile,
                    ordinaryPayAmount: parseNonNegDecimal(e.target.value),
                  })
                }
                placeholder="Ej. 1500"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm font-semibold"
              />
            </div>
            <div>
              <label
                htmlFor={`${inputIdPrefix}-ordinary-count`}
                className="block text-xs font-medium mb-1"
              >
                Pagas ordinarias al año
              </label>
              <input
                id={`${inputIdPrefix}-ordinary-count`}
                type="number"
                min={0}
                max={MAX_ORDINARY_PAY_COUNT}
                step={1}
                value={profile.ordinaryPayCount}
                onChange={(e) => {
                  const n = Math.max(
                    0,
                    Math.min(MAX_ORDINARY_PAY_COUNT, Math.round(Number(e.target.value) || 0))
                  );
                  onChange({ ...profile, ordinaryPayCount: n });
                }}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm font-semibold"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Habitual: 12 (si cobras 14 pagas, pon 12 aquí y añade 2 pagas extra abajo).
              </p>
            </div>
          </div>

          {/* Avisos anti doble cómputo */}
          {summary.warnings.map((w, idx) => (
            <div
              key={idx}
              role="alert"
              className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <span>{w}</span>
            </div>
          ))}

          {/* Pagas extra */}
          <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Pagas extra ({profile.extraPaychecks.length})
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Solo si NO están ya prorrateadas en tu paga ordinaria. Admite importes distintos.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddExtra}
                disabled={profile.extraPaychecks.length >= MAX_EXTRA_PAYCHECKS}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1 disabled:opacity-40 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Añadir paga extra</span>
              </button>
            </div>

            {profile.extraPaychecks.length > 0 && (
              <div className="space-y-2">
                {profile.extraPaychecks.map((extra, idx) => (
                  <div
                    key={extra.id}
                    className="grid grid-cols-12 gap-2 items-end rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-700 p-2.5"
                  >
                    <div className="col-span-12 sm:col-span-5">
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                        Etiqueta
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        aria-label={`Nombre paga extra ${idx + 1} de ${memberName}`}
                        value={extra.label}
                        onChange={(e) => handleUpdateExtra(extra.id, { label: e.target.value })}
                        placeholder="Ej. Paga extra verano"
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-3">
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                        Neto (€)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Importe neto paga extra ${idx + 1} de ${memberName}`}
                        value={extra.amount === 0 ? '' : extra.amount}
                        onChange={(e) =>
                          handleUpdateExtra(extra.id, {
                            amount: parseNonNegDecimal(e.target.value),
                          })
                        }
                        placeholder="1500"
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xs font-semibold"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                        Mes (opc.)
                      </label>
                      <select
                        aria-label={`Mes orientativo paga extra ${idx + 1} de ${memberName}`}
                        value={extra.expectedMonth ?? ''}
                        onChange={(e) =>
                          handleUpdateExtra(extra.id, {
                            expectedMonth: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full min-h-[40px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      >
                        <option value="">Sin mes</option>
                        {SPANISH_MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveExtra(extra.id)}
                        aria-label={`Eliminar ${extra.label}`}
                        className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[#B42318] flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Otros ingresos */}
          <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Otros ingresos ({profile.otherIncomes.length})
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Los puntuales o inciertos NO cuentan por defecto en el reparto habitual salvo que los marques.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddOther}
                disabled={profile.otherIncomes.length >= MAX_OTHER_INCOMES}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1 disabled:opacity-40 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Añadir otro ingreso</span>
              </button>
            </div>

            {profile.otherIncomes.length > 0 && (
              <div className="space-y-2">
                {profile.otherIncomes.map((item, idx) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-700 p-2.5 space-y-2"
                  >
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                          Concepto
                        </label>
                        <input
                          type="text"
                          maxLength={80}
                          aria-label={`Concepto otro ingreso ${idx + 1} de ${memberName}`}
                          value={item.concept}
                          onChange={(e) =>
                            handleUpdateOther(item.id, { concept: e.target.value })
                          }
                          placeholder="Ej. Bonus, alquiler, clases"
                          className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                          Neto (€)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Importe otro ingreso ${idx + 1} de ${memberName}`}
                          value={item.amount === 0 ? '' : item.amount}
                          onChange={(e) =>
                            handleUpdateOther(item.id, {
                              amount: parseNonNegDecimal(e.target.value),
                            })
                          }
                          placeholder="300"
                          className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-xs font-semibold"
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                          Frecuencia
                        </label>
                        <select
                          aria-label={`Frecuencia otro ingreso ${idx + 1} de ${memberName}`}
                          value={item.frequency}
                          onChange={(e) =>
                            handleUpdateOther(item.id, {
                              frequency: e.target.value as OtherIncomeFrequency,
                            })
                          }
                          className="w-full min-h-[40px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {(Object.keys(OTHER_INCOME_FREQUENCY_LABELS) as OtherIncomeFrequency[]).map(
                            (freq) => (
                              <option key={freq} value={freq}>
                                {OTHER_INCOME_FREQUENCY_LABELS[freq]}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      <div className="col-span-10 sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                          Tipo
                        </label>
                        <select
                          aria-label={`Tipo otro ingreso ${idx + 1} de ${memberName}`}
                          value={item.kind}
                          onChange={(e) =>
                            handleUpdateOther(item.id, {
                              kind: e.target.value as OtherIncomeKind,
                            })
                          }
                          className="w-full min-h-[40px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {(Object.keys(OTHER_INCOME_KIND_LABELS) as OtherIncomeKind[]).map((k) => (
                            <option key={k} value={k}>
                              {OTHER_INCOME_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveOther(item.id)}
                          aria-label={`Eliminar otro ingreso ${item.concept || idx + 1}`}
                          className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-[#B42318] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer min-h-[36px]">
                      <input
                        type="checkbox"
                        checked={item.includeInAnnualEstimate}
                        onChange={(e) =>
                          handleUpdateOther(item.id, {
                            includeInAnnualEstimate: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-[#0E5A64]"
                      />
                      <span>
                        Incluir en la estimación anual y reparto
                        {!item.includeInAnnualEstimate && item.kind === 'puntual_o_incierto'
                          ? ' (excluido por defecto por ser puntual/incierto)'
                          : ''}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desglose anual y equivalente mensual promedio */}
          <div className="rounded-xl bg-white dark:bg-[#132025] border border-[#0E5A64]/25 p-3 space-y-1.5 text-xs tabular-nums">
            <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
              <span>
                Pagas ordinarias ({profile.ordinaryPayCount} × {formatEUR(profile.ordinaryPayAmount)})
              </span>
              <span className="font-semibold">{formatEUR(summary.ordinaryAnnual)}</span>
            </div>
            {summary.extrasAnnual > 0 && (
              <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span>Pagas extra</span>
                <span className="font-semibold">{formatEUR(summary.extrasAnnual)}</span>
              </div>
            )}
            {summary.otherRecurringAnnual > 0 && (
              <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span>Otros ingresos recurrentes incluidos</span>
                <span className="font-semibold">{formatEUR(summary.otherRecurringAnnual)}</span>
              </div>
            )}
            {summary.otherUncertainIncludedAnnual > 0 && (
              <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span>Otros puntuales/inciertos incluidos</span>
                <span className="font-semibold">
                  {formatEUR(summary.otherUncertainIncludedAnnual)}
                </span>
              </div>
            )}
            <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex justify-between gap-2 font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
              <span>Neto anual estimado</span>
              <span>{formatEUR(summary.estimatedAnnualNet)}</span>
            </div>
            <div className="flex justify-between gap-2 font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
              <span>Equivalente mensual (promedio / 12)</span>
              <span>{formatEUR(summary.monthlyAverageEquivalent)}/mes</span>
            </div>
            {summary.excludedUncertainCount > 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                Excluidos del reparto por ser puntuales/inciertos:{' '}
                {formatEUR(summary.otherUncertainExcludedAnnual)}/año ({summary.excludedUncertainCount}{' '}
                {summary.excludedUncertainCount === 1 ? 'partida' : 'partidas'}).
              </p>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
              Promedio orientativo para el reparto proporcional (no es tu ingreso bancario de cada
              mes). Un mes con paga extra no cambia el reparto habitual automáticamente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
