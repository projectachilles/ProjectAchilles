import { useState, useEffect } from 'react';
import { useCapabilities } from '@/hooks/useCapabilities';
import { analyticsApi, type TestFleetResponse } from '@/services/api/analytics';

interface Loaded {
  uuid: string;
  data: TestFleetResponse | null;
}

/**
 * Fleet results for one test. Fetches only once capabilities have loaded and
 * report `testFleet`. Any failure is `data: null`: fleet data is optional, so
 * the page never shows an error for it.
 */
export function useTestFleet(uuid: string): { data: TestFleetResponse | null; loading: boolean } {
  const caps = useCapabilities();
  const enabled = caps.loaded === true && caps.testFleet === true;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    analyticsApi
      .getTestFleet(uuid)
      .then((data) => { if (!stale) setLoaded({ uuid, data }); })
      .catch(() => { if (!stale) setLoaded({ uuid, data: null }); });
    return () => { stale = true; };
  }, [uuid, enabled]);

  const current = enabled && loaded?.uuid === uuid;
  return { data: current ? loaded.data : null, loading: enabled && !current };
}
