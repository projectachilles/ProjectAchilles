import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Table, Filter, ChevronUp, ChevronDown, RefreshCw, Settings, ShieldCheck, ShieldOff } from 'lucide-react';
import { CrowdStrikeLogo, SentinelOneLogo } from '@/components/shared/VendorLogos';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import SettingsModal from './components/SettingsModal';
import FilterBar from './components/FilterBar';
import DateRangePicker from './components/DateRangePicker';
import HeroMetricsCard from './components/HeroMetricsCard';
import TrendChart from './components/TrendChart';
import ErrorTypePieChart from './components/ErrorTypePieChart';
import StackedBarChart from './components/StackedBarChart';
import TechniqueDistributionCard from './components/TechniqueDistributionCard';
import CoverageTreemap from './components/CoverageTreemap';
import DefenseScoreByHostChart from './components/DefenseScoreByHostChart';
import ChainDepthCard from './components/ChainDepthCard';
import TestActivityCard from './components/TestActivityCard';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import { Toast } from '@/components/shared/ui/Alert';
import RiskAcceptancesTab from './components/RiskAcceptancesTab';
import DefenderTab from './components/DefenderTab';
import CrowdStrikeTab from './components/CrowdStrikeTab';
import SentinelOneTab from './components/SentinelOneTab';
import SecureScoreCard from './components/SecureScoreCard';
import ZtaScoreCard from './components/ZtaScoreCard';
import TopControlsCard from './components/TopControlsCard';
import { useAnalyticsFilters, serializeToUrlParams } from '@/hooks/useAnalyticsFilters';
import { pickCurrentErrorRate, pickCurrentScore, postureWindowLabel, seriesDelta } from '@/lib/posture';
import { resolveTimeWindow, timeRangeDays } from '@/lib/timeRange';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useCrowdStrikeConfig } from '@/hooks/useCrowdStrikeConfig';
import { useSentinelOneConfig } from '@/hooks/useSentinelOneConfig';
import { sentineloneAnalyticsApi } from '../../services/api/sentineloneAnalytics';
import { useScoringMode } from '@/hooks/useScoringMode';
import { analyticsApi } from '../../services/api/analytics';
import { reportsApi } from '../../services/api/reports';
import { defenderApi, type SecureScoreSummary, type SecureScoreTrendPoint } from '../../services/api/defender';
import { crowdstrikeApi, type ZtaScoreSummary, type ZtaScoreTrendPoint } from '../../services/api/crowdstrike';
import type {
  TrendDataPoint,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  FilterOption,
  ChainDepthResponse,
  EnrichedTestExecution,
  DefenseScoreByHostItem,
  ErrorRateTrendDataPoint,
  GroupedPaginatedResponse,
  RiskAcceptance,
} from '../../services/api/analytics';

type TabType = 'dashboard' | 'executions' | 'risk-acceptances' | 'defender' | 'crowdstrike' | 'sentinelone';

interface DefenseScoreData {
  overall: number | null;
  delta: number | null;
  total: number;
  protected: number;
  realScore?: number | null;
  rawScore?: number | null;
  riskAcceptedCount?: number;
  /** Test x endpoint pairs behind the tile score (basis=latest). */
  pairCount?: number;
}

export default function AnalyticsDashboardPage() {
  // Performance measurement (dev only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      performance.mark('analytics-mount');
    }
  }, []);

  // URL state for tab
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabType | null;
  const expandedFromUrl = searchParams.get('expanded');

  // Defender integration status (Approach A: hidden when not configured)
  const { configured: defenderConfigured } = useDefenderConfig();
  // CrowdStrike integration status (same hidden-until-configured pattern)
  const { configured: crowdstrikeConfigured } = useCrowdStrikeConfig();
  // SentinelOne integration status (same hidden-until-configured pattern)
  const { configured: sentineloneConfigured } = useSentinelOneConfig();
  const { scoringMode } = useScoringMode();

  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const validTabs: TabType[] = [
    'dashboard',
    'executions',
    'risk-acceptances',
    ...(defenderConfigured ? ['defender' as const] : []),
    ...(crowdstrikeConfigured ? ['crowdstrike' as const] : []),
    ...(sentineloneConfigured ? ['sentinelone' as const] : []),
  ];
  const [activeTab, setActiveTab] = useState<TabType>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'dashboard'
  );

  // Defender dashboard data (loaded alongside main dashboard when configured)
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [defenderTechniqueCount, setDefenderTechniqueCount] = useState<number>(0);
  const [secureScoreTrendData, setSecureScoreTrendData] = useState<SecureScoreTrendPoint[]>([]);

  // CrowdStrike dashboard data (loaded alongside main dashboard when configured)
  const [ztaScore, setZtaScore] = useState<ZtaScoreSummary | null>(null);
  const [crowdstrikeTechniqueCount, setCrowdStrikeTechniqueCount] = useState<number>(0);
  const [ztaScoreTrendData, setZtaScoreTrendData] = useState<ZtaScoreTrendPoint[]>([]);

  // SentinelOne dashboard data: technique overlap only (no posture-score equivalent).
  const [sentineloneTechniqueCount, setSentinelOneTechniqueCount] = useState<number>(0);

  // Risk acceptances tab badge count
  const [activeRiskCount, setActiveRiskCount] = useState(0);

  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab') as TabType | null;
    const resolved = urlTab && validTabs.includes(urlTab) ? urlTab : 'dashboard';
    if (resolved !== activeTab) {
      setActiveTab(resolved);
    }
  }, [searchParams, defenderConfigured, crowdstrikeConfigured, sentineloneConfigured]);

  // Handle tab change with URL sync
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    if (tab === 'dashboard') {
      newParams.delete('tab');
    } else {
      newParams.set('tab', tab);
    }
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Master-detail selection deep link (?expanded=<groupKey>)
  const handleExpandedChange = useCallback((key: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (key) next.set('expanded', key);
      else next.delete('expanded');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Filter state (with URL sync)
  const filterState = useAnalyticsFilters(true);

  // Same filters as the tab, serialized the same way, so the report is
  // bookmarkable and regenerates the same scope.
  const reportHref = useMemo(() => {
    const qs = new URLSearchParams(serializeToUrlParams(filterState.filters)).toString();
    return `/analytics/report${qs ? `?${qs}` : ''}`;
  }, [filterState.filters]);

  // Watch for settings changes (e.g., index pattern change)
  const { settingsVersion } = useAnalyticsAuth();

  // Load active risk count on mount for tab badge
  useEffect(() => {
    analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 })
      .then((result) => setActiveRiskCount(result.total))
      .catch(() => {});
  }, [settingsVersion]);

  // Filter options data
  const [availableHostnames, setAvailableHostnames] = useState<FilterOption[]>([]);
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [availableTechniques, setAvailableTechniques] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<FilterOption[]>([]);
  const [availableSeverities, setAvailableSeverities] = useState<FilterOption[]>([]);
  const [availableThreatActors, setAvailableThreatActors] = useState<FilterOption[]>([]);
  const [availableTags, setAvailableTags] = useState<FilterOption[]>([]);
  const [availableErrorNames, setAvailableErrorNames] = useState<FilterOption[]>([]);
  const [availableErrorCodes, setAvailableErrorCodes] = useState<FilterOption[]>([]);
  const [availableBundleNames, setAvailableBundleNames] = useState<FilterOption[]>([]);

  // Dashboard Data State
  const [defenseScore, setDefenseScore] = useState<DefenseScoreData | null>(null);
  const [errorRate, setErrorRate] = useState<number | null>(null);
  const [uniqueHostnames, setUniqueHostnames] = useState<number>(0);
  const [uniqueTestCount, setUniqueTestCount] = useState<number>(0);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [errorRateTrendData, setErrorRateTrendData] = useState<ErrorRateTrendDataPoint[]>([]);
  const [errorTypeData, setErrorTypeData] = useState<ErrorTypeBreakdown[]>([]);
  const [testCoverageData, setTestCoverageData] = useState<TestCoverageItem[]>([]);
  const [techniqueDistData, setTechniqueDistData] = useState<TechniqueDistributionItem[]>([]);
  const [hostTestMatrix, setHostTestMatrix] = useState<HostTestMatrixCell[]>([]);

  // New visualization data
  // null after a failed fetch (the card shows its error state)
  const [chainDepth, setChainDepth] = useState<ChainDepthResponse | null>(null);
  const [recentTests, setRecentTests] = useState<EnrichedTestExecution[]>([]);
  const [recentTestsTotal, setRecentTestsTotal] = useState<number | null>(null);
  const [defenseScoreByHost, setDefenseScoreByHost] = useState<DefenseScoreByHostItem[]>([]);
  const [canonicalTestCount, setCanonicalTestCount] = useState<number>(0);
  const [canonicalTestCount30d, setCanonicalTestCount30d] = useState<number>(0);

  // Executions tab data
  const [executionsData, setExecutionsData] = useState<GroupedPaginatedResponse | null>(null);
  const [executionsPage, setExecutionsPage] = useState(1);
  const [executionsPageSize, setExecutionsPageSize] = useState(25);
  const [executionsSortField, setExecutionsSortField] = useState<string>('routing.event_time');
  const [executionsSortOrder, setExecutionsSortOrder] = useState<'asc' | 'desc'>('desc');

  // Archive state
  const [archiving, setArchiving] = useState(false);
  const [archiveToast, setArchiveToast] = useState<{ message: string; variant: 'success' | 'destructive' } | null>(null);
  const [sbReportExporting, setSbReportExporting] = useState(false);
  const [sbReportToast, setSbReportToast] = useState<{ message: string; variant: 'success' | 'destructive' } | null>(null);
  // Ref to latest loadExecutionsData so archive handlers always call the current version
  const loadExecutionsDataRef = useRef<() => Promise<void>>(undefined);

  // Risk acceptance state
  const [acceptingRisk, setAcceptingRisk] = useState(false);
  const [riskAcceptances, setRiskAcceptances] = useState<Map<string, RiskAcceptance[]>>(new Map());

  // Loading States
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingExecutions, setLoadingExecutions] = useState(false);

  // Load filter options and canonical test count on mount and when settings change
  useEffect(() => {
    loadFilterOptions();
    loadCanonicalTestCount();
  }, [settingsVersion]);

  // Load canonical test counts (stable baselines for coverage calculations)
  async function loadCanonicalTestCount() {
    try {
      const [result90d, result30d] = await Promise.all([
        analyticsApi.getCanonicalTestCount({ days: 90 }),
        analyticsApi.getCanonicalTestCount({ days: 30 }),
      ]);
      setCanonicalTestCount(result90d.count);
      setCanonicalTestCount30d(result30d.count);
    } catch (error) {
      console.error('Failed to load canonical test count:', error);
    }
  }

  // Load dashboard data when filters, settings, defender/crowdstrike config, or scoring mode change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    }
  }, [filterState.filters, activeTab, settingsVersion, defenderConfigured, crowdstrikeConfigured, sentineloneConfigured, scoringMode]);

  // Load executions data when tab/filters/pagination/settings change
  useEffect(() => {
    if (activeTab === 'executions') {
      loadExecutionsData();
    }
  }, [filterState.filters, activeTab, executionsPage, executionsPageSize, executionsSortField, executionsSortOrder, settingsVersion]);

  // Load filter dropdown options
  async function loadFilterOptions() {
    setLoadingFilters(true);
    try {
      const [tests, techniques, hostnames, categories, severities, threatActors, tags, errorNames, errorCodes, bundleNames] = await Promise.all([
        analyticsApi.getAvailableTests(),
        analyticsApi.getAvailableTechniques(),
        analyticsApi.getAvailableHostnames(),
        analyticsApi.getAvailableCategories(),
        analyticsApi.getAvailableSeverities(),
        analyticsApi.getAvailableThreatActors(),
        analyticsApi.getAvailableTags(),
        analyticsApi.getAvailableErrorNames(),
        analyticsApi.getAvailableErrorCodes(),
        analyticsApi.getAvailableBundleNames(),
      ]);

      setAvailableTests(tests);
      setAvailableTechniques(techniques);
      setAvailableHostnames(hostnames);
      setAvailableCategories(categories);
      setAvailableSeverities(severities);
      setAvailableThreatActors(threatActors);
      setAvailableTags(tags);
      setAvailableErrorNames(errorNames);
      setAvailableErrorCodes(errorCodes);
      setAvailableBundleNames(bundleNames);
    } catch (error) {
      console.error('Failed to load filter options:', error);
    } finally {
      setLoadingFilters(false);
    }
  }

  // Load dashboard data
  const loadDashboardData = useCallback(async () => {
    setLoadingDashboard(true);
    const params = filterState.getApiParams();
    // Score-bearing endpoints report the latest result per test x endpoint pair.
    const scoreParams = { ...params, scoringMode, basis: 'latest' as const };

    try {
      const [
        score,
        hostnameCount,
        testCount,
        trend,
        errorTypes,
        coverage,
        techDist,
        matrix,
        chainDepthData,
        recentTestsData,
        hostScores,
        errorRateData,
        errorRateTrend,
      ] = await Promise.all([
        analyticsApi.getDefenseScore(scoreParams),
        analyticsApi.getUniqueHostnames(params),
        analyticsApi.getUniqueTests(params),
        analyticsApi.getDefenseScoreTrend({ ...scoreParams, interval: 'day' }),
        analyticsApi.getResultsByErrorType(params),
        analyticsApi.getTestCoverage(scoreParams),
        analyticsApi.getTechniqueDistribution(scoreParams),
        analyticsApi.getHostTestMatrix(params),
        // Its own failure only blanks its card, not the whole dashboard.
        analyticsApi.getChainDepth(scoreParams).catch((err: unknown) => {
          console.error('Failed to load chain depth:', err);
          return null;
        }),
        // 12 = TestActivityCard's FitList max; the card shows as many as fit its row
        analyticsApi.getPaginatedExecutions({ ...params, pageSize: 12, sortField: 'routing.event_time', sortOrder: 'desc' }),
        analyticsApi.getDefenseScoreByHostname(scoreParams),
        analyticsApi.getErrorRate(params),
        analyticsApi.getErrorRateTrend({ ...params, interval: 'day' }),
      ]);

      setDefenseScore({
        overall: score.score,
        delta: null,
        total: score.totalExecutions,
        protected: score.protectedCount,
        realScore: score.realScore,
        rawScore: score.rawScore,
        riskAcceptedCount: score.riskAcceptedCount,
        pairCount: score.pairCount,
      });
      setUniqueHostnames(hostnameCount);
      setUniqueTestCount(testCount);
      setTrendData(trend);
      setErrorTypeData(errorTypes);
      setTestCoverageData(coverage.slice(0, 10));
      setTechniqueDistData(techDist.slice(0, 10));
      setHostTestMatrix(matrix);
      setChainDepth(chainDepthData);
      setRecentTests(recentTestsData.data);
      setRecentTestsTotal(recentTestsData.pagination.totalItems);
      setDefenseScoreByHost(hostScores);
      setErrorRate(errorRateData.errorRate);
      setErrorRateTrendData(errorRateTrend);

      // Conditionally load Defender summary for dashboard cards
      if (defenderConfigured) {
        const trendDays = timeRangeDays(filterState.filters.dateRange);

        try {
          const [defScore, defTechniques, defTrend] = await Promise.all([
            defenderApi.getSecureScore(),
            defenderApi.getTechniqueOverlap(),
            defenderApi.getSecureScoreTrend(trendDays),
          ]);
          setSecureScore(defScore);
          setDefenderTechniqueCount(defTechniques.length);
          setSecureScoreTrendData(defTrend);
        } catch {
          // Defender data is supplementary — don't fail the whole dashboard
          setSecureScoreTrendData([]);
        }
      } else {
        setSecureScoreTrendData([]);
      }

      // Conditionally load CrowdStrike summary for dashboard cards
      if (crowdstrikeConfigured) {
        const trendDays = timeRangeDays(filterState.filters.dateRange);

        try {
          const [csScore, csTechniques, csTrend] = await Promise.all([
            crowdstrikeApi.getZtaScore(),
            crowdstrikeApi.getTechniqueOverlap(),
            crowdstrikeApi.getZtaScoreTrend(trendDays),
          ]);
          setZtaScore(csScore);
          setCrowdStrikeTechniqueCount(csTechniques.length);
          setZtaScoreTrendData(csTrend);
        } catch {
          // CrowdStrike data is supplementary — don't fail the whole dashboard.
          // ZTA may be unlicensed (403) in some tenants; the card hides then.
          setZtaScore(null);
          setZtaScoreTrendData([]);
        }
      } else {
        setZtaScore(null);
        setZtaScoreTrendData([]);
      }

      // SentinelOne: technique overlap badge only — there is no ZTA-style score to show.
      if (sentineloneConfigured) {
        try {
          const s1Techniques = await sentineloneAnalyticsApi.getTechniqueOverlap();
          setSentinelOneTechniqueCount(s1Techniques.length);
        } catch {
          setSentinelOneTechniqueCount(0);
        }
      } else {
        setSentinelOneTechniqueCount(0);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoadingDashboard(false);
      if (import.meta.env.DEV) {
        performance.mark('analytics-data-ready');
        if (performance.getEntriesByName('analytics-mount').length) {
          performance.measure('analytics-time-to-data', 'analytics-mount', 'analytics-data-ready');
          const m = performance.getEntriesByName('analytics-time-to-data').pop();
          if (m) {
            // eslint-disable-next-line no-console
            console.log(`%c[Perf] Analytics time-to-data: ${m.duration.toFixed(0)}ms`, 'color: #10b981; font-weight: bold');
          }
        }
      }
    }
  }, [filterState, defenderConfigured, crowdstrikeConfigured, sentineloneConfigured, scoringMode]);

  // Load executions data
  const loadExecutionsData = useCallback(async () => {
    setLoadingExecutions(true);
    const params = filterState.getApiParams();

    try {
      const data = await analyticsApi.getGroupedPaginatedExecutions({
        ...params,
        page: executionsPage,
        pageSize: executionsPageSize,
        sortField: executionsSortField,
        sortOrder: executionsSortOrder,
      });
      setExecutionsData(data);
    } catch (error) {
      console.error('Failed to load executions:', error);
    } finally {
      setLoadingExecutions(false);
    }
  }, [filterState, executionsPage, executionsPageSize, executionsSortField, executionsSortOrder]);

  // Keep ref in sync with latest loadExecutionsData
  loadExecutionsDataRef.current = loadExecutionsData;

  // Archive handlers
  const handleArchive = useCallback(async (groupKeys: string[]) => {
    setArchiving(true);
    try {
      const result = await analyticsApi.archiveExecutions(groupKeys);
      await loadExecutionsDataRef.current?.();
      setArchiveToast({
        message: result.archived === 0
          ? 'Archive call succeeded but matched 0 documents — nothing was moved.'
          : `Archived ${result.archived} document${result.archived === 1 ? '' : 's'}.`,
        variant: result.archived === 0 ? 'destructive' : 'success',
      });
    } catch (error) {
      // Axios interceptor in useAuthenticatedApi promotes server's response.data.error to error.message,
      // so this surfaces e.g. ES "security_exception: action [indices:admin/create] is unauthorized" verbatim.
      const detail = (error as { message?: string })?.message || 'Unknown error';
      console.error('Failed to archive executions:', error);
      setArchiveToast({ message: `Archive failed: ${detail}`, variant: 'destructive' });
    } finally {
      setArchiving(false);
    }
  }, []);

  const handleArchiveByDate = useCallback(async (before: string) => {
    setArchiving(true);
    try {
      const result = await analyticsApi.archiveExecutionsByDate(before);
      await loadExecutionsDataRef.current?.();
      setArchiveToast({
        message: result.archived === 0
          ? 'Archive-by-date call succeeded but matched 0 documents.'
          : `Archived ${result.archived} document${result.archived === 1 ? '' : 's'} before ${before}.`,
        variant: result.archived === 0 ? 'destructive' : 'success',
      });
    } catch (error) {
      const detail = (error as { message?: string })?.message || 'Unknown error';
      console.error('Failed to archive executions by date:', error);
      setArchiveToast({ message: `Archive failed: ${detail}`, variant: 'destructive' });
    } finally {
      setArchiving(false);
    }
  }, []);

  // Auto-dismiss the archive toast after 8s — long enough for users to read a multi-line ES error
  // (e.g. "security_exception: action [indices:admin/create] is unauthorized..."), but not permanent.
  useEffect(() => {
    if (!archiveToast) return;
    const timer = globalThis.setTimeout(() => setArchiveToast(null), 8000);
    return () => globalThis.clearTimeout(timer);
  }, [archiveToast]);

  // ── SB report export ─────────────────────────────────────────────
  // The report endpoint validates from/to as concrete ISO datetimes, so the
  // date-range filter (which may be ES date math like 'now-90d') is resolved
  // to an absolute window here. The 'all' preset maps to the last 90 days,
  // matching the trend-window convention used elsewhere on this page.
  const sbReportWindow = useMemo(
    () => resolveTimeWindow(filterState.filters.dateRange),
    [filterState.filters.dateRange],
  );

  const handleExportSbReport = useCallback(async () => {
    if (!sbReportWindow) {
      setSbReportToast({
        message: 'SB report needs a concrete date range — pick a custom range or a relative preset.',
        variant: 'destructive',
      });
      return;
    }
    // Forward the active analytics filter-bar scope filters so the export
    // matches what the operator is looking at. Outcome/result filters are
    // deliberately NOT forwarded — they would falsify a compliance report.
    const joinOrUndefined = (values: string[]) => (values.length > 0 ? values.join(',') : undefined);
    setSbReportExporting(true);
    try {
      const report = await reportsApi.getSbPc2026001Report({
        ...sbReportWindow,
        org: filterState.filters.org || undefined,
        tags: joinOrUndefined(filterState.filters.tags),
        hostnames: joinOrUndefined(filterState.filters.hostnames),
        tests: joinOrUndefined(filterState.filters.tests),
        bundleNames: joinOrUndefined(filterState.filters.bundleNames),
      });
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sb_export_${sbReportWindow.from.slice(0, 10)}_${sbReportWindow.to.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSbReportToast({
        message: `SB Export downloaded (${report.executions.length} execution rows).`,
        variant: 'success',
      });
    } catch (error) {
      const detail = (error as { message?: string })?.message || 'Unknown error';
      console.error('Failed to export SB report:', error);
      setSbReportToast({ message: `SB report export failed: ${detail}`, variant: 'destructive' });
    } finally {
      setSbReportExporting(false);
    }
  }, [sbReportWindow, filterState.filters.org, filterState.filters.tags, filterState.filters.hostnames, filterState.filters.tests, filterState.filters.bundleNames]);

  useEffect(() => {
    if (!sbReportToast) return;
    const timer = globalThis.setTimeout(() => setSbReportToast(null), 8000);
    return () => globalThis.clearTimeout(timer);
  }, [sbReportToast]);

  // Risk acceptance handlers
  const loadRiskAcceptances = useCallback(async (groups: GroupedPaginatedResponse | null) => {
    if (!groups || groups.groups.length === 0) return;

    // Collect unique test_names from current page
    const testNames = new Set<string>();
    for (const g of groups.groups) {
      for (const m of g.members) {
        testNames.add(m.test_name);
      }
    }

    try {
      const result = await analyticsApi.lookupAcceptances([...testNames]);
      setRiskAcceptances(new Map(Object.entries(result)));
    } catch (error) {
      console.error('Failed to load risk acceptances:', error);
    }
  }, []);

  const handleAcceptRisk = useCallback(async (items: { test_name: string; control_id?: string; hostname?: string; scope?: 'host' | 'global' }[], justification: string) => {
    setAcceptingRisk(true);
    try {
      // Accept risk for each item
      for (const item of items) {
        await analyticsApi.acceptRisk({ ...item, justification });
      }
      // Reload both executions (for badge updates) and dashboard (Defense Score changes)
      await loadExecutionsDataRef.current?.();
      if (executionsData) await loadRiskAcceptances(executionsData);
    } catch (error) {
      console.error('Failed to accept risk:', error);
    } finally {
      setAcceptingRisk(false);
    }
  }, [executionsData, loadRiskAcceptances]);

  const handleRevokeRisk = useCallback(async (acceptanceId: string, reason: string) => {
    setAcceptingRisk(true);
    try {
      await analyticsApi.revokeRisk(acceptanceId, reason);
      // Reload both executions (for badge updates) and dashboard (Defense Score changes)
      await loadExecutionsDataRef.current?.();
      if (executionsData) await loadRiskAcceptances(executionsData);
    } catch (error) {
      console.error('Failed to revoke risk acceptance:', error);
    } finally {
      setAcceptingRisk(false);
    }
  }, [executionsData, loadRiskAcceptances]);

  // Load risk acceptances when executions data changes
  useEffect(() => {
    if (executionsData) {
      loadRiskAcceptances(executionsData);
    }
  }, [executionsData, loadRiskAcceptances]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadFilterOptions();
    if (activeTab === 'dashboard') {
      await loadDashboardData();
    } else {
      await loadExecutionsData();
    }
    setIsRefreshing(false);
  }, [activeTab, loadDashboardData, loadExecutionsData]);

  // Handle sort change
  const handleSort = (field: string, order: 'asc' | 'desc') => {
    setExecutionsSortField(field);
    setExecutionsSortOrder(order);
    setExecutionsPage(1); // Reset to first page when sorting changes
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setExecutionsPage(page);
  };

  // Handle page size change
  const handlePageSizeChange = (size: number) => {
    setExecutionsPageSize(size);
    setExecutionsPage(1); // Reset to first page when page size changes
  };

  // Active-range label for the Defense ledger, e.g. "90d window"
  const windowLabel = postureWindowLabel(filterState.filters.dateRange);
  // Ring + pair count follow the trend's last point so the tile and the line never disagree.
  const currentPosture = pickCurrentScore(
    defenseScore ? { score: defenseScore.overall, pairCount: defenseScore.pairCount } : null,
    trendData.length > 0 ? trendData : null,
  );

  return (
    <>
      <div>
        <PageHeader
          title="Analytics"
          description="Detection depth across error types, techniques, and attack chains"
        >
          <Button
            variant={filterState.isExpanded || filterState.activeFilterCount > 0 ? 'secondary' : 'outline'}
            size="sm"
            onClick={filterState.toggleExpanded}
          >
            <Filter />
            Filters
            {filterState.activeFilterCount > 0 && (
              <span className="rounded border border-accent/30 bg-accent-dim px-1.5 font-mono text-[10px] text-accent">
                {filterState.activeFilterCount}
              </span>
            )}
            {filterState.isExpanded ? <ChevronUp className="!size-3" /> : <ChevronDown className="!size-3" />}
          </Button>
          <DateRangePicker value={filterState.filters.dateRange} onChange={filterState.setDateRange} />
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="Analytics settings">
            <Settings />
          </Button>
        </PageHeader>

        {/* Pill sub-tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {([
            { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard, badge: null },
            { id: 'executions' as const, label: 'All Executions', icon: Table, badge: executionsData?.pagination ? executionsData.pagination.totalDocuments.toLocaleString() : null },
            { id: 'risk-acceptances' as const, label: 'Risk Acceptances', icon: ShieldOff, badge: activeRiskCount > 0 ? String(activeRiskCount) : null },
            ...(defenderConfigured ? [{ id: 'defender' as const, label: 'Defender', icon: ShieldCheck, badge: null }] : []),
            ...(crowdstrikeConfigured ? [{ id: 'crowdstrike' as const, label: 'CrowdStrike', icon: CrowdStrikeLogo, badge: null }] : []),
            ...(sentineloneConfigured ? [{ id: 'sentinelone' as const, label: 'SentinelOne', icon: SentinelOneLogo, badge: null }] : []),
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3.5 text-[13px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-accent/25 bg-accent-dim text-accent'
                  : 'border-border bg-raised text-muted hover:bg-overlay'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.badge && (
                <span className="rounded border border-border bg-surface px-1.5 font-mono text-[10px] text-faint">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Shared Filters (visible on both tabs) */}
        {filterState.isExpanded && (
          <FilterBar
            filterState={filterState}
            availableHostnames={availableHostnames}
            availableTests={availableTests}
            availableTechniques={availableTechniques}
            availableCategories={availableCategories}
            availableSeverities={availableSeverities}
            availableThreatActors={availableThreatActors}
            availableTags={availableTags}
            availableErrorNames={availableErrorNames}
            availableErrorCodes={availableErrorCodes}
            availableBundleNames={availableBundleNames}
            loading={loadingFilters}
          />
        )}

        {/* Tab Content */}
        {activeTab === 'defender' ? (
          /* Defender Tab (full-page view) */
          <DefenderTab dateRange={filterState.filters.dateRange} />
        ) : activeTab === 'crowdstrike' ? (
          /* CrowdStrike Tab (full-page view) */
          <CrowdStrikeTab dateRange={filterState.filters.dateRange} />
        ) : activeTab === 'sentinelone' ? (
          /* SentinelOne Tab (full-page view) */
          <SentinelOneTab dateRange={filterState.filters.dateRange} />
        ) : activeTab === 'risk-acceptances' ? (
          /* Risk Acceptances Tab */
          <RiskAcceptancesTab onActiveCountChange={setActiveRiskCount} />
        ) : activeTab === 'dashboard' ? (
          /* Dashboard Tab */
          <div className="flex flex-col gap-4">
            {/* Analytic trio — a clean full row (Test activity lives below,
                in the posture section per the approved Analyst Columns
                redesign, so this grid can never orphan a card) */}
            <div className="grid gap-4 md:grid-cols-3 max-lg:[&>*]:min-w-0">
              <ErrorTypePieChart
                data={errorTypeData}
                loading={loadingDashboard}
                title="Results by error type"
              />
              <TechniqueDistributionCard
                data={techniqueDistData}
                loading={loadingDashboard}
                defenderTechniqueCount={defenderTechniqueCount}
                crowdstrikeTechniqueCount={crowdstrikeTechniqueCount}
                sentineloneTechniqueCount={sentineloneTechniqueCount}
                onTechniqueClick={(technique) => {
                  filterState.setTechniques([technique]);
                  handleTabChange('executions');
                }}
              />
              <ChainDepthCard
                data={chainDepth}
                loading={loadingDashboard}
                onRowClick={(bundleNames) => {
                  filterState.setBundleNames(bundleNames);
                  handleTabChange('executions');
                }}
              />
            </div>

            {/* Posture section — a true two-row 3-column grid so the
                horizontal seams align across columns:
                · row 1: ledger (+ Secure with Defender) | trend — the trend
                  cell is position:absolute-filled so it ADOPTS the rail's
                  height instead of contributing recharts' own ~590px
                  aspect height; trend bottom === Secure card bottom.
                · row 2 (Defender only): Test activity | Top Controls —
                  activity stretches to the controls' height. */}
            <div className="grid items-stretch gap-4 md:grid-cols-3 max-lg:[&>*]:min-w-0">
              <div className="flex min-w-0 flex-col gap-4">
                <HeroMetricsCard
                  defenseScore={currentPosture.score}
                  pairCount={currentPosture.pairCount}
                  tileScore={defenseScore?.overall ?? null}
                  delta={seriesDelta(trendData)}
                  uniqueEndpoints={uniqueHostnames}
                  executedTests={uniqueTestCount}
                  totalResults={defenseScore?.total ?? null}
                  errorRate={pickCurrentErrorRate(errorRateTrendData, errorRate)}
                  realScore={defenseScore?.realScore ?? null}
                  rawScore={defenseScore?.rawScore ?? null}
                  riskAcceptedCount={defenseScore?.riskAcceptedCount}
                  windowLabel={windowLabel}
                  loading={loadingDashboard}
                />
                {defenderConfigured && secureScore && (
                  <SecureScoreCard data={secureScore} loading={loadingDashboard} />
                )}
                {crowdstrikeConfigured && ztaScore && (
                  <ZtaScoreCard data={ztaScore} loading={loadingDashboard} />
                )}
              </div>

              <div className="relative h-[340px] min-w-0 md:col-span-2 md:h-auto">
                <div className="h-full min-w-0 overflow-hidden md:absolute md:inset-0">
                  <TrendChart
                    data={trendData}
                    errorRateData={errorRateTrendData}
                    secureScoreTrendData={secureScoreTrendData}
                    ztaScoreTrendData={ztaScoreTrendData}
                    loading={loadingDashboard}
                    title="Trend Overview"
                  />
                </div>
              </div>

              {defenderConfigured && (
                <>
                  <TestActivityCard
                    recentTests={recentTests}
                    executionCount={recentTestsTotal}
                    loading={loadingDashboard}
                    title="Test activity"
                    className="h-full"
                  />
                  <div className="min-w-0 md:col-span-2">
                    <TopControlsCard compact />
                  </div>
                </>
              )}
            </div>

            {/* Coverage + by-host: last full-width row with Defender, or a
                3-up row alongside Test activity without it */}
            {defenderConfigured ? (
              <div className="grid gap-4 lg:grid-cols-2 max-lg:[&>*]:min-w-0">
                <StackedBarChart
                  data={testCoverageData}
                  loading={loadingDashboard}
                  title="Test Coverage"
                  description="Protected vs unprotected hosts"
                  unit="hosts"
                />
                <DefenseScoreByHostChart
                  data={defenseScoreByHost}
                  loading={loadingDashboard}
                  title="Defense Score by Host"
                />
              </div>
            ) : (
              <div className="grid items-stretch gap-4 md:grid-cols-3 max-lg:[&>*]:min-w-0">
                <TestActivityCard
                  recentTests={recentTests}
                  executionCount={recentTestsTotal}
                  loading={loadingDashboard}
                  title="Test activity"
                  className="h-full"
                />
                <StackedBarChart
                  data={testCoverageData}
                  loading={loadingDashboard}
                  title="Test Coverage"
                  description="Protected vs unprotected hosts"
                  unit="hosts"
                />
                <DefenseScoreByHostChart
                  data={defenseScoreByHost}
                  loading={loadingDashboard}
                  title="Defense Score by Host"
                />
              </div>
            )}

            <CoverageTreemap
              data={hostTestMatrix}
              loading={loadingDashboard}
              title="Test Breadth by Host"
              canonicalTestCount={canonicalTestCount}
              canonicalTestCount30d={canonicalTestCount30d}
            />
          </div>
        ) : (
          /* All Executions Tab */
          <ExecutionsDataTable
            data={executionsData}
            loading={loadingExecutions}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            onSort={handleSort}
            sortField={executionsSortField}
            sortOrder={executionsSortOrder}
            onArchive={handleArchive}
            onArchiveByDate={handleArchiveByDate}
            archiving={archiving}
            onAcceptRisk={handleAcceptRisk}
            onRevokeRisk={handleRevokeRisk}
            riskAcceptances={riskAcceptances}
            acceptingRisk={acceptingRisk}
            selectedKey={expandedFromUrl}
            onSelectedKeyChange={handleExpandedChange}
            onExportSbReport={handleExportSbReport}
            sbReportExporting={sbReportExporting}
            reportHref={reportHref}
          />
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleRefresh}
      />

      {/* Archive result toast — fixed bottom-right so it overlays the table without shifting layout */}
      {archiveToast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md">
          <Toast
            variant={archiveToast.variant}
            message={archiveToast.message}
            onClose={() => setArchiveToast(null)}
          />
        </div>
      )}
      {sbReportToast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md">
          <Toast
            variant={sbReportToast.variant}
            message={sbReportToast.message}
            onClose={() => setSbReportToast(null)}
          />
        </div>
      )}
    </>
  );
}
