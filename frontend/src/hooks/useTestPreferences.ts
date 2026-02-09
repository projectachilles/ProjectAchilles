import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@clerk/clerk-react";
import { apiClient } from "./useAuthenticatedApi";

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
const PREFS_EVENT = "test-prefs-changed";

function getStorageKey(userId: string): string {
  return `achilles-test-prefs-${userId}`;
}

async function readPrefs(_userId?: string): Promise<TestPreferences> {
  try {
    // Fetch favorites from backend via API
    const res = await apiClient.get("/favorites");
    const backendData = res.data as { favorites: string[] };
    return { favorites: backendData.favorites || [], recent: [] };
  } catch (e) {
    console.error("Failed to read preferences:", e);
    return { favorites: [], recent: [] };
  }
}

function writePrefs(userId: string, prefs: TestPreferences) {
  localStorage.setItem(getStorageKey(userId), JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

export function useTestPreferences() {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const [prefs, setPrefs] = useState<TestPreferences>({ favorites: [], recent: [] });

  // Re-read when userId changes or when another hook instance writes
  useEffect(() => {
    if (!userId) return;

    // Load from backend on mount
    readPrefs(userId).then((data) => setPrefs(data));

    const handler = () => {
      readPrefs(userId).then((data) => setPrefs(data));
    };
    window.addEventListener(PREFS_EVENT, handler);
    return () => window.removeEventListener(PREFS_EVENT, handler);
  }, [userId]);

  const favorites = useMemo(() => new Set(prefs.favorites), [prefs.favorites]);

  const isFavorite = useCallback(
    (uuid: string) => favorites.has(uuid),
    [favorites],
  );

  const toggleFavorite = useCallback(
    async (uuid: string) => {
      if (!userId) return;
      try {
        await apiClient.post("/favorites/add", { test_id: uuid });
        const current = await readPrefs(userId);
        const idx = current.favorites.indexOf(uuid);
        if (idx >= 0) {
          current.favorites.splice(idx, 1);
        } else {
          current.favorites.push(uuid);
        }
        writePrefs(userId, current);
      } catch (error) {
        console.error("Failed to toggle favorite:", error);
      }
    },
    [userId],
  );

  const trackView = useCallback(
    (uuid: string, name: string) => {
      if (!userId) return;
      setPrefs((prev) => {
        const current = { ...prev };
        current.recent = current.recent.filter((r: RecentEntry) => r.uuid !== uuid);
        current.recent.unshift({ uuid, name, viewedAt: Date.now() });
        current.recent = current.recent.slice(0, RECENT_LIMIT);
        writePrefs(userId, current);
        return current;
      });
    },
    [userId],
  );

  return {
    favorites,
    recentTests: prefs.recent,
    isFavorite,
    toggleFavorite,
    trackView,
  };
}
