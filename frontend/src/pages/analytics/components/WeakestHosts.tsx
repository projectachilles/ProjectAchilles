import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BulletBar } from '@/components/shared/ui/BulletBar';
import { weakestHosts } from '../utils/analyticsDerivations';
import type { DefenseScoreByHostItem } from '@/services/api/analytics';

interface WeakestHostsProps {
  items: DefenseScoreByHostItem[];
  target?: number;
  loading?: boolean;
}

const SKELETON_ROW_COUNT = 5;

function WeakestHosts({ items, target = 80, loading }: WeakestHostsProps) {
  const rows = weakestHosts(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Weakest Hosts</CardTitle>
        <p className="text-xs text-muted-foreground">score vs {target}% target</p>
      </CardHeader>
      <CardContent aria-busy={loading || undefined}>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-8 shrink-0" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No host data in range.</p>
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.hostname} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-foreground w-24 shrink-0 truncate">
                    {row.hostname}
                  </span>
                  <div className="flex-1">
                    <BulletBar
                      value={row.score}
                      target={target}
                      aria-label={`${row.hostname} defense score`}
                    />
                  </div>
                  <span className="text-xs font-mono tabular-nums text-foreground w-10 shrink-0 text-right">
                    {row.score}%
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--chart-bypassed)' }}
                />
                {'<50% critical'}
              </span>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--chart-warn)' }}
                />
                50–79% at risk
              </span>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-0.5"
                  style={{ backgroundColor: 'var(--foreground)' }}
                />
                {`▏ ${target}% target`}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export { WeakestHosts };
export default WeakestHosts;
