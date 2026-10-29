import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  analyticsApi,
  type DefenseScore,
  type ErrorRateResponse,
  type ErrorRateTrendDataPoint,
  type ExecutionActivityResponse,
  type TechniqueOutcomeItem,
  type ThreatActorCoverageItem,
  type TrendDataPoint,
} from '@/services/api/analytics';
import {
  defenderApi,
  type ControlItem,
  type SecureScoreSummary,
  type SecureScoreTrendPoint,
} from '@/services/api/defender';
import {
  crowdstrikeApi,
  type ZtaScoreSummary,
  type ZtaScoreTrendPoint,
} from '@/services/api/crowdstrike';
import { sophosAnalyticsApi, type SophosHealthCheckResponse } from '@/services/api/sophosAnalytics';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, FleetHealthMetrics, Schedule } from '@/types/agent';
import { browserApi, type SyncStatus } from '@/services/api/browser';
import type { TestMetadata } from '@/types/test';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useCrowdStrikeConfig } from '@/hooks/useCrowdStrikeConfig';
import { useSophosConfig } from '@/hooks/useSophosConfig';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';
import { useScoringMode } from '@/hooks/useScoringMode';
import { usePolling } from '@/hooks/usePolling';
import { formatUtcDay, utcDayKey } from '@/lib/utcDate';
import { pickCurrentErrorRate, pickCurrentScore, seriesDelta } from '@/lib/posture';
import {
  DEFAULT_TIME_RANGE,
  getDateRangeFilter,
  timeRangeButtonLabel,
  timeRangeDays,
  type DateRangeValue,
} from '@/lib/timeRange';
import { computeTestStats, type TestStats } from './computeTestStats';
import {
  buildActorReadiness,
  buildAttackMatrix,
  buildCadence,
  type ActorReadinessView,
  type AttackMatrixView,
  type CadenceView,
} from './dashboardViews';
import { deriveAttentionItems } from './deriveAttentionItems';
import type { AttentionItem } from './components/AttentionBanner';
import type { TrendPoint } from './components/TrendOverviewChart';
import type { RemediationControl } from './components/TopControlsCard';
import type { RecentExecution } from './components/RecentExecutionsCard';

// Upper bounds: the cards show as many as fit their row (FitList max)
const TOP_CONTROLS = 10;
const RECENT_TASKS = 10;
const AGENT_POLL_MS = 15_000;
const CADENCE_DAYS = 14;

/** Phrase for "not tested in <range>". */
function rangeLabelFor(range: DateRangeValue): string {
  if (range.preset === 'all') return 'all time';
  if (range.preset === 'custom') return 'this range';
  return `the last ${timeRangeButtonLabel(range.preset)}`;
}

function settle<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

/**
 * Next schedules state. null = unavailable: set only on HTTP 403 (role lacks
 * endpoints:schedules:read), so the cadence card hides its "Next scheduled"
 * row. A transient failure keeps the previous value instead of flashing
 * "Nothing scheduled" on one failed poll.
 */
export function settleSchedules(
  prev: Schedule[] | null,
  result: PromiseSettledResult<Schedule[]>,
): Schedule[] | null {
  if (result.status === 'fulfilled') return result.value;
  return isAxiosError(result.reason) && result.reason.response?.status === 403 ? null : prev;
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

/** Join secure/zta/error series onto the defense days by UTC day key. */
export function buildTrendPoints(
  defense: TrendDataPoint[] | null,
  error: ErrorRateTrendDataPoint[] | null,
  secure: SecureScoreTrendPoint[] | null,
  zta: ZtaScoreTrendPoint[] | null,
  sophos: SophosHealthCheckResponse['trend'] | null = null,
): TrendPoint[] {
  if (!defense?.length) return [];
  const errByDay = new Map((error ?? []).map((p) => [utcDayKey(p.timestamp), p.errorRate]));
  const secureByDay = new Map((secure ?? []).map((p) => [utcDayKey(p.date), p.percentage]));
  const ztaByDay = new Map((zta ?? []).map((p) => [utcDayKey(p.date), p.overallScore]));
  const sophosByDay = new Map((sophos ?? []).map((p) => [utcDayKey(p.date), p.score]));
  return defense.map((p) => {
    const day = utcDayKey(p.timestamp);
    return {
      date: formatUtcDay(p.timestamp),
      defense: p.score,
      secure: secureByDay.get(day) ?? null,
      zta: ztaByDay.get(day) ?? null,
      ...(sophosByDay.size > 0 ? { sophos: sophosByDay.get(day) ?? null } : {}),
      errorRate: errByDay.get(day) ?? null,
    };
  });
}

/** Describe the CURRENT value of each series; null parts are omitted. */
export function buildTrendDescription(parts: {
  defense: number | null;
  secure: number | null;
  zta: number | null;
  errorRate: number | null;
  /** Achilles average of Sophos Health Check scores. */
  sophos?: number | null;
}): string {
  const out: string[] = [];
  if (parts.defense != null) out.push(`Defense ${parts.defense.toFixed(1)}%`);
  if (parts.secure != null) out.push(`Secure ${parts.secure.toFixed(1)}%`);
  if (parts.zta != null) out.push(`ZTA ${parts.zta.toFixed(1)}%`);
  if (parts.sophos != null) out.push(`Sophos ${parts.sophos.toFixed(1)}%`);
  if (parts.errorRate != null) out.push(`Error rate ${parts.errorRate.toFixed(1)}%`);
  return out.join(' · ');
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
  /** Defense score over the selected range. */
  defenseScore: DefenseScore | null;
  /** Current score: the trend's last point (matches the line), else the tile. */
  defenseCurrentScore: number | null;
  /** Test x endpoint pairs behind the current Defense Score. */
  defensePairCount: number | null;
  /** Last minus first scored point of the defense trend. */
  defenseDelta: number | null;
  cadence: CadenceView | null;
  actorReadiness: ActorReadinessView | null;
  attackMatrix: AttackMatrixView | null;
  errorRate: ErrorRateResponse | null;
  secureScore: SecureScoreSummary | null;
  ztaScore: ZtaScoreSummary | null;
  /** Latest Sophos Health Check headline (0-100), null until the posture pass has run. */
  sophosHealth: number | null;
  testStats: TestStats | null;
  metrics: AgentMetrics | null;
  fleetHealth: FleetHealthMetrics | null;
  /** Agents running an older version than the latest registered one. */
  outdatedAgents: number;
  trend: TrendPoint[];
  trendDescription: string;
  controls: RemediationControl[];
  recentExecutions: RecentExecution[];
  analyticsConfigured: boolean;
  defenderConfigured: boolean;
  crowdstrikeConfigured: boolean;
  sophosConfigured: boolean;
}

/** Time window shared with Analytics; drives the analytics + Defender + CrowdStrike slices. */
/** Failed runs/tasks for the attention row: 7d outcome counts when the backend has them. */
function failedTasksInput(metrics: AgentMetrics | null): { failedTasks: number; failedTasksWindow: '7d' | '24h' } {
  const o = metrics?.task_outcomes_7d;
  if (o) return { failedTasks: o.tests.run_failed + o.other.failed, failedTasksWindow: '7d' };
  return { failedTasks: metrics?.task_activity_24h.failed ?? 0, failedTasksWindow: '24h' };
}

export function useDashboardData(range: DateRangeValue = DEFAULT_TIME_RANGE): DashboardData {
  // Primitive deps, so a new object for the same range doesn't refetch
  const { preset, from: customFrom, to: customTo } = range;
  const { configured: analyticsConfigured, loading: analyticsAuthLoading } = useAnalyticsAuth();
  const { configured: defenderConfigured, loading: defenderConfigLoading } = useDefenderConfig();
  const { configured: crowdstrikeConfigured, loading: crowdstrikeConfigLoading } = useCrowdStrikeConfig();
  const { configured: sophosConfigured, loading: sophosConfigLoading } = useSophosConfig();
  const { scoringMode } = useScoringMode();
  const { outdatedCount } = useOutdatedAgentCount();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [tests, setTests] = useState<TestMetadata[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [defenseScore, setDefenseScore] = useState<DefenseScore | null>(null);
  const [activity, setActivity] = useState<ExecutionActivityResponse | null>(null);
  const [actorCoverage, setActorCoverage] = useState<ThreatActorCoverageItem[] | null>(null);
  const [techniqueOutcomes, setTechniqueOutcomes] = useState<TechniqueOutcomeItem[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [errorRate, setErrorRate] = useState<ErrorRateResponse | null>(null);
  const [defenseTrend, setDefenseTrend] = useState<TrendDataPoint[] | null>(null);
  const [errorTrend, setErrorTrend] = useState<ErrorRateTrendDataPoint[] | null>(null);
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [secureTrend, setSecureTrend] = useState<SecureScoreTrendPoint[] | null>(null);
  const [ztaScore, setZtaScore] = useState<ZtaScoreSummary | null>(null);
  const [ztaTrend, setZtaTrend] = useState<ZtaScoreTrendPoint[] | null>(null);
  const [sophosHealth, setSophosHealth] = useState<SophosHealthCheckResponse | null>(null);
  const [rawControls, setRawControls] = useState<ControlItem[] | null>(null);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [fleetHealth, setFleetHealth] = useState<FleetHealthMetrics | null>(null);
  const [recentTasks, setRecentTasks] = useState<AgentTask[] | null>(null);

  // Agent fleet slice — cheap SQLite queries, polled every 15s
  const loadAgentData = useCallback(async () => {
    const [m, fh, t, sch] = await Promise.allSettled([
      agentApi.getMetrics(),
      agentApi.getFleetHealthMetrics(),
      agentApi.listTasks({ limit: RECENT_TASKS + 4 }),
      // 403 for roles without endpoints:schedules:read -> null (row hidden)
      agentApi.listSchedules({ status: 'active' }),
    ]);
    setSchedules((prev) => settleSchedules(prev, sch));
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

  // Analytics slice — Elasticsearch queries, reloaded on mount/sync/range change.
  const loadAnalyticsData = useCallback(async () => {
    if (!analyticsConfigured) return;
    const bounds = getDateRangeFilter({ preset, from: customFrom, to: customTo });
    const [dRange, er, dTrend, eTrend, act, actors, outcomes] = await Promise.allSettled([
      analyticsApi.getDefenseScore({ ...bounds, scoringMode, basis: 'latest' }),
      analyticsApi.getErrorRate(bounds),
      analyticsApi.getDefenseScoreTrend({ ...bounds, interval: 'day', scoringMode, basis: 'latest' }),
      analyticsApi.getErrorRateTrend({ ...bounds, interval: 'day' }),
      analyticsApi.getExecutionActivity({ days: CADENCE_DAYS }),
      analyticsApi.getThreatActorCoverage({ ...bounds, scoringMode, basis: 'latest' }),
      analyticsApi.getTechniqueOutcomes({ ...bounds }),
    ]);
    setDefenseScore(settle(dRange));
    setErrorRate(settle(er));
    setDefenseTrend(settle(dTrend));
    setErrorTrend(settle(eTrend));
    setActivity(settle(act));
    setActorCoverage(settle(actors));
    setTechniqueOutcomes(settle(outcomes));
  }, [analyticsConfigured, scoringMode, preset, customFrom, customTo]);

  const trendDays = timeRangeDays({ preset, from: customFrom, to: customTo });

  // Defender slice
  const loadDefenderData = useCallback(async () => {
    if (!defenderConfigured) return;
    const [score, trend, controls] = await Promise.allSettled([
      defenderApi.getSecureScore(),
      defenderApi.getSecureScoreTrend(trendDays),
      defenderApi.getControls({ deprecated: false }),
    ]);
    setSecureScore(settle(score));
    setSecureTrend(settle(trend));
    setRawControls(settle(controls));
  }, [defenderConfigured, trendDays]);

  // CrowdStrike slice — ZTA may be unlicensed (403); settle() nulls it out
  // and the rest of the dashboard is unaffected.
  const loadCrowdStrikeData = useCallback(async () => {
    if (!crowdstrikeConfigured) return;
    const [score, trend] = await Promise.allSettled([
      crowdstrikeApi.getZtaScore(),
      crowdstrikeApi.getZtaScoreTrend(trendDays),
    ]);
    setZtaScore(settle(score));
    setZtaTrend(settle(trend));
  }, [crowdstrikeConfigured, trendDays]);

  // Sophos slice: Health Check headline + trend; a failure just hides the tile value.
  const loadSophosData = useCallback(async () => {
    if (!sophosConfigured) return;
    const [health] = await Promise.allSettled([sophosAnalyticsApi.getHealthCheck(trendDays)]);
    setSophosHealth(settle(health));
  }, [sophosConfigured, trendDays]);

  useEffect(() => {
    // Wait for config checks so we don't render "not configured" flashes
    if (analyticsAuthLoading || defenderConfigLoading || crowdstrikeConfigLoading || sophosConfigLoading) return;
    let cancelled = false;
    void Promise.all([loadAgentData(), loadTestData(), loadAnalyticsData(), loadDefenderData(), loadCrowdStrikeData(), loadSophosData()])
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analyticsAuthLoading, defenderConfigLoading, crowdstrikeConfigLoading, sophosConfigLoading, loadAgentData, loadTestData, loadAnalyticsData, loadDefenderData, loadCrowdStrikeData, loadSophosData]);

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

  const cadence = useMemo(
    () => (activity ? buildCadence(activity, metrics, schedules, metrics?.total ?? 0) : null),
    [activity, metrics, schedules],
  );
  const actorReadiness = useMemo(
    () =>
      actorCoverage
        ? buildActorReadiness(actorCoverage, tests ?? [], rangeLabelFor({ preset, from: customFrom, to: customTo }))
        : null,
    [actorCoverage, tests, preset, customFrom, customTo],
  );
  const attackMatrix = useMemo(
    () => (techniqueOutcomes ? buildAttackMatrix(techniqueOutcomes, tests ?? []) : null),
    [techniqueOutcomes, tests],
  );

  const trend = useMemo<TrendPoint[]>(
    () => buildTrendPoints(defenseTrend, errorTrend, secureTrend, ztaTrend, sophosHealth?.trend ?? null),
    [defenseTrend, errorTrend, secureTrend, ztaTrend, sophosHealth],
  );

  const current = useMemo(() => pickCurrentScore(defenseScore, defenseTrend), [defenseScore, defenseTrend]);
  const defenseDelta = useMemo(() => seriesDelta(defenseTrend ?? []), [defenseTrend]);

  const trendDescription = useMemo(() => {
    return buildTrendDescription({
      defense: current.score,
      secure: secureScore ? secureScore.percentage : null,
      zta: ztaScore ? ztaScore.overallScore : null,
      sophos: sophosHealth?.latest?.headline ?? null,
      errorRate: pickCurrentErrorRate(errorTrend, errorRate?.errorRate),
    });
  }, [current, secureScore, ztaScore, sophosHealth, errorTrend, errorRate]);

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
            ...failedTasksInput(metrics),
            outdatedAgents: outdatedCount,
            syncFailed: syncStatus?.status === 'error',
          }),
    [loading, metrics, fleetHealth, outdatedCount, syncStatus],
  );

  return {
    loading: loading || analyticsAuthLoading || defenderConfigLoading || crowdstrikeConfigLoading || sophosConfigLoading,
    syncStatus,
    syncing,
    handleSync,
    lastSyncedAgo: syncStatus?.lastSyncTime ? relativeTime(syncStatus.lastSyncTime) : undefined,
    attentionItems,
    defenseScore,
    defenseCurrentScore: current.score,
    defensePairCount: current.pairCount,
    defenseDelta,
    cadence,
    actorReadiness,
    attackMatrix,
    errorRate,
    secureScore,
    ztaScore,
    sophosHealth: sophosHealth?.latest?.headline ?? null,
    testStats,
    metrics,
    fleetHealth,
    outdatedAgents: outdatedCount,
    trend,
    trendDescription,
    controls,
    recentExecutions,
    analyticsConfigured,
    defenderConfigured,
    crowdstrikeConfigured,
    sophosConfigured,
  };
}
