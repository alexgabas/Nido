import React from 'react';
import { AlertCircle, CalendarClock, CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  formatEUR,
  formatMonthLabelES,
  isRecurringTemplatePending,
  monthlyEquivalent,
} from '../../domain/finance';
import { FREQUENCY_LABELS } from '../../domain/presets';
import {
  isRecurringMissingStartMonth,
  isValidMonthKey,
  partitionRecurringTemplates,
} from '../../domain/recurrence';
import { COMMON_ACCOUNT_ID, type RecurringExpense } from '../../types/nido';
import { CategoryTag } from '../CategoryTag';

interface RecurringTemplatesSectionProps {
  sectionRef: React.RefObject<HTMLElement | null>;
  recurring: RecurringExpense[];
  memberLabel: (uid: string) => string;
  onOpenHabitualModal: () => void;
  onOpenRecModal: (rec: RecurringExpense | null, activateOnOpen?: boolean) => void;
  onOpenIcsModal: () => void;
  onDeleteRequest: (rec: RecurringExpense) => void;
}

export const RecurringTemplatesSection: React.FC<RecurringTemplatesSectionProps> = ({
  sectionRef,
  recurring,
  memberLabel,
  onOpenHabitualModal,
  onOpenRecModal,
  onOpenIcsModal,
  onDeleteRequest,
}) => {
  const {
    activeTemplates,
    pendingTemplates,
    pendingConfigCount,
    unanchoredPeriodicCount,
  } = partitionRecurringTemplates(recurring);

  return (
    <section
      ref={sectionRef}
      id="plantillas-section"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4 scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
          <h2 className="font-display text-base font-bold">Plantillas periódicas</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenIcsModal}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <CalendarPlus className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <span>Exportar (.ics)</span>
          </button>
          <button
            type="button"
            onClick={onOpenHabitualModal}
            className="min-h-[44px] px-3.5 rounded-xl border border-[#0E5A64]/30 dark:border-[#2AA1AE]/40 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#0E5A64]/5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Añadir gastos habituales</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenRecModal(null)}
            className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Plantilla</span>
          </button>
        </div>
      </div>

      {recurring.length === 0 ? (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4 space-y-2">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Añade alquiler, luz, agua o seguros para generar el mes en un toque y tener previsión real.
          </p>
          <button
            type="button"
            onClick={onOpenHabitualModal}
            className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Explorar catálogo habitual</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {unanchoredPeriodicCount > 0 && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300/70 dark:border-amber-700/60 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Tienes <strong>{unanchoredPeriodicCount}</strong>{' '}
                {unanchoredPeriodicCount === 1
                  ? 'plantilla periódica sin mes de referencia'
                  : 'plantillas periódicas sin mes de referencia'}
                . Edítala para confirmar su mes de inicio y calcular exactamente cuándo toca.
              </span>
            </div>
          )}

          {pendingConfigCount > 0 && (
            <div className="rounded-xl bg-[#0E5A64]/6 dark:bg-[#2AA1AE]/10 border border-[#0E5A64]/20 px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-200">
              Tenéis <strong>{pendingConfigCount}</strong>{' '}
              {pendingConfigCount === 1
                ? 'gasto habitual pendiente de configurar'
                : 'gastos habituales pendientes de configurar'}
              . Añade su importe y actívalo para incluirlo en previsiones y recordatorios.
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Activas ({activeTemplates.length})
            </h3>
            {activeTemplates.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ninguna plantilla activa todavía. Configura alguna de las pendientes o crea una nueva.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeTemplates.map((rec) => {
                  const equiv = monthlyEquivalent(rec.amount, rec.frequency);
                  const missingRef = isRecurringMissingStartMonth(rec);
                  return (
                    <li
                      key={rec.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CategoryTag category={rec.category} size="xs" />
                          <p className="text-sm font-semibold truncate">
                            Día {rec.dayOfMonth} · {rec.concept}
                          </p>
                          {missingRef && (
                            <button
                              type="button"
                              onClick={() => onOpenRecModal(rec)}
                              className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-[10px] font-bold hover:underline"
                            >
                              Confirmar mes de referencia
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {FREQUENCY_LABELS[rec.frequency]} ·{' '}
                          {memberLabel(rec.paidByDefault)}
                          {rec.frequency !== 'mensual'
                            ? ` · Equiv. mensual: ${formatEUR(equiv)}`
                            : ''}
                          {rec.startMonth && isValidMonthKey(rec.startMonth)
                            ? ` · Base: ${formatMonthLabelES(rec.startMonth)}`
                            : ''}
                          {rec.splitOverride !== null &&
                          rec.splitOverride !== undefined &&
                          rec.paidByDefault !== COMMON_ACCOUNT_ID
                            ? ` · Reparto ${rec.splitOverride}/${Math.round((100 - rec.splitOverride) * 10) / 10}%`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-mono-num text-xs font-bold">
                          {formatEUR(rec.amount)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Editar plantilla ${rec.concept}`}
                          onClick={() => onOpenRecModal(rec)}
                          className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar plantilla ${rec.concept}`}
                          onClick={() => onDeleteRequest(rec)}
                          className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {pendingTemplates.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Pendientes de configurar ({pendingTemplates.length})
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {pendingTemplates.map((rec) => {
                  const isPendingSeed = isRecurringTemplatePending(rec);
                  return (
                    <li
                      key={rec.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CategoryTag category={rec.category} size="xs" />
                          <p className="text-sm font-semibold truncate text-slate-700 dark:text-slate-200">
                            {rec.concept}
                          </p>
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-[10px] font-semibold">
                            {isPendingSeed ? 'Pendiente de configurar' : 'Inactiva'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {FREQUENCY_LABELS[rec.frequency]}
                          {rec.amount > 0 ? ` · ${formatEUR(rec.amount)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenRecModal(rec, isPendingSeed)}
                          className="min-h-[44px] px-3 rounded-lg bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-semibold hover:bg-[#0E5A64]/15"
                        >
                          Configurar
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar plantilla ${rec.concept}`}
                          onClick={() => onDeleteRequest(rec)}
                          className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
