import { useState, useEffect, useRef, useCallback } from 'react';
import { Gauge } from 'lucide-react';
import {
  crowdstrikeApi,
  type ZtaScoreSummary,
  type CrowdStrikeAlertSummary,
  type ZtaScoreTrendPoint,
  type CrowdStrikeAlertTrendPoint,
} from '@/services/api/crowdstrike';
import { integrationsApi, type CrowdStrikeZtaStatus } from '@/services/api/integrations';
import type { TechniqueCoverageResponse } from '@/services/api/integrationTypes';
import type { DateRangeValue } from '@/lib/timeRange';
import IntegrationTabHeader from './integrations/IntegrationTabHeader';
import HeroStatTile from './HeroStatTile';
import Sparkline from './Sparkline';
import CrowdStrikeAutoResolveStatTile from './CrowdStrikeAutoResolveStatTile';
import EndpointAlertDetailsDrawer from './integrations/EndpointAlertDetailsDrawer';
import IntegrationTimelineCard from './integrations/IntegrationTimelineCard';
import IntegrationAlertFeed from './integrations/IntegrationAlertFeed';
import TechniqueCoverageCard from './integrations/TechniqueCoverageCard';
import { AlertsHeroTile, CoverageHeroTile } from './integrations/IntegrationHeroTiles';
import { firstToLastDelta, formatScore, stillOpenFootnote, ztaTrendDays } from './integrations/heroMetrics';
import { useTabWindow } from './integrations/useTabWindow';
import { VENDORS } from './integrations/vendorConfig';

const vendor = VENDORS.crowdstrike;

interface TabData {
  zta: ZtaScoreSummary | null;
  ztaTrend: ZtaScoreTrendPoint[];
  summary: CrowdStrikeAlertSummary | null;
  summaryFailed: boolean;
  trend: CrowdStrikeAlertTrendPoint[];
  coverage: TechniqueCoverageResponse | null;
  coverageFailed: boolean;
}

/** One labelled 0-100 bar on the ZTA tile. Nothing for a non-finite score. */
function ScoreBar({ label, value }: { label: string; value: number }) {
  if (!Number.isFinite(value)) return null;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-11 shrink-0">{label}</span>
      <div
        role="meter"
        aria-label={`${label} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-foreground">{formatScore(value)}</span>
    </div>
  );
}

interface CrowdStrikeTabProps {
  /** Page date range: the window every card on the tab uses. */
  dateRange: DateRangeValue;
}

export default function CrowdStrikeTab({ dateRange }: CrowdStrikeTabProps) {
  const { window, windowLabel, refreshKey, refresh } = useTabWindow(dateRange);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TabData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [ztaStatus, setZtaStatus] = useState<CrowdStrikeZtaStatus | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTechniques, setDrawerTechniques] = useState<string[] | undefined>(undefined);
  const loadSeq = useRef(0);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  function openDrawerForTechnique(t: string) {
    setDrawerTechniques([t]);
    setDrawerOpen(true);
  }

  // Every load reruns when the window changes (new range, or Sync Now).
  useEffect(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    (async () => {
      const [scoreR, scoreTrendR, summaryR, trendR, coverageR] = await Promise.allSettled([
        crowdstrikeApi.getZtaScore(),
        crowdstrikeApi.getZtaScoreTrend(ztaTrendDays(window)),
        crowdstrikeApi.getAlertSummary(window),
        crowdstrikeApi.getAlertTrend(30, window),
        crowdstrikeApi.getTechniqueCoverage(window),
      ]);
      if (seq !== loadSeq.current) return; // a newer window superseded this load

      if (scoreR.status === 'rejected') console.error('Failed to load CrowdStrike ZTA score:', scoreR.reason);
      if (scoreTrendR.status === 'rejected') console.error('Failed to load ZTA score trend:', scoreTrendR.reason);
      if (summaryR.status === 'rejected') console.error('Failed to load CrowdStrike alert summary:', summaryR.reason);
      if (trendR.status === 'rejected') console.error('Failed to load alert trend:', trendR.reason);
      if (coverageR.status === 'rejected') console.error('Failed to load technique coverage:', coverageR.reason);

      setData({
        zta: scoreR.status === 'fulfilled' ? scoreR.value : null,
        ztaTrend: scoreTrendR.status === 'fulfilled' ? scoreTrendR.value : [],
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
      const status = await integrationsApi.getCrowdStrikeSyncStatus();
      const times = [status.lastAlertSync, status.lastZtaSync]
        .filter((t): t is string => !!t)
        .sort();
      setLastSync(times.at(-1) ?? null);
      setSyncError(status.lastError ? `${status.lastError.stage}: ${status.lastError.message || 'unknown error'}` : null);
      setZtaStatus(status.ztaStatus ?? null);
    } catch (err) {
      console.error('Failed to load CrowdStrike sync status:', err);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await integrationsApi.triggerCrowdStrikeSync();
      const failed = (['alerts', 'zta'] as const).find((s) => (result[s]?.errors.length ?? 0) > 0);
      if (failed) setSyncError(`${failed}: ${result[failed].errors[0] || 'unknown error'}`);
      refresh();
      await loadSyncStatus();
    } catch (err) {
      const apiError = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setSyncError(apiError ?? (err instanceof Error ? err.message : 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  }

  const zta = data?.zta ?? null;
  const ztaSeries = (data?.ztaTrend ?? []).map((p) => p.overallScore).filter((v) => Number.isFinite(v));

  // ZTA is a separately-licensed Falcon Insight feature — a 403 during the
  // backend ZTA sync is recorded as zta_status:'not_licensed' and must not
  // break the rest of the tab. No score data at all gets the same graceful
  // empty state.
  const ztaUnavailable = !loading && (ztaStatus === 'not_licensed' || !zta);
  const ztaEmptyState =
    ztaStatus === 'not_licensed'
      ? 'Posture score requires Falcon Insight licensing'
      : 'No posture score data yet — scores appear after the next sync';
  const ztaDelta = ztaUnavailable ? undefined : firstToLastDelta(ztaSeries);
  // The ZTA trend is "the last N days to now", not the page window: label that span.
  const ztaDays = ztaTrendDays(window);
  const ztaSubValue =
    zta && Number.isFinite(zta.deviceCount)
      ? `${zta.deviceCount.toLocaleString()} hosts${Number.isFinite(zta.minScore) ? ` · lowest ${formatScore(zta.minScore)}` : ''}`
      : undefined;

  return (
    <div className="space-y-6">
      <IntegrationTabHeader vendor={vendor} lastSync={lastSync} syncing={syncing} syncError={syncError} onSync={handleSync} />

      {/* Hero row: 4 tiles */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <HeroStatTile
            title="ZTA Score"
            icon={<Gauge className="w-4 h-4 text-primary" />}
            value={zta && Number.isFinite(zta.overallScore) ? zta.overallScore.toFixed(1) : '—'}
            valueSuffix="%"
            subValue={ztaSubValue}
            chartSlot={
              zta && !ztaUnavailable ? (
                <div className="w-full space-y-1.5">
                  <ScoreBar label="OS" value={zta.osScore} />
                  <ScoreBar label="Sensor" value={zta.sensorConfigScore} />
                  {ztaSeries.length >= 2 && (
                    <div className="text-emerald-500">
                      <Sparkline data={ztaSeries} width={240} height={24} ariaLabel="ZTA Score trend" />
                    </div>
                  )}
                </div>
              ) : undefined
            }
            delta={ztaDelta}
            deltaLabel={`pts over last ${ztaDays}d`}
            loading={loading}
            emptyState={ztaUnavailable ? ztaEmptyState : undefined}
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
          <CrowdStrikeAutoResolveStatTile footnote={stillOpenFootnote(data?.summary?.counts)} />
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

      <EndpointAlertDetailsDrawer
        vendor="crowdstrike"
        open={drawerOpen}
        onClose={closeDrawer}
        techniques={drawerTechniques}
        window={window}
      />
    </div>
  );
}
