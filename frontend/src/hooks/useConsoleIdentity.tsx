import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useLocation } from 'react-router-dom';
import { consoleIdentityApi } from '@/services/api/consoleIdentity';
import { identityHex } from '@/lib/identityColors';
import { documentTitle, faviconDataUrl } from '@/lib/consoleIdentityDocument';
import type { ConsoleIdentity } from '@/types/consoleIdentity';

interface ConsoleIdentityContextType {
  identity: ConsoleIdentity | null;
  active: boolean;
  setIdentity: (identity: ConsoleIdentity) => void;
  refresh: () => Promise<void>;
}

const INERT: ConsoleIdentityContextType = {
  identity: null,
  active: false,
  setIdentity: () => {},
  refresh: async () => {},
};

const ConsoleIdentityContext = createContext<ConsoleIdentityContextType>(INERT);

export function ConsoleIdentityProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { pathname } = useLocation();
  const { loaded, consoleIdentity } = useCapabilities();
  // Backend-only feature: until capabilities load, or where the backend lacks it, never fetch.
  const enabled = loaded === true && consoleIdentity;
  const [identity, setIdentity] = useState<ConsoleIdentity | null>(null);
  const hasIdentity = useRef(false);
  const original = useRef<{ title: string; icon: string | null } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await consoleIdentityApi.get();
      hasIdentity.current = true;
      setIdentity(next);
    } catch {
      // A failed refetch keeps the last good identity so the cue never flickers;
      // only a failed first load leaves it cleared.
      if (!hasIdentity.current) setIdentity(null);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !enabled) {
      hasIdentity.current = false;
      setIdentity(null);
      return;
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isLoaded, isSignedIn, enabled, refresh]);

  const code = identity?.code ?? null;
  const color = identity?.color ?? 'none';
  const active = code != null;

  const iconLink = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');

  // Favicon: set while active, restore when not.
  useEffect(() => {
    if (!code) return;
    const link = iconLink();
    if (!original.current) {
      original.current = { title: document.title, icon: link?.getAttribute('href') ?? null };
    }
    link?.setAttribute('href', faviconDataUrl(code, identityHex(color)));
  }, [code, color]);

  // Title: follows the route while active (the report page owns its own).
  useEffect(() => {
    if (!code) return;
    if (!original.current) {
      original.current = { title: document.title, icon: iconLink()?.getAttribute('href') ?? null };
    }
    const title = documentTitle(pathname, code);
    if (title !== null) document.title = title;
  }, [code, pathname]);

  // Restore originals when identity becomes inactive.
  useEffect(() => {
    if (code || !original.current) return;
    document.title = original.current.title;
    if (original.current.icon !== null) iconLink()?.setAttribute('href', original.current.icon);
    original.current = null;
  }, [code]);

  const value = useMemo<ConsoleIdentityContextType>(
    () => ({
      identity,
      active,
      setIdentity: (next) => {
        hasIdentity.current = true;
        setIdentity(next);
      },
      refresh,
    }),
    [identity, active, refresh],
  );

  return <ConsoleIdentityContext.Provider value={value}>{children}</ConsoleIdentityContext.Provider>;
}

export function useConsoleIdentity(): ConsoleIdentityContextType {
  return useContext(ConsoleIdentityContext);
}
