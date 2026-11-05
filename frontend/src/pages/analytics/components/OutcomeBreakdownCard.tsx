import { memo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExecutionVerdict, OutcomeBreakdown } from '@/services/api/analytics';

interface OutcomeBreakdownCardProps {
  data: OutcomeBreakdown | null;
  loading?: boolean;
  onSelect?: (verdict: ExecutionVerdict) => void;
}

const ROWS: Array<{ verdict: ExecutionVerdict; label: string; hint: string; color: string }> = [
  { verdict: 'protected', label: 'Protected', hint: 'blocked by a control', color: 'var(--chart-protected)' },
  {
    verdict: 'prevented',
    label: 'Prevented',
    hint: 'the EDR stopped it',
    color: 'color-mix(in oklab, var(--chart-protected) 70%, var(--background))',
  },
  { verdict: 'detected', label: 'Detected only', hint: 'ran, the EDR alerted', color: 'var(--chart-cat-2)' },
  { verdict: 'silent', label: 'Silent', hint: 'ran, no alert', color: 'var(--chart-bypassed)' },
];

function OutcomeBreakdownCard({ data, loading, onSelect }: OutcomeBreakdownCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }
  if (!data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Outcome breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex h-40 items-center justify-center text-sm text-faint">
          Couldn't load outcome breakdown.
        </CardContent>
      </Card>
    );
  }

  const total = data.pairCount;
  const slices = ROWS.map((r) => ({ ...r, count: data[r.verdict] }));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Outcome breakdown</CardTitle>
        <CardDescription>{`Latest result per test × host · attack tests · ${data.windowLabel}`}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {total === 0 ? (
          <div className="flex h-44 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <div className="@container flex flex-1 flex-col justify-center">
            <div className="flex flex-1 flex-col items-center gap-4 @sm:flex-row lg:flex-row">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <div className="relative aspect-square h-44 shrink-0 lg:h-full lg:max-h-48 lg:min-h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="count"
                        innerRadius="72%"
                        outerRadius="100%"
                        stroke="none"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {slices.map((s) => (
                          <Cell key={s.verdict} fill={s.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-semibold">{total}</span>
                    <span className="text-[10px] uppercase tracking-wider text-faint">pairs</span>
                  </div>
                </div>
                {data.noConclusive > 0 && (
                  <span className="text-[11px] text-faint">
                    {`No conclusive result yet · ${data.noConclusive} pairs`}
                  </span>
                )}
              </div>
              <div className="flex w-full min-w-0 flex-1 flex-col gap-1">
                {slices.map((s) => (
                  <button
                    key={s.verdict}
                    type="button"
                    onClick={() => onSelect?.(s.verdict)}
                    className="flex items-start justify-between gap-2 rounded px-1.5 py-1 text-left outline-none hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {/* Label on its own line, the plain explanation under it (wraps, never truncated) */}
                    <span className="flex min-w-0 items-start gap-1.5 text-xs">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-foreground">{s.label}</span>
                        <span className="text-[11px] leading-snug text-faint">{s.hint}</span>
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs">
                      {`${s.count} · ${Math.round((s.count / total) * 100)}%`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {data.riskAccepted > 0 && (
          <p className="mt-2 text-[11px] text-faint">
            {`${data.riskAccepted} risk-accepted pairs not counted`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(OutcomeBreakdownCard);
