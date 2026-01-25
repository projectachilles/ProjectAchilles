import { useState, useEffect, useCallback } from 'react';
import { Shield, Monitor, FlaskConical, LayoutDashboard, Table } from 'lucide-react';
import SharedLayout from '../../components/shared/Layout';
import SettingsModal from './components/SettingsModal';
import FilterBar from './components/FilterBar';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import ErrorTypePieChart from './components/ErrorTypePieChart';
import StackedBarChart from './components/StackedBarChart';
import CoverageTreemap from './components/CoverageTreemap';
import DefenseScoreByHostChart from './components/DefenseScoreByHostChart';
import CategoryBreakdownChart from './components/CategoryBreakdownChart';
import LastTestActivity from './components/LastTestActivity';
import RecentTestsList from './components/RecentTestsList';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import { useAnalyticsFilters } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { analyticsApi } from '../../services/api/analytics';
import type {
  TrendDataPoint,
  OrganizationInfo,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  FilterOption,
  CategoryBreakdownItem,
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
  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Filter state (with URL sync)
  const filterState = useAnalyticsFilters(true);

  // Watch for settings changes (e.g., index pattern change)
  const { settingsVersion } = useAnalyticsAuth();

  // Filter options data
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [availableHostnames, setAvailableHostnames] = useState<FilterOption[]>([]);
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [availableTechniques, setAvailableTechniques] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<FilterOption[]>([]);
  const [availableSeverities, setAvailableSeverities] = useState<FilterOption[]>([]);
  const [availableThreatActors, setAvailableThreatActors] = useState<FilterOption[]>([]);
  const [availableTags, setAvailableTags] = useState<FilterOption[]>([]);

  // Dashboard Data State
  const [defenseScore, setDefenseScore] = useState<DefenseScoreData | null>(null);
  const [uniqueHostnames, setUniqueHostnames] = useState<number>(0);
  const [uniqueTestCount, setUniqueTestCount] = useState<number>(0);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [errorTypeData, setErrorTypeData] = useState<ErrorTypeBreakdown[]>([]);
  const [testCoverageData, setTestCoverageData] = useState<TestCoverageItem[]>([]);
  const [techniqueDistData, setTechniqueDistData] = useState<TechniqueDistributionItem[]>([]);
  const [hostTestMatrix, setHostTestMatrix] = useState<HostTestMatrixCell[]>([]);

  // New visualization data
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownItem[]>([]);
  const [recentTests, setRecentTests] = useState<EnrichedTestExecution[]>([]);
  const [defenseScoreByHost, setDefenseScoreByHost] = useState<DefenseScoreByHostItem[]>([]);
  const [canonicalTestCount, setCanonicalTestCount] = useState<number>(0);

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

  // Load canonical test count (stable baseline for coverage calculations)
  async function loadCanonicalTestCount() {
    try {
      const result = await analyticsApi.getCanonicalTestCount({ days: 90 });
      setCanonicalTestCount(result.count);
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
      const [orgs, tests, techniques, hostnames, categories, severities, threatActors, tags] = await Promise.all([
        analyticsApi.getOrganizations(),
        analyticsApi.getAvailableTests(),
        analyticsApi.getAvailableTechniques(),
        analyticsApi.getAvailableHostnames(),
        analyticsApi.getAvailableCategories(),
        analyticsApi.getAvailableSeverities(),
        analyticsApi.getAvailableThreatActors(),
        analyticsApi.getAvailableTags(),
      ]);

      setOrganizations(orgs.map(org => {
        if (typeof org === 'string') {
          return { uuid: org, shortName: org, fullName: org };
        }
        return {
          uuid: org.uuid,
          shortName: org.shortName || org.uuid,
          fullName: org.fullName || org.shortName || org.uuid
        };
      }));
      setAvailableTests(tests);
      setAvailableTechniques(techniques);
      setAvailableHostnames(hostnames);
      setAvailableCategories(categories);
      setAvailableSeverities(severities);
      setAvailableThreatActors(threatActors);
      setAvailableTags(tags);
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
      ] = await Promise.all([
        analyticsApi.getDefenseScore(params),
        analyticsApi.getUniqueHostnames(params),
        analyticsApi.getUniqueTests(params),
        analyticsApi.getDefenseScoreTrend({ ...params, interval: 'day' }),
        analyticsApi.getResultsByErrorType(params),
        analyticsApi.getTestCoverage(params),
        analyticsApi.getTechniqueDistribution(params),
        analyticsApi.getHostTestMatrix(params),
        analyticsApi.getDefenseScoreByCategory(params),
        analyticsApi.getPaginatedExecutions({ ...params, pageSize: 3, sortField: 'routing.event_time', sortOrder: 'desc' }),
        analyticsApi.getDefenseScoreByHostname(params),
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
        {/* Filter Bar */}
        <FilterBar
          filterState={filterState}
          organizations={organizations}
          availableHostnames={availableHostnames}
          availableTests={availableTests}
          availableTechniques={availableTechniques}
          availableCategories={availableCategories}
          availableSeverities={availableSeverities}
          availableThreatActors={availableThreatActors}
          availableTags={availableTags}
          loading={loadingFilters}
        />

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab('dashboard')}
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
            onClick={() => setActiveTab('executions')}
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
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' ? (
          /* Dashboard Tab */
          <div className="grid grid-cols-12 auto-rows-[140px] gap-4">
            {/* Row 1: Defense Score Trend (full width, 2 rows) */}
            <div className="col-span-12 row-span-2 min-w-0 overflow-hidden">
              <TrendChart
                data={trendData}
                loading={loadingDashboard}
                title="Defense Score Trend"
              />
            </div>

            {/* Row 3: Metrics (1 row each) */}
            <div className="col-span-12 md:col-span-4 lg:col-span-4 row-span-1">
              <MetricCard
                title="Defense Score"
                value={defenseScore?.overall || 0}
                format="percent"
                valueColor="score"
                icon={Shield}
                subtitle={defenseScore?.delta !== null && defenseScore?.delta !== undefined
                  ? `${defenseScore.delta > 0 ? '+' : ''}${defenseScore.delta.toFixed(1)}% vs prior`
                  : undefined}
                loading={loadingDashboard}
              />
            </div>
            <div className="col-span-6 md:col-span-4 lg:col-span-4 row-span-1">
              <MetricCard
                title="Unique Endpoints"
                value={uniqueHostnames}
                icon={Monitor}
                loading={loadingDashboard}
              />
            </div>
            <div className="col-span-6 md:col-span-4 lg:col-span-4 row-span-1">
              <MetricCard
                title="Unique Tests"
                value={uniqueTestCount}
                icon={FlaskConical}
                loading={loadingDashboard}
              />
            </div>

            {/* Row 4-5: Category breakdown + Last Test Activity (2 rows each) */}
            <div className="col-span-12 md:col-span-6 row-span-2">
              <CategoryBreakdownChart
                data={categoryBreakdown}
                loading={loadingDashboard}
                title="Score by Category"
              />
            </div>
            <div className="col-span-12 md:col-span-6 row-span-2">
              <LastTestActivity
                data={trendData}
                loading={loadingDashboard}
                title="Last Test Activity"
              />
            </div>

            {/* Row 6-7: Pie Chart + Donut + Technique Distribution (2 rows each) */}
            <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
              <ErrorTypePieChart
                data={errorTypeData}
                loading={loadingDashboard}
                title="Results by Error Type"
              />
            </div>
            <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
              <RecentTestsList
                data={recentTests}
                loading={loadingDashboard}
                title="Recent Tests"
              />
            </div>
            <div className="col-span-12 lg:col-span-4 row-span-2">
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
