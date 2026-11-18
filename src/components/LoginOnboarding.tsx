import React, { useState } from 'react';
import { ArrowRight, Home, KeyRound, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { HouseholdSwitchConfirmationRequiredError } from '../repositories/HouseholdRepository';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import { ConfirmDialog } from './ConfirmDialog';
import { PWAInstallButton } from './PWAInstallButton';

export const LoginOnboarding: React.FC = () => {
  const {
    authReady,
    authUser,
    householdLoading,
    householdError,
    signInWithGoogle,
    logout,
    enterDemoMode,
    createHousehold,
    joinHousehold,
    theme,
    toggleTheme,
  } = useNido();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [householdName, setHouseholdName] = useState('Piso Sant Sadurní');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<{ code: string; targetName: string } | null>(null);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(
        toUserFriendlyErrorMessage(err, 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = householdName.trim();
    if (!clean) {
      setErrorMsg('Introduce un nombre para vuestro hogar.');
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await createHousehold(clean);
    } catch (err) {
      setErrorMsg(
        toUserFriendlyErrorMessage(err, 'No se ha podido crear el hogar, inténtalo de nuevo.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const runJoin = async (code: string, confirmSwitch: boolean) => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await joinHousehold(code, { confirmSwitch });
      setSwitchConfirm(null);
    } catch (err) {
      if (err instanceof HouseholdSwitchConfirmationRequiredError && !confirmSwitch) {
        setSwitchConfirm({ code, targetName: err.targetHouseholdName });
        return;
      }
      setErrorMsg(
        toUserFriendlyErrorMessage(
          err,
          'No se pudo unir al hogar. Comprueba el código e inténtalo de nuevo.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setErrorMsg('El código debe tener exactamente 6 letras o números.');
      return;
    }
    await runJoin(code, false);
  };

  if (!authReady || householdLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8F8] dark:bg-[#0B1316] p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] mx-auto flex items-center justify-center">
            <Home className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Cargando tu espacio en Nido...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#F6F8F8] dark:bg-[#0B1316] text-[#0F1F24] dark:text-[#F0F5F6] p-4 sm:p-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#0E5A64] text-white flex items-center justify-center font-display font-bold text-lg">
            N
          </div>
          <span className="font-display font-bold text-xl tracking-tight">Nido</span>
        </div>
        <div className="flex items-center gap-2">
          <PWAInstallButton />
          <button
            type="button"
            onClick={toggleTheme}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          </button>
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <section className="lg:col-span-6 space-y-5">
          <p className="text-sm font-medium text-[#0E5A64] dark:text-[#5EEAD4]">
            Economía compartida en pareja · Sant Sadurní d’Anoia
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-[#0F1F24] dark:text-[#F0F5F6]">
            Vuestro piso, vuestras cuentas claras y sin sorpresas a fin de mes.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
            Organizad la mudanza, el reparto proporcional al salario, los gastos fijos del hogar y vuestras metas de ahorro en tiempo real desde el móvil.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 space-y-1">
              <Users className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <p className="text-sm font-semibold">En tiempo real</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sincronización instantánea entre las dos cuentas.
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 space-y-1">
              <ShieldCheck className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <p className="text-sm font-semibold">Checklist Catalunya</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fianza INCASÒL, zona tensionada y mobiliario IKEA.
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 space-y-1">
              <KeyRound className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
              <p className="text-sm font-semibold">Funciona offline</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                App instalable con caché local y copias JSON.
              </p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-6">
          <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6">
            {(errorMsg || householdError) && (
              <div
                role="alert"
                className="rounded-xl bg-[#DC4C3E]/10 border border-[#DC4C3E]/30 px-4 py-3 text-sm text-[#B42318] dark:text-[#FCA5A5]"
              >
                {errorMsg || householdError}
              </div>
            )}

            {!authUser ? (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <h2 className="font-display text-xl font-bold">Entrar en Nido</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Inicia sesión con tu cuenta de Google para crear vuestro hogar o unirte con un código de invitación.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleGoogleLogin()}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors"
                >
                  <span>{submitting ? 'Conectando...' : 'Continuar con Google'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ¿Quieres ver cómo funciona antes de conectar tu cuenta?
                  </p>
                  <button
                    type="button"
                    onClick={enterDemoMode}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    Explorar demo local (datos de ejemplo)
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Sesión iniciada como</p>
                    <p className="text-sm font-semibold truncate">
                      {authUser.displayName || authUser.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Salir</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('create');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                      mode === 'create'
                        ? 'bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Crear hogar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('join');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                      mode === 'join'
                        ? 'bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Unirme con código
                  </button>
                </div>

                {mode === 'create' ? (
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="household-name" className="block text-sm font-medium">
                        Nombre de vuestro hogar
                      </label>
                      <input
                        id="household-name"
                        type="text"
                        maxLength={80}
                        required
                        value={householdName}
                        onChange={(e) => setHouseholdName(e.target.value)}
                        placeholder="Ej. Piso Sant Sadurní"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-2 focus:outline-[#0E5A64]"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Se creará con la lista inicial de mudanza Catalunya, mobiliario IKEA y metas base.
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                    >
                      {submitting ? 'Creando hogar...' : 'Crear hogar y generar código'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleJoin} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="invite-code" className="block text-sm font-medium">
                        Código de invitación (6 caracteres)
                      </label>
                      <input
                        id="invite-code"
                        type="text"
                        maxLength={6}
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder="Ej. SNT26A"
                        className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base tracking-widest uppercase focus:outline-2 focus:outline-[#0E5A64]"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Pide a tu pareja el código desde la pestaña Ajustes. Máximo 2 personas por hogar.
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                    >
                      {submitting ? 'Uniendo...' : 'Unirme al hogar'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>Nido · Gestión del hogar en pareja</span>
        <span>Moneda EUR (es-ES)</span>
      </footer>

      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title="Cambiar de hogar activo"
        description={
          switchConfirm
            ? `Tu cuenta ya pertenece a otro hogar. Si continúas, pasarás a usar "${switchConfirm.targetName}" como hogar activo.`
            : ''
        }
        confirmLabel="Cambiar de hogar"
        destructive={false}
        onConfirm={() => {
          if (switchConfirm) void runJoin(switchConfirm.code, true);
        }}
        onCancel={() => setSwitchConfirm(null)}
      />
    </div>
  );
};
