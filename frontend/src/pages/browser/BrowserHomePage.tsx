import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import type { TestMetadata } from '@/types/test';
import TestCard from '@/components/browser/TestCard';
import TestListItem from '@/components/browser/TestListItem';
import SearchBar from '@/components/browser/SearchBar';
import { Loader2, LayoutGrid, List } from 'lucide-react';

type ViewMode = 'grid' | 'list';

export default function BrowserHomePage() {
  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [filteredTests, setFilteredTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const navigate = useNavigate();

  useEffect(() => {
    loadTests();
  }, []);

  const filterTests = useCallback(() => {
    try {
      let filtered = [...tests]; // Create a copy to avoid mutations

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
      // Fallback to showing all tests if filtering fails
      setFilteredTests(tests);
    }
  }, [tests, searchQuery, selectedCategory, selectedSeverity]);

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

  // Get unique categories and severities
  const categories = ['all', ...new Set(tests.map(t => t.category).filter(Boolean))];
  const severities = ['all', ...new Set(tests.map(t => t.severity).filter(Boolean))];

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
            <label className="text-sm font-medium">Category:</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm"
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
            <label className="text-sm font-medium">Severity:</label>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm"
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
            <div className="flex items-center gap-1 border border-border rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
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
                    : 'hover:bg-accent'
                }`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm text-muted-foreground">
              Showing {filteredTests.length} of {tests.length} tests
            </div>
          </div>
        </div>
      </div>

      {/* Test Grid/List */}
      <div className="flex-1 overflow-y-auto">
        {filteredTests.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No tests found matching your criteria
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
            {filteredTests.map(test => (
              <TestCard
                key={test.uuid}
                test={test}
                onClick={() => navigate(`/browser/test/${test.uuid}`)}
              />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            {filteredTests.map(test => (
              <TestListItem
                key={test.uuid}
                test={test}
                onClick={() => navigate(`/browser/test/${test.uuid}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
