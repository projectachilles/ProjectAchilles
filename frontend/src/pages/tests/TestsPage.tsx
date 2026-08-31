import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  CheckSquare,
  Play,
  X,
} from 'lucide-react';
import { browserApi } from '@/services/api/browser';
import { analyticsApi } from '@/services/api/analytics';
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
import { tacticLabel, tacticToSlug } from '@/lib/mitreTactics';
import { CompactTestCard } from './components/CompactTestCard';
import { FacetRail } from './components/FacetRail';
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
  { value: 'severity', label: 'Severity' },
  { value: 'score', label: 'Score' },
  { value: 'createdDate', label: 'Created' },
  { value: 'lastModifiedDate', label: 'Modified' },
];

export default function TestsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { favorites, recentTests, isFavorite, toggleFavorite } = useTestPreferences();
  const canCreateTasks = useHasPermission('endpoints:tasks:create');
  const { configured: esConfigured } = useAnalyticsAuth();

  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [notRunYet, setNotRunYet] = useState(false);
  const [hasBinary, setHasBinary] = useState(false);

  const [executedUuids, setExecutedUuids] = useState<Set<string> | null>(null);
  const [builtUuids, setBuiltUuids] = useState<Set<string> | null>(null);
  const fetchedRef = useRef(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTests, setDrawerTests] = useState<TestMetadata[]>([]);

  // Deep-linkable facets live in the URL (?category= &severity= &tactic= &view=)
  const view = (searchParams.get('view') as ViewFilter) || 'all';
  const category = searchParams.get('category');
  const severities = useMemo(
    () => new Set((searchParams.get('severity') || '').split(',').filter(Boolean)),
    [searchParams],
  );
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
      if ('severities' in patch)
        apply('severity', patch.severities?.size ? [...patch.severities].join(',') : null);
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
      severities,
      tacticSlug,
      target: searchParams.get('platform'),
      threatActor: searchParams.get('actor'),
      notRunYet,
      hasBinary,
      view,
      sortField,
      sortDirection,
    }),
    [query, category, severities, tacticSlug, searchParams, notRunYet, hasBinary, view, sortField, sortDirection],
  );

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
  }, []);

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

  const ctx = useMemo(
    () => ({
      favorites,
      recentUuids: recentTests.map((r) => r.uuid),
      executedUuids,
      builtUuids,
    }),
    [favorites, recentTests, executedUuids, builtUuids],
  );

  const filtered = useMemo(() => filterTests(tests, filters, ctx), [tests, filters, ctx]);
  const counts = useMemo(() => computeFacetCounts(tests, filters, ctx), [tests, filters, ctx]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

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
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          id="page-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, UUID, technique, or description…"
          className="min-w-0 flex-1"
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

      {tacticSlug && (
        <button
          onClick={() => setUrlFacets({ tacticSlug: null })}
          className="mb-4 inline-flex items-center gap-1.5 rounded border border-accent/30 bg-accent-dim px-2 py-1 font-mono text-xs text-accent hover:bg-accent-dim/70"
        >
          tactic: {tacticLabel(tacticSlug)}
          <X className="h-3 w-3" />
        </button>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <FacetRail
          counts={counts}
          filters={filters}
          showNotRunYet={esConfigured && executedUuids != null}
          showHasBinary={builtUuids != null}
          onChange={handleFilterChange}
        />

        <div className="flex flex-col gap-6">
          {loading ? (
            <div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-raised" />
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
              <section key={group.category}>
                <div className="mb-2.5 flex items-center gap-2.5">
                  <h2 className="font-mono text-xs text-accent">{group.category}</h2>
                  <span className="text-[11px] text-faint">{group.tests.length} tests</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                  {group.tests.map((test) => (
                    <CompactTestCard
                      key={test.uuid}
                      test={test}
                      onOpen={() => navigate(`/tests/${test.uuid}`)}
                      isFavorite={isFavorite(test.uuid)}
                      onToggleFavorite={() => toggleFavorite(test.uuid)}
                      onExecute={canCreateTasks ? () => openDrawer([test]) : undefined}
                      selectMode={selectMode}
                      selected={selectedUuids.has(test.uuid)}
                      onToggleSelect={() => toggleSelect(test.uuid)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

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
