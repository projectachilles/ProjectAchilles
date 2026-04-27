import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useAnalyticsFilters } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useScoringMode } from '@/hooks/useScoringMode';
import { analyticsApi } from '@/services/api/analytics';
import type { GroupedPaginatedResponse, RiskAcceptance } from '@/services/api/analytics';
import ExecutionsDataTable from './components/ExecutionsDataTable';
import { AnalyticsLayout } from './AnalyticsLayout';
import './analytics.css';

const DENSITY_KEY = 'analytics.executions.density';
type Density = 'comfortable' | 'compact';

function readStoredDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === 'compact') return 'compact';
  } catch {
    /* ignore */
  }
  return 'comfortable';
}

export default function AnalyticsExecutionsPage() {
  const filterState = useAnalyticsFilters(true);
  const { settingsVersion } = useAnalyticsAuth();
  const { scoringMode, setScoringMode } = useScoringMode();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<string>('routing.event_time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [data, setData] = useState<GroupedPaginatedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [acceptingRisk, setAcceptingRisk] = useState(false);
  const [riskAcceptances, setRiskAcceptances] = useState<Map<string, RiskAcceptance[]>>(new Map());
  const [activeRiskCount, setActiveRiskCount] = useState(0);
  const [density, setDensityState] = useState<Density>(readStoredDensity);

  // Persist density toggle
  useEffect(() => {
    try { localStorage.setItem(DENSITY_KEY, density); } catch { /* ignore */ }
  }, [density]);

  // Active risk count for sub-nav badge
  useEffect(() => {
    analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 })
      .then((r) => setActiveRiskCount(r.total))
      .catch(() => setActiveRiskCount(0));
  }, [settingsVersion]);

  // Load executions whenever filters / pagination / sort change
  const loadExecutions = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterState.getApiParams();
      const result = await analyticsApi.getGroupedPaginatedExecutions({
        ...params,
        page,
        pageSize,
        sortField,
        sortOrder,
      });
      setData(result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load executions:', e);
    } finally {
      setLoading(false);
    }
  }, [filterState, page, pageSize, sortField, sortOrder]);

  // Stable ref so async callbacks always fire the latest fetcher
  const loadExecutionsRef = useRef<() => Promise<void>>(loadExecutions);
  loadExecutionsRef.current = loadExecutions;

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions, settingsVersion]);

  // Risk acceptance lookups for the visible page
  useEffect(() => {
    if (!data?.groups.length) return;
    const testNames = new Set<string>();
    for (const g of data.groups) for (const m of g.members) testNames.add(m.test_name);
    analyticsApi.lookupAcceptances([...testNames])
      .then((r) => setRiskAcceptances(new Map(Object.entries(r))))
      .catch(() => { /* leave map empty */ });
  }, [data]);

  const handleArchive = useCallback(async (groupKeys: string[]) => {
    setArchiving(true);
    try {
      await analyticsApi.archiveExecutions(groupKeys);
      await loadExecutionsRef.current?.();
    } finally {
      setArchiving(false);
    }
  }, []);

  const handleArchiveByDate = useCallback(async (before: string) => {
    setArchiving(true);
    try {
      await analyticsApi.archiveExecutionsByDate(before);
      await loadExecutionsRef.current?.();
    } finally {
      setArchiving(false);
    }
  }, []);

  const handleAcceptRisk = useCallback(async (
    items: { test_name: string; control_id?: string; hostname?: string; scope?: 'host' | 'global' }[],
    justification: string,
  ) => {
    setAcceptingRisk(true);
    try {
      for (const item of items) await analyticsApi.acceptRisk({ ...item, justification });
      await loadExecutionsRef.current?.();
    } finally {
      setAcceptingRisk(false);
    }
  }, []);

  const handleRevokeRisk = useCallback(async (acceptanceId: string, reason: string) => {
    setAcceptingRisk(true);
    try {
      await analyticsApi.revokeRisk(acceptanceId, reason);
      await loadExecutionsRef.current?.();
    } finally {
      setAcceptingRisk(false);
    }
  }, []);

  const totalGroups = data?.pagination.totalGroups ?? 0;
  const totalDocs = data?.pagination.totalDocuments ?? 0;

  return (
    <AnalyticsLayout
      executionsCount={totalDocs}
      riskCount={activeRiskCount}
    >
      <div className="an-exec-toolbar">
        <div className="an-exec-toolbar-left">
          Showing <strong>{totalGroups.toLocaleString()}</strong> bundles ·{' '}
          <strong>{totalDocs.toLocaleString()}</strong> total executions
          <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>· grouped by name+host+date</span>
        </div>
        <div className="an-exec-toolbar-right">
          <div className="an-mode-toggle" role="tablist" aria-label="Density">
            <button
              type="button"
              role="tab"
              aria-selected={density === 'comfortable'}
              className={density === 'comfortable' ? 'is-active' : ''}
              onClick={() => setDensityState('comfortable')}
            >
              COMFORT
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={density === 'compact'}
              className={density === 'compact' ? 'is-active' : ''}
              onClick={() => setDensityState('compact')}
            >
              COMPACT
            </button>
          </div>
          <button
            type="button"
            className="an-pill"
            onClick={() => setScoringMode(scoringMode === 'all-stages' ? 'any-stage' : 'all-stages')}
            title="Toggle multi-stage scoring mode"
          >
            <Icon size={11}>{I.shield}</Icon>
            SCORING: {scoringMode === 'all-stages' ? 'NORMAL' : 'ANY-STAGE'}
          </button>
        </div>
      </div>

      <div className={density === 'compact' ? 'an-exec-density-compact' : ''}>
        <ExecutionsDataTable
          data={data}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          onSort={(f, o) => { setSortField(f); setSortOrder(o); setPage(1); }}
          sortField={sortField}
          sortOrder={sortOrder}
          onArchive={handleArchive}
          onArchiveByDate={handleArchiveByDate}
          archiving={archiving}
          onAcceptRisk={handleAcceptRisk}
          onRevokeRisk={handleRevokeRisk}
          riskAcceptances={riskAcceptances}
          acceptingRisk={acceptingRisk}
          scoringMode={scoringMode}
          onScoringModeChange={setScoringMode}
        />
      </div>
    </AnalyticsLayout>
  );
}
