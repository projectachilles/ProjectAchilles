import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import type { TestMetadata, SyncStatus } from '@/types/test';
import TestCard from '@/components/browser/TestCard';
import TestListItem from '@/components/browser/TestListItem';
import SearchBar from '@/components/browser/SearchBar';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { useHasPermission } from '@/hooks/useAppRole';
import { Loader2, LayoutGrid, List, RefreshCw, GitBranch, Clock, AlertCircle, Heart, History } from 'lucide-react';

type ViewMode = 'grid' | 'list';
type BrowseMode = 'browse' | 'favorites' | 'recent';

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
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { favorites, recentTests, isFavorite, toggleFavorite } = useTestPreferences();
  const canSync = useHasPermission('tests:sync:execute');

  useEffect(() => {
    loadTests();
    if (mode === 'browse') loadSyncStatus();
  }, [mode]);

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
      let filtered = [...modeFilteredTests]; // Create a copy to avoid mutations

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

      setFilteredTests(filtered);
    } catch (err) {
      console.error('Error in filterTests:', err);
      setFilteredTests(modeFilteredTests);
    }
  }, [modeFilteredTests, searchQuery, selectedCategory, selectedSeverity]);

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
      // Reload tests after successful sync
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

  // Get unique categories and severities from the mode-filtered set
  const categories = ['all', ...new Set(modeFilteredTests.map(t => t.category).filter(Boolean))];
  const severities = ['all', ...new Set(modeFilteredTests.map(t => t.severity).filter(Boolean))];

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

  return (
    <div className="container mx-auto h-full px-4 py-6 flex flex-col">
      {/* Sync Status Bar — only in browse mode */}
      {mode === 'browse' && syncStatus && (
        <div className="mb-4 flex items-center justify-between p-3 rounded-lg bg-card text-card-foreground border border-border">
          <div className="flex items-center gap-4 text-sm">
            {/* Sync Status */}
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

            {/* Last Sync Time */}
            {syncStatus.lastSyncTime && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatRelativeTime(syncStatus.lastSyncTime)}</span>
              </div>
            )}

            {/* Sync Error */}
            {syncError && (
              <span className="text-red-500 text-xs">{syncError}</span>
            )}
          </div>

          {/* Sync Button */}
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
      )}

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
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm"
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
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm"
            >
              {severities.map(sev => (
                <option key={sev} value={sev}>
                  {sev === 'all' ? 'All Severities' : sev}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex items-center gap-1 border border-border rounded-lg p-1 bg-background">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent'
                }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm text-muted-foreground">
              Showing {filteredTests.length} of {modeFilteredTests.length}{' '}
              {mode === 'favorites' ? 'favorites' : mode === 'recent' ? 'recent' : 'tests'}
            </div>
          </div>
        </div>
      </div>

      {/* Test Grid/List */}
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
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {filteredTests.map(test => (
              <TestCard
                key={test.uuid}
                test={test}
                onClick={() => navigate(`/browser/test/${test.uuid}`)}
                isFavorite={isFavorite(test.uuid)}
                onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(test.uuid); }}
              />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card text-card-foreground">
            {filteredTests.map(test => (
              <TestListItem
                key={test.uuid}
                test={test}
                onClick={() => navigate(`/browser/test/${test.uuid}`)}
                isFavorite={isFavorite(test.uuid)}
                onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(test.uuid); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
