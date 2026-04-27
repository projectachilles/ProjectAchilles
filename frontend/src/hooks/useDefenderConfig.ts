import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { integrationsApi } from '@/services/api/integrations';

/** Check if Defender integration is configured. Used for conditional UI rendering. */
export function useDefenderConfig() {
  // Wait for Clerk before calling backend; otherwise the request goes out
  // unauthed → 302 → Clerk HTML redirect → catch sets configured:false and
  // never re-runs after sign-in. (Same race that bit useAnalyticsAuth.)
  const { isLoaded, isSignedIn } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setConfigured(false);
      setLoading(false);
      return;
    }
    integrationsApi.getDefenderSettings()
      .then((settings) => setConfigured(settings.configured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn]);

  return { configured, loading };
}
