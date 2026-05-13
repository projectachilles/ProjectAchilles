import { useState, useEffect } from 'react';
import { ShieldCheck, Bell, Crosshair } from 'lucide-react';
import {
  defenderApi,
  type SecureScoreSummary,
  type AlertSummary,
  type SecureScoreTrendPoint,
  type AlertTrendPoint,
  type DetectionRateResponse,
} from '@/services/api/defender';
import DefenderTabHeader from './DefenderTabHeader';
import HeroStatTile, { type DeltaTone } from './HeroStatTile';
import AutoResolveStatTile from './AutoResolveStatTile';
import AlertsSummaryCard from './AlertsSummaryCard';
import TopControlsCard from './TopControlsCard';
import TestVsAlertTimelineCard from './TestVsAlertTimelineCard';
import DetectionAnalysisCard from './DetectionAnalysisCard';
import TechniqueOverlapChart from './TechniqueOverlapChart';
import AlertDetailsDrawer from './AlertDetailsDrawer';

const TREND_DAYS = 30;

function secureScoreDelta(trend: SecureScoreTrendPoint[]): number {
  if (trend.length < 2) return 0;
  return trend[trend.length - 1].percentage - trend[0].percentage;
}

function alertCountWindowDelta(trend: AlertTrendPoint[], windowDays: number): number {
  const recentStart = Math.max(0, trend.length - windowDays);
  const priorStart = Math.max(0, trend.length - windowDays * 2);
  const recent = trend.slice(recentStart).reduce((s, p) => s + p.count, 0);
  const prior = trend.slice(priorStart, recentStart).reduce((s, p) => s + p.count, 0);
  return recent - prior;
}

function inverseDeltaTone(delta: number | undefined): DeltaTone | undefined {
  if (delta === undefined) return undefined;
  if (delta > 0) return 'negative';
  if (delta < 0) return 'positive';
  return 'neutral';
}

export default function DefenderTab() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [secureScoreTrend, setSecureScoreTrend] = useState<SecureScoreTrendPoint[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [alertTrend, setAlertTrend] = useState<AlertTrendPoint[]>([]);
  const [detectionRate, setDetectionRate] = useState<DetectionRateResponse | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTechnique, setDrawerTechnique] = useState<string | undefined>(undefined);

  function openDrawerForTechnique(t: string) {
    setDrawerTechnique(t);
    setDrawerOpen(true);
  }

  function openDrawerForAll() {
    setDrawerTechnique(undefined);
    setDrawerOpen(true);
  }

  useEffect(() => {
    loadData();
    loadSyncStatus();
  }, []);

  async function loadData() {
    setLoading(true);
    const [scoreR, scoreTrendR, alertR, alertTrendR, detectR] = await Promise.allSettled([
      defenderApi.getSecureScore(),
      defenderApi.getSecureScoreTrend(TREND_DAYS),
      defenderApi.getAlertSummary(),
      defenderApi.getAlertTrend(TREND_DAYS),
      defenderApi.getDetectionRate(TREND_DAYS, 60),
    ]);

    if (scoreR.status === 'fulfilled') setSecureScore(scoreR.value);
    else console.error('Failed to load Defender secure score:', scoreR.reason);

    if (scoreTrendR.status === 'fulfilled') setSecureScoreTrend(scoreTrendR.value);
    else console.error('Failed to load secure score trend:', scoreTrendR.reason);

    if (alertR.status === 'fulfilled') setAlertSummary(alertR.value);
    else console.error('Failed to load Defender alert summary:', alertR.reason);

    if (alertTrendR.status === 'fulfilled') setAlertTrend(alertTrendR.value);
    else console.error('Failed to load alert trend:', alertTrendR.reason);

    if (detectR.status === 'fulfilled') setDetectionRate(detectR.value);
    else console.error('Failed to load detection rate:', detectR.reason);

    setLoading(false);
  }

  async function loadSyncStatus() {
    try {
      const res = await fetch('/api/integrations/defender/sync/status', {
        headers: { Authorization: `Bearer ${document.cookie}` },
      }).catch(() => null);
      if (res?.ok) {
        const syncStatus = await res.json();
        setLastSync(syncStatus.lastScoreSync || syncStatus.lastAlertSync || null);
      }
    } catch {
      // Ignore sync status errors
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const response = await fetch('/api/integrations/defender/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        await loadData();
        await loadSyncStatus();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  const scoreDelta = secureScoreTrend.length >= 2 ? secureScoreDelta(secureScoreTrend) : undefined;
  const alertDeltaWeek = alertTrend.length >= 14 ? alertCountWindowDelta(alertTrend, 7) : undefined;

  const totalAlerts = alertSummary?.total ?? 0;
  const highAlerts = alertSummary?.bySeverity.high ?? 0;

  return (
    <div className="space-y-6">
      <DefenderTabHeader lastSync={lastSync} syncing={syncing} onSync={handleSync} />

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
            deltaLabel={`pts vs ${TREND_DAYS}d ago`}
            sparklineData={secureScoreTrend.map((p) => p.percentage)}
            sparklineClass="text-emerald-500"
            loading={loading}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <HeroStatTile
            title="Defender Alerts"
            icon={<Bell className="w-4 h-4 text-primary" />}
            value={totalAlerts.toLocaleString()}
            subValue={alertSummary ? `${highAlerts.toLocaleString()} high severity` : undefined}
            delta={alertDeltaWeek}
            deltaTone={inverseDeltaTone(alertDeltaWeek)}
            deltaLabel="vs prev 7d"
            sparklineData={alertTrend.map((p) => p.count)}
            sparklineClass="text-red-500"
            loading={loading}
            onClick={openDrawerForAll}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <HeroStatTile
            title="Detection Rate"
            icon={<Crosshair className="w-4 h-4 text-primary" />}
            value={detectionRate?.overall.detectionRate.toFixed(1) ?? '—'}
            valueSuffix="%"
            subValue={
              detectionRate
                ? `${detectionRate.overall.detectedTechniques}/${detectionRate.overall.testedTechniques} techniques`
                : undefined
            }
            loading={loading}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 md:col-span-3">
          <AutoResolveStatTile />
        </div>
      </div>

      {/* Correlation timeline */}
      <TestVsAlertTimelineCard />

      {/* Detail row: alert breakdown + remediation controls */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '320px' }}>
        <div className="col-span-12 md:col-span-5">
          <AlertsSummaryCard data={alertSummary} loading={loading} />
        </div>
        <div className="col-span-12 md:col-span-7">
          <TopControlsCard compact />
        </div>
      </div>

      {/* Detection analysis */}
      <DetectionAnalysisCard onSelectTechnique={openDrawerForTechnique} />

      {/* Technique overlap */}
      <TechniqueOverlapChart onSelectTechnique={openDrawerForTechnique} />

      <AlertDetailsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        technique={drawerTechnique}
      />
    </div>
  );
}
