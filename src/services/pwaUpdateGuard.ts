import { useEffect } from 'react';

export interface PwaReloadBlockStatus {
  blocked: boolean;
  reason: 'pending_write' | 'unsaved_form' | null;
  message: string | null;
}

const CHUNK_RELOAD_GUARD_KEY = 'nido_chunk_reload_guard_v1';
const CHUNK_RELOAD_WINDOW_MS = 60_000;
const MAX_CHUNK_RELOADS_PER_WINDOW = 1;

let activeEditCount = 0;
let activeWriteCount = 0;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribePwaGuard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function acquirePwaEditLock(): () => void {
  activeEditCount += 1;
  notifyListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeEditCount = Math.max(0, activeEditCount - 1);
    notifyListeners();
  };
}

export function acquirePwaWriteLock(): () => void {
  activeWriteCount += 1;
  notifyListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeWriteCount = Math.max(0, activeWriteCount - 1);
    notifyListeners();
  };
}

export function usePwaUpdateBlock(active: boolean, kind: 'edit' | 'write' = 'edit'): void {
  useEffect(() => {
    if (!active) return;
    return kind === 'write' ? acquirePwaWriteLock() : acquirePwaEditLock();
  }, [active, kind]);
}

function hasActiveBlockingDomForm(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const dialogForms = document.querySelectorAll('[role="dialog"] form');
    if (dialogForms.length > 0) return true;
    const explicitGuards = document.querySelectorAll('[data-pwa-unsaved="true"]');
    if (explicitGuards.length > 0) return true;
  } catch {
    // ignore DOM query errors
  }
  return false;
}

export function getPwaReloadBlockStatus(): PwaReloadBlockStatus {
  if (activeWriteCount > 0) {
    return {
      blocked: true,
      reason: 'pending_write',
      message:
        'Hay una operación guardándose o pendiente de confirmar. Espera a que termine antes de recargar.',
    };
  }
  if (activeEditCount > 0 || hasActiveBlockingDomForm()) {
    return {
      blocked: true,
      reason: 'unsaved_form',
      message:
        'Tienes un formulario o ventana de edición abierta. Guarda o cierra antes de actualizar para no perder cambios.',
    };
  }
  return {
    blocked: false,
    reason: null,
    message: null,
  };
}

export function resetPwaGuardForTests(): void {
  activeEditCount = 0;
  activeWriteCount = 0;
  notifyListeners();
}

interface ChunkReloadState {
  count: number;
  lastAtMs: number;
}

function readChunkReloadState(storage?: Pick<Storage, 'getItem'>): ChunkReloadState | null {
  const target = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!target) return null;
  try {
    const raw = target.getItem(CHUNK_RELOAD_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChunkReloadState>;
    if (typeof parsed.count !== 'number' || typeof parsed.lastAtMs !== 'number') return null;
    return { count: parsed.count, lastAtMs: parsed.lastAtMs };
  } catch {
    return null;
  }
}

export function canTriggerSafeChunkReload(
  nowMs = Date.now(),
  storage?: Pick<Storage, 'getItem'>
): boolean {
  const state = readChunkReloadState(storage);
  if (!state) return true;
  if (nowMs - state.lastAtMs > CHUNK_RELOAD_WINDOW_MS) return true;
  return state.count < MAX_CHUNK_RELOADS_PER_WINDOW;
}

export function recordSafeChunkReloadAttempt(
  nowMs = Date.now(),
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): boolean {
  const target = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!canTriggerSafeChunkReload(nowMs, target)) return false;
  const prev = readChunkReloadState(target);
  const nextCount =
    prev && nowMs - prev.lastAtMs <= CHUNK_RELOAD_WINDOW_MS ? prev.count + 1 : 1;
  try {
    target?.setItem(
      CHUNK_RELOAD_GUARD_KEY,
      JSON.stringify({ count: nextCount, lastAtMs: nowMs })
    );
  } catch {
    // ignore storage errors
  }
  return true;
}

export function clearSafeChunkReloadAttempts(
  storage?: Pick<Storage, 'removeItem'>
): void {
  const target = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  try {
    target?.removeItem(CHUNK_RELOAD_GUARD_KEY);
  } catch {
    // ignore storage errors
  }
}

export function isLikelyStaleChunkError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('loading chunk') ||
    lower.includes('chunkloaderror') ||
    lower.includes('unable to preload css') ||
    lower.includes('failed to load module script')
  );
}

/**
 * Extrae una ruta estrictamente del mismo origen `/assets/*.js` de un error de
 * importación dinámica para poder reintentar con query-busting cuando el mapa
 * de módulos del navegador (HTML spec) cacheó el fallo previo por falta de red.
 */
export function extractFailedSameOriginAssetPath(error: unknown): string | null {
  if (typeof window === 'undefined') return null;
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!msg) return null;
  const match = msg.match(/(?:https?:\/\/[^\s'"]+)?(\/assets\/[a-zA-Z0-9._-]+\.js)/);
  if (!match) return null;
  try {
    const parsed = new URL(match[0], window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith('/assets/') &&
      parsed.pathname.endsWith('.js')
    ) {
      return parsed.pathname;
    }
  } catch {
    return null;
  }
  return null;
}
