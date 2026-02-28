import { useState, useEffect } from 'react';
import { integrationsApi } from '@/services/api/integrations';

/** Check if Defender integration is configured. Used for conditional UI rendering. */
export function useDefenderConfig() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    integrationsApi.getDefenderSettings()
      .then((settings) => setConfigured(settings.configured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  return { configured, loading };
}
