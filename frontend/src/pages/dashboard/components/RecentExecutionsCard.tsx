import { Link } from 'react-router-dom';
import { StreamRow } from '@/components/shared/ui/StreamRow';
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
            <StreamRow
              key={execution.id}
              as={Link}
              to={execution.to}
              className="group rounded-md px-1 py-1.5 text-xs hover:bg-raised"
              leading={
                <Badge
                  variant={execution.status === 'completed' ? 'accent' : 'high'}
                  className="font-mono uppercase"
                >
                  {execution.status}
                </Badge>
              }
              name={execution.testName}
              nameClassName="group-hover:text-accent"
              meta={
                execution.hostname ? (
                  <span className="max-w-[160px] truncate font-mono text-muted md:max-w-[110px]">
                    {execution.hostname}
                  </span>
                ) : undefined
              }
              trailing={<span className="whitespace-nowrap text-faint">{execution.timeAgo}</span>}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
