import React from 'react';
import {
  CalendarDays,
  Home,
  Package,
  PiggyBank,
  Plus,
  RotateCcw,
  Settings,
  WifiOff,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { NavTab } from '../types/nido';
import { QuickExpenseModal } from './QuickExpenseModal';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'mudanza', label: 'Mudanza', icon: Package },
  { id: 'mensual', label: 'Mensual', icon: CalendarDays },
  { id: 'ahorros', label: 'Ahorros', icon: PiggyBank },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
];

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    household,
    activeTab,
    setActiveTab,
    quickExpenseOpen,
    setQuickExpenseOpen,
    toastMessage,
    undoToast,
    dismissUndo,
    isDemoMode,
    exitDemoMode,
  } = useNido();
  const isOnline = useOnlineStatus();

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8F8] dark:bg-[#0B1316] text-[#0F1F24] dark:text-[#F0F5F6]">
      {/* Top Bar: 3 zones on desktop, compact 52px on mobile */}
      <header className="sticky top-0 z-30 h-[54px] md:h-16 bg-white/95 dark:bg-[#132025]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 md:gap-8">
          {/* Zone 1: Brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('inicio')}
            className="font-display font-bold text-lg tracking-tight text-[#0E5A64] dark:text-[#5EEAD4] whitespace-nowrap shrink-0 flex items-center gap-2 min-h-[44px]"
          >
            <span>Nido</span>
            {household?.name && (
              <span className="hidden sm:inline font-sans font-normal text-sm text-slate-500 dark:text-slate-400">
                · {household.name}
              </span>
            )}
          </button>

          {/* Zone 2: 5 single-line nav links on desktop */}
          <nav
            aria-label="Navegación principal"
            className="hidden md:flex items-center gap-6"
          >
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`min-h-[44px] px-1 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-[#0E5A64] dark:border-[#5EEAD4] text-[#0F1F24] dark:text-[#F0F5F6]'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-[#0F1F24] dark:hover:text-[#F0F5F6]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQuickExpenseOpen(true)}
              className="min-h-[40px] sm:min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Añadir gasto</span>
            </button>
          </div>
        </div>
      </header>

      {/* Subtle demo banner when exploring without Google account */}
      {isDemoMode && (
        <div className="bg-[#0E5A64]/10 dark:bg-[#2AA1AE]/15 border-b border-[#0E5A64]/20 px-4 py-2 text-xs text-[#0E5A64] dark:text-[#5EEAD4]">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>Vista previa local con datos de ejemplo (Sant Sadurní d’Anoia).</span>
            <button
              type="button"
              onClick={exitDemoMode}
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              Conectar con Google
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-10">
        {children}
      </main>

      {/* Mobile Fixed Bottom Navigation (60px height, >=44px hitboxes) */}
      <nav
        aria-label="Navegación inferior móvil"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[62px] bg-white/95 dark:bg-[#132025]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center px-1"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                active
                  ? 'text-[#0E5A64] dark:text-[#5EEAD4] font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Offline indicator */}
      {!isOnline && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Sin conexión · Trabajando con caché local</span>
        </div>
      )}

      {/* Undo snackbar (5 seconds) */}
      {undoToast && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 right-4 z-50 flex items-center gap-3 rounded-xl bg-[#0F1F24] dark:bg-slate-800 text-white px-4 py-3 shadow-lg border border-slate-700"
        >
          <span className="text-sm">{undoToast.message}</span>
          <button
            type="button"
            onClick={async () => {
              const fn = undoToast.onUndo;
              dismissUndo();
              await fn();
            }}
            className="min-h-[36px] px-2.5 rounded-lg bg-[#2AA1AE] text-[#0F1F24] text-xs font-bold flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Deshacer
          </button>
        </div>
      )}

      {/* Normal toast */}
      {toastMessage && !undoToast && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 right-4 z-40 rounded-xl bg-[#0F1F24] dark:bg-slate-800 text-white px-4 py-2.5 text-sm font-medium shadow-md"
        >
          {toastMessage}
        </div>
      )}

      <QuickExpenseModal
        open={quickExpenseOpen}
        onClose={() => setQuickExpenseOpen(false)}
      />
    </div>
  );
};
