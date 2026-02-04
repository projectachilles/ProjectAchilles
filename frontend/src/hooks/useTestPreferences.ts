import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUser } from '@clerk/clerk-react';

export interface RecentEntry {
  uuid: string;
  name: string;
  viewedAt: number;
}

interface TestPreferences {
  favorites: string[];
  recent: RecentEntry[];
}

const RECENT_LIMIT = 20;
const PREFS_EVENT = 'test-prefs-changed';

function getStorageKey(userId: string): string {
  return `achilles-test-prefs-${userId}`;
}

function readPrefs(userId: string): TestPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return { favorites: [], recent: [] };
}

function writePrefs(userId: string, prefs: TestPreferences) {
  localStorage.setItem(getStorageKey(userId), JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

export function useTestPreferences() {
  const { user } = useUser();
  const userId = user?.id ?? '';
  const [prefs, setPrefs] = useState<TestPreferences>(() => readPrefs(userId));

  // Re-read when userId changes or when another hook instance writes
  useEffect(() => {
    if (!userId) return;
    setPrefs(readPrefs(userId));

    const handler = () => setPrefs(readPrefs(userId));
    window.addEventListener(PREFS_EVENT, handler);
    return () => window.removeEventListener(PREFS_EVENT, handler);
  }, [userId]);

  const favorites = useMemo(() => new Set(prefs.favorites), [prefs.favorites]);

  const isFavorite = useCallback(
    (uuid: string) => favorites.has(uuid),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (uuid: string) => {
      if (!userId) return;
      const current = readPrefs(userId);
      const idx = current.favorites.indexOf(uuid);
      if (idx >= 0) {
        current.favorites.splice(idx, 1);
      } else {
        current.favorites.push(uuid);
      }
      writePrefs(userId, current);
    },
    [userId]
  );

  const trackView = useCallback(
    (uuid: string, name: string) => {
      if (!userId) return;
      const current = readPrefs(userId);
      // Remove existing entry for this uuid
      current.recent = current.recent.filter(r => r.uuid !== uuid);
      // Prepend new entry
      current.recent.unshift({ uuid, name, viewedAt: Date.now() });
      // Trim to limit
      current.recent = current.recent.slice(0, RECENT_LIMIT);
      writePrefs(userId, current);
    },
    [userId]
  );

  return {
    favorites,
    recentTests: prefs.recent,
    isFavorite,
    toggleFavorite,
    trackView,
  };
}
