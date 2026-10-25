import { useState, useEffect } from 'react';
import { apiClient } from './useAuthenticatedApi';

export interface Capabilities {
  build: boolean;
  buildUpload: boolean;
  certGenerate: boolean;
  certUpload: boolean;
  gitSync: boolean;
  agentBuild: boolean;
  preExecutionNotices: boolean;
  campaigns: boolean;
  /** SentinelOne integration routes (backend-only; backend-serverless has none) */
  sentinelone: boolean;
  platform: string;
  /** false until /api/capabilities has resolved (or failed); values are defaults before then */
  loaded?: boolean;
}

// Default capabilities: assume all features available (Docker/Railway/Render backends)
const DEFAULT_CAPABILITIES: Capabilities = {
  build: true,
  buildUpload: true,
  certGenerate: true,
  certUpload: true,
  gitSync: true,
  agentBuild: true,
  preExecutionNotices: false,
  campaigns: false,
  sentinelone: false,
  platform: 'docker',
};

let cachedCapabilities: Capabilities | null = null;

export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>(
    cachedCapabilities ? { ...cachedCapabilities, loaded: true } : { ...DEFAULT_CAPABILITIES, loaded: false },
  );

  useEffect(() => {
    if (cachedCapabilities) return;

    let cancelled = false;
    apiClient.get('/capabilities')
      .then((res) => {
        if (!cancelled) {
          const caps = { ...DEFAULT_CAPABILITIES, ...res.data };
          cachedCapabilities = caps;
          setCapabilities({ ...caps, loaded: true });
        }
      })
      .catch(() => {
        // Older backends may not have /api/capabilities — fall back to defaults
        if (!cancelled) {
          cachedCapabilities = DEFAULT_CAPABILITIES;
          setCapabilities({ ...DEFAULT_CAPABILITIES, loaded: true });
        }
      });

    return () => { cancelled = true; };
  }, []);

  return capabilities;
}
