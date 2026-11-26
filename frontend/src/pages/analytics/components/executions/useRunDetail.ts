import { useState, useMemo, useRef, useCallback } from 'react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import { browserApi } from '@/services/api/browser';
import { defenderApi, type RelatedAlertsResponse } from '@/services/api/defender';
import type { RelatedCrowdStrikeAlertsResponse } from '@/services/api/crowdstrike';
import type { AlertsForTestItem } from '@/services/api/alertsForTests';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useCrowdStrikeConfig } from '@/hooks/useCrowdStrikeConfig';
import { useSentinelOneConfig } from '@/hooks/useSentinelOneConfig';
import { useSophosConfig } from '@/hooks/useSophosConfig';
import { ENDPOINT_VENDOR_IDS, VENDORS, type EndpointVendorId } from '../integrations/vendorConfig';
import { stageAlertsKey, type DescriptionData, type EndpointAlertState, type RunDetailPanelProps } from './detailParts';
import type { DisplayRow } from './shared';

/**
 * What a run's detail shows beyond the row itself: the test's description and
 * the alerts related to each stage, loaded on demand and kept for the life of
 * the page. The executions list and the coverage matrix's drawer both use it,
 * so a run reads the same in either.
 */
export interface RunDetail {
  /** Spread into RunDetailPanel, next to `row` and the dialogs' props. */
  panelProps: Pick<
    RunDetailPanelProps,
    | 'showVersions'
    | 'defenderConfigured'
    | 'endpointAlerts'
    | 'descriptionMap'
    | 'descriptionLoadingKey'
    | 'alertsMap'
    | 'alertsLoading'
    | 'stageAlertsCacheKey'
    | 'expandedControlIndex'
    | 'onToggleControl'
  >;
  /** Load what the panel needs for this run; what is already loaded is not asked again. */
  prime: (row: DisplayRow) => void;
  /** Close the open stage (another run is being shown). */
  collapseControls: () => void;
}

function emptyCaches(): Record<EndpointVendorId, Map<string, RelatedCrowdStrikeAlertsResponse | null>> {
  return Object.fromEntries(ENDPOINT_VENDOR_IDS.map((id) => [id, new Map()])) as Record<
    EndpointVendorId,
    Map<string, RelatedCrowdStrikeAlertsResponse | null>
  >;
}

export function useRunDetail(): RunDetail {
  const { testVersions: showVersions } = useCapabilities();
  const { configured: defenderConfigured } = useDefenderConfig();
  const { configured: crowdstrikeConfigured } = useCrowdStrikeConfig();
  const { configured: sentineloneConfigured } = useSentinelOneConfig();
  const { configured: sophosConfigured } = useSophosConfig();

  const [expandedControlIndex, setExpandedControlIndex] = useState<number | null>(null);

  // Description cache: cacheKey → { description, hasInfoCard, hasReadme }
  const descriptionCache = useRef<Map<string, DescriptionData | null>>(new Map());
  const [descriptionLoading, setDescriptionLoading] = useState<string | null>(null);
  const [descriptionMap, setDescriptionMap] = useState<Map<string, DescriptionData | null>>(new Map());

  const fetchDescription = useCallback(async (exec: EnrichedTestExecution) => {
    const isBundleCtrl = exec.is_bundle_control && exec.bundle_id;
    const cacheKey = isBundleCtrl
      ? `${exec.bundle_id}::${exec.control_validator ?? ''}`
      : exec.test_uuid;

    if (descriptionCache.current.has(cacheKey)) {
      return;
    }

    setDescriptionLoading(cacheKey);
    try {
      const uuid = isBundleCtrl ? exec.bundle_id! : exec.test_uuid;
      const validator = isBundleCtrl ? exec.control_validator : undefined;
      const result = await browserApi.getTestDescription(uuid, validator);
      descriptionCache.current.set(cacheKey, result);
      setDescriptionMap(prev => new Map(prev).set(cacheKey, result));
    } catch {
      descriptionCache.current.set(cacheKey, null);
      setDescriptionMap(prev => new Map(prev).set(cacheKey, null));
    } finally {
      setDescriptionLoading(null);
    }
  }, []);

  // Related Defender alerts cache (mirrors descriptionCache pattern).
  // Keyed PER STAGE so each stage queries with its own timestamp + techniques.
  // alertsLoading is a Set to track concurrent in-flight fetches across stages.
  const alertsCache = useRef<Map<string, RelatedAlertsResponse | null>>(new Map());
  const [alertsLoading, setAlertsLoading] = useState<Set<string>>(new Set());
  const [alertsMap, setAlertsMap] = useState<Map<string, RelatedAlertsResponse | null>>(new Map());

  // Per-stage cache key. Each stage queries with its own routing.event_time +
  // techniques; the bundle-level callout aggregates `attribution === 'bundle'`
  // alerts across every stage cache and dedupes by alert_id.
  const stageAlertsCacheKey = stageAlertsKey;

  // Related-alert lookup for one execution: its techniques, host and the
  // bundle binary `<uuid>.exe` (bundle controls carry `<uuid>::<control>`).
  // null when the execution has no techniques to correlate on.
  const alertsItemFor = useCallback((exec: EnrichedTestExecution): AlertsForTestItem | null => {
    if (!exec.techniques || exec.techniques.length === 0) return null;
    const baseUuid = exec.test_uuid.includes('::') ? exec.test_uuid.split('::')[0] : exec.test_uuid;
    return {
      techniques: exec.techniques,
      timestamp: exec.timestamp,
      ...(exec.run_started_at ? { runStartedAt: exec.run_started_at } : {}),
      windowMinutes: 30,
      hostname: exec.hostname,
      binaryName: `${baseUuid}.exe`,
      bundleName: exec.bundle_name,
    };
  }, []);

  // Defender alerts for every given execution (a row's stages) in one
  // request: the batch endpoint runs one msearch per fallback tier instead of
  // one request and up to three sequential searches per stage.
  const fetchRelatedAlerts = useCallback(async (execs: EnrichedTestExecution[]) => {
    if (!defenderConfigured) return;
    const todo = new Map<string, AlertsForTestItem>();
    for (const exec of execs) {
      const key = stageAlertsCacheKey(exec);
      const item = alertsItemFor(exec);
      if (item && !alertsCache.current.has(key)) todo.set(key, item);
    }
    if (todo.size === 0) return;
    const keys = [...todo.keys()];

    setAlertsLoading(prev => new Set([...prev, ...keys]));
    let results: Array<RelatedAlertsResponse | null>;
    try {
      results = await defenderApi.getAlertsForTests([...todo.values()]);
    } catch {
      results = keys.map(() => null);
    }
    // Cache successes only: a failed lookup (null) shows as an error and is
    // asked again the next time the run or stage is opened.
    keys.forEach((key, i) => { if (results[i]) alertsCache.current.set(key, results[i]); });
    setAlertsMap(prev => {
      const next = new Map(prev);
      keys.forEach((key, i) => next.set(key, results[i] ?? null));
      return next;
    });
    setAlertsLoading(prev => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, [defenderConfigured, stageAlertsCacheKey, alertsItemFor]);

  // Related endpoint-EDR alerts (CrowdStrike, SentinelOne, Sophos): same
  // per-stage cache key for every vendor, one map/loading set per vendor.
  const endpointConfigured: Record<EndpointVendorId, boolean> = {
    crowdstrike: crowdstrikeConfigured,
    sentinelone: sentineloneConfigured,
    sophos: sophosConfigured,
  };
  const endpointCacheRef = useRef<Record<EndpointVendorId, Map<string, RelatedCrowdStrikeAlertsResponse | null>> | null>(null);
  if (endpointCacheRef.current === null) endpointCacheRef.current = emptyCaches();
  const endpointCache = endpointCacheRef as { current: Record<EndpointVendorId, Map<string, RelatedCrowdStrikeAlertsResponse | null>> };
  const [endpointLoading, setEndpointLoading] = useState<Record<EndpointVendorId, Set<string>>>(
    () => Object.fromEntries(ENDPOINT_VENDOR_IDS.map((id) => [id, new Set<string>()])) as Record<EndpointVendorId, Set<string>>,
  );
  const [endpointMaps, setEndpointMaps] = useState<Record<EndpointVendorId, Map<string, RelatedCrowdStrikeAlertsResponse | null>>>(
    emptyCaches,
  );

  const endpointAlerts = useMemo<EndpointAlertState>(
    () =>
      Object.fromEntries(
        ENDPOINT_VENDOR_IDS.map((id) => [
          id,
          { configured: endpointConfigured[id], map: endpointMaps[id], loading: endpointLoading[id] },
        ]),
      ) as EndpointAlertState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crowdstrikeConfigured, sentineloneConfigured, sophosConfigured, endpointMaps, endpointLoading],
  );

  const fetchRelatedEndpointAlerts = useCallback(async (execs: EnrichedTestExecution[]) => {
    await Promise.all(ENDPOINT_VENDOR_IDS.map(async (id) => {
      const api = VENDORS[id].api;
      if (!endpointConfigured[id] || !api.getAlertsForTest) return;
      const todo = new Map<string, AlertsForTestItem>();
      for (const exec of execs) {
        const key = stageAlertsCacheKey(exec);
        const item = alertsItemFor(exec);
        if (item && !endpointCache.current[id].has(key)) todo.set(key, item);
      }
      if (todo.size === 0) return;
      const keys = [...todo.keys()];
      const items = [...todo.values()];
      const single = api.getAlertsForTest;

      setEndpointLoading(prev => ({ ...prev, [id]: new Set([...prev[id], ...keys]) }));
      let results: Array<RelatedCrowdStrikeAlertsResponse | null>;
      try {
        results = api.getAlertsForTests
          ? await api.getAlertsForTests(items)
          : await Promise.all(items.map((it) =>
              single(it.techniques, it.timestamp, it.windowMinutes, it.hostname, it.binaryName, it.bundleName)
                .catch(() => null)));
      } catch {
        results = keys.map(() => null);
      }
      // Cache successes only (see fetchRelatedAlerts): failures are retried.
      keys.forEach((key, i) => { if (results[i]) endpointCache.current[id].set(key, results[i]); });
      setEndpointMaps(prev => {
        const next = new Map(prev[id]);
        keys.forEach((key, i) => next.set(key, results[i] ?? null));
        return { ...prev, [id]: next };
      });
      setEndpointLoading(prev => {
        const next = new Set(prev[id]);
        for (const key of keys) next.delete(key);
        return { ...prev, [id]: next };
      });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crowdstrikeConfigured, sentineloneConfigured, sophosConfigured, stageAlertsCacheKey, alertsItemFor]);

  const prime = useCallback(
    (row: DisplayRow) => {
      if (row.type === 'standalone') {
        void fetchDescription(row.execution);
        void fetchRelatedAlerts([row.execution]);
        void fetchRelatedEndpointAlerts([row.execution]);
      } else {
        // One request per vendor for every stage of the row.
        void fetchRelatedAlerts(row.controls);
        void fetchRelatedEndpointAlerts(row.controls);
      }
    },
    [fetchDescription, fetchRelatedAlerts, fetchRelatedEndpointAlerts],
  );

  const onToggleControl = useCallback(
    (index: number, ctrl: EnrichedTestExecution) => {
      setExpandedControlIndex((prev) => {
        if (prev === index) return null;
        void fetchDescription(ctrl);
        void fetchRelatedAlerts([ctrl]);
        void fetchRelatedEndpointAlerts([ctrl]);
        return index;
      });
    },
    [fetchDescription, fetchRelatedAlerts, fetchRelatedEndpointAlerts],
  );

  const collapseControls = useCallback(() => setExpandedControlIndex(null), []);

  return {
    panelProps: {
      showVersions,
      defenderConfigured,
      endpointAlerts,
      descriptionMap,
      descriptionLoadingKey: descriptionLoading,
      alertsMap,
      alertsLoading,
      stageAlertsCacheKey,
      expandedControlIndex,
      onToggleControl,
    },
    prime,
    collapseControls,
  };
}
