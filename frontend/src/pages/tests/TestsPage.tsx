import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  CheckSquare,
  Filter,
  Play,
  X,
} from 'lucide-react';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useTestVersions } from '@/hooks/useTestVersions';
import { VERSION_STATUS_LABEL } from '@/components/browser/VersionStatusChip';
import type { TestVersionStatus } from '@/types/testVersion';
import { browserApi } from '@/services/api/browser';
import type { SyncStatus } from '@/types/test';
import { formatRelativeTime } from '@/utils/dateFormatters';
import { analyticsApi, type TestResultItem } from '@/services/api/analytics';
import type { TestMetadata } from '@/types/test';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExecutionDrawer } from '@/components/browser/execution';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { targetLabel } from '@/utils/platformLabels';
import { cn } from '@/lib/utils';
import { tacticLabel, tacticToSlug } from '@/lib/mitreTactics';
import { TestListHeader, TestListRow } from './components/TestListRow';
import { fleetResultText, type FleetState } from './components/fleetResult';
import { FacetRail } from './components/FacetRail';
import { SyncChip } from './components/SyncChip';
import { VersionBanner, unrecordedBuildCount, versionBannerVisible } from './components/VersionBanner';
import {
  DEFAULT_FILTERS,
  computeFacetCounts,
  filterTests,
  groupByCategory,
  type SortDirection,
  type SortField,
  type TestFilters,
  type ViewFilter,
} from './filterTests';

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'score', label: 'Score' },
  { value: 'createdDate', label: 'Created' },
  { value: 'lastModifiedDate', label: 'Modified' },
];

function FacetChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent-dim px-2 py-1 font-mono text-xs text-accent hover:bg-accent-dim/70"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

export default function TestsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { favorites, recentTests, isFavorite, toggleFavorite } = useTestPreferences();
  const canCreateTasks = useHasPermission('endpoints:tasks:create');
  const canSync = useHasPermission('tests:sync:execute');
  const { configured: esConfigured } = useAnalyticsAuth();

  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Git state of the test library; null when it cannot be read (e.g. sync not configured).
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [notRunYet, setNotRunYet] = useState(false);
  const [hasBinary, setHasBinary] = useState(false);
  const [versionStatus, setVersionStatus] = useState<TestVersionStatus | null>(null);
  const { testVersions: versionsEnabled } = useCapabilities();
  const versionState = useTestVersions();
  const reloadVersions = versionState.reload;
  const versions = versionsEnabled ? versionState.data : null;

  const [executedUuids, setExecutedUuids] = useState<Set<string> | null>(null);
  const [builtUuids, setBuiltUuids] = useState<Set<string> | null>(null);
  const fetchedRef = useRef(false);
  const [fleetFetchState, setFleetFetchState] = useState<FleetState>('loading');
  const [fleetResults, setFleetResults] = useState<Map<string, TestResultItem>>(() => new Map());

  const [selectMode, setSelectMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTests, setDrawerTests] = useState<TestMetadata[]>([]);
  const isDesktop = useIsDesktop();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Deep-linkable facets live in the URL (?category= &tactic= &view=); a legacy ?severity= is ignored
  const view = (searchParams.get('view') as ViewFilter) || 'all';
  const category = searchParams.get('category');
  const tacticSlug = useMemo(() => {
    const raw = searchParams.get('tactic');
    return raw ? tacticToSlug(raw) : null;
  }, [searchParams]);

  const setUrlFacets = useCallback(
    (patch: Partial<TestFilters>) => {
      const next = new URLSearchParams(searchParams);
      const apply = (key: string, value: string | null) => {
        if (value) next.set(key, value);
        else next.delete(key);
      };
      if ('view' in patch) apply('view', patch.view === 'all' ? null : (patch.view as string));
      if ('category' in patch) apply('category', patch.category ?? null);
      if ('tacticSlug' in patch) apply('tactic', patch.tacticSlug ?? null);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const filters = useMemo<TestFilters>(
    () => ({
      ...DEFAULT_FILTERS,
      query,
      category,
      tacticSlug,
      target: searchParams.get('platform'),
      threatActor: searchParams.get('actor'),
      notRunYet,
      hasBinary,
      versionStatus: versions ? versionStatus : null,
      view,
      sortField,
      sortDirection,
    }),
    [query, category, tacticSlug, searchParams, notRunYet, hasBinary, versionStatus, versions, view, sortField, sortDirection],
  );

  const activeFacetCount =
    (filters.view !== 'all' ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.target ? 1 : 0) +
    (filters.threatActor ? 1 : 0) +
    (filters.tacticSlug ? 1 : 0) +
    (filters.notRunYet ? 1 : 0) +
    (filters.hasBinary ? 1 : 0) +
    (filters.versionStatus ? 1 : 0);

  const handleFilterChange = useCallback(
    (patch: Partial<TestFilters>) => {
      if ('notRunYet' in patch) setNotRunYet(patch.notRunYet ?? false);
      if ('hasBinary' in patch) setHasBinary(patch.hasBinary ?? false);
      if ('target' in patch) {
        const next = new URLSearchParams(searchParams);
        if (patch.target) next.set('platform', patch.target);
        else next.delete('platform');
        setSearchParams(next, { replace: true });
        return;
      }
      if ('threatActor' in patch) {
        const next = new URLSearchParams(searchParams);
        if (patch.threatActor) next.set('actor', patch.threatActor);
        else next.delete('actor');
        setSearchParams(next, { replace: true });
        return;
      }
      setUrlFacets(patch);
    },
    [searchParams, setSearchParams, setUrlFacets],
  );

  useEffect(() => {
    browserApi
      .getAllTests()
      .then(setTests)
      .catch((err) => {
        console.error(err);
        setError('Failed to load tests');
      })
      .finally(() => setLoading(false));
    browserApi
      .getSyncStatus()
      .then(setSyncStatus)
      .catch(() => setSyncStatus(null));
  }, []);

  // Pull the library, then show what the pull brought: the new commit and the new list.
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncFailed(false);
    try {
      const result = await browserApi.syncTests();
      setSyncStatus(result.syncStatus);
      setTests(await browserApi.getAllTests());
      void reloadVersions();
      browserApi
        .getBuiltTestUuids()
        .then((uuids) => setBuiltUuids(new Set(uuids)))
        .catch(() => setBuiltUuids(null));
    } catch (err) {
      console.error('Test library sync failed:', err);
      setSyncFailed(true);
    } finally {
      setSyncing(false);
    }
  }, [reloadVersions]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    if (esConfigured) {
      analyticsApi
        .getExecutedTestUuids()
        .then((uuids) => {
          const base = new Set<string>();
          for (const id of uuids) {
            const sep = id.indexOf('::');
            base.add(sep >= 0 ? id.substring(0, sep) : id);
          }
          setExecutedUuids(base);
        })
        .catch(() => setExecutedUuids(null));
    }
    browserApi
      .getBuiltTestUuids()
      .then((uuids) => setBuiltUuids(new Set(uuids)))
      .catch(() => setBuiltUuids(null));
  }, [esConfigured]);

  // Fleet results get their own effect (not behind fetchedRef) so they load once
  // analytics turns out to be configured; a failure leaves the cells neutral.
  useEffect(() => {
    if (!esConfigured) return;
    let cancelled = false;
    setFleetFetchState('loading');
    analyticsApi
      .getTestResults()
      .then((items) => {
        if (cancelled) return;
        setFleetResults(new Map(items.map((item) => [item.testUuid, item])));
        setFleetFetchState('ready');
      })
      .catch(() => {
        if (!cancelled) setFleetFetchState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [esConfigured]);

  const fleetState: FleetState = esConfigured ? fleetFetchState : 'error';

  const ctx = useMemo(
    () => ({
      favorites,
      recentUuids: recentTests.map((r) => r.uuid),
      executedUuids,
      builtUuids,
      versions: versions?.tests ?? null,
    }),
    [favorites, recentTests, executedUuids, builtUuids, versions],
  );

  const filtered = useMemo(() => filterTests(tests, filters, ctx), [tests, filters, ctx]);
  const counts = useMemo(() => computeFacetCounts(tests, filters, ctx), [tests, filters, ctx]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  const unrecordedBuilds = useMemo(() => (versions ? unrecordedBuildCount(versions.tests) : 0), [versions]);
  const bannerVisible = versions != null && versionBannerVisible(versions.library, unrecordedBuilds);

  function openDrawer(drawerSet: TestMetadata[]) {
    setDrawerTests(drawerSet);
    setDrawerOpen(true);
  }

  function toggleSelect(uuid: string) {
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Tests" description="Browse and run the security test library">
        <span className="text-sm text-muted">
          {filtered.length}/{tests.length} tests
        </span>
        {syncFailed && (
          <span role="alert" className="text-sm text-danger">
            Sync failed
          </span>
        )}
        {versionState.checkError && (
          <span role="alert" className="text-sm text-danger">
            {versionState.checkError}
          </span>
        )}
        <SyncChip
          branch={syncStatus?.branch}
          commit={syncStatus?.commitHash ?? undefined}
          lastSyncedAgo={syncStatus?.lastSyncTime ? formatRelativeTime(syncStatus.lastSyncTime) : undefined}
          checkedAgo={
            versions?.library.gitEnabled && versions.library.checkedAt
              ? formatRelativeTime(versions.library.checkedAt)
              : undefined
          }
          syncing={syncing}
          canSync={canSync}
          onSync={() => void handleSync()}
          onCheck={versions?.library.gitEnabled ? () => void versionState.checkNow() : undefined}
          checking={versionState.checking}
          note={versions && !versions.library.gitEnabled ? 'Git sync is off: published versions are not checked' : undefined}
        />
      </PageHeader>

      {versions && bannerVisible && (
        <VersionBanner library={versions.library} unrecordedBuilds={unrecordedBuilds} />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          id="page-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, UUID, technique, or description…"
          className="min-w-0 basis-full sm:flex-1"
          autoComplete="off"
        />
        <Select
          value={sortField}
          onValueChange={(value) => {
            const field = value as SortField;
            setSortField(field);
            setSortDirection(field === 'name' ? 'asc' : 'desc');
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDirection === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownNarrowWide />}
        </Button>
        {versions && (
          <select
            aria-label="Version status"
            value={versionStatus ?? ''}
            onChange={(e) => setVersionStatus((e.target.value || null) as TestVersionStatus | null)}
            className="h-9 rounded-md border border-border bg-raised px-2 text-sm text-foreground"
          >
            <option value="">All versions</option>
            {(Object.keys(VERSION_STATUS_LABEL) as TestVersionStatus[]).map((status) => (
              <option key={status} value={status}>
                {VERSION_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        )}
        {!isDesktop && (
          <Button
            variant={activeFacetCount > 0 ? 'secondary' : 'outline'}
            onClick={() => setFiltersOpen(true)}
          >
            <Filter />
            Filters
            {activeFacetCount > 0 && (
              <span className="rounded border border-accent/30 bg-accent-dim px-1.5 font-mono text-[10px] text-accent">
                {activeFacetCount}
              </span>
            )}
          </Button>
        )}
        {canCreateTasks && (
          <>
            {selectMode && selectedUuids.size > 0 && (
              <Button onClick={() => openDrawer(filtered.filter((t) => selectedUuids.has(t.uuid)))}>
                <Play />
                Run {selectedUuids.size}
              </Button>
            )}
            <Button
              variant={selectMode ? 'secondary' : 'outline'}
              onClick={() => {
                setSelectMode((prev) => {
                  if (prev) setSelectedUuids(new Set());
                  return !prev;
                });
              }}
            >
              <CheckSquare />
              {selectMode ? 'Cancel' : 'Select'}
            </Button>
          </>
        )}
      </div>

      {(tacticSlug || (!isDesktop && activeFacetCount > 0)) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tacticSlug && (
            <FacetChip label={`tactic: ${tacticLabel(tacticSlug)}`} onClear={() => setUrlFacets({ tacticSlug: null })} />
          )}
          {!isDesktop && filters.view !== 'all' && (
            <FacetChip label={filters.view} onClear={() => handleFilterChange({ view: 'all' })} />
          )}
          {!isDesktop && filters.category && (
            <FacetChip label={filters.category} onClear={() => handleFilterChange({ category: null })} />
          )}
          {!isDesktop && filters.target && (
            <FacetChip label={targetLabel(filters.target)} onClear={() => handleFilterChange({ target: null })} />
          )}
          {!isDesktop && filters.threatActor && (
            <FacetChip label={filters.threatActor} onClear={() => handleFilterChange({ threatActor: null })} />
          )}
          {!isDesktop && filters.notRunYet && (
            <FacetChip label="not run yet" onClear={() => handleFilterChange({ notRunYet: false })} />
          )}
          {!isDesktop && filters.versionStatus && (
            <FacetChip
              label={VERSION_STATUS_LABEL[filters.versionStatus]}
              onClear={() => setVersionStatus(null)}
            />
          )}
          {!isDesktop && filters.hasBinary && (
            <FacetChip label="has binary" onClear={() => handleFilterChange({ hasBinary: false })} />
          )}
        </div>
      )}

      <div className={cn('grid items-start gap-4', isDesktop && 'lg:grid-cols-[200px_minmax(0,1fr)]')}>
        {isDesktop && (
          <FacetRail
            counts={counts}
            filters={filters}
            showNotRunYet={esConfigured && executedUuids != null}
            showHasBinary={builtUuids != null}
            onChange={handleFilterChange}
          />
        )}

        <div className="flex flex-col gap-6">
          {loading ? (
            <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse border-b border-border bg-raised/40 last:border-b-0" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-faint">
              {view === 'favorites'
                ? 'No favorites yet — hover a test and click the heart.'
                : view === 'recent'
                  ? 'No recently viewed tests yet.'
                  : 'No tests match the current filters.'}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.category} aria-label={group.category}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <h2 className="font-mono text-xs text-accent">{group.category}</h2>
                  <span className="text-[11px] text-faint">{group.tests.length} tests</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
                  <TestListHeader />
                  <ul>
                    {group.tests.map((test) => (
                      <TestListRow
                        key={test.uuid}
                        test={test}
                        fleet={fleetResultText(
                          test,
                          fleetResults.get(test.uuid),
                          fleetState,
                          executedUuids ? executedUuids.has(test.uuid) : null,
                        )}
                        onOpen={() => navigate(`/tests/${test.uuid}`, { state: { backTo: `/tests${searchParams.size ? `?${searchParams}` : ''}` } })}
                        isFavorite={isFavorite(test.uuid)}
                        onToggleFavorite={() => toggleFavorite(test.uuid)}
                        onExecute={canCreateTasks ? () => openDrawer([test]) : undefined}
                        version={versions?.tests[test.uuid]}
                        selectMode={selectMode}
                        selected={selectedUuids.has(test.uuid)}
                        onToggleSelect={() => toggleSelect(test.uuid)}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      {!isDesktop && (

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>

          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto border-border bg-background p-4">

            <SheetTitle className="mb-3 text-sm font-semibold">Filters</SheetTitle>

            <FacetRail

              counts={counts}

              filters={filters}

              showNotRunYet={esConfigured && executedUuids != null}

              showHasBinary={builtUuids != null}

              onChange={handleFilterChange}

            />

            <Button className="mt-4 w-full" onClick={() => setFiltersOpen(false)}>

              Show {filtered.length} tests

            </Button>

          </SheetContent>

        </Sheet>

      )}


      <ExecutionDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerTests([]);
        }}
        tests={drawerTests}
      />
    </div>
  );
}
