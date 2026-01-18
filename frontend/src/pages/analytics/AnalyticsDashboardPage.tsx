import { useState, useEffect, useCallback } from 'react';
import { Shield, Monitor, FlaskConical, LayoutDashboard, Table } from 'lucide-react';
import SharedLayout from '../../components/shared/Layout';
import SettingsModal from './components/SettingsModal';
import FilterBar from './components/FilterBar';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import BarChart from './components/BarChart';
import ErrorTypePieChart from './components/ErrorTypePieChart';
import ProtectionRateDonut from './components/ProtectionRateDonut';
import StackedBarChart from './components/StackedBarChart';
import HeatmapChart from './components/HeatmapChart';
import SeverityBreakdownChart from './components/SeverityBreakdownChart';
import CategoryBreakdownChart from './components/CategoryBreakdownChart';
import ThreatActorCoverage from './components/ThreatActorCoverage';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import { useAnalyticsFilters } from '@/hooks/useAnalyticsFilters';
import { analyticsApi } from '../../services/api/analytics';
import type {
  TrendDataPoint,
  BreakdownItem,
  OrganizationInfo,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  FilterOption,
  SeverityBreakdownItem,
  CategoryBreakdownItem,
  ThreatActorCoverageItem,
  PaginatedResponse,
  EnrichedTestExecution,
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
  const [byTestData, setByTestData] = useState<BreakdownItem[]>([]);
  const [byTechniqueData, setByTechniqueData] = useState<BreakdownItem[]>([]);
  const [testCoverageData, setTestCoverageData] = useState<TestCoverageItem[]>([]);
  const [techniqueDistData, setTechniqueDistData] = useState<TechniqueDistributionItem[]>([]);
  const [hostTestMatrix, setHostTestMatrix] = useState<HostTestMatrixCell[]>([]);

  // New visualization data
  const [severityBreakdown, setSeverityBreakdown] = useState<SeverityBreakdownItem[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownItem[]>([]);
  const [threatActorCoverage, setThreatActorCoverage] = useState<ThreatActorCoverageItem[]>([]);

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

  // Load filter options on mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Load dashboard data when filters change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData();
    }
  }, [filterState.filters, activeTab]);

  // Load executions data when tab/filters/pagination changes
  useEffect(() => {
    if (activeTab === 'executions') {
      loadExecutionsData();
    }
  }, [filterState.filters, activeTab, executionsPage, executionsPageSize, executionsSortField, executionsSortOrder]);

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
        byTest,
        byTechnique,
        coverage,
        techDist,
        matrix,
        severityData,
        categoryData,
        threatActorData,
      ] = await Promise.all([
        analyticsApi.getDefenseScore(params),
        analyticsApi.getUniqueHostnames(params),
        analyticsApi.getUniqueTests(params),
        analyticsApi.getDefenseScoreTrend({ ...params, interval: 'day' }),
        analyticsApi.getResultsByErrorType(params),
        analyticsApi.getDefenseScoreByTest(params),
        analyticsApi.getDefenseScoreByTechnique(params),
        analyticsApi.getTestCoverage(params),
        analyticsApi.getTechniqueDistribution(params),
        analyticsApi.getHostTestMatrix(params),
        analyticsApi.getDefenseScoreBySeverity(params),
        analyticsApi.getDefenseScoreByCategory(params),
        analyticsApi.getThreatActorCoverage(params),
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
      setByTestData(byTest.slice(0, 10).map((t: any) => ({
        name: t.testName || t.name || '',
        score: t.score,
        count: (t.protectedCount || t.count || 0) + (t.unprotectedCount || 0),
        protected: t.protectedCount || t.protected || 0
      })));
      setByTechniqueData(byTechnique.slice(0, 10).map((t: any) => ({
        name: t.technique || t.name || '',
        score: t.score,
        count: (t.protectedCount || t.count || 0) + (t.unprotectedCount || 0),
        protected: t.protectedCount || t.protected || 0
      })));
      setTestCoverageData(coverage.slice(0, 10));
      setTechniqueDistData(techDist.slice(0, 10));
      setHostTestMatrix(matrix);
      setSeverityBreakdown(severityData);
      setCategoryBreakdown(categoryData);
      setThreatActorCoverage(threatActorData);
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

  // Switch to executions tab with threat actor filter
  const handleViewThreatActors = () => {
    setActiveTab('executions');
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
            <div className="col-span-12 row-span-2">
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

            {/* Row 4-5: New Charts - Severity + Category + Threat Actor (2 rows each) */}
            <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
              <SeverityBreakdownChart
                data={severityBreakdown}
                loading={loadingDashboard}
                title="Score by Severity"
              />
            </div>
            <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
              <CategoryBreakdownChart
                data={categoryBreakdown}
                loading={loadingDashboard}
                title="Score by Category"
              />
            </div>
            <div className="col-span-12 lg:col-span-4 row-span-2">
              <ThreatActorCoverage
                data={threatActorCoverage}
                loading={loadingDashboard}
                title="Threat Actor Coverage"
                maxItems={4}
                onViewAll={handleViewThreatActors}
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
              <ProtectionRateDonut
                protected={defenseScore?.protected || 0}
                total={defenseScore?.total || 0}
                loading={loadingDashboard}
                title="Protection Rate"
              />
            </div>
            <div className="col-span-12 lg:col-span-4 row-span-2">
              <StackedBarChart
                data={techniqueDistData}
                loading={loadingDashboard}
                title="ATT&CK Technique Distribution"
                layout="vertical"
              />
            </div>

            {/* Row 8-9: Defense Score by Test + by Technique (2 rows each) */}
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <BarChart
                data={byTestData}
                title="Defense Score by Test"
                loading={loadingDashboard}
              />
            </div>
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <BarChart
                data={byTechniqueData}
                title="Defense Score by Technique"
                loading={loadingDashboard}
              />
            </div>

            {/* Row 10-11: Test Coverage + Host-Test Matrix (2 rows each) */}
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <StackedBarChart
                data={testCoverageData}
                loading={loadingDashboard}
                title="Test Coverage"
                layout="vertical"
              />
            </div>
            <div className="col-span-12 lg:col-span-6 row-span-2">
              <HeatmapChart
                data={hostTestMatrix}
                loading={loadingDashboard}
                title="Host-Test Coverage Matrix"
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
