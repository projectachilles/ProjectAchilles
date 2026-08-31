import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface RecentExecution {
  id: string;
  testName: string;
  hostname?: string;
  status: 'completed' | 'failed';
  timeAgo: string;
  /** Row destination — task search today, analytics deep-link once master-detail lands. */
  to: string;
}

interface RecentExecutionsCardProps {
  executions: RecentExecution[];
  configured: boolean;
  loading?: boolean;
}

export function RecentExecutionsCard({ executions, configured, loading }: RecentExecutionsCardProps) {
  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent executions</CardTitle>
        <CardDescription>Latest task results</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {!configured ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Analytics is not configured.
          </div>
        ) : executions.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          executions.map((execution) => (
            <Link
              key={execution.id}
              to={execution.to}
              className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 text-xs hover:bg-raised"
            >
              <Badge
                variant={execution.status === 'completed' ? 'accent' : 'high'}
                className="font-mono uppercase"
              >
                {execution.status}
              </Badge>
              <span className="min-w-0 flex-1 truncate group-hover:text-accent">{execution.testName}</span>
              {execution.hostname && (
                <span className="hidden max-w-[110px] truncate font-mono text-muted sm:inline">
                  {execution.hostname}
                </span>
              )}
              <span className="shrink-0 whitespace-nowrap text-faint">{execution.timeAgo}</span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
