import { memo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ErrorTypeBreakdown } from '@/services/api/analytics';

interface ErrorTypePieChartProps {
  data: ErrorTypeBreakdown[];
  loading?: boolean;
  title?: string;
}

/** Result-type → governed token. Anything unmapped cycles the categorical ramp. */
const RESULT_COLORS: Record<string, string> = {
  ExecutionPrevented: 'var(--chart-protected)',
  Unprotected: 'var(--chart-bypassed)',
  UnexpectedTestError: 'var(--faint)',
};

const FALLBACK_COLORS = [
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-5)',
];

function colorFor(name: string, index: number): string {
  return RESULT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function ErrorTypePieChart({ data, loading, title = 'Results by error type' }: ErrorTypePieChartProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const slices = data.map((d, i) => ({ ...d, color: colorFor(d.name, i) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>All executions in window</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex h-44 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <div className="@container">
          <div className="flex flex-col items-center gap-4 @sm:flex-row lg:flex-row">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="count"
                    innerRadius={56}
                    outerRadius={78}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {slices.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold">{total}</span>
                <span className="text-[10px] uppercase tracking-wider text-faint">results</span>
              </div>
            </div>
            <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
              {slices.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs">
                    {entry.count} · {total > 0 ? ((entry.count / total) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(ErrorTypePieChart);
