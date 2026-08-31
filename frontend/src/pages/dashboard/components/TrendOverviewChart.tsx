import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface TrendPoint {
  date: string;
  defense?: number | null;
  secure?: number | null;
  errorRate?: number | null;
}

interface TrendOverviewChartProps {
  data: TrendPoint[];
  description: string;
  hasSecureScore: boolean;
  loading?: boolean;
}

const SERIES = [
  { key: 'defense', label: 'defense score', color: 'var(--chart-protected)' },
  { key: 'secure', label: 'secure score', color: 'var(--chart-series-alert)' },
  { key: 'errorRate', label: 'error rate', color: 'var(--chart-bypassed)' },
] as const;

export function TrendOverviewChart({ data, description, hasSecureScore, loading }: TrendOverviewChartProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const series = SERIES.filter((s) => s.key !== 'secure' || hasSecureScore);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trend overview — last 30 days</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="trend-defense-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-protected)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-protected)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--faint)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--faint)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--overlay)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--foreground)' }}
                formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
              />
              <Area
                type="monotone"
                dataKey="defense"
                name="defense score"
                stroke="var(--chart-protected)"
                strokeWidth={2}
                fill="url(#trend-defense-fill)"
                connectNulls
              />
              {hasSecureScore && (
                <Area
                  type="monotone"
                  dataKey="secure"
                  name="secure score"
                  stroke="var(--chart-series-alert)"
                  strokeWidth={2}
                  fill="var(--chart-series-alert)"
                  fillOpacity={0.06}
                  connectNulls
                />
              )}
              <Area
                type="monotone"
                dataKey="errorRate"
                name="error rate"
                stroke="var(--chart-bypassed)"
                strokeWidth={2}
                fill="none"
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="mt-3 flex items-center justify-center gap-4">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
