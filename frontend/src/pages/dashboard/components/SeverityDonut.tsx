import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface SeverityMix {
  high: number;
  medium: number;
  low: number;
}

interface SeverityDonutProps {
  mix: SeverityMix;
  loading?: boolean;
}

const SLICES = [
  { key: 'high', color: 'var(--chart-bypassed)' },
  { key: 'medium', color: 'var(--chart-warn)' },
  { key: 'low', color: 'var(--chart-series-alert)' },
] as const;

export function SeverityDonut({ mix, loading }: SeverityDonutProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const total = mix.high + mix.medium + mix.low;
  const data = SLICES.map((s) => ({ name: s.key, value: mix[s.key], color: s.color }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Severity</CardTitle>
        <CardDescription>Test mix by severity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={56}
                outerRadius={78}
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold">{total}</span>
            <span className="text-[10px] uppercase tracking-wider text-faint">tests</span>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-4">
          {data.map((entry) => (
            <Link
              key={entry.name}
              to={`/tests?severity=${entry.name}`}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name} {entry.value}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
