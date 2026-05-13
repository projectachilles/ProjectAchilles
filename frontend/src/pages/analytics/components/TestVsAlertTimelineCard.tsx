import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Loader2, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DEFENDER_CHART_COLORS } from '../utils/defenderChartColors';
import { defenderApi, type AlertTrendPoint } from '@/services/api/defender';
import { analyticsApi, type TrendDataPoint } from '@/services/api/analytics';

type Days = 7 | 30 | 90;

interface Point {
  date: string;
  tests: number;
  alerts: number;
}

function buildSeries(
  testTrend: TrendDataPoint[],
  alertTrend: AlertTrendPoint[]
): Point[] {
  const byDate = new Map<string, Point>();

  for (const p of testTrend) {
    const key = p.timestamp.slice(0, 10);
    byDate.set(key, { date: key, tests: p.total ?? 0, alerts: 0 });
  }

  for (const p of alertTrend) {
    const key = p.date.slice(0, 10);
    const existing = byDate.get(key);
    if (existing) {
      existing.alerts = p.count;
    } else {
      byDate.set(key, { date: key, tests: 0, alerts: p.count });
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export default function TestVsAlertTimelineCard() {
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const [testResult, alertResult] = await Promise.allSettled([
        analyticsApi.getDefenseScoreTrend({ from: since, interval: 'day' }),
        defenderApi.getAlertTrend(days),
      ]);

      if (cancelled) return;

      if (testResult.status === 'rejected' && alertResult.status === 'rejected') {
        setError('Unable to load test or alert volume');
        setLoading(false);
        return;
      }

      const tests = testResult.status === 'fulfilled' ? testResult.value : [];
      const alerts = alertResult.status === 'fulfilled' ? alertResult.value : [];
      setData(buildSeries(tests, alerts));
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Test Execution vs Defender Alert Volume
          </CardTitle>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
            className="bg-secondary border border-border rounded px-2 py-1 text-xs"
            aria-label="Time range"
          >
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[260px] flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            No test or alert activity in the selected window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) =>
                  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                yAxisId="tests"
                orientation="left"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                label={{ value: 'Tests', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <YAxis
                yAxisId="alerts"
                orientation="right"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                label={{ value: 'Alerts', angle: 90, position: 'insideRight', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                yAxisId="tests"
                type="monotone"
                dataKey="tests"
                name="Test executions"
                stroke={DEFENDER_CHART_COLORS.tests}
                fill={DEFENDER_CHART_COLORS.tests}
                fillOpacity={0.2}
              />
              <Line
                yAxisId="alerts"
                type="monotone"
                dataKey="alerts"
                name="Defender alerts"
                stroke={DEFENDER_CHART_COLORS.alerts}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
