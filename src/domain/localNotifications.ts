import { formatEUR, getUpcomingChargesWithinDays, type UpcomingAlertCharge } from './finance';
import type { RecurringExpense, Transaction } from '../types/nido';

export type LocalNoticeDaysAhead = 1 | 2 | 3;

export interface LocalNoticeSettings {
  enabled: boolean;
  daysAhead: LocalNoticeDaysAhead;
  showAmountsInNotification: boolean;
  lastNotifiedDate: string;
}

export const DEFAULT_LOCAL_NOTICE_SETTINGS: LocalNoticeSettings = {
  enabled: false,
  daysAhead: 2,
  showAmountsInNotification: false,
  lastNotifiedDate: '',
};

export const LOCAL_NOTICE_UPDATED_EVENT = 'nido:local-notice-updated';

export function buildLocalNoticeStorageKey(householdId: string, uid: string): string {
  return `nido_local_notices_v1_${householdId}_${uid}`;
}

export function loadLocalNoticeSettings(storageKey: string): LocalNoticeSettings {
  if (typeof window === 'undefined' || !storageKey) {
    return { ...DEFAULT_LOCAL_NOTICE_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_LOCAL_NOTICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LocalNoticeSettings>;
    const days = parsed.daysAhead === 1 || parsed.daysAhead === 2 || parsed.daysAhead === 3 ? parsed.daysAhead : 2;
    return {
      enabled: Boolean(parsed.enabled),
      daysAhead: days,
      showAmountsInNotification: Boolean(parsed.showAmountsInNotification),
      lastNotifiedDate:
        typeof parsed.lastNotifiedDate === 'string' ? parsed.lastNotifiedDate.slice(0, 10) : '',
    };
  } catch {
    return { ...DEFAULT_LOCAL_NOTICE_SETTINGS };
  }
}

export function saveLocalNoticeSettings(storageKey: string, settings: LocalNoticeSettings): void {
  if (typeof window === 'undefined' || !storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(LOCAL_NOTICE_UPDATED_EVENT, { detail: storageKey }));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export interface DueDeviceNotificationPayload {
  count: number;
  items: UpcomingAlertCharge[];
  title: string;
  body: string;
}

function formatRelativeDayText(daysUntil: number): string {
  if (daysUntil === 0) return 'Hoy';
  if (daysUntil === 1) return 'Mañana';
  return `En ${daysUntil} días`;
}

/**
 * Pure selector for due recurring charges on this device.
 * - Excludes private transactions & settled items via getUpcomingChargesWithinDays.
 * - Hides exact EUR amounts by default unless showAmounts === true.
 */
export function getDueNotificationsForDevice(
  recurring: RecurringExpense[],
  transactions: Transaction[],
  todayISO: string,
  daysAhead: LocalNoticeDaysAhead,
  showAmounts = false
): DueDeviceNotificationPayload {
  const items = getUpcomingChargesWithinDays(recurring, todayISO, daysAhead, transactions);
  if (items.length === 0) {
    return { count: 0, items: [], title: '', body: '' };
  }

  if (items.length === 1) {
    const item = items[0];
    const when = formatRelativeDayText(item.daysUntil);
    const title = 'Nido · Próximo cobro';
    const body = showAmounts
      ? `${when} toca pagar ${item.concept} (${formatEUR(item.amount)}).`
      : `${when} tienes un cobro previsto: ${item.concept}.`;
    return { count: 1, items, title, body };
  }

  const names = items.slice(0, 3).map((item) =>
    showAmounts ? `${item.concept} (${formatEUR(item.amount)})` : item.concept
  );
  const extra = items.length > 3 ? ` y ${items.length - 3} más` : '';
  return {
    count: items.length,
    items,
    title: `Nido · ${items.length} cobros próximos`,
    body: `Pendientes en los próximos días: ${names.join(', ')}${extra}.`,
  };
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function syncAppBadge(pendingCount: number): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (pendingCount > 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(pendingCount);
    } else if (pendingCount <= 0 && typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge();
    }
  } catch {
    // Badge API unsupported in current context
  }
}

export function triggerForegroundNotificationCheck(params: {
  storageKey: string;
  recurring: RecurringExpense[];
  transactions: Transaction[];
  todayISO: string;
}): boolean {
  const { storageKey, recurring, transactions, todayISO } = params;
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;

  const settings = loadLocalNoticeSettings(storageKey);
  if (!settings.enabled) return false;
  if (settings.lastNotifiedDate === todayISO) return false;

  const payload = getDueNotificationsForDevice(
    recurring,
    transactions,
    todayISO,
    settings.daysAhead,
    settings.showAmountsInNotification
  );
  if (payload.count === 0) return false;

  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: `nido-upcoming-${todayISO}`,
    });
    saveLocalNoticeSettings(storageKey, {
      ...settings,
      lastNotifiedDate: todayISO,
    });
    return true;
  } catch {
    return false;
  }
}
