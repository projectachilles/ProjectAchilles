import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Grid, List, AlertCircle } from 'lucide-react';
import { browserApi } from '../../services/api/browser';
import type { TestMetadata } from '../../services/api/browser';
import { Card } from '../../components/shared/ui/Card';
import { Input } from '../../components/shared/ui/Input';
import { Badge } from '../../components/shared/ui/Badge';
import { Loading } from '../../components/shared/ui/Spinner';

export default function BrowserHomePage() {
  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    loadTests();
  }, []);

  const loadTests = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await browserApi.getAllTests();
      setTests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tests');
    } finally {
      setLoading(false);
    }
  };

  // Filter tests based on search query
  const filteredTests = tests.filter(test => {
    const query = searchQuery.toLowerCase();
    return (
      test.name.toLowerCase().includes(query) ||
      test.uuid.toLowerCase().includes(query) ||
      test.techniques.some(t => t.toLowerCase().includes(query)) ||
      test.description?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Loading message="Loading security tests..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="flex items-center gap-4 p-6 bg-destructive/10 border-destructive/30">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <div>
            <h2 className="font-semibold text-destructive">Failed to Load Tests</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Security Tests</h1>
        <p className="text-muted-foreground">
          Browse {tests.length} security test{tests.length !== 1 ? 's' : ''} in the F0RT1KA framework
        </p>
      </div>

      {/* Search and View Controls */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search tests by name, UUID, or technique..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
            }`}
            title="Grid view"
          >
            <Grid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
            }`}
            title="List view"
          >
            <List className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Results Count */}
      {searchQuery && (
        <p className="text-sm text-muted-foreground mb-4">
          Found {filteredTests.length} test{filteredTests.length !== 1 ? 's' : ''} matching "{searchQuery}"
        </p>
      )}

      {/* Test Grid/List */}
      {filteredTests.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No tests found matching your search.</p>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTests.map((test) => (
            <TestCard key={test.uuid} test={test} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTests.map((test) => (
            <TestListItem key={test.uuid} test={test} />
          ))}
        </div>
      )}
    </div>
  );
}

// Test Card Component
function TestCard({ test }: { test: TestMetadata }) {
  return (
    <Link to={`/test/${test.uuid}`}>
      <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="mb-3">
            <h3 className="font-semibold line-clamp-2">{test.name}</h3>
            <p className="text-xs text-muted-foreground font-mono mt-1">{test.uuid}</p>
          </div>

          {/* Description */}
          {test.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3 flex-1">
              {test.description}
            </p>
          )}

          {/* Techniques */}
          <div className="flex flex-wrap gap-1 mb-3">
            {test.techniques.slice(0, 3).map((technique) => (
              <Badge key={technique} variant="primary" className="text-xs">
                {technique}
              </Badge>
            ))}
            {test.techniques.length > 3 && (
              <Badge variant="default" className="text-xs">
                +{test.techniques.length - 3}
              </Badge>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-sm">
            {test.score !== undefined && (
              <span className="text-muted-foreground">
                Score: <span className="font-medium text-foreground">{test.score}/10</span>
              </span>
            )}
            {test.severity && (
              <Badge
                variant={
                  test.severity === 'critical' ? 'destructive' :
                  test.severity === 'high' ? 'warning' :
                  'default'
                }
              >
                {test.severity}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

// Test List Item Component
function TestListItem({ test }: { test: TestMetadata }) {
  return (
    <Link to={`/test/${test.uuid}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-4">
          {/* Main Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold truncate">{test.name}</h3>
              {test.isMultiStage && (
                <Badge variant="outline" className="text-xs">Multi-stage</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono">{test.uuid}</p>
          </div>

          {/* Techniques */}
          <div className="hidden md:flex flex-wrap gap-1 max-w-xs">
            {test.techniques.slice(0, 2).map((technique) => (
              <Badge key={technique} variant="primary" className="text-xs">
                {technique}
              </Badge>
            ))}
            {test.techniques.length > 2 && (
              <Badge variant="default" className="text-xs">
                +{test.techniques.length - 2}
              </Badge>
            )}
          </div>

          {/* Score & Severity */}
          <div className="flex items-center gap-3">
            {test.score !== undefined && (
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{test.score}</span>/10
              </span>
            )}
            {test.severity && (
              <Badge
                variant={
                  test.severity === 'critical' ? 'destructive' :
                  test.severity === 'high' ? 'warning' :
                  'default'
                }
              >
                {test.severity}
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
