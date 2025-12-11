import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Monitor, FlaskConical } from 'lucide-react';
import Header from './components/Header';
import Layout from './components/Layout';
import SettingsModal from './components/SettingsModal';
import MetricCard from './components/MetricCard';
import TrendChart from './components/TrendChart';
import BarChart from './components/BarChart';
import ErrorTypePieChart from './components/ErrorTypePieChart';
import ProtectionRateDonut from './components/ProtectionRateDonut';
import StackedBarChart from './components/StackedBarChart';
import HeatmapChart from './components/HeatmapChart';
import ExecutionsTable from './components/ExecutionsTable';
import OrgFilter from './components/OrgFilter';
import MultiSelectFilter from './components/MultiSelectFilter';
import DateRangePicker, { getDateRangeFilter } from './components/DateRangePicker';
import { analyticsApi } from '../../services/api/analytics';
import type {
  TrendDataPoint,
  BreakdownItem,
  TestExecution,
  OrganizationInfo,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell
} from '../../services/api/analytics';
import type { DateRangeValue } from './components/DateRangePicker';

interface DefenseScoreData {
  overall: number;
  delta: number | null;
  total: number;
  protected: number;
}

export default function AnalyticsDashboardPage() {
  const navigate = useNavigate();

  // UI State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [selectedTechniques, setSelectedTechniques] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRangeValue>({ preset: '7d' });

  // Filter options
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [availableTechniques, setAvailableTechniques] = useState<string[]>([]);

  // Data State
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
  const [executions, setExecutions] = useState<TestExecution[]>([]);

  // Loading States
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingScore, setLoadingScore] = useState(true);
  const [loadingHostnames, setLoadingHostnames] = useState(true);
  const [loadingTestCount, setLoadingTestCount] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingErrorType, setLoadingErrorType] = useState(true);
  const [loadingByTest, setLoadingByTest] = useState(true);
  const [loadingByTechnique, setLoadingByTechnique] = useState(true);
  const [loadingTestCoverage, setLoadingTestCoverage] = useState(true);
  const [loadingTechniqueDist, setLoadingTechniqueDist] = useState(true);
  const [loadingMatrix, setLoadingMatrix] = useState(true);
  const [loadingExecutions, setLoadingExecutions] = useState(true);

  // Check if configured
  useEffect(() => {
    checkConfiguration();
  }, []);

  async function checkConfiguration() {
    try {
      const settings = await analyticsApi.getSettings();
      if (!settings.configured) {
        navigate('/analytics/setup');
        return;
      }
      // Load filter options first
      loadFilterOptions();
      // Load initial data
      loadAllData();
    } catch (error) {
      navigate('/analytics/setup');
    }
  }

  // Load filter dropdown options
  async function loadFilterOptions() {
    setLoadingOrgs(true);
    setLoadingFilters(true);
    try {
      const [orgs, tests, techniques] = await Promise.all([
        analyticsApi.getOrganizations(),
        analyticsApi.getAvailableTests(),
        analyticsApi.getAvailableTechniques()
      ]);
      // API now consistently returns OrganizationInfo[]
      setOrganizations(orgs);
      setAvailableTests(tests);
      setAvailableTechniques(techniques);
    } catch (error) {
      console.error('Failed to load filter options:', error);
    } finally {
      setLoadingOrgs(false);
      setLoadingFilters(false);
    }
  }

  // Build params with multi-select filter support
  const buildParams = useCallback(() => {
    const dateFilter = getDateRangeFilter(dateRange);
    const params: Record<string, string | undefined> = {
      org: selectedOrg || undefined,
      ...dateFilter
    };

    // Add test filter (OR logic - comma separated)
    if (selectedTests.length > 0) {
      params.tests = selectedTests.join(',');
    }

    // Add technique filter (OR logic - comma separated)
    if (selectedTechniques.length > 0) {
      params.techniques = selectedTechniques.join(',');
    }

    return params;
  }, [selectedOrg, selectedTests, selectedTechniques, dateRange]);

  // Load all data
  const loadAllData = useCallback(async () => {
    const params = buildParams();
    setLoadError(null); // Clear any previous errors

    // Track if any critical requests fail
    let errorCount = 0;

    // Load all data in parallel for performance
    const loadPromises = [
      // Defense Score
      (async () => {
        setLoadingScore(true);
        try {
          const score = await analyticsApi.getDefenseScore(params);
          setDefenseScore({
            overall: score.score,
            delta: null,
            total: score.totalExecutions,
            protected: score.protectedCount
          });
        } catch (error) {
          console.error('Failed to load defense score:', error);
          errorCount++;
        } finally {
          setLoadingScore(false);
        }
      })(),

      // Unique Hostnames
      (async () => {
        setLoadingHostnames(true);
        try {
          const count = await analyticsApi.getUniqueHostnames(params);
          setUniqueHostnames(count);
        } catch (error) {
          console.error('Failed to load unique hostnames:', error);
        } finally {
          setLoadingHostnames(false);
        }
      })(),

      // Unique Tests
      (async () => {
        setLoadingTestCount(true);
        try {
          const count = await analyticsApi.getUniqueTests(params);
          setUniqueTestCount(count);
        } catch (error) {
          console.error('Failed to load unique tests:', error);
        } finally {
          setLoadingTestCount(false);
        }
      })(),

      // Trend Data
      (async () => {
        setLoadingTrend(true);
        try {
          const trend = await analyticsApi.getDefenseScoreTrend({ ...params, interval: 'day' });
          setTrendData(trend);
        } catch (error) {
          console.error('Failed to load trend data:', error);
        } finally {
          setLoadingTrend(false);
        }
      })(),

      // Error Type Breakdown
      (async () => {
        setLoadingErrorType(true);
        try {
          const errorTypes = await analyticsApi.getResultsByErrorType(params);
          setErrorTypeData(errorTypes);
        } catch (error) {
          console.error('Failed to load error type data:', error);
        } finally {
          setLoadingErrorType(false);
        }
      })(),

      // By Test
      (async () => {
        setLoadingByTest(true);
        try {
          const byTest = await analyticsApi.getDefenseScoreByTest(params);
          // Convert TestBreakdown to BreakdownItem
          const converted = byTest.slice(0, 10).map(t => ({
            name: t.testName,
            score: t.score,
            count: t.protectedCount + t.unprotectedCount,
            protected: t.protectedCount
          }));
          setByTestData(converted);
        } catch (error) {
          console.error('Failed to load by test data:', error);
        } finally {
          setLoadingByTest(false);
        }
      })(),

      // By Technique
      (async () => {
        setLoadingByTechnique(true);
        try {
          const byTechnique = await analyticsApi.getDefenseScoreByTechnique(params);
          // Convert TechniqueBreakdown to BreakdownItem
          const converted = byTechnique.slice(0, 10).map(t => ({
            name: t.technique,
            score: t.score,
            count: t.protectedCount + t.unprotectedCount,
            protected: t.protectedCount
          }));
          setByTechniqueData(converted);
        } catch (error) {
          console.error('Failed to load by technique data:', error);
        } finally {
          setLoadingByTechnique(false);
        }
      })(),

      // Test Coverage (stacked bar)
      (async () => {
        setLoadingTestCoverage(true);
        try {
          const coverage = await analyticsApi.getTestCoverage(params);
          setTestCoverageData(coverage.slice(0, 10));
        } catch (error) {
          console.error('Failed to load test coverage:', error);
        } finally {
          setLoadingTestCoverage(false);
        }
      })(),

      // Technique Distribution (stacked bar)
      (async () => {
        setLoadingTechniqueDist(true);
        try {
          const dist = await analyticsApi.getTechniqueDistribution(params);
          setTechniqueDistData(dist.slice(0, 10));
        } catch (error) {
          console.error('Failed to load technique distribution:', error);
        } finally {
          setLoadingTechniqueDist(false);
        }
      })(),

      // Host-Test Matrix
      (async () => {
        setLoadingMatrix(true);
        try {
          const matrix = await analyticsApi.getHostTestMatrix(params);
          setHostTestMatrix(matrix);
        } catch (error) {
          console.error('Failed to load host-test matrix:', error);
        } finally {
          setLoadingMatrix(false);
        }
      })(),

      // Executions
      (async () => {
        setLoadingExecutions(true);
        try {
          const execs = await analyticsApi.getRecentExecutions({ ...params, limit: 20 });
          setExecutions(execs);
        } catch (error) {
          console.error('Failed to load executions:', error);
        } finally {
          setLoadingExecutions(false);
        }
      })()
    ];

    await Promise.all(loadPromises);

    // Set error message if multiple data sources failed
    if (errorCount > 0) {
      setLoadError(`Failed to load ${errorCount} data source${errorCount > 1 ? 's' : ''}. Some charts may be incomplete.`);
    }
  }, [buildParams]);

  // Reload when filters change
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Refresh handler
  async function handleRefresh() {
    setIsRefreshing(true);
    await loadAllData();
    setIsRefreshing(false);
  }

  return (
    <Layout>
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        onRefreshClick={handleRefresh}
        isRefreshing={isRefreshing}
      />

      <main className="container mx-auto px-4 py-6">
        {/* Error Banner */}
        {loadError && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">{loadError}</p>
            </div>
            <button
              onClick={() => setLoadError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
              aria-label="Dismiss error"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <OrgFilter
            organizations={organizations}
            selectedOrg={selectedOrg}
            onChange={setSelectedOrg}
            loading={loadingOrgs}
          />
          <MultiSelectFilter
            label="Test"
            options={availableTests}
            selected={selectedTests}
            onChange={setSelectedTests}
            loading={loadingFilters}
            placeholder="All Tests"
          />
          <MultiSelectFilter
            label="Technique"
            options={availableTechniques}
            selected={selectedTechniques}
            onChange={setSelectedTechniques}
            loading={loadingFilters}
            placeholder="All Techniques"
          />
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
          />
        </div>

        {/* Dashboard Grid - Bento Grid Layout with fixed row heights */}
        <div className="grid grid-cols-12 auto-rows-[140px] gap-4">
          {/* Row 1: Defense Score Trend (full width, 2 rows) */}
          <div className="col-span-12 row-span-2">
            <TrendChart
              data={trendData}
              loading={loadingTrend}
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
              loading={loadingScore}
            />
          </div>
          <div className="col-span-6 md:col-span-4 lg:col-span-4 row-span-1">
            <MetricCard
              title="Unique Endpoints"
              value={uniqueHostnames}
              icon={Monitor}
              loading={loadingHostnames}
            />
          </div>
          <div className="col-span-6 md:col-span-4 lg:col-span-4 row-span-1">
            <MetricCard
              title="Unique Tests"
              value={uniqueTestCount}
              icon={FlaskConical}
              loading={loadingTestCount}
            />
          </div>

          {/* Row 4-5: Pie Chart + Donut + Technique Distribution (2 rows each) */}
          <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
            <ErrorTypePieChart
              data={errorTypeData}
              loading={loadingErrorType}
              title="Results by Error Type"
            />
          </div>
          <div className="col-span-12 md:col-span-6 lg:col-span-4 row-span-2">
            <ProtectionRateDonut
              protected={defenseScore?.protected || 0}
              total={defenseScore?.total || 0}
              loading={loadingScore}
              title="Protection Rate"
            />
          </div>
          <div className="col-span-12 lg:col-span-4 row-span-2">
            <StackedBarChart
              data={techniqueDistData}
              loading={loadingTechniqueDist}
              title="ATT&CK Technique Distribution"
              layout="vertical"
            />
          </div>

          {/* Row 6-7: Defense Score by Test + by Technique (2 rows each) */}
          <div className="col-span-12 lg:col-span-6 row-span-2">
            <BarChart
              data={byTestData}
              title="Defense Score by Test"
              loading={loadingByTest}
            />
          </div>
          <div className="col-span-12 lg:col-span-6 row-span-2">
            <BarChart
              data={byTechniqueData}
              title="Defense Score by Technique"
              loading={loadingByTechnique}
            />
          </div>

          {/* Row 8-9: Test Coverage + Host-Test Matrix (2 rows each) */}
          <div className="col-span-12 lg:col-span-6 row-span-2">
            <StackedBarChart
              data={testCoverageData}
              loading={loadingTestCoverage}
              title="Test Coverage"
              layout="vertical"
            />
          </div>
          <div className="col-span-12 lg:col-span-6 row-span-2">
            <HeatmapChart
              data={hostTestMatrix}
              loading={loadingMatrix}
              title="Host-Test Coverage Matrix"
            />
          </div>

          {/* Row 10-11: Recent Executions (2 rows, full width) */}
          <div className="col-span-12 row-span-2">
            <ExecutionsTable
              data={executions}
              loading={loadingExecutions}
            />
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleRefresh}
      />
    </Layout>
  );
}
