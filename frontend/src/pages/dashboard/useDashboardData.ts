import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  analyticsApi,
  type DefenseScore,
  type ErrorRateResponse,
  type ErrorRateTrendDataPoint,
  type TrendDataPoint,
} from '@/services/api/analytics';
import {
  defenderApi,
  type ControlItem,
  type SecureScoreSummary,
  type SecureScoreTrendPoint,
} from '@/services/api/defender';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, FleetHealthMetrics } from '@/types/agent';
import { browserApi, type SyncStatus } from '@/services/api/browser';
import type { TestMetadata } from '@/types/test';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';
import { useScoringMode } from '@/hooks/useScoringMode';
import { usePolling } from '@/hooks/usePolling';
import { computeTestStats, type TestStats } from './computeTestStats';
import { deriveAttentionItems } from './deriveAttentionItems';
import type { AttentionItem } from './components/AttentionBanner';
import type { TrendPoint } from './components/TrendOverviewChart';
import type { RemediationControl } from './components/TopControlsCard';
import type { RecentExecution } from './components/RecentExecutionsCard';

const TOP_CONTROLS = 5;
const RECENT_TASKS = 6;
const AGENT_POLL_MS = 15_000;

function settle<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function toDate(ts: string): Date {
  return /^\d+$/.test(ts) ? new Date(Number(ts)) : new Date(ts);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface DashboardData {
  loading: boolean;
  // header
  syncStatus: SyncStatus | null;
  syncing: boolean;
  handleSync: () => Promise<void>;
  lastSyncedAgo?: string;
  // banner
  attentionItems: AttentionItem[];
  // KPIs + cards
  defense30: DefenseScore | null;
  defense7: DefenseScore | null;
  errorRate: ErrorRateResponse | null;
  secureScore: SecureScoreSummary | null;
  testStats: TestStats | null;
  metrics: AgentMetrics | null;
  fleetHealth: FleetHealthMetrics | null;
  trend: TrendPoint[];
  trendDescription: string;
  controls: RemediationControl[];
  recentExecutions: RecentExecution[];
  analyticsConfigured: boolean;
  defenderConfigured: boolean;
}

export function useDashboardData(): DashboardData {
  const { configured: analyticsConfigured, loading: analyticsAuthLoading } = useAnalyticsAuth();
  const { configured: defenderConfigured, loading: defenderConfigLoading } = useDefenderConfig();
  const { scoringMode } = useScoringMode();
  const { outdatedCount } = useOutdatedAgentCount();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [tests, setTests] = useState<TestMetadata[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [defense30, setDefense30] = useState<DefenseScore | null>(null);
  const [defense7, setDefense7] = useState<DefenseScore | null>(null);
  const [errorRate, setErrorRate] = useState<ErrorRateResponse | null>(null);
  const [defenseTrend, setDefenseTrend] = useState<TrendDataPoint[] | null>(null);
  const [errorTrend, setErrorTrend] = useState<ErrorRateTrendDataPoint[] | null>(null);
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [secureTrend, setSecureTrend] = useState<SecureScoreTrendPoint[] | null>(null);
  const [rawControls, setRawControls] = useState<ControlItem[] | null>(null);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [fleetHealth, setFleetHealth] = useState<FleetHealthMetrics | null>(null);
  const [recentTasks, setRecentTasks] = useState<AgentTask[] | null>(null);

  // Agent fleet slice — cheap SQLite queries, polled every 15s
  const loadAgentData = useCallback(async () => {
    const [m, fh, t] = await Promise.allSettled([
      agentApi.getMetrics(),
      agentApi.getFleetHealthMetrics(),
      agentApi.listTasks({ limit: RECENT_TASKS + 4 }),
    ]);
    setMetrics(settle(m));
    setFleetHealth(settle(fh));
    setRecentTasks(settle(t)?.tasks ?? null);
  }, []);

  // Test library slice
  const loadTestData = useCallback(async () => {
    const [allTests, sync] = await Promise.allSettled([
      browserApi.getAllTests(),
      browserApi.getSyncStatus(),
    ]);
    setTests(settle(allTests));
    setSyncStatus(settle(sync));
  }, []);

  // Analytics slice — Elasticsearch queries, loaded once per mount/sync
  const loadAnalyticsData = useCallback(async () => {
    if (!analyticsConfigured) return;
    const [d30, d7, er, dTrend, eTrend] = await Promise.allSettled([
      analyticsApi.getDefenseScore({ from: 'now-30d', scoringMode }),
      analyticsApi.getDefenseScore({ from: 'now-7d', scoringMode }),
      analyticsApi.getErrorRate({ from: 'now-30d' }),
      analyticsApi.getDefenseScoreTrend({ from: 'now-30d', interval: 'day', windowDays: 7, scoringMode }),
      analyticsApi.getErrorRateTrend({ from: 'now-30d', interval: 'day', windowDays: 7 }),
    ]);
    setDefense30(settle(d30));
    setDefense7(settle(d7));
    setErrorRate(settle(er));
    setDefenseTrend(settle(dTrend));
    setErrorTrend(settle(eTrend));
  }, [analyticsConfigured, scoringMode]);

  // Defender slice
  const loadDefenderData = useCallback(async () => {
    if (!defenderConfigured) return;
    const [score, trend, controls] = await Promise.allSettled([
      defenderApi.getSecureScore(),
      defenderApi.getSecureScoreTrend(30),
      defenderApi.getControls({ deprecated: false }),
    ]);
    setSecureScore(settle(score));
    setSecureTrend(settle(trend));
    setRawControls(settle(controls));
  }, [defenderConfigured]);

  useEffect(() => {
    // Wait for config checks so we don't render "not configured" flashes
    if (analyticsAuthLoading || defenderConfigLoading) return;
    let cancelled = false;
    void Promise.all([loadAgentData(), loadTestData(), loadAnalyticsData(), loadDefenderData()])
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analyticsAuthLoading, defenderConfigLoading, loadAgentData, loadTestData, loadAnalyticsData, loadDefenderData]);

  usePolling(loadAgentData, AGENT_POLL_MS);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await browserApi.syncTests();
      setSyncStatus(result.syncStatus);
      await loadTestData();
    } finally {
      setSyncing(false);
    }
  }, [loadTestData]);

  const testStats = useMemo(() => (tests ? computeTestStats(tests) : null), [tests]);

  // Left-join error-rate + secure-score trends onto the defense-score days
  const trend = useMemo<TrendPoint[]>(() => {
    if (!defenseTrend?.length) return [];
    const errByDay = new Map(
      (errorTrend ?? []).map((p) => [format(toDate(p.timestamp), 'yyyy-MM-dd'), p.errorRate]),
    );
    const secureByDay = new Map(
      (secureTrend ?? []).map((p) => [format(new Date(p.date), 'yyyy-MM-dd'), p.percentage]),
    );
    return defenseTrend.map((p) => {
      const day = format(toDate(p.timestamp), 'yyyy-MM-dd');
      return {
        date: format(toDate(p.timestamp), 'MMM d'),
        defense: p.score,
        secure: secureByDay.get(day) ?? null,
        errorRate: errByDay.get(day) ?? null,
      };
    });
  }, [defenseTrend, errorTrend, secureTrend]);

  const trendDescription = useMemo(() => {
    const parts: string[] = [];
    if (defense30) parts.push(`Defense ${defense30.score.toFixed(1)}%`);
    if (secureScore) parts.push(`Secure ${secureScore.percentage.toFixed(1)}%`);
    if (errorRate) parts.push(`Error rate ${errorRate.errorRate.toFixed(1)}%`);
    parts.push('(7-day rolling)');
    return parts.join(' · ');
  }, [defense30, secureScore, errorRate]);

  const controls = useMemo<RemediationControl[]>(() => {
    if (!rawControls) return [];
    return [...rawControls]
      .sort((a, b) => b.max_score - a.max_score)
      .slice(0, TOP_CONTROLS)
      .map((c) => ({
        id: c.control_name,
        title: c.title,
        category: c.control_category,
        scoreImpact: `+${c.max_score.toFixed(2)}`,
        url: c.action_url || undefined,
      }));
  }, [rawControls]);

  const recentExecutions = useMemo<RecentExecution[]>(() => {
    if (!recentTasks) return [];
    return recentTasks
      .filter((t) => t.status === 'completed' || t.status === 'failed')
      .slice(0, RECENT_TASKS)
      .map((t) => ({
        id: t.id,
        testName: t.payload?.test_name || t.type,
        hostname: t.agent_hostname ?? undefined,
        status: t.status as 'completed' | 'failed',
        timeAgo: relativeTime(t.completed_at ?? t.created_at),
        to: `/tasks?search=${encodeURIComponent(t.payload?.test_name || t.id)}`,
      }));
  }, [recentTasks]);

  const attentionItems = useMemo(
    () =>
      loading
        ? []
        : deriveAttentionItems({
            offlineAgents: metrics?.offline ?? 0,
            staleAgents: fleetHealth?.stale_agent_count ?? 0,
            failedTasks24h: metrics?.task_activity_24h.failed ?? 0,
            outdatedAgents: outdatedCount,
            syncFailed: syncStatus?.status === 'error',
          }),
    [loading, metrics, fleetHealth, outdatedCount, syncStatus],
  );

  return {
    loading: loading || analyticsAuthLoading || defenderConfigLoading,
    syncStatus,
    syncing,
    handleSync,
    lastSyncedAgo: syncStatus?.lastSyncTime ? relativeTime(syncStatus.lastSyncTime) : undefined,
    attentionItems,
    defense30,
    defense7,
    errorRate,
    secureScore,
    testStats,
    metrics,
    fleetHealth,
    trend,
    trendDescription,
    controls,
    recentExecutions,
    analyticsConfigured,
    defenderConfigured,
  };
}
