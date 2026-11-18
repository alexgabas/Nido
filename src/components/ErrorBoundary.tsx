import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Ha ocurrido un error inesperado.' };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    let displayDetail = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
      if (parsed.error) {
        displayDetail = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
      }
    } catch {
      // keep raw message
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F6F8F8] dark:bg-[#0B1316]">
        <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div className="flex items-center gap-3 text-[#DC4C3E]">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h1 className="text-lg font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
              Algo no ha salido como esperábamos
            </h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            No se ha perdido ningún dato guardado. Revisa tu conexión o recarga la aplicación para continuar.
          </p>
          <p className="text-xs font-mono bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 p-3 rounded-xl break-words">
            {displayDetail}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[44px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E5A64]"
          >
            <RefreshCw className="w-4 h-4" />
            Recargar Nido
          </button>
        </div>
      </div>
    );
  }
}
