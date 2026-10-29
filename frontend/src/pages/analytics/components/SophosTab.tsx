import { useState, useEffect, useRef, useCallback } from 'react';
import { Gauge, ShieldCheck } from 'lucide-react';
import type { CrowdStrikeAlertSummary, CrowdStrikeAlertTrendPoint } from '@/services/api/crowdstrike';
import { sophosAnalyticsApi, type SophosHealthCheckResponse } from '@/services/api/sophosAnalytics';
import { sophosApi, type SophosCapabilities, type SophosSyncGap } from '@/services/api/sophos';
import type { TechniqueCoverageResponse } from '@/services/api/integrationTypes';
import type { DateRangeValue } from '@/lib/timeRange';
import { Alert } from '@/components/shared/ui/Alert';
import IntegrationTabHeader from './integrations/IntegrationTabHeader';
import AutoResolveStatTile from './AutoResolveStatTile';
import HeroStatTile from './HeroStatTile';
import Sparkline from './Sparkline';
import ScoreBar from './integrations/ScoreBar';
import EndpointAlertDetailsDrawer from './integrations/EndpointAlertDetailsDrawer';
import IntegrationTimelineCard from './integrations/IntegrationTimelineCard';
import IntegrationAlertFeed from './integrations/IntegrationAlertFeed';
import TechniqueCoverageCard from './integrations/TechniqueCoverageCard';
import { AlertsHeroTile, CoverageHeroTile } from './integrations/IntegrationHeroTiles';
import { firstToLastDelta, stillOpenFootnote, ztaTrendDays } from './integrations/heroMetrics';
import { useTabWindow } from './integrations/useTabWindow';
import { VENDORS } from './integrations/vendorConfig';
import {
  SOPHOS_CATEGORY_LABELS,
  SophosEndpointHealthCard,
  SophosExclusionGapCard,
  SophosHealthCheckBand,
  SophosPolicyTable,
} from './SophosPostureCards';

const vendor = VENDORS.sophos;

const XDR_COPY = 'ATT&CK techniques come from Sophos XDR detections';

interface TabData {
  summary: CrowdStrikeAlertSummary | null;
  summaryFailed: boolean;
  trend: CrowdStrikeAlertTrendPoint[];
  coverage: TechniqueCoverageResponse | null;
  coverageFailed: boolean;
  health: SophosHealthCheckResponse | null;
}

interface SophosTabProps {
  /** Page date range: the window every card on the tab uses. */
  dateRange: DateRangeValue;
}

/** XDR detections feed the ATT&CK coverage; without a licence only alerts and SIEM events exist. */
export function xdrUnavailable(caps: SophosCapabilities | undefined): boolean {
  if (!caps) return false;
  return caps.xdr_graphql !== 'available' && caps.xdr_rest !== 'available';
}

function licenceLine(caps: SophosCapabilities | undefined, region: string | undefined): string | null {
  const parts: string[] = [];
  if (region) parts.push(`Region ${region}`);
  if (caps) {
    const features = [
      caps.siem === 'available' && 'SIEM events',
      caps.alerts === 'available' && 'Alerts',
      (caps.xdr_graphql === 'available' || caps.xdr_rest === 'available') && 'XDR detections',
      caps.health_check === 'available' && 'Health Check',
    ].filter((f): f is string => !!f);
    parts.push(features.length ? `Licensed: ${features.join(', ')}` : 'No licensed features detected');
    if (xdrUnavailable(caps)) parts.push(XDR_COPY);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Sophos analytics tab: the SentinelOne tab's layout over /api/analytics/sophos/*.
 * Sophos has a Health Check instead of a posture pass of our own, so the posture
 * tile shows the Achilles average of its four category scores (labelled as ours).
 */
export default function SophosTab({ dateRange }: SophosTabProps) {
  const { window, windowLabel, refreshKey, refresh } = useTabWindow(dateRange);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TabData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncGap, setSyncGap] = useState<SophosSyncGap | null>(null);
  const [caps, setCaps] = useState<SophosCapabilities | undefined>(undefined);
  const [region, setRegion] = useState<string | undefined>(undefined);
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

  const healthDays = ztaTrendDays(window);

  useEffect(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    (async () => {
      const [summaryR, trendR, coverageR, healthR] = await Promise.allSettled([
        sophosAnalyticsApi.getAlertSummary(window),
        sophosAnalyticsApi.getAlertTrend(30, window),
        sophosAnalyticsApi.getTechniqueCoverage(window),
        sophosAnalyticsApi.getHealthCheck(healthDays),
      ]);
      if (seq !== loadSeq.current) return;

      if (summaryR.status === 'rejected') console.error('Failed to load Sophos alert summary:', summaryR.reason);
      if (trendR.status === 'rejected') console.error('Failed to load Sophos alert trend:', trendR.reason);
      if (coverageR.status === 'rejected') console.error('Failed to load Sophos technique coverage:', coverageR.reason);
      if (healthR.status === 'rejected') console.error('Failed to load Sophos Health Check:', healthR.reason);

      setData({
        summary: summaryR.status === 'fulfilled' ? summaryR.value : null,
        summaryFailed: summaryR.status === 'rejected',
        trend: trendR.status === 'fulfilled' ? trendR.value : [],
        coverage: coverageR.status === 'fulfilled' ? coverageR.value : null,
        coverageFailed: coverageR.status === 'rejected',
        health: healthR.status === 'fulfilled' ? healthR.value : null,
      });
      setLoading(false);
    })();
  }, [window, healthDays]);

  useEffect(() => {
    loadSyncStatus();
    sophosApi.getSettings()
      .then((s) => {
        if (!mounted.current) return;
        setCaps(s.capabilities);
        setRegion(s.data_region);
        setSyncGap((prev) => prev ?? s.sync_gap ?? null);
      })
      .catch((err) => console.error('Failed to load Sophos settings:', err));
  }, []);

  async function loadSyncStatus() {
    try {
      const status = await sophosApi.getSyncStatus();
      if (!mounted.current) return;
      const times = [status.lastSiemSync, status.lastAlertSync, status.lastDetectionSync].filter((t): t is string => !!t).sort();
      setLastSync(times.at(-1) ?? null);
      setSyncError(status.lastError ? `${status.lastError.stage}: ${status.lastError.message || 'unknown error'}` : null);
      if (status.syncGap) setSyncGap(status.syncGap);
    } catch (err) {
      console.error('Failed to load Sophos sync status:', err);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await sophosApi.triggerSync();
      // The sync runs in the background (202): refresh the cards once it finishes.
      const done = await sophosApi.waitForSync({ isCancelled: () => !mounted.current });
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

  // Health Check: Achilles average of the category scores, refreshed by the 6-hourly posture pass.
  const snapshot = data?.health?.latest ?? null;
  const headline = snapshot?.headline ?? null;
  const healthSeries = (data?.health?.trend ?? []).map((p) => p.score).filter((v) => Number.isFinite(v));
  const healthUnavailable = !loading && headline == null;
  const noXdr = xdrUnavailable(caps);

  const prevention = data?.summary?.counts?.byPrevention;
  const responseTotal = prevention ? prevention.prevented + prevention.detected_only + prevention.kill_failed : 0;
  const licence = licenceLine(caps, region);

  return (
    <div className="space-y-6">
      <IntegrationTabHeader
        vendor={vendor}
        lastSync={lastSync}
        syncing={syncing}
        syncError={syncError}
        onSync={handleSync}
      />
      {licence && <p className="-mt-3 text-xs text-muted-foreground">{licence}</p>}
      {syncGap && (
        <Alert variant="warning" title="Sophos sync gap">
          Sophos events between {new Date(syncGap.from).toLocaleString()} and {new Date(syncGap.to).toLocaleString()} were not
          collected (Sophos keeps 24 hours).
        </Alert>
      )}

      {/* Hero row: 5 tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <HeroStatTile
            title="Sophos Health Check"
            icon={<Gauge className="w-4 h-4 text-primary" />}
            value={headline != null ? String(Math.round(headline)) : '—'}
            valueSuffix=" / 100"
            subValue={headline != null ? 'Achilles average of Sophos Health Check scores' : undefined}
            chartSlot={
              snapshot && !healthUnavailable ? (
                <div className="w-full space-y-1.5">
                  {snapshot.categories.map((c) =>
                    c.score != null ? (
                      <ScoreBar key={c.category} label={SOPHOS_CATEGORY_LABELS[c.category] ?? c.category} value={c.score} labelClassName="w-20" />
                    ) : null,
                  )}
                  {healthSeries.length >= 2 && (
                    <div className="text-emerald-500">
                      <Sparkline data={healthSeries} width={240} height={24} ariaLabel="Health Check trend" />
                    </div>
                  )}
                </div>
              ) : undefined
            }
            delta={healthUnavailable ? undefined : firstToLastDelta(healthSeries)}
            deltaLabel={`pts over last ${healthDays}d`}
            loading={loading}
            emptyState={healthUnavailable ? 'No Health Check yet: it appears after the next posture sync (every 6 hours)' : undefined}
          />
        </div>
        <div>
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
        <div>
          <CoverageHeroTile
            coverage={data?.coverage ?? null}
            loading={loading}
            failed={!!data?.coverageFailed}
            windowLabel={windowLabel}
          />
        </div>
        <div>
          <HeroStatTile
            title="Sophos response"
            icon={<ShieldCheck className="w-4 h-4 text-primary" />}
            value={prevention ? prevention.prevented.toLocaleString() : '—'}
            subValue={
              prevention
                ? `prevented (quarantined / killed / blocked) · ${prevention.detected_only.toLocaleString()} detected only${prevention.kill_failed ? ` · ${prevention.kill_failed.toLocaleString()} cleanup failed` : ''}`
                : undefined
            }
            loading={loading}
            emptyState={!loading && (!prevention || responseTotal === 0) ? `No Sophos alerts in ${windowLabel}` : undefined}
          />
        </div>
        <div>
          <AutoResolveStatTile vendor={vendor} footnote={stillOpenFootnote(data?.summary?.counts)} />
        </div>
      </div>

      <SophosHealthCheckBand refreshKey={refreshKey} />

      <SophosEndpointHealthCard refreshKey={refreshKey} />

      <IntegrationTimelineCard vendor={vendor} window={window} refreshKey={refreshKey} />

      <IntegrationAlertFeed
        key={vendor.id}
        vendor={vendor}
        window={window}
        windowLabel={windowLabel}
        refreshKey={refreshKey}
      />

      <div className="space-y-2">
        {noXdr && <p className="text-xs text-muted-foreground">{XDR_COPY}.</p>}
        <TechniqueCoverageCard
          vendor={vendor}
          data={data?.coverage ?? null}
          loading={loading}
          error={!!data?.coverageFailed}
          onSelectTechnique={openDrawerForTechnique}
        />
      </div>

      <SophosExclusionGapCard window={window} windowLabel={windowLabel} refreshKey={refreshKey} />

      <SophosPolicyTable refreshKey={refreshKey} />

      <EndpointAlertDetailsDrawer
        vendor="sophos"
        open={drawerOpen}
        onClose={closeDrawer}
        techniques={drawerTechniques}
        window={window}
      />
    </div>
  );
}
