import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FitList } from '@/components/shared/FitList';
import { cn } from '@/lib/utils';
import { BundleResultLabel, ExecResultLabel, type DisplayRow } from './executions/shared';

interface TestActivityCardProps {
  /**
   * Recent runs, newest first: the rows of All Executions (a bundle run is one
   * row with its run verdict, not one row per stage).
   */
  runs: DisplayRow[];
  /** Total runs in the window (grouped pagination total). */
  runCount?: number | null;
  loading?: boolean;
  title?: string;
  className?: string;
}

const runName = (row: DisplayRow) => (row.type === 'bundle' ? row.bundle_name : row.execution.test_name || 'Unknown Test');
const runTime = (row: DisplayRow) => (row.type === 'bundle' ? row.timestamp : row.execution.timestamp);

// Parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  if (!timestamp) return new Date(NaN);
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  return new Date(timestamp);
}

function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

function getRelativeTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function TestActivityCard({
  runs,
  runCount,
  loading,
  title = 'Test activity',
  className,
}: TestActivityCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  // Most recent run by timestamp (do not rely on list order).
  const latest = runs.reduce<Date | null>((best, row) => {
    const d = parseTimestamp(runTime(row));
    if (!isValidDate(d)) return best;
    return best === null || d > best ? d : best;
  }, null);

  const description =
    latest && runCount != null
      ? `${runCount.toLocaleString()} ${runCount === 1 ? 'run' : 'runs'} · last run ${latest.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
      : 'Latest runs in window';

  return (
    <Card className={cn('h-full', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {runs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <FitList
            items={runs}
            min={3}
            max={12}
            fallback={4}
            gap={8}
            getKey={(row) => row.key}
          >
            {(row) => (
              <div className="flex items-center gap-2.5 rounded-md border border-border bg-raised px-3 py-2.5 text-xs">
                <span className="min-w-0 flex-1 truncate" title={runName(row)}>
                  {runName(row)}
                </span>
                <span className="shrink-0">
                  {row.type === 'bundle' ? <BundleResultLabel group={row} compact /> : <ExecResultLabel exec={row.execution} compact />}
                </span>
                <span className="shrink-0 whitespace-nowrap text-faint">
                  {getRelativeTime(runTime(row))}
                </span>
              </div>
            )}
          </FitList>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(TestActivityCard);
