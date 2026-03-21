/**
 * Lightweight localStorage-based flash notification system.
 * Used for transient notifications (e.g., "new agent version built")
 * that appear in the NotificationBell without backend persistence.
 */

export interface FlashNotification {
  id: string;
  message: string;
  detail?: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning';
}

const STORAGE_KEY = 'achilles:flash-notifications';
const MAX_ITEMS = 10;

/** Read all flash notifications from localStorage. */
export function getFlashNotifications(): FlashNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as FlashNotification[];
    // Prune items older than 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return items.filter((n) => new Date(n.timestamp).getTime() > cutoff);
  } catch {
    return [];
  }
}

/** Push a new flash notification. Dispatches a storage event for cross-component reactivity. */
export function pushFlashNotification(
  message: string,
  options?: { detail?: string; type?: FlashNotification['type'] },
): void {
  const items = getFlashNotifications();
  const notification: FlashNotification = {
    id: `flash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    message,
    detail: options?.detail,
    timestamp: new Date().toISOString(),
    type: options?.type ?? 'info',
  };

  items.unshift(notification);
  const trimmed = items.slice(0, MAX_ITEMS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota errors
  }

  // Dispatch a custom event so same-tab components can react
  window.dispatchEvent(new CustomEvent('achilles:flash-notification', { detail: notification }));
}

/** Clear all flash notifications. */
export function clearFlashNotifications(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
