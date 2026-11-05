import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import type { CampaignRunSummary, Page, PageParams } from '@/services/api/campaigns';

export const RUNS_PAGE_SIZE = 25;

interface RunHistoryListProps<T extends CampaignRunSummary> {
  /** Accessible name of the list (also used for the empty state). */
  label: string;
  load: (page: PageParams) => Promise<Page<T>>;
  /** Extra content before the run date, e.g. the campaign name and a deleted marker. */
  renderLead?: (run: T) => ReactNode;
}

function protectedText(pct: number | null): string {
  return pct === null ? 'No conclusive results' : `${pct}% protected`;
}

/** Paged, newest-first list of campaign runs; each run links to its evidence page. */
export function RunHistoryList<T extends CampaignRunSummary>({ label, load, renderLead }: RunHistoryListProps<T>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load({ limit: RUNS_PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load runs');
      });
    return () => { cancelled = true; };
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!items) return;
    setLoadingMore(true);
    try {
      const page = await load({ limit: RUNS_PAGE_SIZE, offset: items.length });
      setItems([...items, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoadingMore(false);
    }
  }, [items, load]);

  if (error && !items) return <Alert variant="destructive">{error}</Alert>;
  if (!items) return <div className="flex justify-center py-4"><Spinner /></div>;
  if (items.length === 0) return <p className="py-2 text-sm text-muted">No runs yet.</p>;

  return (
    <div>
      <ul aria-label={label} className="divide-y divide-border">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {renderLead?.(r)}
            <Link to={`/tasks/campaigns/runs/${r.id}`} className="text-accent hover:underline">
              {new Date(r.started_at).toLocaleString()}
            </Link>
            <span className="text-muted">{`by ${r.started_by_name || r.started_by}`}</span>
            <span className="text-muted">{`${r.task_count} ${r.task_count === 1 ? 'task' : 'tasks'}`}</span>
            <span>{protectedText(r.percent_protected)}</span>
          </li>
        ))}
      </ul>
      {error && <Alert variant="destructive" className="mt-2">{error}</Alert>}
      {items.length < total && (
        <Button variant="outline" size="sm" className="mt-2" disabled={loadingMore}
          aria-label="Show more runs" onClick={() => void loadMore()}>
          {`Show more (${total - items.length} more)`}
        </Button>
      )}
    </div>
  );
}
