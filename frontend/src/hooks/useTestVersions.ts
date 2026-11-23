import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { browserApi } from '@/services/api/browser';
import type { TestVersionsResponse } from '@/types/testVersion';
import { useCapabilities } from './useCapabilities';

export interface UseTestVersions {
  data: TestVersionsResponse | null;
  loading: boolean;
  checking: boolean;
  /** Why the last Check now failed (not a 409); cleared by the next successful check or reload. */
  checkError: string | null;
  /** Ask the server to re-check the published versions, then show the result. */
  checkNow: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Version status of every test. Makes no request when the backend has no versions endpoint. */
function checkFailureMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 403) {
    return "You don't have permission to check for updates";
  }
  const serverMessage = axios.isAxiosError(err) ? (err.response?.data as { error?: unknown } | undefined)?.error : undefined;
  return `Could not check for updates: ${typeof serverMessage === 'string' && serverMessage ? serverMessage : 'request failed'}`;
}

export function useTestVersions(): UseTestVersions {
  const { testVersions } = useCapabilities();
  const [data, setData] = useState<TestVersionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!testVersions) return;
    setLoading(true);
    try {
      setData(await browserApi.getTestVersions());
      setCheckError(null);
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
      setCheckError(null);
    } catch (err) {
      console.error('Checking for test updates failed:', err);
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        // A check is already running: show its state, no error.
        try {
          setData(await browserApi.getTestVersions());
          setCheckError(null);
        } catch {
          // keep what we have
        }
      } else {
        setCheckError(checkFailureMessage(err));
      }
    } finally {
      setChecking(false);
    }
  }, [testVersions]);

  return { data, loading, checking, checkError, checkNow, reload };
}
