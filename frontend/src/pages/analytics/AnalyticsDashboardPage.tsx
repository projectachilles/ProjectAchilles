import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Table } from 'lucide-react';
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
import { useAnalyticsFilters, getWindowDaysForDateRange } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { analyticsApi } from '../../services/api/analytics';
import type {
  TrendDataPoint,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  FilterOption,
  CategorySubcategoryBreakdownItem,
  PaginatedResponse,
  EnrichedTestExecution,
  DefenseScoreByHostItem,
} from '../../services/api/analytics';

type TabType = 'dashboard' | 'executions';

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

  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>(tabFromUrl === 'executions' ? 'executions' : 'dashboard');

  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab') as TabType | null;
    const newTab = urlTab === 'executions' ? 'executions' : 'dashboard';
    if (newTab !== activeTab) {
      setActiveTab(newTab);
    }
  }, [searchParams]);

  // Handle tab change with URL sync
  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    if (tab === 'executions') {
      newParams.set('tab', 'executions');
    } else {
      newParams.delete('tab');
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
  const [executionsData, setExecutionsData] = useState<PaginatedResponse<EnrichedTestExecution> | null>(null);
  const [executionsPage, setExecutionsPage] = useState(1);
  const [executionsPageSize, setExecutionsPageSize] = useState(25);
  const [executionsSortField, setExecutionsSortField] = useState<string>('routing.event_time');
  const [executionsSortOrder, setExecutionsSortOrder] = useState<'asc' | 'desc'>('desc');

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

  // Load dashboard data when filters or settings change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    }
  }, [filterState.filters, activeTab, settingsVersion]);

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
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoadingDashboard(false);
    }
  }, [filterState]);

  // Load executions data
  const loadExecutionsData = useCallback(async () => {
    setLoadingExecutions(true);
    const params = filterState.getApiParams();

    try {
      const data = await analyticsApi.getPaginatedExecutions({
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
                {executionsData.pagination.totalItems.toLocaleString()}
              </span>
            )}
          </button>
          <div className="ml-auto pb-2">
            <DateRangePicker value={filterState.filters.dateRange} onChange={filterState.setDateRange} />
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' ? (
          /* Dashboard Tab */
          <div className="grid grid-cols-12 auto-rows-[140px] gap-4">
            {/* Row 1-2: Hero Metrics (1/3) + Defense Score Trend (2/3) */}
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
                loading={loadingDashboard}
                title="Defense Score Trend"
                windowDays={getWindowDaysForDateRange(filterState.filters.dateRange)}
              />
            </div>

            {/* Row 3-4: Category breakdown + Test Activity */}
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
          <>
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
            <ExecutionsDataTable
              data={executionsData}
              loading={loadingExecutions}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              onSort={handleSort}
              sortField={executionsSortField}
              sortOrder={executionsSortOrder}
              filtersExpanded={filterState.isExpanded}
              onToggleFilters={filterState.toggleExpanded}
              activeFilterCount={filterState.activeFilterCount}
            />
          </>
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
