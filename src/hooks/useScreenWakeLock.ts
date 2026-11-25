import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener: (type: 'release', listener: () => void) => void;
}

interface WakeLockCapableNavigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

export interface UseScreenWakeLockResult {
  supported: boolean;
  active: boolean;
  statusMessage: string | null;
}

export function isScreenWakeLockSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as unknown as WakeLockCapableNavigator;
  return Boolean(nav.wakeLock && typeof nav.wakeLock.request === 'function');
}

/**
 * Solicita Screen Wake Lock únicamente cuando `enabled` es true y la vista está visible.
 * Libera el bloqueo al desactivar, al salir de la pantalla o al desmontar el componente,
 * y reintenta al volver a primer plano si sigue habilitado.
 */
export function useScreenWakeLock(enabled: boolean): UseScreenWakeLockResult {
  const supported = isScreenWakeLockSupported();
  const [active, setActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const mountedRef = useRef(true);

  const releaseCurrent = useCallback(async () => {
    const current = sentinelRef.current;
    sentinelRef.current = null;
    if (current && !current.released) {
      try {
        await current.release();
      } catch {
        // Ignore release errors when browser already released it
      }
    }
    if (mountedRef.current) {
      setActive(false);
    }
  }, []);

  const acquire = useCallback(async () => {
    if (!supported) {
      if (mountedRef.current) {
        setActive(false);
        setStatusMessage('Tu navegador no permite mantener la pantalla encendida automáticamente.');
      }
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    if (sentinelRef.current && !sentinelRef.current.released) {
      if (mountedRef.current) {
        setActive(true);
        setStatusMessage(null);
      }
      return;
    }

    try {
      const nav = navigator as unknown as WakeLockCapableNavigator;
      const sentinel = await nav.wakeLock!.request('screen');
      if (!mountedRef.current) {
        try {
          await sentinel.release();
        } catch {
          // ignore
        }
        return;
      }
      const handleRelease = () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
        if (mountedRef.current) {
          setActive(false);
        }
      };
      sentinel.addEventListener('release', handleRelease);
      sentinelRef.current = sentinel;
      setActive(true);
      setStatusMessage(null);
    } catch {
      if (mountedRef.current) {
        setActive(false);
        setStatusMessage(
          'El navegador o el ahorro de batería no permitió mantener la pantalla encendida.'
        );
      }
    }
  }, [supported]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void releaseCurrent();
    };
  }, [releaseCurrent]);

  useEffect(() => {
    if (!enabled) {
      setStatusMessage(null);
      void releaseCurrent();
      return;
    }

    void acquire();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      } else {
        void releaseCurrent();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseCurrent();
    };
  }, [enabled, acquire, releaseCurrent]);

  return {
    supported,
    active,
    statusMessage,
  };
}
