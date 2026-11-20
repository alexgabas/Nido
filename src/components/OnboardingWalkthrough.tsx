import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Scale, Share2, Sparkles, Users, X } from 'lucide-react';

export const ONBOARDING_SEEN_KEY = 'nido_onboarding_seen_v1';

interface OnboardingWalkthroughProps {
  open: boolean;
  onClose: () => void;
  inviteCode?: string;
  householdName?: string;
  onGoToAjustes?: () => void;
}

export const OnboardingWalkthrough: React.FC<OnboardingWalkthroughProps> = ({
  open,
  onClose,
  inviteCode,
  householdName,
  onGoToAjustes,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setShareFeedback(null);
    }
  }, [open]);

  if (!open) return null;

  const finishOnboarding = () => {
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    } catch {
      // Ignore storage errors in private browsing
    }
    onClose();
  };

  const handleShareCode = async () => {
    if (!inviteCode) return;
    const shareTitle = householdName ? `Únete a ${householdName} en Nido` : 'Únete a nuestro hogar en Nido';
    const shareText = `Entra en Nido e introduce nuestro código de invitación: ${inviteCode}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: window.location.origin,
        });
        setShareFeedback('Invitación compartida');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(inviteCode);
      setShareFeedback(`Código ${inviteCode} copiado al portapapeles`);
    } catch {
      setShareFeedback(`Comparte este código con tu pareja: ${inviteCode}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-step-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-2 rounded-full transition-all ${
                  n <= step ? 'w-7 bg-[#0E5A64] dark:bg-[#5EEAD4]' : 'w-4 bg-slate-200 dark:bg-slate-700'
                }`}
              />
            ))}
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 ml-1">
              Paso {step} de 3
            </span>
          </div>
          <button
            type="button"
            onClick={finishOnboarding}
            aria-label="Cerrar guía de bienvenida"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 id="onboarding-step-title" className="font-display text-2xl font-bold tracking-tight">
                Qué es Nido
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Es vuestro espacio compartido en pareja para llevar al día los gastos del mes, la mudanza, la lista de la compra y vuestras metas de ahorro.
              </p>
            </div>
            <ul className="space-y-2.5 text-sm text-slate-700 dark:text-slate-200">
              <li className="flex items-start gap-2.5 rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3">
                <Check className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
                <span>Cada persona entra con su propia cuenta de Google y elige Modo Sencillo o Avanzado.</span>
              </li>
              <li className="flex items-start gap-2.5 rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3">
                <Check className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
                <span>Funciona sin cobertura guardando tus cambios en el móvil hasta recuperar conexión.</span>
              </li>
            </ul>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center">
              <Scale className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 id="onboarding-step-title" className="font-display text-2xl font-bold tracking-tight">
                Cómo se reparte
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Cada gasto guarda quién pagó (tú, tu pareja o la Cuenta común) y calcula automáticamente quién debe a quién sin hojas de cálculo.
              </p>
            </div>
            <div className="space-y-2 text-xs sm:text-sm">
              <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3">
                <p className="font-bold text-[#0F1F24] dark:text-[#F0F5F6]">Según reparto</p>
                <p className="text-slate-600 dark:text-slate-300">
                  A medias (50/50), proporcional a vuestros ingresos o con el porcentaje que configuréis en Ajustes.
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3">
                <p className="font-bold text-[#0F1F24] dark:text-[#F0F5F6]">Lo pago y asumo yo / Privado</p>
                <p className="text-slate-600 dark:text-slate-300">
                  También podéis registrar gastos que asumís al 100 % o marcarlos como privados para que solo los veas tú.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 id="onboarding-step-title" className="font-display text-2xl font-bold tracking-tight">
                Invitar a tu pareja
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {inviteCode
                  ? 'Comparte este código de 6 caracteres con tu pareja. Cuando entre con su Google y pulse «Unirme con código», veréis lo mismo al instante.'
                  : 'Al crear vuestro hogar recibirás un código de 6 caracteres. Compártelo con tu pareja para que se una con su cuenta de Google.'}
              </p>
            </div>

            {inviteCode ? (
              <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Código del hogar
                    </p>
                    <p className="font-mono text-2xl font-bold tracking-widest text-[#0E5A64] dark:text-[#5EEAD4]">
                      {inviteCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleShareCode()}
                    className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Compartir código</span>
                  </button>
                </div>
                {shareFeedback && (
                  <p role="status" className="text-xs font-semibold text-[#15803D] dark:text-[#4ADE80]">
                    {shareFeedback}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-600 dark:text-slate-300">
                Podrás compartir o regenerar este código cuando quieras desde Ajustes o desde la pantalla de Inicio.
              </div>
            )}

            {onGoToAjustes && (
              <button
                type="button"
                onClick={() => {
                  finishOnboarding();
                  onGoToAjustes();
                }}
                className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Abrir Ajustes para configurar reparto
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev === 3 ? 2 : 1))}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Anterior</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={finishOnboarding}
              className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Saltar
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev === 1 ? 2 : 3))}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <span>Siguiente</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishOnboarding}
              className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Empezar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
