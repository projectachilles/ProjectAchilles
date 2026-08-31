import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Table, Filter, ChevronUp, ChevronDown, RefreshCw, Settings, ShieldCheck, ShieldOff } from 'lucide-react';
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
import CategoryBreakdownChart from './components/CategoryBreakdownChart';
import TestActivityCard from './components/TestActivityCard';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import { Toast } from '@/components/shared/ui/Alert';
import RiskAcceptancesTab from './components/RiskAcceptancesTab';
import DefenderTab from './components/DefenderTab';
import SecureScoreCard from './components/SecureScoreCard';
import TopControlsCard from './components/TopControlsCard';
import { useAnalyticsFilters, getWindowDaysForDateRange } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useScoringMode } from '@/hooks/useScoringMode';
import { analyticsApi } from '../../services/api/analytics';
import { defenderApi, type SecureScoreSummary, type SecureScoreTrendPoint } from '../../services/api/defender';
import type {
  TrendDataPoint,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  FilterOption,
  CategorySubcategoryBreakdownItem,
  EnrichedTestExecution,
  DefenseScoreByHostItem,
  ErrorRateTrendDataPoint,
  GroupedPaginatedResponse,
  RiskAcceptance,
} from '../../services/api/analytics';

type TabType = 'dashboard' | 'executions' | 'risk-acceptances' | 'defender';

interface DefenseScoreData {
  overall: number;
  delta: number | null;
  total: number;
  protected: number;
  realScore?: number;
  rawScore?: number;
  riskAcceptedCount?: number;
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
  const { scoringMode } = useScoringMode();

  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const validTabs: TabType[] = ['dashboard', 'executions', 'risk-acceptances', ...(defenderConfigured ? ['defender' as const] : [])];
  const [activeTab, setActiveTab] = useState<TabType>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'dashboard'
  );

  // Defender dashboard data (loaded alongside main dashboard when configured)
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [defenderTechniqueCount, setDefenderTechniqueCount] = useState<number>(0);
  const [secureScoreTrendData, setSecureScoreTrendData] = useState<SecureScoreTrendPoint[]>([]);

  // Risk acceptances tab badge count
  const [activeRiskCount, setActiveRiskCount] = useState(0);

  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab') as TabType | null;
    const resolved = urlTab && validTabs.includes(urlTab) ? urlTab : 'dashboard';
    if (resolved !== activeTab) {
      setActiveTab(resolved);
    }
  }, [searchParams, defenderConfigured]);

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
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategorySubcategoryBreakdownItem[]>([]);
  const [recentTests, setRecentTests] = useState<EnrichedTestExecution[]>([]);
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

  // Load dashboard data when filters, settings, defender config, or scoring mode change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    }
  }, [filterState.filters, activeTab, settingsVersion, defenderConfigured, scoringMode]);

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
    const scoreParams = { ...params, scoringMode };

    // Calculate window size based on current date range filter
    const windowDays = getWindowDaysForDateRange(filterState.filters.dateRange);

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
        categoryData,
        recentTestsData,
        hostScores,
        errorRateData,
        errorRateTrend,
      ] = await Promise.all([
        analyticsApi.getDefenseScore(scoreParams),
        analyticsApi.getUniqueHostnames(params),
        analyticsApi.getUniqueTests(params),
        analyticsApi.getDefenseScoreTrend({ ...scoreParams, interval: 'day', windowDays }),
        analyticsApi.getResultsByErrorType(params),
        analyticsApi.getTestCoverage(params),
        analyticsApi.getTechniqueDistribution(params),
        analyticsApi.getHostTestMatrix(params),
        analyticsApi.getDefenseScoreByCategorySubcategory(scoreParams),
        analyticsApi.getPaginatedExecutions({ ...params, pageSize: 3, sortField: 'routing.event_time', sortOrder: 'desc' }),
        analyticsApi.getDefenseScoreByHostname(scoreParams),
        analyticsApi.getErrorRate(params),
        analyticsApi.getErrorRateTrend({ ...params, interval: 'day', windowDays }),
      ]);

      setDefenseScore({
        overall: score.score,
        delta: null,
        total: score.totalExecutions,
        protected: score.protectedCount,
        realScore: score.realScore,
        rawScore: score.rawScore,
        riskAcceptedCount: score.riskAcceptedCount,
      });
      setUniqueHostnames(hostnameCount);
      setUniqueTestCount(testCount);
      setTrendData(trend);
      setErrorTypeData(errorTypes);
      setTestCoverageData(coverage.slice(0, 10));
      setTechniqueDistData(techDist.slice(0, 10));
      setHostTestMatrix(matrix);
      setCategoryBreakdown(categoryData);
      setRecentTests(recentTestsData.data);
      setDefenseScoreByHost(hostScores);
      setErrorRate(errorRateData.errorRate);
      setErrorRateTrendData(errorRateTrend);

      // Conditionally load Defender summary for dashboard cards
      if (defenderConfigured) {
        // Derive total days from date range preset for the trend API
        const presetDaysMap: Record<string, number> = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, 'all': 90 };
        const trendDays = presetDaysMap[filterState.filters.dateRange.preset] ?? 90;

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
  }, [filterState, defenderConfigured, scoringMode]);

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
  const rangePreset = filterState.filters.dateRange.preset;
  const windowLabel =
    rangePreset === 'custom' ? 'custom window' : rangePreset === 'all' ? 'all time' : `${rangePreset} window`;

  return (
    <>
      <div>
        <PageHeader
          title="Analytics"
          description="Detection depth across error types, techniques, and categories"
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
          <DefenderTab />
        ) : activeTab === 'risk-acceptances' ? (
          /* Risk Acceptances Tab */
          <RiskAcceptancesTab onActiveCountChange={setActiveRiskCount} />
        ) : activeTab === 'dashboard' ? (
          /* Dashboard Tab */
          <div className="flex flex-col gap-4">
            {/* Analytic trio — a clean full row (Test activity lives below,
                in the posture section per the approved Analyst Columns
                redesign, so this grid can never orphan a card) */}
            <div className="grid gap-4 md:grid-cols-3">
              <ErrorTypePieChart
                data={errorTypeData}
                loading={loadingDashboard}
                title="Results by error type"
              />
              <TechniqueDistributionCard
                data={techniqueDistData}
                loading={loadingDashboard}
                defenderTechniqueCount={defenderTechniqueCount}
                onTechniqueClick={(technique) => {
                  filterState.setTechniques([technique]);
                  handleTabChange('executions');
                }}
              />
              <CategoryBreakdownChart
                data={categoryBreakdown}
                loading={loadingDashboard}
                title="Score by category"
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
            <div className="grid items-stretch gap-4 md:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-4">
                <HeroMetricsCard
                  defenseScore={defenseScore?.overall ?? null}
                  uniqueEndpoints={uniqueHostnames}
                  executedTests={uniqueTestCount}
                  totalResults={defenseScore?.total ?? null}
                  errorRate={errorRate}
                  realScore={defenseScore?.realScore ?? null}
                  rawScore={defenseScore?.rawScore ?? null}
                  riskAcceptedCount={defenseScore?.riskAcceptedCount}
                  windowLabel={windowLabel}
                  loading={loadingDashboard}
                />
                {defenderConfigured && secureScore && (
                  <SecureScoreCard data={secureScore} loading={loadingDashboard} />
                )}
              </div>

              <div className="relative h-[340px] min-w-0 md:col-span-2 md:h-auto">
                <div className="h-full min-w-0 overflow-hidden md:absolute md:inset-0">
                  <TrendChart
                    data={trendData}
                    errorRateData={errorRateTrendData}
                    errorRateOverall={errorRate}
                    secureScoreTrendData={secureScoreTrendData}
                    loading={loadingDashboard}
                    title="Trend Overview"
                    windowDays={getWindowDaysForDateRange(filterState.filters.dateRange)}
                  />
                </div>
              </div>

              {defenderConfigured && (
                <>
                  <TestActivityCard
                    trendData={trendData}
                    recentTests={recentTests}
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
              <div className="grid gap-4 lg:grid-cols-2">
                <StackedBarChart
                  data={testCoverageData}
                  loading={loadingDashboard}
                  title="Test Coverage"
                />
                <DefenseScoreByHostChart
                  data={defenseScoreByHost}
                  loading={loadingDashboard}
                  title="Defense Score by Host"
                />
              </div>
            ) : (
              <div className="grid items-stretch gap-4 md:grid-cols-3">
                <TestActivityCard
                  trendData={trendData}
                  recentTests={recentTests}
                  loading={loadingDashboard}
                  title="Test activity"
                  className="h-full"
                />
                <StackedBarChart
                  data={testCoverageData}
                  loading={loadingDashboard}
                  title="Test Coverage"
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
    </>
  );
}
