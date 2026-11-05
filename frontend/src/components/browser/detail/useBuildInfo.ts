import { useState, useEffect, useCallback } from 'react';
import { testsApi } from '@/services/api/tests';
import type { BuildInfo } from '@/types/test';

export interface BuildInfoState {
  buildInfo: BuildInfo | null;
  setBuildInfo: (info: BuildInfo | null) => void;
  loading: boolean;
  download: () => Promise<void>;
}

interface Loaded {
  uuid: string;
  info: BuildInfo | null;
}

/**
 * Build state of one test, fetched when `uuid` changes. Pass `null` for an
 * inert state that makes no request (used when the state is shared from
 * above). The page owns one instance and hands it to the header and the
 * Deploy panel so both see the same build.
 */
export function useBuildInfo(uuid: string | null): BuildInfoState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (uuid === null) return;
    let stale = false;
    testsApi
      .getBuildInfo(uuid)
      .then((info) => { if (!stale) setLoaded({ uuid, info }); })
      // Non-critical: callers show their empty state
      .catch(() => { if (!stale) setLoaded({ uuid, info: null }); });
    return () => { stale = true; };
  }, [uuid]);

  // Derived, so a uuid switch never shows the previous test's build.
  const current = uuid !== null && loaded?.uuid === uuid;
  const buildInfo = current ? loaded.info : null;
  const loading = uuid !== null && !current;

  const setBuildInfo = useCallback((info: BuildInfo | null) => {
    if (uuid !== null) setLoaded({ uuid, info });
  }, [uuid]);

  const download = useCallback(async () => {
    if (uuid === null) return;
    try {
      await testsApi.downloadBuild(uuid);
    } catch {
      // ignore
    }
  }, [uuid]);

  return { buildInfo, setBuildInfo, loading, download };
}
