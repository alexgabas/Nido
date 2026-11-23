import React, { Suspense, lazy, useMemo, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginOnboarding } from './components/LoginOnboarding';
import { NidoProvider, useNido } from './context/NidoContext';
import {
  canTriggerSafeChunkReload,
  extractFailedSameOriginAssetPath,
  getPwaReloadBlockStatus,
  isLikelyStaleChunkError,
  recordSafeChunkReloadAttempt,
} from './services/pwaUpdateGuard';
import type { NavTab } from './types/nido';
import { InicioView } from './views/InicioView';

type LazyViewTab = Exclude<NavTab, 'inicio'>;

const VIEW_EXPORT_NAMES: Record<LazyViewTab, string> = {
  mudanza: 'MudanzaView',
  mensual: 'MensualView',
  ahorros: 'AhorrosView',
  ajustes: 'AjustesView',
  ayuda: 'AyudaView',
};

const VIEW_IMPORTERS: Record<LazyViewTab, () => Promise<{ default: React.ComponentType }>> = {
  mudanza: () => import('./views/MudanzaView').then((m) => ({ default: m.MudanzaView })),
  mensual: () => import('./views/MensualView').then((m) => ({ default: m.MensualView })),
  ahorros: () => import('./views/AhorrosView').then((m) => ({ default: m.AhorrosView })),
  ajustes: () => import('./views/AjustesView').then((m) => ({ default: m.AjustesView })),
  ayuda: () => import('./views/AyudaView').then((m) => ({ default: m.AyudaView })),
};

const lazyViewCache = new Map<string, React.LazyExoticComponent<React.ComponentType>>();
const failedViewAssetPaths = new Map<LazyViewTab, string>();

function getRetryableLazyView(
  tab: LazyViewTab,
  retryAttempt: number
): React.LazyExoticComponent<React.ComponentType> {
  const key = `${tab}:${retryAttempt}`;
  const cached = lazyViewCache.get(key);
  if (cached) return cached;

  const fresh = lazy(async () => {
    const failedPath = retryAttempt > 0 ? failedViewAssetPaths.get(tab) : undefined;
    if (failedPath) {
      const mod = (await import(
        /* @vite-ignore */ `${failedPath}?nido_retry=${retryAttempt}`
      )) as Record<string, unknown>;
      const exportName = VIEW_EXPORT_NAMES[tab];
      const comp = (mod[exportName] ?? mod.default) as React.ComponentType | undefined;
      if (!comp) {
        throw new Error(`El módulo recargado para ${tab} no exporta ${exportName}.`);
      }
      failedViewAssetPaths.delete(tab);
      return { default: comp };
    }

    try {
      const resolved = await VIEW_IMPORTERS[tab]();
      failedViewAssetPaths.delete(tab);
      return resolved;
    } catch (err) {
      const assetPath = extractFailedSameOriginAssetPath(err);
      if (assetPath) {
        failedViewAssetPaths.set(tab, assetPath);
      }
      throw err;
    }
  });
  lazyViewCache.set(key, fresh);
  return fresh;
}

interface ViewChunkBoundaryProps {
  resetKey: string;
  onRetry: () => void;
  children: React.ReactNode;
}

interface ViewChunkBoundaryState {
  hasError: boolean;
  error: unknown;
  reloadBlockedMessage: string | null;
}

class ViewChunkErrorBoundary extends React.Component<
  ViewChunkBoundaryProps,
  ViewChunkBoundaryState
> {
  constructor(props: ViewChunkBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, reloadBlockedMessage: null };
  }

  static getDerivedStateFromError(error: unknown): ViewChunkBoundaryState {
    return { hasError: true, error, reloadBlockedMessage: null };
  }

  componentDidCatch(error: unknown) {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online && isLikelyStaleChunkError(error) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nido:stale-chunk'));
    }
  }

  componentDidUpdate(prevProps: ViewChunkBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, reloadBlockedMessage: null });
    }
  }

  private handleSafeReload = () => {
    const block = getPwaReloadBlockStatus();
    if (block.blocked) {
      this.setState({
        reloadBlockedMessage:
          block.message || 'Guarda o cierra los cambios pendientes antes de recargar.',
      });
      return;
    }
    if (!recordSafeChunkReloadAttempt()) {
      this.setState({
        reloadBlockedMessage:
          'Ya intentamos recargar hace un momento. Comprueba tu conexión o vuelve a intentarlo en unos segundos.',
      });
      return;
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const staleOnline = !offline && isLikelyStaleChunkError(this.state.error);
      const canReloadNow = canTriggerSafeChunkReload();

      return (
        <div
          role="alert"
          className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 max-w-lg mx-auto my-8 text-center space-y-3"
        >
          {offline && (
            <WifiOff className="w-7 h-7 text-amber-600 dark:text-amber-400 mx-auto" />
          )}
          <p className="font-display text-base font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
            {offline
              ? 'Sección no disponible sin conexión'
              : staleOnline
                ? 'Hay una versión más reciente de Nido'
                : 'No se pudo cargar esta sección'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {offline
              ? 'Esta pantalla todavía no se ha descargado en este dispositivo. Conéctate a internet y pulsa Reintentar.'
              : staleOnline
                ? 'La app se ha actualizado mientras tenías esta pestaña abierta y falta un archivo de la versión anterior.'
                : 'Se produjo un problema al cargar esta sección. Puedes volver a intentarlo ahora.'}
          </p>
          {this.state.reloadBlockedMessage && (
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              {this.state.reloadBlockedMessage}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {staleOnline && canReloadNow && (
              <button
                type="button"
                onClick={this.handleSafeReload}
                className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Actualizar Nido</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null, reloadBlockedMessage: null });
                this.props.onRetry();
              }}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 ${
                staleOnline && canReloadNow
                  ? 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  : 'bg-[#0E5A64] hover:bg-[#0A464E] text-white'
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reintentar</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ViewLoadingFallback: React.FC = () => (
  <div
    role="status"
    className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 px-6 py-10 max-w-lg mx-auto my-6 text-center text-sm font-medium text-slate-600 dark:text-slate-300"
  >
    Cargando sección...
  </div>
);

const NidoRouter: React.FC = () => {
  const { authReady, authUser, isDemoMode, householdId, household, activeTab, uiMode } = useNido();
  const [viewRetryCount, setViewRetryCount] = useState(0);

  const effectiveTab = uiMode === 'sencillo' && activeTab === 'ajustes' ? 'inicio' : activeTab;

  const ActiveLazyView = useMemo(() => {
    if (effectiveTab === 'inicio') return null;
    return getRetryableLazyView(effectiveTab, viewRetryCount);
  }, [effectiveTab, viewRetryCount]);

  if (!isDemoMode && !authReady) {
    return <LoginOnboarding />;
  }

  if (!isDemoMode && (!authUser || !householdId)) {
    return <LoginOnboarding />;
  }

  if (!household) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8F8] dark:bg-[#0B1316] p-6">
        <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 px-8 py-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          Sincronizando datos del hogar...
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      {effectiveTab === 'inicio' || !ActiveLazyView ? (
        <InicioView />
      ) : (
        <ViewChunkErrorBoundary
          resetKey={`${effectiveTab}-${viewRetryCount}`}
          onRetry={() => setViewRetryCount((n) => n + 1)}
        >
          <Suspense fallback={<ViewLoadingFallback />}>
            <ActiveLazyView key={`${effectiveTab}-${viewRetryCount}`} />
          </Suspense>
        </ViewChunkErrorBoundary>
      )}
    </AppShell>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <NidoProvider>
        <NidoRouter />
      </NidoProvider>
    </ErrorBoundary>
  );
}
