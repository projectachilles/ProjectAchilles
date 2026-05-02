import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { analyticsApi } from '../services/api/analytics';

interface AnalyticsSettings {
  configured: boolean;
  connectionType?: 'cloud' | 'direct';
  indexPattern?: string;
}

interface AnalyticsAuthContextType {
  configured: boolean;
  loading: boolean;
  error: Error | null;
  settings: AnalyticsSettings | null;
  settingsVersion: number;
  checkConfiguration: () => Promise<void>;
  updateSettings: (settings: AnalyticsSettings) => void;
}

const AnalyticsAuthContext = createContext<AnalyticsAuthContextType | undefined>(undefined);

interface AnalyticsAuthProviderProps {
  children: ReactNode;
}

export function AnalyticsAuthProvider({ children }: AnalyticsAuthProviderProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const checkConfiguration = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await analyticsApi.getSettings();
      setSettings(response);
      setConfigured(response.configured);
    } catch (err) {
      console.error('Failed to check analytics configuration:', err);
      setError(err instanceof Error ? err : new Error('Failed to check analytics configuration'));
      setConfigured(false);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Wait for Clerk to hydrate before calling /analytics/settings: getToken()
  // returns null until then, so an unauthenticated request would hit a 401
  // and the module would render as "locked" until the user refreshed.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setConfigured(false);
      setSettings(null);
      setError(null);
      setLoading(false);
      return;
    }
    checkConfiguration();
  }, [isLoaded, isSignedIn, checkConfiguration]);

  const updateSettings = (newSettings: AnalyticsSettings) => {
    setSettings(newSettings);
    setConfigured(newSettings.configured);
    // Increment version to notify consumers that settings have changed
    setSettingsVersion(v => v + 1);
  };

  return (
    <AnalyticsAuthContext.Provider
      value={{
        configured,
        loading,
        error,
        settings,
        settingsVersion,
        checkConfiguration,
        updateSettings,
      }}
    >
      {children}
    </AnalyticsAuthContext.Provider>
  );
}

export function useAnalyticsAuth() {
  const context = useContext(AnalyticsAuthContext);
  if (context === undefined) {
    throw new Error('useAnalyticsAuth must be used within an AnalyticsAuthProvider');
  }
  return context;
}
