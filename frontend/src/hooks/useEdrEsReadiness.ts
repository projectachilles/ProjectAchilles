import { useCallback, useEffect, useRef, useState } from 'react';
import { edrReadinessApi } from '@/services/api/edrReadiness';
import type { EdrEsReadiness } from '@/services/api/edrReadiness';
import type { EdrVendorKey } from '@/lib/edrVendors';

const POLL_MS = 60_000;

/**
 * Elasticsearch readiness for an EDR settings card: the stored result once the
 * integration is configured, the result a save returned, or a fresh check on
 * Test. While not ready it re-reads once a minute, so the notice clears on its
 * own once the API key is fixed.
 */
export function useEdrEsReadiness(vendor: EdrVendorKey, configured: boolean) {
  const [readiness, setReadiness] = useState<EdrEsReadiness | null>(null);
  const [fromTest, setFromTest] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    try {
      const r = await edrReadinessApi.get(vendor, fresh);
      if (r) {
        setReadiness(r);
        setFromTest(fresh);
      }
      return r;
    } catch {
      return null; // keep the last result; the card's own error handling covers the rest
    }
  }, [vendor]);

  // Disconnect (configured -> not configured) drops the old result; a Test
  // before the first save never had a configured state, so it is kept.
  const wasConfigured = useRef(configured);
  useEffect(() => {
    if (configured) void load(false);
    else if (wasConfigured.current) setReadiness(null);
    wasConfigured.current = configured;
  }, [configured, load]);

  const notReady = readiness?.status === 'not_ready';
  useEffect(() => {
    if (!configured || !notReady) return;
    const id = setInterval(() => { void load(false); }, POLL_MS);
    return () => clearInterval(id);
  }, [configured, notReady, load]);

  const fromSave = useCallback((r: EdrEsReadiness | undefined) => {
    if (!r) return;
    setReadiness(r);
    setFromTest(false);
  }, []);

  const check = useCallback(() => load(true), [load]);

  return { readiness, fromTest, fromSave, check };
}
