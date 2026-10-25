import { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { CrowdStrikeAlertSummary, CrowdStrikeAlertTrendPoint } from '@/services/api/crowdstrike';
import { sentineloneAnalyticsApi } from '@/services/api/sentineloneAnalytics';
import { sentinelOneApi } from '@/services/api/sentinelone';
import type { TechniqueCoverageResponse } from '@/services/api/integrationTypes';
import type { DateRangeValue } from '@/lib/timeRange';
import IntegrationTabHeader from './integrations/IntegrationTabHeader';
import HeroStatTile from './HeroStatTile';
import EndpointAlertDetailsDrawer from './integrations/EndpointAlertDetailsDrawer';
import IntegrationTimelineCard from './integrations/IntegrationTimelineCard';
import IntegrationAlertFeed from './integrations/IntegrationAlertFeed';
import TechniqueCoverageCard from './integrations/TechniqueCoverageCard';
import { AlertsHeroTile, CoverageHeroTile } from './integrations/IntegrationHeroTiles';
import { useTabWindow } from './integrations/useTabWindow';
import { VENDORS } from './integrations/vendorConfig';
import { SentinelOneAgentHealthCard, SentinelOnePolicyTable, SentinelOneExclusionGapCard } from './SentinelOnePostureCards';

const vendor = VENDORS.sentinelone;

interface TabData {
  summary: CrowdStrikeAlertSummary | null;
  summaryFailed: boolean;
  trend: CrowdStrikeAlertTrendPoint[];
  coverage: TechniqueCoverageResponse | null;
  coverageFailed: boolean;
}

interface SentinelOneTabProps {
  /** Page date range: the window every card on the tab uses. */
  dateRange: DateRangeValue;
}

/**
 * SentinelOne analytics tab — the CrowdStrike tab's layout over
 * /api/analytics/sentinelone/*. SentinelOne has no Zero Trust Assessment
 * equivalent, so the posture tile is replaced by the agent-response split
 * (prevented vs detected only) from the same alert facets; no score is invented.
 */
export default function SentinelOneTab({ dateRange }: SentinelOneTabProps) {
  const { window, windowLabel, refreshKey, refresh } = useTabWindow(dateRange);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TabData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTechniques, setDrawerTechniques] = useState<string[] | undefined>(undefined);
  const loadSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  function openDrawerForTechnique(t: string) {
    setDrawerTechniques([t]);
    setDrawerOpen(true);
  }

  useEffect(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    (async () => {
      const [summaryR, trendR, coverageR] = await Promise.allSettled([
        sentineloneAnalyticsApi.getAlertSummary(window),
        sentineloneAnalyticsApi.getAlertTrend(30, window),
        sentineloneAnalyticsApi.getTechniqueCoverage(window),
      ]);
      if (seq !== loadSeq.current) return;

      if (summaryR.status === 'rejected') console.error('Failed to load SentinelOne alert summary:', summaryR.reason);
      if (trendR.status === 'rejected') console.error('Failed to load SentinelOne alert trend:', trendR.reason);
      if (coverageR.status === 'rejected') console.error('Failed to load SentinelOne technique coverage:', coverageR.reason);

      setData({
        summary: summaryR.status === 'fulfilled' ? summaryR.value : null,
        summaryFailed: summaryR.status === 'rejected',
        trend: trendR.status === 'fulfilled' ? trendR.value : [],
        coverage: coverageR.status === 'fulfilled' ? coverageR.value : null,
        coverageFailed: coverageR.status === 'rejected',
      });
      setLoading(false);
    })();
  }, [window]);

  useEffect(() => {
    loadSyncStatus();
  }, []);

  async function loadSyncStatus() {
    try {
      const status = await sentinelOneApi.getSyncStatus();
      const times = [status.lastThreatSync, status.lastAlertSync].filter((t): t is string => !!t).sort();
      setLastSync(times.at(-1) ?? null);
      setSyncError(status.lastError ? `${status.lastError.stage}: ${status.lastError.message || 'unknown error'}` : null);
    } catch (err) {
      console.error('Failed to load SentinelOne sync status:', err);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await sentinelOneApi.triggerSync();
      // The sync runs in the background (202): refresh the cards once it finishes.
      const done = await sentinelOneApi.waitForSync({ isCancelled: () => !mounted.current });
      if (!mounted.current) return;
      if (done) refresh();
      await loadSyncStatus();
    } catch (err) {
      const apiError = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      if (mounted.current) setSyncError(apiError ?? (err instanceof Error ? err.message : 'Sync failed'));
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }

  const prevention = data?.summary?.counts?.byPrevention;
  const responseTotal = prevention ? prevention.prevented + prevention.detected_only + prevention.kill_failed : 0;

  return (
    <div className="space-y-6">
      <IntegrationTabHeader
        vendor={vendor}
        lastSync={lastSync}
        syncing={syncing}
        syncError={syncError}
        onSync={handleSync}
      />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-6 md:col-span-4">
          <AlertsHeroTile
            vendor={vendor}
            summary={data?.summary ?? null}
            trend={data?.trend ?? []}
            window={window}
            loading={loading}
            failed={!!data?.summaryFailed}
            windowLabel={windowLabel}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-4">
          <CoverageHeroTile
            coverage={data?.coverage ?? null}
            loading={loading}
            failed={!!data?.coverageFailed}
            windowLabel={windowLabel}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-4">
          <HeroStatTile
            title="Agent response"
            icon={<ShieldCheck className="w-4 h-4 text-primary" />}
            value={prevention ? prevention.prevented.toLocaleString() : '—'}
            subValue={
              prevention
                ? `prevented (kill / quarantine) · ${prevention.detected_only.toLocaleString()} detected only${prevention.kill_failed ? ` · ${prevention.kill_failed.toLocaleString()} failed` : ''}`
                : undefined
            }
            loading={loading}
            emptyState={!loading && (!prevention || responseTotal === 0) ? `No SentinelOne alerts in ${windowLabel}` : undefined}
          />
        </div>
      </div>

      <SentinelOneAgentHealthCard refreshKey={refreshKey} />

      <IntegrationTimelineCard vendor={vendor} window={window} refreshKey={refreshKey} />

      <IntegrationAlertFeed
        key={vendor.id}
        vendor={vendor}
        window={window}
        windowLabel={windowLabel}
        refreshKey={refreshKey}
      />

      <TechniqueCoverageCard
        vendor={vendor}
        data={data?.coverage ?? null}
        loading={loading}
        error={!!data?.coverageFailed}
        onSelectTechnique={openDrawerForTechnique}
      />

      <SentinelOneExclusionGapCard window={window} windowLabel={windowLabel} refreshKey={refreshKey} />

      <SentinelOnePolicyTable refreshKey={refreshKey} />

      <EndpointAlertDetailsDrawer
        vendor="sentinelone"
        open={drawerOpen}
        onClose={closeDrawer}
        techniques={drawerTechniques}
        window={window}
      />
    </div>
  );
}
