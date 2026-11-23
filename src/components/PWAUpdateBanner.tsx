import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  canTriggerSafeChunkReload,
  getPwaReloadBlockStatus,
  recordSafeChunkReloadAttempt,
  subscribePwaGuard,
  type PwaReloadBlockStatus,
} from '../services/pwaUpdateGuard';

export const PWAUpdateBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);
  const [staleChunkDetected, setStaleChunkDetected] = useState(false);
  const [confirmUnsafeReload, setConfirmUnsafeReload] = useState(false);
  const [reloadLoopBlocked, setReloadLoopBlocked] = useState(false);
  const [blockStatus, setBlockStatus] = useState<PwaReloadBlockStatus>(() =>
    getPwaReloadBlockStatus()
  );
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration ?? null;
    },
  });

  // Mantener sincronizado el estado de protección de formularios/escrituras
  useEffect(() => {
    const sync = () => {
      const next = getPwaReloadBlockStatus();
      setBlockStatus(next);
      if (!next.blocked) {
        setConfirmUnsafeReload(false);
      }
    };
    const unsub = subscribePwaGuard(sync);
    const onFocusOrVisibility = () => {
      sync();
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine !== false &&
        registrationRef.current
      ) {
        void registrationRef.current.update().catch(() => {});
      }
    };
    window.addEventListener('focus', onFocusOrVisibility);
    document.addEventListener('visibilitychange', onFocusOrVisibility);
    return () => {
      unsub();
      window.removeEventListener('focus', onFocusOrVisibility);
      document.removeEventListener('visibilitychange', onFocusOrVisibility);
    };
  }, []);

  // Escuchar detección de chunk desfasado (p. ej. tras publicar nueva versión)
  useEffect(() => {
    const onStaleChunk = () => {
      setStaleChunkDetected(true);
      setDismissed(false);
      setReloadLoopBlocked(!canTriggerSafeChunkReload());
      if (navigator.onLine !== false && registrationRef.current) {
        void registrationRef.current.update().catch(() => {});
      }
    };
    window.addEventListener('nido:stale-chunk', onStaleChunk);
    return () => window.removeEventListener('nido:stale-chunk', onStaleChunk);
  }, []);

  // Cuando llega una actualización real de SW, volver a mostrar el aviso
  useEffect(() => {
    if (needRefresh) {
      setDismissed(false);
    }
  }, [needRefresh]);

  const shouldShow = (needRefresh || staleChunkDetected) && !dismissed;
  if (!shouldShow) return null;

  const executeReload = (forceBypassUnsavedForm = false) => {
    const liveBlock = getPwaReloadBlockStatus();
    setBlockStatus(liveBlock);

    if (liveBlock.reason === 'pending_write') {
      setConfirmUnsafeReload(false);
      return;
    }

    if (liveBlock.blocked && !forceBypassUnsavedForm) {
      setConfirmUnsafeReload(true);
      return;
    }

    if (needRefresh) {
      void updateServiceWorker(true);
      return;
    }

    if (!recordSafeChunkReloadAttempt()) {
      setReloadLoopBlocked(true);
      return;
    }
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-banner"
      className="bg-[#0E5A64] text-white px-4 py-2.5 border-b border-[#0A464E]"
    >
      <div className="max-w-6xl mx-auto space-y-2 text-xs sm:text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {staleChunkDetected && !needRefresh
              ? 'Hay una versión más reciente de Nido publicada. Recarga cuando termines de editar.'
              : 'Hay una actualización disponible de Nido. No recargaremos mientras estés editando.'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={blockStatus.reason === 'pending_write' || reloadLoopBlocked}
              onClick={() => executeReload(false)}
              className="min-h-[44px] px-3.5 rounded-xl bg-white text-[#0E5A64] disabled:opacity-50 font-bold text-xs inline-flex items-center gap-1.5 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Recargar</span>
            </button>
            <button
              type="button"
              aria-label="Cerrar aviso de actualización"
              onClick={() => {
                setDismissed(true);
                setConfirmUnsafeReload(false);
                setStaleChunkDetected(false);
                setNeedRefresh(false);
              }}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-white/90 hover:bg-white/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {blockStatus.reason === 'pending_write' && blockStatus.message && (
          <div
            role="alert"
            className="rounded-xl bg-amber-950/40 border border-amber-300/40 px-3 py-2 text-xs text-amber-100 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
            <span>{blockStatus.message}</span>
          </div>
        )}

        {confirmUnsafeReload && blockStatus.reason === 'unsaved_form' && (
          <div
            role="alert"
            className="rounded-xl bg-amber-950/45 border border-amber-300/50 px-3 py-2.5 text-xs text-amber-50 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300 mt-0.5" />
              <span>{blockStatus.message}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmUnsafeReload(false)}
                className="min-h-[44px] px-3 rounded-lg bg-white text-[#0E5A64] font-bold text-xs"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={() => executeReload(true)}
                className="min-h-[44px] px-3 rounded-lg border border-amber-200/70 text-amber-50 font-semibold text-xs hover:bg-white/10"
              >
                Recargar igualmente
              </button>
            </div>
          </div>
        )}

        {reloadLoopBlocked && (
          <div
            role="alert"
            className="rounded-xl bg-amber-950/45 border border-amber-300/50 px-3 py-2 text-xs text-amber-100"
          >
            Ya se intentó recargar hace un momento y el recurso sigue sin estar disponible. Revisa tu
            conexión o vuelve a intentarlo en unos segundos.
          </div>
        )}
      </div>
    </div>
  );
};
