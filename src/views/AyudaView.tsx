import React, { useState } from 'react';
import { HelpCircle, Lock, Scale, Share2, Smartphone, UserCheck, WifiOff } from 'lucide-react';
import { OnboardingWalkthrough } from '../components/OnboardingWalkthrough';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { useNido } from '../context/NidoContext';

export const AyudaView: React.FC = () => {
  const { household, uiMode, setActiveTab } = useNido();
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
          Ayuda e instalación
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Cómo instalar Nido en tu móvil para usarla sin conexión y cómo funcionan los tipos de gasto.
        </p>
      </header>

      {/* Instalar en el móvil (Android Chrome e iOS Safari) */}
      <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold">Instalar Nido como app (PWA)</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Ábrela a pantalla completa desde el icono de tu móvil y úsala incluso sin cobertura.
            </p>
          </div>
        </div>

        <PWAInstallButton variant="full" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 space-y-2">
            <h3 className="font-display text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
              Android (Google Chrome)
            </h3>
            <ol className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 space-y-1.5 list-decimal list-inside">
              <li>Abre Nido en <strong>Chrome</strong>.</li>
              <li>Pulsa el botón «Instalar app» arriba o toca el menú <strong>⋮</strong> (arriba a la derecha).</li>
              <li>Elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</li>
            </ol>
          </div>

          <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 space-y-2">
            <h3 className="font-display text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
              iPhone / iPad (Safari)
            </h3>
            <ol className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 space-y-1.5 list-decimal list-inside">
              <li>Abre Nido en <strong>Safari</strong> (no dentro de otro navegador).</li>
              <li>Pulsa el botón <strong>Compartir</strong> (icono de cuadrado con flecha hacia arriba).</li>
              <li>Desliza y toca <strong>Añadir a pantalla de inicio</strong>.</li>
            </ol>
          </div>
        </div>

        <div className="rounded-2xl bg-[#0E5A64]/8 dark:bg-[#2AA1AE]/12 px-4 py-3 flex items-start gap-2.5 text-xs text-[#0F1F24] dark:text-[#F0F5F6]">
          <WifiOff className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
          <span>
            Aunque pierdas la conexión en el metro o en el supermercado, podrás apuntar gastos o marcar la lista de la compra; se sincronizarán en cuanto vuelva la red.
          </span>
        </div>
      </section>

      {/* Explicación breve de Según reparto / Lo pago y asumo yo / Privado */}
      <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold">Tipos de gasto en Nido</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Elige cómo afecta cada apunte a vuestras cuentas y a la privacidad.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex items-start gap-3">
            <Scale className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold">Según reparto</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Lo ven los dos, suma al gasto mensual del hogar y se divide según el porcentaje acordado (por defecto, al 50/50, proporcional a vuestros ingresos o personalizado).
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex items-start gap-3">
            <UserCheck className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold">Lo pago y asumo yo (cuenta en el hogar)</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Lo ve tu pareja y suma al presupuesto total del hogar, pero el 100 % te corresponde a ti: no genera deuda para tu pareja. (Visible en Modo Avanzado).
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold">Privado (no lo ve mi pareja)</h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Solo es visible para tu cuenta. Queda excluido del reparto, del saldo entre vosotros, de los totales del hogar y de las exportaciones de tu pareja.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Tour en 3 pasos */}
      <section className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold">Guía rápida e invitación</h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
            Repasa en 3 pasos cómo funciona Nido o comparte vuestro código de hogar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWalkthroughOpen(true)}
          className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          <span>Ver guía en 3 pasos</span>
        </button>
      </section>

      <OnboardingWalkthrough
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
        inviteCode={household?.inviteCode}
        householdName={household?.name}
        onGoToAjustes={uiMode === 'avanzado' ? () => setActiveTab('ajustes') : undefined}
      />
    </div>
  );
};
