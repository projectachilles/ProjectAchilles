import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import { analyticsApi } from '@/services/api/analytics';
import type { TestMetadata, SyncStatus } from '@/types/test';
import TestCard from '@/components/browser/TestCard';
import TestLibraryOverview from '@/components/browser/TestLibraryOverview';
import MitreAttackMatrix from '@/components/browser/MitreAttackMatrix';
import SearchBar from '@/components/browser/SearchBar';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shared/ui/Tabs';
import { Badge } from '@/components/shared/ui/Badge';
import { Switch } from '@/components/shared/ui/Switch';
import { Loader2, LayoutDashboard, Grid3X3, LayoutGrid, RefreshCw, GitBranch, Clock, AlertCircle, Heart, History, CheckSquare, Play, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import { ExecutionDrawer } from '@/components/browser/execution';

type BrowserTab = 'overview' | 'matrix' | 'browse';
type BrowseMode = 'browse' | 'favorites' | 'recent';
type SortField = 'name' | 'createdDate' | 'score' | 'severity' | 'lastModifiedDate';
type SortDirection = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, informational: 1,
};

const TARGET_LABELS: Record<string, string> = {
  'windows-endpoint': 'Windows',
  'linux-server': 'Linux',
  'entra-id': 'Entra ID',
  'azure-ad': 'Azure AD',
  'macos-endpoint': 'macOS',
  'm365': 'M365',
  'exchange-online': 'Exchange Online',
  'sharepoint-online': 'SharePoint Online',
  'network': 'Network',
};

function targetLabel(raw: string): string {
  return TARGET_LABELS[raw] || raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface BrowserHomePageProps {
  mode?: BrowseMode;
}

export default function BrowserHomePage({ mode = 'browse' }: BrowserHomePageProps) {
  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [filteredTests, setFilteredTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTests, setDrawerTests] = useState<TestMetadata[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTestUuids, setSelectedTestUuids] = useState<Set<string>>(new Set());
  const [selectedTarget, setSelectedTarget] = useState<string>('all');
  const [nryFilter, setNryFilter] = useState(false);
  const [executedUuids, setExecutedUuids] = useState<Set<string> | null>(null);
  const [executedUuidsLoading, setExecutedUuidsLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { favorites, recentTests, isFavorite, toggleFavorite } = useTestPreferences();
  const canSync = useHasPermission('tests:sync:execute');
  const canCreateTasks = useHasPermission('endpoints:tasks:create');
  const { configured: esConfigured } = useAnalyticsAuth();
  const executedUuidsFetched = useRef(false);

  // Tab state — URL-synced, only for browse mode
  const activeTab: BrowserTab = mode === 'browse'
    ? (searchParams.get('tab') as BrowserTab) || 'overview'
    : 'browse';

  function setActiveTab(tab: BrowserTab) {
    if (tab === 'overview') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', tab);
    }
    setSearchParams(searchParams, { replace: true });
  }

  useEffect(() => {
    loadTests();
    if (mode === 'browse') loadSyncStatus();
  }, [mode]);

  // Fetch executed test UUIDs from ES (for NRY filter)
  useEffect(() => {
    if (!esConfigured || executedUuidsFetched.current) return;
    executedUuidsFetched.current = true;
    setExecutedUuidsLoading(true);
    analyticsApi.getExecutedTestUuids()
      .then(uuids => {
        // Extract base UUIDs from composite keys (uuid::control-id)
        const baseUuids = new Set<string>();
        for (const id of uuids) {
          const sep = id.indexOf('::');
          baseUuids.add(sep >= 0 ? id.substring(0, sep) : id);
        }
        setExecutedUuids(baseUuids);
      })
      .catch(() => setExecutedUuids(null))
      .finally(() => setExecutedUuidsLoading(false));
  }, [esConfigured]);

  // Apply mode-based pre-filtering before search/category/severity filters
  const modeFilteredTests = useMemo(() => {
    if (mode === 'favorites') {
      return tests.filter(t => favorites.has(t.uuid));
    }
    if (mode === 'recent') {
      const recentUuids = recentTests.map(r => r.uuid);
      const recentSet = new Set(recentUuids);
      const matching = tests.filter(t => recentSet.has(t.uuid));
      // Preserve recent order
      matching.sort((a, b) => recentUuids.indexOf(a.uuid) - recentUuids.indexOf(b.uuid));
      return matching;
    }
    return tests;
  }, [tests, mode, favorites, recentTests]);

  const filterTests = useCallback(() => {
    try {
      let filtered = [...modeFilteredTests];

      // Search filter with defensive checks
      if (searchQuery && searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(test => {
          try {
            return (
              (test.name || '').toLowerCase().includes(query) ||
              (test.uuid || '').toLowerCase().includes(query) ||
              (Array.isArray(test.techniques) && test.techniques.some(t =>
                (t || '').toLowerCase().includes(query)
              )) ||
              (test.description || '').toLowerCase().includes(query)
            );
          } catch (err) {
            console.error('Error filtering test:', test, err);
            return false;
          }
        });
      }

      // Category filter
      if (selectedCategory && selectedCategory !== 'all') {
        filtered = filtered.filter(test => test.category === selectedCategory);
      }

      // Severity filter
      if (selectedSeverity && selectedSeverity !== 'all') {
        filtered = filtered.filter(test => test.severity === selectedSeverity);
      }

      // Target/platform filter
      if (selectedTarget !== 'all') {
        filtered = filtered.filter(test =>
          Array.isArray(test.target) && test.target.includes(selectedTarget)
        );
      }

      // NRY (Not Run Yet) filter
      if (nryFilter && executedUuids) {
        filtered = filtered.filter(test => !executedUuids.has(test.uuid));
      }

      // Sorting
      filtered.sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'name':
            cmp = (a.name || '').localeCompare(b.name || '');
            break;
          case 'createdDate':
            cmp = (a.createdDate || '').localeCompare(b.createdDate || '');
            break;
          case 'lastModifiedDate':
            cmp = (a.lastModifiedDate || '').localeCompare(b.lastModifiedDate || '');
            break;
          case 'score':
            cmp = (a.score ?? 0) - (b.score ?? 0);
            break;
          case 'severity':
            cmp = (SEVERITY_ORDER[a.severity || ''] ?? 0) - (SEVERITY_ORDER[b.severity || ''] ?? 0);
            break;
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });

      setFilteredTests(filtered);
    } catch (err) {
      console.error('Error in filterTests:', err);
      setFilteredTests(modeFilteredTests);
    }
  }, [modeFilteredTests, searchQuery, selectedCategory, selectedSeverity, selectedTarget, nryFilter, executedUuids, sortField, sortDirection]);

  useEffect(() => {
    filterTests();
  }, [filterTests]);

  async function loadTests() {
    try {
      setLoading(true);
      const data = await browserApi.getAllTests();
      setTests(data);
      setFilteredTests(data);
    } catch (err) {
      setError('Failed to load tests');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSyncStatus() {
    try {
      const status = await browserApi.getSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  }

  async function handleSync() {
    if (syncing) return;

    try {
      setSyncing(true);
      setSyncError(null);
      const result = await browserApi.syncTests();
      setSyncStatus(result.syncStatus);
      await loadTests();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync failed';
      setSyncError(errorMessage);
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  // Format relative time
  function formatRelativeTime(dateString: string | null): string {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }

  function handleExecuteTest(test: TestMetadata, e: React.MouseEvent) {
    e.stopPropagation();
    setDrawerTests([test]);
    setDrawerOpen(true);
  }

  function handleRunSelected() {
    const selected = filteredTests.filter((t) => selectedTestUuids.has(t.uuid));
    if (selected.length === 0) return;
    setDrawerTests(selected);
    setDrawerOpen(true);
  }

  function handleToggleTestSelection(uuid: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedTestUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  function handleToggleSelectMode() {
    setSelectMode((prev) => {
      if (prev) setSelectedTestUuids(new Set());
      return !prev;
    });
  }

  function handleDrawerClose() {
    setDrawerOpen(false);
    setDrawerTests([]);
  }

  // Drill-down handlers — switch to Browse tab with pre-set filters
  function handleDrillToSeverity(severity: string) {
    setSelectedSeverity(severity);
    setSelectedCategory('all');
    setSelectedTarget('all');
    setSearchQuery('');
    setActiveTab('browse');
  }

  function handleDrillToCategory(category: string) {
    setSelectedCategory(category);
    setSelectedSeverity('all');
    setSelectedTarget('all');
    setSearchQuery('');
    setActiveTab('browse');
  }

  function handleDrillToTechnique(technique: string) {
    setSearchQuery(technique);
    setSelectedCategory('all');
    setSelectedSeverity('all');
    setSelectedTarget('all');
    setActiveTab('browse');
  }

  function handleNavigateToTest(uuid: string) {
    navigate(`/browser/test/${uuid}`);
  }

  // Get unique categories, severities, and targets from the mode-filtered set
  const categories = ['all', ...new Set(modeFilteredTests.map(t => t.category).filter(Boolean))];
  const severities = ['all', ...new Set(modeFilteredTests.map(t => t.severity).filter(Boolean))];
  const targets = useMemo(() => {
    const unique = new Set<string>();
    for (const t of modeFilteredTests) {
      if (Array.isArray(t.target)) t.target.forEach(v => unique.add(v));
    }
    return ['all', ...Array.from(unique).sort()];
  }, [modeFilteredTests]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading security tests...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500 mb-2">{error}</p>
          <button
            onClick={loadTests}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Shared card grid + controls (used in Browse tab and non-browse modes)
  const browseContent = (
    <>
      {/* Search and Filters */}
      <div className="mb-6 space-y-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name, UUID, technique, or description..."
        />

        <div className="flex gap-4 flex-wrap items-center">
          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Category:</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 rounded-base border-theme border-border bg-background text-foreground text-sm"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Severity Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Severity:</label>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="px-3 py-1.5 rounded-base border-theme border-border bg-background text-foreground text-sm"
            >
              {severities.map(sev => (
                <option key={sev} value={sev}>
                  {sev === 'all' ? 'All Severities' : sev}
                </option>
              ))}
            </select>
          </div>

          {/* Platform/Target Filter */}
          {targets.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">Platform:</label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                className="px-3 py-1.5 rounded-base border-theme border-border bg-background text-foreground text-sm"
              >
                {targets.map(t => (
                  <option key={t} value={t}>
                    {t === 'all' ? 'All Platforms' : targetLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* NRY (Not Run Yet) Toggle */}
          {esConfigured && executedUuids && (
            <Switch
              label="Not run yet"
              checked={nryFilter}
              disabled={executedUuidsLoading}
              onChange={(e) => setNryFilter(e.target.checked)}
            />
          )}

          <div className="ml-auto flex items-center gap-4">
            {/* Sort Controls */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">Sort:</label>
              <select
                value={sortField}
                onChange={(e) => {
                  const field = e.target.value as SortField;
                  setSortField(field);
                  // Auto-set natural direction
                  setSortDirection(
                    field === 'severity' || field === 'score' || field === 'createdDate' || field === 'lastModifiedDate'
                      ? 'desc' : 'asc'
                  );
                }}
                className="px-3 py-1.5 rounded-base border-theme border-border bg-background text-foreground text-sm"
              >
                <option value="name">Name</option>
                <option value="severity">Severity</option>
                <option value="score">Score</option>
                <option value="createdDate">Created</option>
                <option value="lastModifiedDate">Modified</option>
              </select>
              <button
                onClick={() => setSortDirection(d => d === 'asc' ? 'desc' : 'asc')}
                className="p-1.5 rounded-base border border-border hover:bg-accent text-foreground"
                title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortDirection === 'asc'
                  ? <ArrowUpNarrowWide className="w-4 h-4" />
                  : <ArrowDownNarrowWide className="w-4 h-4" />
                }
              </button>
            </div>

            {/* Select Mode + Run Selected */}
            {canCreateTasks && (
              <>
                {selectMode && selectedTestUuids.size > 0 && (
                  <button
                    onClick={handleRunSelected}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90"
                  >
                    <Play className="w-4 h-4" />
                    Run {selectedTestUuids.size} Selected
                  </button>
                )}
                <button
                  onClick={handleToggleSelectMode}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectMode
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-foreground hover:bg-accent'
                  }`}
                  title={selectMode ? 'Exit select mode' : 'Select tests for batch execution'}
                >
                  <CheckSquare className="w-4 h-4" />
                  {selectMode ? 'Cancel' : 'Select'}
                </button>
              </>
            )}

            <div className="text-sm text-muted-foreground">
              Showing {filteredTests.length} of {modeFilteredTests.length}{' '}
              {mode === 'favorites' ? 'favorites' : mode === 'recent' ? 'recent' : 'tests'}
            </div>
          </div>
        </div>
      </div>

      {/* Test Grid */}
      <div className="flex-1 overflow-y-auto">
        {filteredTests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            {mode === 'favorites' ? (
              <>
                <Heart className="w-10 h-10 opacity-30" />
                <p>No favorites yet. Browse tests and click the heart icon to save your favorites.</p>
              </>
            ) : mode === 'recent' ? (
              <>
                <History className="w-10 h-10 opacity-30" />
                <p>No recently viewed tests yet.</p>
              </>
            ) : (
              <p>No tests found matching your criteria</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {filteredTests.map(test => (
              <TestCard
                key={test.uuid}
                test={test}
                onClick={() => navigate(`/browser/test/${test.uuid}`)}
                isFavorite={isFavorite(test.uuid)}
                onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(test.uuid); }}
                onExecute={canCreateTasks ? (e) => handleExecuteTest(test, e) : undefined}
                selectMode={selectMode}
                selected={selectedTestUuids.has(test.uuid)}
                onToggleSelect={(e) => handleToggleTestSelection(test.uuid, e)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );

  // Sync status bar (shared above tabs and in non-tab modes)
  const syncStatusBar = mode === 'browse' && syncStatus && (
    <div className="mb-4 flex items-center justify-between p-3 rounded-base bg-card text-card-foreground border-theme border-border shadow-theme">
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          {syncStatus.status === 'syncing' ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : syncStatus.status === 'synced' ? (
            <GitBranch className="w-4 h-4 text-green-500" />
          ) : syncStatus.status === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : (
            <GitBranch className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-muted-foreground">
            {syncStatus.branch}
            {syncStatus.commitHash && (
              <span className="ml-1 font-mono text-xs">
                ({syncStatus.commitHash.substring(0, 7)})
              </span>
            )}
          </span>
        </div>

        {syncStatus.lastSyncTime && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatRelativeTime(syncStatus.lastSyncTime)}</span>
          </div>
        )}

        {syncError && (
          <span className="text-red-500 text-xs">{syncError}</span>
        )}
      </div>

      {canSync && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      )}
    </div>
  );

  // Favorites/Recent mode: no tabs, just card grid directly
  if (mode !== 'browse') {
    return (
      <div className="container mx-auto h-full px-4 py-6 flex flex-col">
        {browseContent}
        <ExecutionDrawer open={drawerOpen} onClose={handleDrawerClose} tests={drawerTests} />
      </div>
    );
  }

  // Browse mode: 3-tab layout
  return (
    <div className="container mx-auto h-full px-4 py-6 flex flex-col">
      {syncStatusBar}

      <Tabs value={activeTab} defaultValue="overview" onValueChange={(v) => setActiveTab(v as BrowserTab)}>
        <TabsList>
          <TabsTrigger value="overview">
            <LayoutDashboard className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="matrix">
            <Grid3X3 className="w-4 h-4" />
            Matrix
          </TabsTrigger>
          <TabsTrigger value="browse">
            <LayoutGrid className="w-4 h-4" />
            Browse
            <Badge variant="default" className="text-[10px] px-1.5 py-0">{tests.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <TestLibraryOverview
            tests={tests}
            onDrillToSeverity={handleDrillToSeverity}
            onDrillToCategory={handleDrillToCategory}
            onDrillToTechnique={handleDrillToTechnique}
            onNavigateToTest={handleNavigateToTest}
          />
        </TabsContent>

        <TabsContent value="matrix">
          <MitreAttackMatrix
            tests={tests}
            onDrillToTechnique={handleDrillToTechnique}
          />
        </TabsContent>

        <TabsContent value="browse">
          {browseContent}
        </TabsContent>
      </Tabs>

      <ExecutionDrawer open={drawerOpen} onClose={handleDrawerClose} tests={drawerTests} />
    </div>
  );
}
