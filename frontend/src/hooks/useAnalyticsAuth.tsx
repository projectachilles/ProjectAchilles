import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { analyticsApi } from '../services/api/analytics';

interface AnalyticsSettings {
  configured: boolean;
  connectionType?: 'cloud' | 'direct';
  indexPattern?: string;
}

interface AnalyticsAuthContextType {
  configured: boolean;
  loading: boolean;
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
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const checkConfiguration = useCallback(async () => {
    try {
      setLoading(true);
      const response = await analyticsApi.getSettings();
      setSettings(response);
      setConfigured(response.configured);
    } catch (error) {
      console.error('Failed to check analytics configuration:', error);
      setConfigured(false);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConfiguration();
  }, [checkConfiguration]);

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
