import React, { useMemo, useState } from 'react';
import { AlertCircle, CalendarPlus, Download, X } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import { downloadTextFile } from '../../domain/backup';
import { formatMonthLabelES } from '../../domain/finance';
import {
  buildRecurringIcsCalendar,
  type IcsAlarmDaysBefore,
  type IcsHorizonMonths,
} from '../../domain/icsExport';
import type { RecurringExpense } from '../../types/nido';

interface RecurringIcsModalProps {
  open: boolean;
  onClose: () => void;
  householdName: string;
  fromMonthKey: string;
  recurring: RecurringExpense[];
  onDownloaded: (count: number) => void;
}

export const RecurringIcsModal: React.FC<RecurringIcsModalProps> = ({
  open,
  onClose,
  householdName,
  fromMonthKey,
  recurring,
  onDownloaded,
}) => {
  const { categoryRegistry } = useNido();
  const [horizon, setHorizon] = useState<IcsHorizonMonths>(3);
  const [alarmDays, setAlarmDays] = useState<IcsAlarmDaysBefore>(1);

  const preview = useMemo(
    () =>
      buildRecurringIcsCalendar({
        householdName,
        recurring,
        fromMonthKey,
        monthsHorizon: horizon,
        alarmDaysBefore: alarmDays,
        categoryLabels: categoryRegistry.labelsMap,
      }),
    [householdName, recurring, fromMonthKey, horizon, alarmDays, categoryRegistry.labelsMap]
  );

  if (!open) return null;

  const handleDownload = () => {
    if (preview.eventsCount === 0) return;
    downloadTextFile(preview.filename, preview.icsContent, 'text/calendar;charset=utf-8;');
    onDownloaded(preview.eventsCount);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ics-modal-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
              <CalendarPlus className="w-5 h-5" />
            </span>
            <div>
              <h2 id="ics-modal-title" className="font-display text-lg font-bold">
                Exportar al calendario (.ics)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Desde {formatMonthLabelES(fromMonthKey)} · Sin suscripciones ni servidores externos
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar exportación de calendario"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              Horizonte a exportar
            </span>
            <div className="grid grid-cols-3 gap-2">
              {([1, 3, 6] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setHorizon(m)}
                  className={`min-h-[44px] rounded-xl text-xs font-bold border transition-colors ${
                    horizon === m
                      ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {m === 1 ? '1 mes' : `${m} meses`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              Recordatorio sugerido en el archivo
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 0, label: 'Mismo día' },
                  { value: 1, label: '1 día antes' },
                  { value: 2, label: '2 días antes' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAlarmDays(opt.value)}
                  className={`min-h-[44px] rounded-xl text-xs font-bold border transition-colors ${
                    alarmDays === opt.value
                      ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5 text-xs">
          <p className="font-semibold text-[#0F1F24] dark:text-[#F0F5F6]">
            {preview.eventsCount > 0
              ? `Se generarán ${preview.eventsCount} evento${preview.eventsCount === 1 ? '' : 's'} de cobros previstos.`
              : 'No hay cobros periódicos activos con fecha confirmada en este horizonte.'}
          </p>
          {preview.skippedUnanchoredCount > 0 && (
            <p className="text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Se omiten {preview.skippedUnanchoredCount} plantillas periódicas sin mes de referencia confirmado.
              </span>
            </p>
          )}
        </div>

        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 p-3 text-[11px] text-amber-950 dark:text-amber-100 space-y-1">
          <p className="font-semibold">Cómo funciona esta exportación:</p>
          <p>
            Es una foto estática puntual: si más adelante editas o borras una plantilla en Nido, los cambios no se propagarán automáticamente al archivo importado.
          </p>
          <p>
            Cada app de calendario (Google Calendar, Apple Calendar, Outlook) decide cómo aplicar las alertas de eventos de todo el día según tus ajustes.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={preview.eventsCount === 0}
            onClick={handleDownload}
            className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Descargar .ics</span>
          </button>
        </div>
      </div>
    </div>
  );
};
