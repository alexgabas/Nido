import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const PWA_BANNER_DISMISSED_KEY = 'nido_pwa_banner_dismissed_v1';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PWA_BANNER_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || dismissed) return null;
  if (!isInstallable && !isIOS) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(PWA_BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage error
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label="Instalar Nido en el dispositivo"
        className="bg-[#0E5A64]/8 dark:bg-[#2AA1AE]/12 border-b border-[#0E5A64]/20 px-4 py-2 text-xs text-[#0F1F24] dark:text-[#F0F5F6]"
      >
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Smartphone className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
            <span className="font-medium">
              Instala Nido en tu pantalla de inicio para abrirla al instante y usarla sin cobertura.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isInstallable ? (
              <button
                type="button"
                onClick={() => void install()}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white font-bold inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Instalar app</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowIOSGuide(true)}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white font-bold inline-flex items-center gap-1.5"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Instalar en iPhone</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Ahora no"
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Ahora no</span>
            </button>
          </div>
        </div>
      </div>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-banner-ios-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 id="pwa-banner-ios-title" className="font-display text-base font-bold">
              Instalar Nido en iPhone / iPad
            </h3>
            <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside">
              <li>Pulsa el botón <strong>Compartir</strong> en Safari.</li>
              <li>Desliza y elige <strong>Añadir a pantalla de inicio</strong>.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
