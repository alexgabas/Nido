import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  HelpCircle,
  Home,
  LogOut,
  Moon,
  Package,
  PiggyBank,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  WifiOff,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { NavTab } from '../types/nido';
import { PWAInstallBanner } from './PWAInstallBanner';
import { PWAUpdateBanner } from './PWAUpdateBanner';
import { QuickExpenseModal } from './QuickExpenseModal';

const AVANZADO_NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'mudanza', label: 'Mudanza', icon: Package },
  { id: 'mensual', label: 'Mensual', icon: CalendarDays },
  { id: 'ahorros', label: 'Ahorros', icon: PiggyBank },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
];

const SENCILLO_DESKTOP_NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
}> = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'ahorros', label: 'Ahorros' },
  { id: 'ayuda', label: 'Ayuda' },
];

function getInitials(name: string | undefined): string {
  const clean = (name || 'U').trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    household,
    currentUserProfile,
    currentMember,
    activeTab,
    setActiveTab,
    uiMode,
    toggleUiMode,
    theme,
    toggleTheme,
    quickExpenseOpen,
    setQuickExpenseOpen,
    quickExpensePrefill,
    quickExpenseOnSaved,
    clearQuickExpensePrefill,
    toastMessage,
    undoToast,
    dismissUndo,
    isDemoMode,
    exitDemoMode,
    logout,
    seedPending,
    seedingDefaults,
    retryDefaultSeed,
  } = useNido();
  const isOnline = useOnlineStatus();

  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const handleToggleMode = async () => {
    if (switchingMode) return;
    setSwitchingMode(true);
    try {
      await toggleUiMode();
    } finally {
      setSwitchingMode(false);
    }
  };

  const displayName = currentMember?.displayName || currentUserProfile?.displayName || 'Usuario';
  const photoURL = currentMember?.photoURL || currentUserProfile?.photoURL || '';
  const desktopNavItems = uiMode === 'sencillo' ? SENCILLO_DESKTOP_NAV_ITEMS : AVANZADO_NAV_ITEMS;

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8F8] dark:bg-[#0B1316] text-[#0F1F24] dark:text-[#F0F5F6]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 h-[56px] md:h-16 bg-white/95 dark:bg-[#132025]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto h-full px-3 sm:px-6 flex items-center justify-between gap-3 md:gap-8">
          {/* Zone 1: Brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('inicio')}
            className="font-display font-bold text-lg tracking-tight text-[#0E5A64] dark:text-[#5EEAD4] whitespace-nowrap shrink-0 flex items-center gap-2 min-h-[44px] min-w-0"
          >
            <span>Nido</span>
            {household?.name && (
              <span
                className={`font-sans font-normal text-xs sm:text-sm text-slate-600 dark:text-slate-400 truncate max-w-[135px] sm:max-w-[220px] ${
                  uiMode === 'avanzado' ? 'hidden sm:inline' : ''
                }`}
              >
                · {household.name}
              </span>
            )}
          </button>

          {/* Zone 2: Desktop Navigation */}
          <nav aria-label="Navegación principal" className="hidden md:flex items-center gap-6">
            {desktopNavItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`min-h-[44px] px-1 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-[#0E5A64] dark:border-[#5EEAD4] text-[#0F1F24] dark:text-[#F0F5F6]'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-[#0F1F24] dark:hover:text-[#F0F5F6]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Quick Add (desktop or Avanzado mobile) + Top-Right Avatar & Mode Menu */}
          <div className="flex items-center gap-2 shrink-0" ref={menuContainerRef}>
            <button
              type="button"
              aria-label="Añadir gasto"
              onClick={() => setQuickExpenseOpen(true)}
              className={`${
                uiMode === 'sencillo' ? 'hidden md:flex' : 'flex'
              } min-h-[44px] px-3 sm:px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold items-center gap-1.5 transition-colors whitespace-nowrap shrink-0`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">Gasto</span>
              <span className="hidden sm:inline">Añadir gasto</span>
            </button>

            <div className="relative">
              <button
                type="button"
                aria-label={`Menú de ${displayName} (${uiMode === 'sencillo' ? 'Modo Sencillo' : 'Modo Avanzado'})`}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="min-h-[44px] pl-1.5 pr-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
              >
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                  />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-[#0E5A64] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {getInitials(displayName)}
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                  {uiMode === 'sencillo' ? 'Sencillo' : 'Avanzado'}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-600 dark:text-slate-300 transition-transform ${
                    menuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {menuOpen && (
                <div
                  role="dialog"
                  aria-label="Opciones de cuenta y modo"
                  className="absolute right-0 mt-2 w-72 rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 shadow-xl p-4 space-y-3 z-50"
                >
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    {photoURL ? (
                      <img
                        src={photoURL}
                        alt={displayName}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span className="w-10 h-10 rounded-full bg-[#0E5A64] text-white text-sm font-bold flex items-center justify-center shrink-0">
                        {getInitials(displayName)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{displayName}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                        {household?.name || 'Hogar'}
                      </p>
                    </div>
                  </div>

                  {/* Clear Mode Toggle Switch */}
                  <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                          Modo de la app
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">
                          {uiMode === 'sencillo'
                            ? 'Simple, directo y sin menús técnicos'
                            : 'Tablas, filtros, gráficos y control total'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={uiMode === 'avanzado'}
                        aria-label="Cambiar entre Modo Sencillo y Modo Avanzado"
                        disabled={switchingMode}
                        onClick={() => void handleToggleMode()}
                        className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-2 focus:outline-[#0E5A64] ${
                          uiMode === 'avanzado'
                            ? 'bg-[#0E5A64]'
                            : 'bg-slate-400 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                            uiMode === 'avanzado' ? 'translate-x-6' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs font-semibold text-center rounded-lg bg-white dark:bg-[#132025] p-1 border border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        disabled={switchingMode || uiMode === 'sencillo'}
                        onClick={() => void handleToggleMode()}
                        className={`min-h-[44px] rounded-md transition-colors ${
                          uiMode === 'sencillo'
                            ? 'bg-[#0E5A64] text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        Sencillo
                      </button>
                      <button
                        type="button"
                        disabled={switchingMode || uiMode === 'avanzado'}
                        onClick={() => void handleToggleMode()}
                        className={`min-h-[44px] rounded-md transition-colors ${
                          uiMode === 'avanzado'
                            ? 'bg-[#0E5A64] text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        Avanzado
                      </button>
                    </div>
                  </div>

                  {/* Quick Secondary Actions */}
                  <div className="space-y-1">
                    {uiMode === 'avanzado' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('ajustes');
                          setMenuOpen(false);
                        }}
                        className="w-full min-h-[44px] px-3 rounded-xl text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Settings className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        <span>Ajustes del hogar</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('ayuda');
                        setMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] px-3 rounded-xl text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <HelpCircle className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      <span>Ayuda e instalación</span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="w-full min-h-[44px] px-3 rounded-xl text-left text-xs font-semibold flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2.5">
                        {theme === 'dark' ? (
                          <Sun className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        ) : (
                          <Moon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        )}
                        <span>{theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (isDemoMode) exitDemoMode();
                        else void logout();
                      }}
                      className="w-full min-h-[44px] px-3 rounded-xl text-left text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] flex items-center gap-2.5 hover:bg-[#B42318]/10"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{isDemoMode ? 'Salir de la vista de prueba' : 'Cerrar sesión'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Subtle demo banner when exploring without Google account */}
      {isDemoMode && uiMode === 'avanzado' && (
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

      {/* Pending default lists banner if Phase B seed failed */}
      {seedPending && (
        <div
          role="status"
          className="bg-amber-500/12 border-b border-amber-500/30 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              Tu hogar está listo, pero faltan por cargar las listas iniciales.
            </span>
            <button
              type="button"
              disabled={seedingDefaults}
              onClick={() => void retryDefaultSeed()}
              className="min-h-[44px] px-3.5 rounded-lg bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-60 text-white font-semibold transition-colors"
            >
              {seedingDefaults ? 'Cargando listas...' : 'Cargar listas por defecto'}
            </button>
          </div>
        </div>
      )}

      {/* PWA update & install banners */}
      <PWAUpdateBanner />
      <PWAInstallBanner />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10 min-w-0 overflow-x-hidden">
        {children}
      </main>

      {/* Mobile Fixed Bottom Navigation */}
      {uiMode === 'sencillo' ? (
        <nav
          aria-label="Navegación inferior móvil"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 min-h-[calc(66px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#132025]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 items-center px-3"
        >
          <button
            type="button"
            onClick={() => setActiveTab('inicio')}
            className={`min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
              activeTab === 'inicio'
                ? 'text-[#0E5A64] dark:text-[#5EEAD4] font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[11px] leading-none">Inicio</span>
          </button>

          <div className="flex items-center justify-center">
            <button
              type="button"
              aria-label="Añadir gasto"
              onClick={() => setQuickExpenseOpen(true)}
              className="w-16 h-12 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] active:scale-[0.97] text-white shadow-md flex items-center justify-center transition-all"
            >
              <Plus className="w-7 h-7" strokeWidth={2.5} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('ahorros')}
            className={`min-h-[50px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
              activeTab === 'ahorros'
                ? 'text-[#0E5A64] dark:text-[#5EEAD4] font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <PiggyBank className="w-5 h-5" />
            <span className="text-[11px] leading-none">Ahorros</span>
          </button>
        </nav>
      ) : (
        <nav
          aria-label="Navegación inferior móvil"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 min-h-[calc(62px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#132025]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center px-1"
        >
          {AVANZADO_NAV_ITEMS.map((item) => {
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
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] leading-none">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Offline indicator */}
      {!isOnline && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
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
            className="min-h-[44px] px-3 rounded-lg bg-[#5EEAD4] text-[#0F1F24] text-xs font-bold flex items-center gap-1"
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
        onClose={() => {
          setQuickExpenseOpen(false);
          clearQuickExpensePrefill();
        }}
        prefill={quickExpensePrefill}
        onSaved={quickExpenseOnSaved}
      />
    </div>
  );
};
