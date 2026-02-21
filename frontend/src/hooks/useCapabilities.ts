import { useState, useEffect } from 'react';
import { apiClient } from './useAuthenticatedApi';

export interface Capabilities {
  build: boolean;
  buildUpload: boolean;
  certGenerate: boolean;
  certUpload: boolean;
  gitSync: boolean;
  agentBuild: boolean;
  platform: string;
}

// Default capabilities: assume all features available (Docker/Railway/Render backends)
const DEFAULT_CAPABILITIES: Capabilities = {
  build: true,
  buildUpload: true,
  certGenerate: true,
  certUpload: true,
  gitSync: true,
  agentBuild: true,
  platform: 'docker',
};

let cachedCapabilities: Capabilities | null = null;

export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>(
    cachedCapabilities ?? DEFAULT_CAPABILITIES,
  );

  useEffect(() => {
    if (cachedCapabilities) return;

    let cancelled = false;
    apiClient.get('/capabilities')
      .then((res) => {
        if (!cancelled) {
          const caps = { ...DEFAULT_CAPABILITIES, ...res.data };
          cachedCapabilities = caps;
          setCapabilities(caps);
        }
      })
      .catch(() => {
        // Older backends may not have /api/capabilities — fall back to defaults
        if (!cancelled) {
          cachedCapabilities = DEFAULT_CAPABILITIES;
        }
      });

    return () => { cancelled = true; };
  }, []);

  return capabilities;
}
