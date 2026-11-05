import { useState, useEffect, useCallback } from 'react';
import { testsApi } from '@/services/api/tests';
import type { BuildInfo } from '@/types/test';

/**
 * Build state of one test: fetched when `uuid` changes. Shared by the detail
 * header (Download) and the Deploy panel (BuildSection).
 */
export function useBuildInfo(uuid: string) {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    testsApi
      .getBuildInfo(uuid)
      .then((info) => { if (!stale) setBuildInfo(info); })
      .catch(() => {
        // Non-critical: callers show their empty state
        if (!stale) setBuildInfo(null);
      })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [uuid]);

  const download = useCallback(async () => {
    try {
      await testsApi.downloadBuild(uuid);
    } catch {
      // ignore
    }
  }, [uuid]);

  return { buildInfo, setBuildInfo, loading, download };
}
