import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface FleetStat {
  value: string;
  label: string;
  accent?: boolean;
}

export interface FleetBarRow {
  label: string;
  count: number;
  pct: number;
}

interface FleetHealthCardProps {
  stats: FleetStat[];
  rows: FleetBarRow[];
  loading?: boolean;
}

export function FleetHealthCard({ stats, rows, loading }: FleetHealthCardProps) {
  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet health</CardTitle>
        <CardDescription>Endpoint agents</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 max-lg:[&>*]:min-w-0">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border border-border bg-raised p-2">
              <div className={cn('truncate text-sm font-semibold tracking-tight', stat.accent && 'text-accent')}>
                {stat.value}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-faint">{stat.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{row.label}</span>
                <span className="font-mono text-xs text-muted">
                  {row.count} ({Math.round(row.pct)}%)
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-raised">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="flex h-16 items-center justify-center text-sm text-faint">
              No agents enrolled yet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
