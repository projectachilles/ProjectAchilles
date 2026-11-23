import { useCallback, useEffect, useState } from 'react';
import { browserApi } from '@/services/api/browser';
import type { TestVersionsResponse } from '@/types/testVersion';
import { useCapabilities } from './useCapabilities';

export interface UseTestVersions {
  data: TestVersionsResponse | null;
  loading: boolean;
  checking: boolean;
  /** Ask the server to re-check the published versions, then show the result. */
  checkNow: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Version status of every test. Makes no request when the backend has no versions endpoint. */
export function useTestVersions(): UseTestVersions {
  const { testVersions } = useCapabilities();
  const [data, setData] = useState<TestVersionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const reload = useCallback(async () => {
    if (!testVersions) return;
    setLoading(true);
    try {
      setData(await browserApi.getTestVersions());
    } catch (err) {
      console.error('Loading test versions failed:', err);
    } finally {
      setLoading(false);
    }
  }, [testVersions]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const checkNow = useCallback(async () => {
    if (!testVersions) return;
    setChecking(true);
    try {
      setData(await browserApi.checkTestUpdates());
    } catch (err) {
      // 409: a check is already running; the read below shows its state.
      console.error('Checking for test updates failed:', err);
      try {
        setData(await browserApi.getTestVersions());
      } catch {
        // keep what we have
      }
    } finally {
      setChecking(false);
    }
  }, [testVersions]);

  return { data, loading, checking, checkNow, reload };
}
