import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const PWAUpdateBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#0E5A64] text-white px-4 py-2.5 border-b border-[#0A464E]"
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <span className="font-medium">
          Hay una actualización disponible de Nido con mejoras y correcciones.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="min-h-[44px] px-3.5 rounded-xl bg-white text-[#0E5A64] font-bold text-xs inline-flex items-center gap-1.5 hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recargar</span>
          </button>
          <button
            type="button"
            aria-label="Cerrar aviso de actualización"
            onClick={() => {
              setDismissed(true);
              setNeedRefresh(false);
            }}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-white/90 hover:bg-white/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
