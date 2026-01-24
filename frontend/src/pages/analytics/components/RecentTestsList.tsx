import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EnrichedTestExecution } from '@/services/api/analytics';

interface RecentTestsListProps {
  data: EnrichedTestExecution[];
  loading?: boolean;
  title?: string;
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

export default function RecentTestsList({
  data,
  loading,
  title = 'Recent Tests',
}: RecentTestsListProps) {
  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No recent test executions</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Clock className="w-4 h-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-2 h-full">
          {data.slice(0, 3).map((execution, index) => {
            const isProtected = execution.is_protected;
            const testName = execution.test_name || 'Unknown Test';
            const hostname = execution.hostname || 'Unknown Host';
            const timestamp = execution.timestamp;

            return (
              <div
                key={`${execution.test_uuid}-${timestamp}-${index}`}
                className="flex flex-col gap-1 p-2 rounded-md bg-secondary/50 border border-border/50"
              >
                {/* Test name */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-sm font-medium text-foreground truncate"
                    title={testName}
                  >
                    {truncateText(testName, 28)}
                  </span>
                  {/* Status indicator */}
                  {isProtected ? (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                </div>

                {/* Hostname and time */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate" title={hostname}>
                    {truncateText(hostname, 18)}
                  </span>
                  <span className="flex-shrink-0">{getRelativeTime(timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
