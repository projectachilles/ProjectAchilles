import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Table, Filter, ChevronUp, ChevronDown, ShieldCheck } from 'lucide-react';
import SharedLayout from '../../components/shared/Layout';
import SettingsModal from './components/SettingsModal';
import FilterBar from './components/FilterBar';
import DateRangePicker from './components/DateRangePicker';
import HeroMetricsCard from './components/HeroMetricsCard';
import TrendChart from './components/TrendChart';
import ErrorTypePieChart from './components/ErrorTypePieChart';
import StackedBarChart from './components/StackedBarChart';
import CoverageTreemap from './components/CoverageTreemap';
import DefenseScoreByHostChart from './components/DefenseScoreByHostChart';
import CategoryBreakdownChart from './components/CategoryBreakdownChart';
import TestActivityCard from './components/TestActivityCard';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import DefenderTab from './components/DefenderTab';
import SecureScoreCard from './components/SecureScoreCard';
import AlertsSummaryCard from './components/AlertsSummaryCard';
import { useAnalyticsFilters, getWindowDaysForDateRange } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { analyticsApi } from '../../services/api/analytics';
import { defenderApi, type SecureScoreSummary, type AlertSummary, type SecureScoreTrendPoint } from '../../services/api/defender';
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
} from '../../services/api/analytics';

type TabType = 'dashboard' | 'executions' | 'defender';

interface DefenseScoreData {
  overall: number;
  delta: number | null;
  total: number;
  protected: number;
}

export default function AnalyticsDashboardPage() {
  // URL state for tab
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabType | null;

  // Defender integration status (Approach A: hidden when not configured)
  const { configured: defenderConfigured } = useDefenderConfig();

  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const validTabs: TabType[] = ['dashboard', 'executions', ...(defenderConfigured ? ['defender' as const] : [])];
  const [activeTab, setActiveTab] = useState<TabType>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'dashboard'
  );

  // Defender dashboard data (loaded alongside main dashboard when configured)
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [defenderTechniqueCount, setDefenderTechniqueCount] = useState<number>(0);
  const [secureScoreTrendData, setSecureScoreTrendData] = useState<SecureScoreTrendPoint[]>([]);

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

  // Filter state (with URL sync)
  const filterState = useAnalyticsFilters(true);

  // Watch for settings changes (e.g., index pattern change)
  const { settingsVersion } = useAnalyticsAuth();

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
  // Ref to latest loadExecutionsData so archive handlers always call the current version
  const loadExecutionsDataRef = useRef<() => Promise<void>>(undefined);

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

  // Load dashboard data when filters, settings, or defender config change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    }
  }, [filterState.filters, activeTab, settingsVersion, defenderConfigured]);

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
      const [tests, techniques, hostnames, categories, severities, threatActors, tags, errorNames, errorCodes] = await Promise.all([
        analyticsApi.getAvailableTests(),
        analyticsApi.getAvailableTechniques(),
        analyticsApi.getAvailableHostnames(),
        analyticsApi.getAvailableCategories(),
        analyticsApi.getAvailableSeverities(),
        analyticsApi.getAvailableThreatActors(),
        analyticsApi.getAvailableTags(),
        analyticsApi.getAvailableErrorNames(),
        analyticsApi.getAvailableErrorCodes(),
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
        analyticsApi.getDefenseScore(params),
        analyticsApi.getUniqueHostnames(params),
        analyticsApi.getUniqueTests(params),
        analyticsApi.getDefenseScoreTrend({ ...params, interval: 'day', windowDays }),
        analyticsApi.getResultsByErrorType(params),
        analyticsApi.getTestCoverage(params),
        analyticsApi.getTechniqueDistribution(params),
        analyticsApi.getHostTestMatrix(params),
        analyticsApi.getDefenseScoreByCategorySubcategory(params),
        analyticsApi.getPaginatedExecutions({ ...params, pageSize: 3, sortField: 'routing.event_time', sortOrder: 'desc' }),
        analyticsApi.getDefenseScoreByHostname(params),
        analyticsApi.getErrorRate(params),
        analyticsApi.getErrorRateTrend({ ...params, interval: 'day', windowDays }),
      ]);

      setDefenseScore({
        overall: score.score,
        delta: null,
        total: score.totalExecutions,
        protected: score.protectedCount
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
          const [defScore, defAlerts, defTechniques, defTrend] = await Promise.all([
            defenderApi.getSecureScore(),
            defenderApi.getAlertSummary(),
            defenderApi.getTechniqueOverlap(),
            defenderApi.getSecureScoreTrend(trendDays),
          ]);
          setSecureScore(defScore);
          setAlertSummary(defAlerts);
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
    }
  }, [filterState, defenderConfigured]);

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
      await analyticsApi.archiveExecutions(groupKeys);
      await loadExecutionsDataRef.current?.();
    } catch (error) {
      console.error('Failed to archive executions:', error);
    } finally {
      setArchiving(false);
    }
  }, []);

  const handleArchiveByDate = useCallback(async (before: string) => {
    setArchiving(true);
    try {
      await analyticsApi.archiveExecutionsByDate(before);
      await loadExecutionsDataRef.current?.();
    } catch (error) {
      console.error('Failed to archive executions by date:', error);
    } finally {
      setArchiving(false);
    }
  }, []);

  // Refresh handler
  async function handleRefresh() {
    setIsRefreshing(true);
    await loadFilterOptions();
    if (activeTab === 'dashboard') {
      await loadDashboardData();
    } else {
      await loadExecutionsData();
    }
    setIsRefreshing(false);
  }

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

  return (
    <SharedLayout
      onSettingsClick={() => setSettingsOpen(true)}
      onRefreshClick={handleRefresh}
      isRefreshing={isRefreshing}
    >
      <div className="container mx-auto px-4 py-6">
        {/* Tab Navigation + Date Range Picker */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button
            onClick={() => handleTabChange('dashboard')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'dashboard'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => handleTabChange('executions')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'executions'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Table className="w-4 h-4" />
            All Executions
            {executionsData?.pagination && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-secondary rounded">
                {executionsData.pagination.totalDocuments.toLocaleString()}
              </span>
            )}
          </button>
          {defenderConfigured && (
            <button
              onClick={() => handleTabChange('defender')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'defender'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Defender
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 pb-2">
            <button
              onClick={filterState.toggleExpanded}
              className={`
                flex items-center gap-1.5 px-3 py-1.5
                border rounded-lg text-sm transition-colors
                ${filterState.isExpanded || filterState.activeFilterCount > 0
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-secondary border-border text-foreground hover:bg-accent'
                }
              `}
            >
              <Filter className="w-4 h-4" />
              Filters
              {filterState.activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                  {filterState.activeFilterCount}
                </span>
              )}
              {filterState.isExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
            <DateRangePicker value={filterState.filters.dateRange} onChange={filterState.setDateRange} />
          </div>
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
            loading={loadingFilters}
          />
        )}

        {/* Tab Content */}
        {activeTab === 'defender' ? (
          /* Defender Tab (full-page view) */
          <DefenderTab />
        ) : activeTab === 'dashboard' ? (
          /* Dashboard Tab */
          <div className="grid grid-cols-12 auto-rows-[140px] gap-4">
            {/* Row 1-2: Hero Metrics (1/3) + Trend Overview (2/3) */}
            <div className="col-span-12 md:col-span-4 row-span-2">
              <HeroMetricsCard
                defenseScore={defenseScore?.overall ?? null}
                uniqueEndpoints={uniqueHostnames}
                executedTests={uniqueTestCount}
                errorRate={errorRate}
                loading={loadingDashboard}
              />
            </div>
            <div className="col-span-12 md:col-span-8 row-span-2 min-w-0 overflow-hidden">
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

            {/* Row 3-4 (conditional): Secure Score + Alert Summary */}
            {defenderConfigured && secureScore && (
              <div className="col-span-12 md:col-span-4 row-span-2">
                <SecureScoreCard data={secureScore} loading={loadingDashboard} />
              </div>
            )}
            {defenderConfigured && alertSummary && (
              <div className="col-span-12 md:col-span-8 row-span-2">
                <AlertsSummaryCard data={alertSummary} loading={loadingDashboard} />
              </div>
            )}

            {/* Category breakdown + Test Activity */}
            <div className="col-span-12 md:col-span-6 row-span-2">
              <CategoryBreakdownChart
                data={categoryBreakdown}
                loading={loadingDashboard}
                title="Score by Category"
              />
            </div>
            <div className="col-span-12 md:col-span-6 row-span-2">
              <TestActivityCard
                trendData={trendData}
                recentTests={recentTests}
                loading={loadingDashboard}
                title="Test Activity"
              />
            </div>

            {/* Row 6-7: Pie Chart + Technique Distribution (2 rows each) */}
            <div className="col-span-12 md:col-span-6 row-span-2">
              <ErrorTypePieChart
                data={errorTypeData}
                loading={loadingDashboard}
                title="Results by Error Type"
              />
            </div>
            <div className="col-span-12 md:col-span-6 row-span-2">
              <StackedBarChart
                data={techniqueDistData}
                loading={loadingDashboard}
                title="ATT&CK Technique Distribution"
                badge={defenderTechniqueCount > 0 ? (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/10 text-amber-500">
                    {defenderTechniqueCount} with Defender alerts
                  </span>
                ) : undefined}
              />
            </div>

            {/* Row 8-9: Test Coverage + Defense Score by Host (2 rows each, side by side) */}
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <StackedBarChart
                data={testCoverageData}
                loading={loadingDashboard}
                title="Test Coverage"
              />
            </div>
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <DefenseScoreByHostChart
                data={defenseScoreByHost}
                loading={loadingDashboard}
                title="Defense Score by Host"
              />
            </div>

            {/* Row 10-12: Test Breadth by Host Treemap (full width, 3 rows for better visibility) */}
            <div className="col-span-12 row-span-3">
              <CoverageTreemap
                data={hostTestMatrix}
                loading={loadingDashboard}
                title="Test Breadth by Host"
                canonicalTestCount={canonicalTestCount}
                canonicalTestCount30d={canonicalTestCount30d}
              />
            </div>
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
          />
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleRefresh}
      />
    </SharedLayout>
  );
}
