import { Loader2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrendDataPoint } from '@/services/api/analytics';

interface LastTestActivityProps {
  data: TrendDataPoint[];
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
    year: 'numeric',
  });
}

function getDaysSinceLastTest(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export default function LastTestActivity({
  data,
  loading,
  title = 'Last Test Activity',
}: LastTestActivityProps) {
  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Find the most recent data point with activity
  const validData = data.filter(d => d.total > 0);
  const lastActivity = validData.length > 0
    ? validData.reduce((latest, current) => {
        const currentDate = parseTimestamp(current.timestamp);
        const latestDate = parseTimestamp(latest.timestamp);
        return currentDate > latestDate ? current : latest;
      })
    : null;

  if (!lastActivity) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No test activity recorded</p>
        </CardContent>
      </Card>
    );
  }

  const lastDate = parseTimestamp(lastActivity.timestamp);

  if (!isValidDate(lastDate)) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Unable to parse activity date</p>
        </CardContent>
      </Card>
    );
  }

  const daysSince = getDaysSinceLastTest(lastDate);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Clock className="w-4 h-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center gap-2">
        {/* Main metric - centered and prominent */}
        <div className="text-center">
          <div className="text-5xl font-bold text-foreground">
            {daysSince}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {daysSince === 1 ? 'day ago' : 'days ago'}
          </div>
        </div>

        {/* Details */}
        <div className="text-center text-sm text-muted-foreground pt-2 border-t border-border mt-2">
          <div>{formatDate(lastDate)}</div>
          <div className="text-foreground font-medium">
            {lastActivity.total.toLocaleString()} test{lastActivity.total !== 1 ? 's' : ''} executed
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
