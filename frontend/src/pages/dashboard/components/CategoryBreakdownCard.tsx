import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface CategoryRow {
  label: string;
  count: number;
}

interface CategoryBreakdownCardProps {
  rows: CategoryRow[];
  avgScore?: string;
  scoredTests?: number;
  criticalHigh?: number;
  loading?: boolean;
}

export function CategoryBreakdownCard({
  rows,
  avgScore,
  scoredTests,
  criticalHigh,
  loading,
}: CategoryBreakdownCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category breakdown</CardTitle>
        <CardDescription>Tests per category</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">{row.label}</span>
              <span className="font-mono text-xs text-muted">{row.count}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent/70"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted">avg score</span>
            <span className="font-mono text-accent">{avgScore ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">scored tests</span>
            <span className="font-mono">{scoredTests ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">critical/high</span>
            <span className="font-mono text-danger">{criticalHigh ?? '—'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
