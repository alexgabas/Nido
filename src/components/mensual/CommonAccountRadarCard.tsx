import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Landmark } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import { computeCommonAccountRadar } from '../../domain/commonAccountRadar';
import { formatDateES, formatEUR, getTodayLocalISO } from '../../domain/finance';
import type { RecurringExpense, Transaction, UiMode } from '../../types/nido';
import { CategoryTag } from '../CategoryTag';

interface CommonAccountRadarCardProps {
  monthKey: string;
  transactions: Transaction[];
  recurring: RecurringExpense[];
  uiMode: UiMode;
  effectiveSplitPctA: number;
  shortNameA: string;
  shortNameB: string;
  hasPartner: boolean;
}

export const CommonAccountRadarCard: React.FC<CommonAccountRadarCardProps> = ({
  monthKey,
  transactions,
  recurring,
  uiMode,
  effectiveSplitPctA,
  shortNameA,
  shortNameB,
  hasPartner,
}) => {
  const { householdId } = useNido();
  const storageKey = householdId ? `nido_common_balance_${householdId}` : null;

  const [balanceInput, setBalanceInput] = useState('');

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      setBalanceInput('');
      return;
    }
    try {
      const saved = window.localStorage.getItem(storageKey);
      setBalanceInput(saved ?? '');
    } catch {
      setBalanceInput('');
    }
  }, [storageKey]);

  const handleBalanceChange = (nextVal: string) => {
    setBalanceInput(nextVal);
    if (!storageKey || typeof window === 'undefined') return;
    try {
      if (nextVal.trim() === '') {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, nextVal);
      }
    } catch {
      // Ignore storage errors
    }
  };

  const parsedBalance = useMemo(() => {
    const clean = balanceInput.trim().replace(',', '.');
    if (clean === '') return null;
    const n = Number(clean);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }, [balanceInput]);

  const todayISO = getTodayLocalISO();
  const radar = useMemo(
    () =>
      computeCommonAccountRadar(monthKey, transactions, recurring, effectiveSplitPctA, {
        todayISO,
        currentCommonBalance: parsedBalance,
      }),
    [monthKey, transactions, recurring, effectiveSplitPctA, todayISO, parsedBalance]
  );

  const hasCommonActivity =
    radar.registeredToDateCount > 0 ||
    radar.allPendingItems.length > 0 ||
    radar.unanchoredCommonTemplates.length > 0;

  if (!hasCommonActivity && uiMode === 'sencillo') {
    return null;
  }

  // ─── MODO SENCILLO ──────────────────────────────────────────────────────────
  if (uiMode === 'sencillo') {
    return (
      <section
        aria-label="Previsión cuenta común"
        className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <h2 className="font-display text-base font-bold">Cuenta común este mes</h2>
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {radar.requiredAvailableTotal > 0 ? (
                  <>
                    Conviene tener{' '}
                    <strong className="font-display text-base tabular-nums text-[#0E5A64] dark:text-[#5EEAD4]">
                      {formatEUR(radar.requiredAvailableTotal)}
                    </strong>{' '}
                    disponibles para lo que falta por cobrar.
                  </>
                ) : (
                  'No quedan cargos pendientes en la cuenta común este mes.'
                )}
              </p>
            </div>
          </div>
        </div>

        {radar.next5DaysItems.length > 0 && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-100">
            <strong>En los próximos 5 días:</strong>{' '}
            <span className="tabular-nums font-bold">{formatEUR(radar.next5DaysTotal)}</span> (
            {radar.next5DaysItems.map((it) => `${it.concept} (${formatDateES(it.date)})`).join(', ')})
          </div>
        )}

        {radar.restOfMonthItems.length > 0 && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Resto del mes: <strong className="tabular-nums">{formatEUR(radar.restOfMonthTotal)}</strong>{' '}
            ({radar.restOfMonthItems.length}{' '}
            {radar.restOfMonthItems.length === 1 ? 'cargo previsto' : 'cargos previstos'}).
          </p>
        )}
      </section>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <section
      aria-label="Radar de cuenta común"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <h2 className="font-display text-base font-bold">Radar de cuenta común</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cargos del mes con pagador «Cuenta común». Ya registrado hasta hoy:{' '}
            <strong className="tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
              {formatEUR(radar.registeredToDateTotal)}
            </strong>{' '}
            ({radar.registeredToDateCount}).
          </p>
        </div>

        <div className="rounded-xl bg-[#0E5A64]/8 dark:bg-[#2AA1AE]/12 border border-[#0E5A64]/20 px-4 py-2.5 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0E5A64] dark:text-[#5EEAD4]">
            Importe previsto a tener disponible
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-[#0F1F24] dark:text-[#F0F5F6]">
            {formatEUR(radar.requiredAvailableTotal)}
          </p>
        </div>
      </div>

      {/* Breakdown cards: Next 5 days vs Rest of month + Overdue unregistered */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Próximos 5 días
            </span>
            <span className="font-mono-num text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
              {formatEUR(radar.next5DaysTotal)}
            </span>
          </div>
          {radar.next5DaysItems.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sin cargos comunes en los próximos 5 días.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {radar.next5DaysItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CategoryTag category={it.category} size="xs" />
                    <span className="truncate font-medium">
                      {formatDateES(it.date).slice(0, 5)} · {it.concept}
                    </span>
                  </div>
                  <span className="font-mono-num font-bold shrink-0">{formatEUR(it.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              Resto del mes
            </span>
            <span className="font-mono-num text-sm font-bold">
              {formatEUR(radar.restOfMonthTotal)}
            </span>
          </div>
          {radar.restOfMonthItems.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sin otros cargos previstos este mes.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {radar.restOfMonthItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CategoryTag category={it.category} size="xs" />
                    <span className="truncate font-medium">
                      {formatDateES(it.date).slice(0, 5)} · {it.concept}
                    </span>
                  </div>
                  <span className="font-mono-num font-bold shrink-0">{formatEUR(it.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Optional local common account balance check */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <label
            htmlFor="common-balance-input"
            className="block text-xs font-bold text-slate-600 dark:text-slate-300"
          >
            Saldo actual en cuenta común (opcional)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="common-balance-input"
              type="text"
              inputMode="decimal"
              value={balanceInput}
              onChange={(e) => handleBalanceChange(e.target.value)}
              placeholder="Ej. 1200"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm font-semibold"
            />
            {balanceInput.trim() !== '' && (
              <button
                type="button"
                onClick={() => handleBalanceChange('')}
                className="min-h-[44px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Limpiar
              </button>
            )}
          </div>
          {radar.balanceStatus === 'shortfall' && (
            <p className="text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Faltarían {formatEUR(radar.shortfallAmount)} según el saldo indicado.</span>
            </p>
          )}
          {radar.balanceStatus === 'covered' && (
            <p className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Cubierto con margen de {formatEUR(radar.marginAmount)}.</span>
            </p>
          )}
          {radar.balanceStatus === 'not_provided' && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Solo se guarda en este navegador para comparar cobertura.
            </p>
          )}
        </div>
      </div>

      {radar.overdueUnregisteredItems.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-100">
          <strong>Pendientes de fecha pasada este mes ({formatEUR(radar.overdueUnregisteredTotal)}):</strong>{' '}
          {radar.overdueUnregisteredItems
            .map((it) => `${it.concept} (${formatDateES(it.date)}, ${formatEUR(it.amount)})`)
            .join(' · ')}{' '}
          — incluidos en el total previsto hasta que se registren.
        </div>
      )}

      {radar.requiredAvailableTotal > 0 && hasPartner && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Aportación orientativa según reparto para cubrir lo pendiente:{' '}
          <strong className="tabular-nums">
            {shortNameA} {formatEUR(radar.orientativeShareA)}
          </strong>{' '}
          ·{' '}
          <strong className="tabular-nums">
            {shortNameB} {formatEUR(radar.orientativeShareB)}
          </strong>{' '}
          <span className="text-slate-500 dark:text-slate-400">
            (dato orientativo; no crea deudas ni transferencias en el saldo de pareja).
          </span>
        </p>
      )}
    </section>
  );
};
