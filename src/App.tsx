import React from 'react';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginOnboarding } from './components/LoginOnboarding';
import { NidoProvider, useNido } from './context/NidoContext';
import { AhorrosView } from './views/AhorrosView';
import { AjustesView } from './views/AjustesView';
import { InicioView } from './views/InicioView';
import { MensualView } from './views/MensualView';
import { MudanzaView } from './views/MudanzaView';

const NidoRouter: React.FC = () => {
  const { authReady, authUser, isDemoMode, householdId, household, activeTab } = useNido();

  if (!authReady) {
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
      {activeTab === 'inicio' && <InicioView />}
      {activeTab === 'mudanza' && <MudanzaView />}
      {activeTab === 'mensual' && <MensualView />}
      {activeTab === 'ahorros' && <AhorrosView />}
      {activeTab === 'ajustes' && <AjustesView />}
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
