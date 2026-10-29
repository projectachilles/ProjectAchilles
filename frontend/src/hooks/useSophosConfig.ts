import { useState, useEffect } from 'react';
import { sophosApi } from '@/services/api/sophos';

/** Check if the Sophos integration is configured. Used for conditional UI rendering. */
export function useSophosConfig() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sophosApi.getSettings()
      .then((settings) => setConfigured(settings.configured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  return { configured, loading };
}
