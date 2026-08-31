import { memo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrendDataPoint, EnrichedTestExecution } from '@/services/api/analytics';

interface TestActivityCardProps {
  trendData: TrendDataPoint[];
  recentTests: EnrichedTestExecution[];
  loading?: boolean;
  title?: string;
  className?: string;
}

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
  trendData,
  recentTests,
  loading,
  title = 'Test activity',
  className,
}: TestActivityCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const totalTests = trendData.reduce((sum, d) => sum + (d.total ?? 0), 0);
  const validData = trendData.filter((d) => d.total > 0);
  const lastActivity =
    validData.length > 0
      ? validData.reduce((latest, current) =>
          parseTimestamp(current.timestamp) > parseTimestamp(latest.timestamp) ? current : latest,
        )
      : null;
  const lastDate = lastActivity ? parseTimestamp(lastActivity.timestamp) : null;

  const description =
    lastDate && isValidDate(lastDate)
      ? `${totalTests.toLocaleString()} tests · last run ${lastDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
      : 'Latest executions in window';

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {recentTests.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          recentTests.slice(0, 4).map((execution, index) => (
            <div
              key={`${execution.test_uuid}-${execution.timestamp}-${index}`}
              className="flex items-center gap-2.5 rounded-md border border-border bg-raised px-3 py-2.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate" title={execution.test_name}>
                {execution.test_name || 'Unknown Test'}
              </span>
              {execution.is_protected ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
              )}
              <span className="shrink-0 whitespace-nowrap text-faint">
                {getRelativeTime(execution.timestamp)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default memo(TestActivityCard);
