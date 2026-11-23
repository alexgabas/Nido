import type { PdfExportInput } from './pdfExport';
import { extractFailedSameOriginAssetPath, isLikelyStaleChunkError } from './pwaUpdateGuard';

let loadedModule: typeof import('./pdfExport') | null = null;
let inFlightImport: Promise<typeof import('./pdfExport')> | null = null;
let failedPdfAssetPath: string | null = null;
let pdfRetryAttempt = 0;

export function isPdfModuleLoaded(): boolean {
  return loadedModule !== null;
}

export async function loadPdfExportModule(): Promise<typeof import('./pdfExport')> {
  if (loadedModule) return loadedModule;
  if (inFlightImport) return inFlightImport;

  const attemptPromise = (async () => {
    if (failedPdfAssetPath) {
      pdfRetryAttempt += 1;
      const retried = (await import(
        /* @vite-ignore */ `${failedPdfAssetPath}?nido_retry=${pdfRetryAttempt}`
      )) as typeof import('./pdfExport');
      if (typeof retried?.exportNidoPDF === 'function') {
        failedPdfAssetPath = null;
        return retried;
      }
    }
    return import('./pdfExport');
  })();

  inFlightImport = attemptPromise
    .then((mod) => {
      loadedModule = mod;
      failedPdfAssetPath = null;
      return mod;
    })
    .catch((err) => {
      const failedPath = extractFailedSameOriginAssetPath(err);
      if (failedPath) {
        failedPdfAssetPath = failedPath;
      }
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const staleChunk = !offline && isLikelyStaleChunkError(err);
      if (staleChunk && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nido:stale-chunk'));
      }
      const reason = offline
        ? 'No se pudo descargar el módulo de exportación PDF sin conexión. Conéctate a internet para cargarlo la primera vez e inténtalo de nuevo.'
        : staleChunk
          ? 'Hay una versión más reciente de Nido publicada. Recarga la app desde el aviso superior para descargar el módulo PDF actualizado.'
          : 'No se pudo cargar el módulo de exportación PDF. Comprueba tu conexión e inténtalo de nuevo.';
      const wrapped = new Error(reason);
      (wrapped as Error & { cause?: unknown }).cause = err;
      throw wrapped;
    })
    .finally(() => {
      inFlightImport = null;
    });

  return inFlightImport;
}

export async function loadAndExportNidoPDF(input: PdfExportInput): Promise<void> {
  const mod = await loadPdfExportModule();
  mod.exportNidoPDF(input);
}
