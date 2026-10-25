import { useState, useEffect } from 'react';
import { sentinelOneApi } from '@/services/api/sentinelone';

/** Check if the SentinelOne integration is configured. Used for conditional UI rendering. */
export function useSentinelOneConfig() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sentinelOneApi.getSettings()
      .then((settings) => setConfigured(settings.configured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  return { configured, loading };
}
