import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Database } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type { IndexInfo } from '@/services/api/analytics';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function HealthDot({ status }: { status: string }) {
  const color =
    status === 'green'
      ? 'bg-emerald-500'
      : status === 'yellow'
        ? 'bg-amber-500'
        : status === 'red'
          ? 'bg-red-500'
          : 'bg-muted-foreground';

  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={status} />;
}

interface IndexManagementProps {
  onSelectIndex?: (name: string) => void;
}

export function IndexManagement({ onSelectIndex }: IndexManagementProps) {
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchIndices = useCallback(async (showRefreshSpinner = false) => {
    if (showRefreshSpinner) setRefreshing(true);
    try {
      const data = await analyticsApi.listIndices();
      setIndices(data);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to load indices' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchIndices();
  }, [fetchIndices]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-card-foreground">Index Management</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchIndices(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Index table or empty state */}
      {indices.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No indices found. Results will appear here once tests run.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Docs</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Size</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Health</th>
              </tr>
            </thead>
            <tbody>
              {indices.map((idx) => (
                <tr key={idx.name} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                  <td
                    className={`px-3 py-2 font-mono text-xs text-card-foreground ${onSelectIndex ? 'cursor-pointer hover:text-primary hover:underline' : ''}`}
                    onClick={() => onSelectIndex?.(idx.name)}
                  >
                    {idx.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {idx.docsCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{formatBytes(idx.storeSize)}</td>
                  <td className="px-3 py-2 text-center">
                    <HealthDot status={idx.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <Alert variant={feedback.type === 'success' ? 'success' : 'destructive'}>
          {feedback.message}
        </Alert>
      )}
    </div>
  );
}
