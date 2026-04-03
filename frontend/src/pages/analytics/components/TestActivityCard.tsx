import { memo } from 'react';
import { Loader2, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrendDataPoint, EnrichedTestExecution } from '@/services/api/analytics';

interface TestActivityCardProps {
  trendData: TrendDataPoint[];
  recentTests: EnrichedTestExecution[];
  loading?: boolean;
  title?: string;
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

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getDaysSinceLastTest(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

function TestActivityCard({
  trendData,
  recentTests,
  loading,
  title = 'Test Activity',
}: TestActivityCardProps) {
  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Find the most recent data point with activity (for the "days ago" metric)
  const validData = trendData.filter(d => d.total > 0);
  const lastActivity = validData.length > 0
    ? validData.reduce((latest, current) => {
        const currentDate = parseTimestamp(current.timestamp);
        const latestDate = parseTimestamp(latest.timestamp);
        return currentDate > latestDate ? current : latest;
      })
    : null;

  const lastDate = lastActivity ? parseTimestamp(lastActivity.timestamp) : null;
  const daysSince = lastDate && isValidDate(lastDate) ? getDaysSinceLastTest(lastDate) : null;

  const hasNoData = !lastActivity && (!recentTests || recentTests.length === 0);

  if (hasNoData) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No test activity recorded</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Clock className="w-4 h-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div className="flex h-full gap-2 sm:gap-4">
          {/* Left side: Big metric */}
          <div className="flex-shrink-0 w-[100px] sm:w-[120px] md:w-[140px] flex flex-col justify-center items-center border-r border-border pr-2 sm:pr-4">
            {daysSince !== null ? (
              <>
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground">
                  {daysSince}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">
                  {daysSince === 1 ? 'day ago' : 'days ago'}
                </div>
                {lastDate && isValidDate(lastDate) && (
                  <div className="mt-1 sm:mt-2 text-center">
                    <div className="text-[10px] sm:text-xs text-muted-foreground">
                      {formatDate(lastDate)}
                    </div>
                    {lastActivity && (
                      <div className="text-[10px] sm:text-xs text-foreground font-medium">
                        {lastActivity.total.toLocaleString()} test{lastActivity.total !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs sm:text-sm text-muted-foreground text-center">
                No activity data
              </div>
            )}
          </div>

          {/* Right side: Recent tests list */}
          <div className="flex-1 flex flex-col gap-1 sm:gap-2 overflow-hidden min-w-0">
            {recentTests && recentTests.length > 0 ? (
              recentTests.slice(0, 3).map((execution, index) => {
                const isProtected = execution.is_protected;
                const testName = execution.test_name || 'Unknown Test';
                const hostname = execution.hostname || 'Unknown Host';
                const timestamp = execution.timestamp;

                return (
                  <div
                    key={`${execution.test_uuid}-${timestamp}-${index}`}
                    className="flex flex-col gap-0.5 p-1.5 sm:p-2 rounded-md bg-secondary/50 border border-border/50"
                  >
                    {/* Test name and status */}
                    <div className="flex items-center justify-between gap-1 sm:gap-2">
                      <span
                        className="text-xs sm:text-sm font-medium text-foreground truncate"
                        title={testName}
                      >
                        {truncateText(testName, 32)}
                      </span>
                      {isProtected ? (
                        <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-3 h-3 sm:w-4 sm:h-4 text-red-500 flex-shrink-0" />
                      )}
                    </div>

                    {/* Hostname and time */}
                    <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
                      <span className="truncate" title={hostname}>
                        {truncateText(hostname, 24)}
                      </span>
                      <span className="flex-shrink-0">{getRelativeTime(timestamp)}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-muted-foreground text-sm">No recent executions</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(TestActivityCard);
