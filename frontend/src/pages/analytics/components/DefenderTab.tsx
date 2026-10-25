import { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  defenderApi,
  type SecureScoreSummary,
  type AlertSummary,
  type SecureScoreTrendPoint,
  type AlertTrendPoint,
} from '@/services/api/defender';
import { integrationsApi } from '@/services/api/integrations';
import type { TechniqueCoverageResponse, TimeWindow } from '@/services/api/integrationTypes';
import type { DateRangeValue } from '@/lib/timeRange';
import IntegrationTabHeader from './integrations/IntegrationTabHeader';
import HeroStatTile from './HeroStatTile';
import AutoResolveStatTile from './AutoResolveStatTile';
import TopControlsCard from './TopControlsCard';
import AlertDetailsDrawer from './AlertDetailsDrawer';
import IntegrationTimelineCard from './integrations/IntegrationTimelineCard';
import IntegrationAlertFeed from './integrations/IntegrationAlertFeed';
import TechniqueCoverageCard from './integrations/TechniqueCoverageCard';
import { AlertsHeroTile, CoverageHeroTile } from './integrations/IntegrationHeroTiles';
import { stillOpenFootnote } from './integrations/heroMetrics';
import { useTabWindow } from './integrations/useTabWindow';
import { VENDORS } from './integrations/vendorConfig';

const vendor = VENDORS.defender;

/** The Secure Score tile keeps its fixed 30-day trend (unchanged by the redesign). */
const SECURE_SCORE_TREND_DAYS = 30;

function secureScoreDelta(trend: SecureScoreTrendPoint[]): number {
  if (trend.length < 2) return 0;
  return trend[trend.length - 1].percentage - trend[0].percentage;
}

interface TabData {
  secureScore: SecureScoreSummary | null;
  secureScoreTrend: SecureScoreTrendPoint[];
  summary: AlertSummary | null;
  summaryFailed: boolean;
  trend: AlertTrendPoint[];
  coverage: TechniqueCoverageResponse | null;
  coverageFailed: boolean;
}

interface DrawerState {
  open: boolean;
  techniques?: string[];
  title?: string;
  window?: TimeWindow;
}

interface DefenderTabProps {
  /** Page date range: the window every card on the tab uses. */
  dateRange: DateRangeValue;
}

export default function DefenderTab({ dateRange }: DefenderTabProps) {
  const { window, windowLabel, refreshKey, refresh } = useTabWindow(dateRange);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TabData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({ open: false });
  const loadSeq = useRef(0);
  const closeDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);

  /** A coverage row: that technique's alerts in the tab window, so the count matches the row. */
  function openDrawerForTechnique(t: string) {
    setDrawer({ open: true, techniques: [t], window });
  }

  /**
   * Open the drawer for the alerts addressed by a Top Remediation Control.
   * Passes the FULL covered-techniques array — backend ORs them via the
   * /alerts?techniques=... filter, so a multi-technique control surfaces
   * alerts for every covered technique. No window: the control's badge counts
   * its own fixed 30 days, and the drawer keeps its unbounded behaviour.
   */
  const openDrawerForControl = useCallback((techniques: string[], controlTitle: string) => {
    setDrawer({ open: true, techniques, title: `Alerts addressed by '${controlTitle}'` });
  }, []);

  // Every load reruns when the window changes (new range, or Sync Now).
  useEffect(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    (async () => {
      const [scoreR, scoreTrendR, summaryR, trendR, coverageR] = await Promise.allSettled([
        defenderApi.getSecureScore(),
        defenderApi.getSecureScoreTrend(SECURE_SCORE_TREND_DAYS),
        defenderApi.getAlertSummary(window),
        defenderApi.getAlertTrend(30, window),
        defenderApi.getTechniqueCoverage(window),
      ]);
      if (seq !== loadSeq.current) return; // a newer window superseded this load

      if (scoreR.status === 'rejected') console.error('Failed to load Defender secure score:', scoreR.reason);
      if (scoreTrendR.status === 'rejected') console.error('Failed to load secure score trend:', scoreTrendR.reason);
      if (summaryR.status === 'rejected') console.error('Failed to load Defender alert summary:', summaryR.reason);
      if (trendR.status === 'rejected') console.error('Failed to load alert trend:', trendR.reason);
      if (coverageR.status === 'rejected') console.error('Failed to load technique coverage:', coverageR.reason);

      setData({
        secureScore: scoreR.status === 'fulfilled' ? scoreR.value : null,
        secureScoreTrend: scoreTrendR.status === 'fulfilled' ? scoreTrendR.value : [],
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
      const status = await integrationsApi.getDefenderSyncStatus();
      const times = [status.lastScoreSync, status.lastControlSync, status.lastAlertSync]
        .filter((t): t is string => !!t)
        .sort();
      setLastSync(times.at(-1) ?? null);
      setSyncError(status.lastError ? `${status.lastError.stage}: ${status.lastError.message}` : null);
    } catch (err) {
      console.error('Failed to load Defender sync status:', err);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await integrationsApi.triggerDefenderSync();
      const failed = (['scores', 'controls', 'alerts'] as const).find((s) => result[s].errors.length > 0);
      if (failed) setSyncError(`${failed}: ${result[failed].errors[0]}`);
      refresh();
      await loadSyncStatus();
    } catch (err) {
      const apiError = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setSyncError(apiError ?? (err instanceof Error ? err.message : 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  }

  const secureScore = data?.secureScore ?? null;
  const secureScoreTrend = data?.secureScoreTrend ?? [];
  const scoreDelta = secureScoreTrend.length >= 2 ? secureScoreDelta(secureScoreTrend) : undefined;

  return (
    <div className="space-y-6">
      <IntegrationTabHeader vendor={vendor} lastSync={lastSync} syncing={syncing} syncError={syncError} onSync={handleSync} />

      {/* Hero row: 4 tiles */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <HeroStatTile
            title="Secure Score"
            icon={<ShieldCheck className="w-4 h-4 text-primary" />}
            value={secureScore?.percentage.toFixed(1) ?? '—'}
            valueSuffix="%"
            subValue={
              secureScore
                ? `${secureScore.currentScore} / ${secureScore.maxScore} pts`
                : undefined
            }
            delta={scoreDelta}
            deltaLabel={`pts vs ${SECURE_SCORE_TREND_DAYS}d ago`}
            sparklineData={secureScoreTrend.map((p) => p.percentage)}
            sparklineClass="text-emerald-500"
            loading={loading}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
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
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <CoverageHeroTile
            coverage={data?.coverage ?? null}
            loading={loading}
            failed={!!data?.coverageFailed}
            windowLabel={windowLabel}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <AutoResolveStatTile footnote={stillOpenFootnote(data?.summary?.counts)} />
        </div>
      </div>

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

      <TopControlsCard twoColumn onSelectControlAlerts={openDrawerForControl} />

      <AlertDetailsDrawer
        open={drawer.open}
        onClose={closeDrawer}
        techniques={drawer.techniques}
        title={drawer.title}
        window={drawer.window}
      />
    </div>
  );
}
