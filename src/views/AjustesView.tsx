import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  HelpCircle,
  LogOut,
  Moon,
  Palette,
  RefreshCw,
  Share2,
  Sun,
  Upload,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { CategoryColorModal } from '../components/mensual/CategoryColorModal';
import { useNido } from '../context/NidoContext';
import {
  buildLastBackupStorageKey,
  daysSinceLastBackup,
  downloadTextFile,
  generateSpanishCSV,
  loadLastBackupRequestedAt,
  saveLastBackupRequestedAt,
  shouldShowBackupReminder,
  validateAndMigrateBackup,
} from '../domain/backup';
import {
  computeEffectiveSplitPctA,
  computeSavingsCapacity,
  formatDateES,
  formatEUR,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  shiftMonthKey,
} from '../domain/finance';
import {
  buildLocalNoticeStorageKey,
  DEFAULT_LOCAL_NOTICE_SETTINGS,
  getBrowserNotificationPermission,
  loadLocalNoticeSettings,
  requestBrowserNotificationPermission,
  saveLocalNoticeSettings,
  type LocalNoticeDaysAhead,
  type LocalNoticeSettings,
} from '../domain/localNotifications';
import { SPLIT_PRESETS, TRANSACTION_CATEGORY_LABELS } from '../domain/presets';
import { HouseholdSwitchConfirmationRequiredError } from '../repositories/HouseholdRepository';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import { exportNidoPDF } from '../services/pdfExport';
import type { HouseholdSettings, NidoBackupV1, SplitMode } from '../types/nido';

export const AjustesView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentUserProfile,
    uiMode,
    toggleUiMode,
    theme,
    toggleTheme,
    setActiveTab,
    recurring,
    recentTransactions,
    monthClosures,
    currentMonthBudget,
    repo,
    logout,
    joinHousehold,
    isDemoMode,
    seedPending,
    seedingDefaults,
    retryDefaultSeed,
    showToast,
  } = useNido();

  const [splitMode, setSplitMode] = useState<SplitMode>('preset');
  const [presetA, setPresetA] = useState(50);
  const [incomeA, setIncomeA] = useState('2000');
  const [incomeB, setIncomeB] = useState('2000');
  const [householdName, setHouseholdName] = useState('');
  const [copied, setCopied] = useState(false);
  const [switchInviteCode, setSwitchInviteCode] = useState('');
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchingHousehold, setSwitchingHousehold] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<{ code: string; targetName: string } | null>(null);
  const [colorModalOpen, setColorModalOpen] = useState(false);

  // Full report date range
  const todayISO = getTodayLocalISO();
  const [reportFrom, setReportFrom] = useState(() => `${shiftMonthKey(todayISO.slice(0, 7), -2)}-01`);
  const [reportTo, setReportTo] = useState(todayISO);

  // JSON import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<NidoBackupV1 | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Device-local foreground reminders (opt-in)
  const noticeStorageKey =
    householdId && currentUserProfile?.uid
      ? buildLocalNoticeStorageKey(householdId, currentUserProfile.uid)
      : '';
  const [noticeSettings, setNoticeSettings] = useState<LocalNoticeSettings>(
    DEFAULT_LOCAL_NOTICE_SETTINGS
  );
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserNotificationPermission()
  );

  // Device-local 30-day JSON backup timestamp
  const backupStorageKey =
    householdId && currentUserProfile?.uid
      ? buildLastBackupStorageKey(householdId, currentUserProfile.uid)
      : '';
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(null);

  useEffect(() => {
    if (!noticeStorageKey) return;
    setNoticeSettings(loadLocalNoticeSettings(noticeStorageKey));
    setNotifPermission(getBrowserNotificationPermission());
  }, [noticeStorageKey]);

  useEffect(() => {
    if (!backupStorageKey) {
      setLastBackupDate(null);
      return;
    }
    setLastBackupDate(loadLastBackupRequestedAt(backupStorageKey));
  }, [backupStorageKey]);

  useEffect(() => {
    if (!household) return;
    setSplitMode(household.settings.splitMode);
    setPresetA(household.settings.presetA);
    setIncomeA(String(household.settings.incomeA || ''));
    setIncomeB(String(household.settings.incomeB || ''));
    setHouseholdName(household.name);
  }, [household]);

  const draftSettings: HouseholdSettings = {
    splitMode,
    presetA,
    presetB: Math.round((100 - presetA) * 10) / 10,
    incomeA: Math.max(0, Number(incomeA.replace(',', '.')) || 0),
    incomeB: Math.max(0, Number(incomeB.replace(',', '.')) || 0),
    currency: 'EUR',
  };

  const currentMonthKey = getCurrentMonthKeyLocal();
  const previewPctA = computeEffectiveSplitPctA(draftSettings);
  const previewPctB = Math.round((100 - previewPctA) * 10) / 10;
  const capacityPreview = computeSavingsCapacity(draftSettings, recurring, {
    transactions: recentTransactions,
    monthClosures,
    currentMonthKey,
    budget: currentMonthBudget,
  });

  const nameA = memberA?.displayName?.split(' ')[0] || 'Tú';
  const nameB = memberB?.displayName?.split(' ')[0] || 'tu pareja';

  const handleSaveSplit = async () => {
    if (!householdId || !currentUserProfile) return;
    try {
      const summary = `Actualizó el reparto a ${previewPctA}% / ${previewPctB}% (${splitMode === 'income' ? 'proporcional al salario' : splitMode === 'preset' ? 'predefinido' : 'personalizado'})`;
      await repo.updateSettings(householdId, draftSettings, currentUserProfile, summary);
      showToast('Reparto guardado y sincronizado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo guardar el reparto. Inténtalo de nuevo.'));
    }
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile || !householdName.trim()) return;
    try {
      await repo.updateHouseholdName(householdId, householdName.trim(), currentUserProfile);
      showToast('Nombre del hogar actualizado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el nombre del hogar.'));
    }
  };

  const runSwitchHousehold = async (code: string, confirmSwitch: boolean) => {
    setSwitchError(null);
    setSwitchingHousehold(true);
    try {
      await joinHousehold(code, { confirmSwitch });
      setSwitchInviteCode('');
      setSwitchConfirm(null);
      showToast('Hogar cambiado correctamente');
    } catch (err) {
      if (err instanceof HouseholdSwitchConfirmationRequiredError && !confirmSwitch) {
        setSwitchConfirm({ code, targetName: err.targetHouseholdName });
        return;
      }
      setSwitchError(
        toUserFriendlyErrorMessage(err, 'No se pudo cambiar de hogar. Revisa el código e inténtalo de nuevo.')
      );
    } finally {
      setSwitchingHousehold(false);
    }
  };

  const handleSwitchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = switchInviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setSwitchError('El código debe tener exactamente 6 letras o números.');
      return;
    }
    await runSwitchHousehold(code, false);
  };

  const handleCopyInvite = async () => {
    if (!household?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(household.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      showToast('Código copiado');
    } catch {
      showToast(`Código: ${household.inviteCode}`);
    }
  };

  const handleShareInvite = async () => {
    if (!household?.inviteCode) return;
    const text = `Únete a "${household.name}" en Nido con el código: ${household.inviteCode}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Invitación a ${household.name} en Nido`,
          text,
          url: window.location.origin,
        });
        showToast('Invitación compartida');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await handleCopyInvite();
  };

  const updateNoticeSettings = (patch: Partial<LocalNoticeSettings>) => {
    if (!noticeStorageKey) return;
    const next: LocalNoticeSettings = { ...noticeSettings, ...patch };
    setNoticeSettings(next);
    saveLocalNoticeSettings(noticeStorageKey, next);
  };

  const handleToggleDeviceNotices = async () => {
    if (!noticeStorageKey) return;
    if (noticeSettings.enabled) {
      updateNoticeSettings({ enabled: false });
      showToast('Recordatorios locales desactivados');
      return;
    }
    const currentPerm = getBrowserNotificationPermission();
    setNotifPermission(currentPerm);
    if (currentPerm === 'unsupported') {
      showToast('Este navegador no admite notificaciones locales');
      return;
    }
    if (currentPerm === 'denied') {
      showToast('Permiso bloqueado en los ajustes del navegador');
      return;
    }
    const finalPerm =
      currentPerm === 'granted' ? 'granted' : await requestBrowserNotificationPermission();
    setNotifPermission(finalPerm);
    if (finalPerm === 'granted') {
      updateNoticeSettings({ enabled: true, lastNotifiedDate: '' });
      showToast('Recordatorios activados para este dispositivo');
    } else {
      showToast('No se concedió permiso para mostrar avisos');
    }
  };

  const handleExportJSON = async () => {
    if (!householdId || !currentUserProfile) return;
    const backup = await repo.exportBackup(householdId, currentUserProfile.uid);
    downloadTextFile(
      `nido-backup-${todayISO}.json`,
      JSON.stringify(backup, null, 2),
      'application/json'
    );
    if (backupStorageKey) {
      saveLastBackupRequestedAt(backupStorageKey, todayISO);
      setLastBackupDate(todayISO);
    }
    showToast('Copia de seguridad JSON descargada');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validated = validateAndMigrateBackup(parsed);
      setPendingBackup(validated);
    } catch (err) {
      setImportError(
        toUserFriendlyErrorMessage(err, 'El archivo no tiene un formato válido de Nido.')
      );
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingBackup || !householdId || !currentUserProfile) return;
    const backup = pendingBackup;
    setPendingBackup(null);
    try {
      await repo.importBackup(householdId, backup, currentUserProfile);
      showToast('Copia de seguridad restaurada');
    } catch (err) {
      setImportError(
        toUserFriendlyErrorMessage(err, 'No se pudo restaurar la copia de seguridad. Inténtalo de nuevo.')
      );
    }
  };

  const handleFullReportCSV = async () => {
    if (!householdId || !currentUserProfile) return;
    try {
      const backup = await repo.exportBackup(householdId, currentUserProfile.uid);
      const filtered = backup.transactions.filter((t) => t.date >= reportFrom && t.date <= reportTo);
      const csv = generateSpanishCSV(
        ['Fecha', 'Mes', 'Concepto', 'Categoría', 'Pagó', 'Reparto A (%)', 'Tipo', 'Importe (€)'],
        filtered.map((t) => [
          formatDateES(t.date),
          t.monthKey,
          t.concept,
          TRANSACTION_CATEGORY_LABELS[t.category],
          t.paidBy === 'cuenta_comun'
            ? 'Cuenta común'
            : members.find((m) => m.uid === t.paidBy)?.displayName?.split(' ')[0] || t.paidBy,
          t.isPrivate ? 'Personal' : t.splitPctA,
          t.isPrivate ? 'Personal' : t.isSettlement ? 'Liquidación' : 'Compartido',
          t.amount,
        ])
      );
      downloadTextFile(`nido-informe-${reportFrom}_${reportTo}.csv`, csv, 'text/csv;charset=utf-8;');
      showToast('Informe CSV descargado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo generar el informe CSV.'));
    }
  };

  const handleFullReportPDF = async () => {
    if (!household || !householdId || !currentUserProfile) return;
    try {
      const backup = await repo.exportBackup(householdId, currentUserProfile.uid);
      exportNidoPDF({
        scope: 'completo',
        household,
        members,
        fromDate: reportFrom,
        toDate: reportTo,
        transactions: backup.transactions.map((t) => ({ ...t, createdAt: '', updatedAt: '' })),
        initialCosts: backup.initialCosts.map((c) => ({ ...c, createdAt: '', updatedAt: '' })),
        items: backup.items.map((it) => ({ ...it, createdAt: '', updatedAt: '' })),
        goals: backup.goals.map((g) => ({ ...g, createdAt: '', updatedAt: '' })),
        goalMovements: backup.goalMovements.map((m) => ({ ...m, createdAt: '' })),
      });
      showToast('Informe completo PDF descargado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo generar el informe PDF.'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Reparto de gastos, preferencias de vista, hogar compartido y copias de seguridad.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Split configuration */}
        <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold">Configuración del reparto</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Define qué porcentaje de los gastos comunes corresponde a cada uno.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl">
            {[
              { id: 'preset' as const, label: 'Predefinido' },
              { id: 'income' as const, label: 'Por salario' },
              { id: 'custom' as const, label: 'Personalizado' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setSplitMode(tab.id);
                  if (tab.id === 'preset' && !SPLIT_PRESETS.some((p) => p.a === presetA)) {
                    setPresetA(50);
                  }
                }}
                className={`min-h-[44px] px-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                  splitMode === tab.id
                    ? 'bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {splitMode === 'preset' && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {SPLIT_PRESETS.map((p) => {
                const active = presetA === p.a;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPresetA(p.a)}
                    className={`min-h-[44px] rounded-xl text-sm font-bold tabular-nums border transition-colors ${
                      active
                        ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {splitMode === 'custom' && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm font-semibold tabular-nums">
                <span>
                  {nameA}: {presetA}%
                </span>
                <span>
                  {nameB}: {Math.round((100 - presetA) * 10) / 10}%
                </span>
              </div>
              <input
                aria-label="Porcentaje de reparto"
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={presetA}
                onChange={(e) => setPresetA(Number(e.target.value))}
                className="w-full accent-[#0E5A64]"
              />
            </div>
          )}

          {/* Ingresos netos mensuales (siempre editables para capacidad de ahorro) */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Ingresos netos mensuales
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Se usan para calcular la capacidad de ahorro mensual y el reparto proporcional por salario.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="income-a" className="block text-xs font-medium mb-1">
                  Salario neto mensual · {nameA} (€)
                </label>
                <input
                  id="income-a"
                  type="text"
                  inputMode="decimal"
                  value={incomeA}
                  onChange={(e) => setIncomeA(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-base font-semibold"
                />
              </div>
              <div>
                <label htmlFor="income-b" className="block text-xs font-medium mb-1">
                  Salario neto mensual · {nameB} (€)
                </label>
                <input
                  id="income-b"
                  type="text"
                  inputMode="decimal"
                  value={incomeB}
                  onChange={(e) => setIncomeB(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-base font-semibold"
                />
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              Capacidad de ahorro estimada:{' '}
              <strong
                className={
                  capacityPreview.capacity >= 0
                    ? 'text-[#15803D] dark:text-[#4ADE80]'
                    : 'text-[#B42318] dark:text-[#FCA5A5]'
                }
              >
                {formatEUR(capacityPreview.capacity)}/mes
              </strong>{' '}
              (Ingresos {formatEUR(capacityPreview.totalIncome)} − gasto habitual{' '}
              {formatEUR(capacityPreview.habitualSpend)} (fijos{' '}
              {formatEUR(capacityPreview.fixedMonthly)} + variables{' '}
              {formatEUR(capacityPreview.variableMonthly)}))
            </p>
          </div>

          {/* Live Preview */}
          <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Vista previa del reparto</p>
            <p className="font-display text-base sm:text-lg font-bold tabular-nums">
              De cada 100 €, {previewPctA.toLocaleString('es-ES')} € {nameA} / {previewPctB.toLocaleString('es-ES')} € {nameB}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSaveSplit()}
            className="w-full sm:w-auto min-h-[44px] px-6 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold transition-colors"
          >
            Guardar reparto
          </button>
        </section>

        {/* Preferences + Household Invite */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h2 className="font-display text-base font-bold">Tu interfaz y tema</h2>

            <div className="flex items-center justify-between gap-3 py-1">
              <div>
                <p className="text-sm font-semibold">Modo de uso</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sencillo oculta filtros avanzados y gráficas detalladas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleUiMode()}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold whitespace-nowrap"
              >
                {uiMode === 'sencillo' ? 'Sencillo' : 'Avanzado'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 py-1 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div>
                <p className="text-sm font-semibold">Apariencia</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Tema claro u oscuro.</p>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 py-1 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div>
                <p className="text-sm font-semibold">Colores de categorías</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Paleta compartida del hogar en calendario, etiquetas y gráficos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setColorModalOpen(true)}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Palette className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                <span>Personalizar</span>
              </button>
            </div>

            <div className="pt-2 space-y-2">
              <PWAInstallButton variant="full" />
              <button
                type="button"
                onClick={() => setActiveTab('ayuda')}
                className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <HelpCircle className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                <span>Ayuda e instalación en móvil</span>
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="font-display text-base font-bold flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                  <span>Recordatorios en este dispositivo</span>
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Aviso al abrir Nido si hay un cargo próximo sin apuntar (hasta 1 vez al día).
                </p>
              </div>
              <button
                type="button"
                disabled={notifPermission === 'unsupported'}
                onClick={() => void handleToggleDeviceNotices()}
                className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                  noticeSettings.enabled && notifPermission === 'granted'
                    ? 'bg-[#0E5A64] text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                {noticeSettings.enabled && notifPermission === 'granted' ? 'Activados' : 'Activar'}
              </button>
            </div>

            {notifPermission === 'denied' && (
              <p className="text-xs text-[#B42318] dark:text-[#FCA5A5]">
                Las notificaciones están bloqueadas para esta web en la configuración del navegador.
              </p>
            )}
            {notifPermission === 'unsupported' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Este navegador no admite notificaciones web. Usa «Exportar al calendario (.ics)» en Mensual.
              </p>
            )}

            <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Antelación del aviso
                </span>
                <div className="flex items-center gap-1">
                  {([1, 2, 3] as LocalNoticeDaysAhead[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => updateNoticeSettings({ daysAhead: d })}
                      className={`min-h-[44px] px-2.5 rounded-lg text-xs font-semibold border ${
                        noticeSettings.daysAhead === d
                          ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {d} {d === 1 ? 'día' : 'días'}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 min-h-[44px] cursor-pointer">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Mostrar importes exactos en el texto del aviso
                </span>
                <input
                  type="checkbox"
                  checked={noticeSettings.showAmountsInNotification}
                  onChange={(e) =>
                    updateNoticeSettings({ showAmountsInNotification: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#0E5A64]"
                />
              </label>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Nota gratuita sin servidor: solo se muestran cuando abres Nido. Para avisos con la app cerrada, exporta vuestros cobros a Google o Apple Calendar (.ics) en Mensual.
              </p>
            </div>
          </section>

          <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h2 className="font-display text-base font-bold">Hogar compartido</h2>

            <form onSubmit={handleSaveName} className="flex gap-2">
              <input
                aria-label="Nombre del hogar"
                type="text"
                maxLength={80}
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Guardar
              </button>
            </form>

            <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3.5 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-slate-600 dark:text-slate-400">Código de invitación</p>
                <p className="font-mono text-lg font-bold tracking-widest">
                  {household?.inviteCode || '—'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Compartir código de invitación"
                  onClick={() => void handleShareInvite()}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Copiar código de invitación"
                  onClick={() => void handleCopyInvite()}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center"
                >
                  {copied ? <Check className="w-4 h-4 text-[#15803D]" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  aria-label="Regenerar código de invitación"
                  onClick={() =>
                    householdId &&
                    household &&
                    currentUserProfile &&
                    void repo.regenerateInviteCode(
                      householdId,
                      household.inviteCode,
                      currentUserProfile
                    )
                  }
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-slate-500 dark:text-slate-400">
                Miembros ({members.length}/2)
              </p>
              {members.map((m) => (
                <div key={m.uid} className="flex items-center justify-between py-1">
                  <span className="font-medium">{m.displayName}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {m.uiMode === 'avanzado' ? 'Avanzado' : 'Sencillo'}
                  </span>
                </div>
              ))}
            </div>

            {seedPending && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Faltan por cargar las listas iniciales por defecto en este hogar.
                </p>
                <button
                  type="button"
                  disabled={seedingDefaults}
                  onClick={() => void retryDefaultSeed()}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                >
                  {seedingDefaults ? 'Cargando listas...' : 'Cargar listas por defecto'}
                </button>
              </div>
            )}

            {!isDemoMode && (
              <form
                onSubmit={handleSwitchSubmit}
                className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2"
              >
                <label
                  htmlFor="switch-invite-code"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  Unirse a otro hogar con código
                </label>
                {switchError && (
                  <p role="alert" className="text-xs text-[#B42318] dark:text-[#FCA5A5]">
                    {switchError}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    id="switch-invite-code"
                    type="text"
                    maxLength={6}
                    value={switchInviteCode}
                    onChange={(e) => setSwitchInviteCode(e.target.value.toUpperCase())}
                    placeholder="Código de 6 caracteres"
                    className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-sm uppercase tracking-widest"
                  />
                  <button
                    type="submit"
                    disabled={switchingHousehold}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    {switchingHousehold ? 'Cambiando...' : 'Cambiar hogar'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>

      {/* Full Reports & JSON Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="font-display text-base font-bold">Informe completo por fechas</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rep-from" className="block text-xs font-medium mb-1">Desde</label>
              <input
                id="rep-from"
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label htmlFor="rep-to" className="block text-xs font-medium mb-1">Hasta</label>
              <input
                id="rep-to"
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleFullReportCSV()}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Exportar CSV (Excel ES)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleFullReportPDF()}
              className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Generar informe PDF</span>
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-bold">Copia de seguridad (JSON)</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Exporta todo vuestro historial o restaura una copia validada contra esquema. Cada miembro exporta los datos compartidos y solo sus propios gastos privados.
            </p>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 pt-1">
              {(() => {
                const days = daysSinceLastBackup(lastBackupDate, todayISO);
                if (!lastBackupDate) {
                  return 'Última exportación solicitada desde este dispositivo: ninguna registrada aún.';
                }
                const suffix =
                  days === 0
                    ? ' (hoy)'
                    : days === 1
                      ? ' (hace 1 día)'
                      : days !== null
                        ? ` (hace ${days} días)`
                        : '';
                return `Última exportación solicitada desde este dispositivo: ${formatDateES(lastBackupDate)}${suffix}.`;
              })()}
            </p>
          </div>

          {shouldShowBackupReminder(lastBackupDate, todayISO, 30) && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              {lastBackupDate
                ? 'Han pasado más de 30 días desde la última exportación en este dispositivo. Conviene guardar una copia actualizada.'
                : 'Aún no has descargado ninguna copia JSON desde este dispositivo. Te recomendamos guardar una al menos una vez al mes.'}
            </div>
          )}

          {importError && (
            <div role="alert" className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs">
              {importError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleExportJSON()}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Exportar JSON</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <Upload className="w-4 h-4" />
              <span>Importar JSON</span>
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[44px] px-4 rounded-xl border border-[#B42318]/40 text-[#B42318] dark:text-[#FCA5A5] text-xs sm:text-sm font-semibold flex items-center gap-1.5 ml-auto"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingBackup)}
        title="Restaurar copia de seguridad JSON"
        description={
          pendingBackup
            ? `Se importarán ${pendingBackup.transactions.length} gastos, ${pendingBackup.items.length} muebles, ${pendingBackup.goals.length} metas y la configuración de "${pendingBackup.householdName}".`
            : ''
        }
        confirmLabel="Restaurar copia"
        destructive={false}
        onConfirm={() => void handleConfirmImport()}
        onCancel={() => setPendingBackup(null)}
      />

      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title="Cambiar de hogar activo"
        description={
          switchConfirm
            ? `Ahora perteneces a "${household?.name || 'tu hogar actual'}". Si confirmas, tu cuenta pasará a conectarse con "${switchConfirm.targetName}" (los datos del hogar actual no se borran, pero dejarán de mostrarse como activos).`
            : ''
        }
        confirmLabel="Cambiar de hogar"
        destructive={false}
        onConfirm={() => {
          if (switchConfirm) void runSwitchHousehold(switchConfirm.code, true);
        }}
        onCancel={() => setSwitchConfirm(null)}
      />

      <CategoryColorModal open={colorModalOpen} onClose={() => setColorModalOpen(false)} />
    </div>
  );
};
