import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Loader2, Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { analyticsApi } from '@/services/api/analytics';
import type { IntegrationVendor, TimeWindow } from './vendorConfig';
import { buildSeries, type TimelinePoint } from './buildSeries';

const LINKED = 'var(--chart-series-alert)';
const ORGANIC = 'var(--muted-foreground)';
const EXEC = 'var(--chart-series-exec)';

interface Props {
  vendor: IntegrationVendor;
  window: TimeWindow;
  /** Bump to re-request with the same window (Sync Now on a custom range). */
  refreshKey?: number;
}

export default function IntegrationTimelineCard({ vendor, window, refreshKey = 0 }: Props) {
  const [data, setData] = useState<TimelinePoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setFailed([]);
      const [testResult, alertResult] = await Promise.allSettled([
        // Attack simulations only; cyber-hygiene checks can't trip a vendor alert.
        analyticsApi.getDefenseScoreTrend({
          from: window.from,
          to: window.to,
          interval: 'day',
          excludeCyberHygiene: true,
          // This series counts stage results per day, as it always has; the
          // API default is now any-stage (one count per test and host).
          scoringMode: 'all-stages',
        }),
        vendor.api.getAlertTrend(30, window),
      ]);
      if (cancelled) return;
      if (testResult.status === 'rejected' && alertResult.status === 'rejected') {
        setError('Unable to load test or alert volume');
        setLoading(false);
        return;
      }
      const tests = testResult.status === 'fulfilled' ? testResult.value : [];
      const alerts = alertResult.status === 'fulfilled' ? alertResult.value : [];
      const missing: string[] = [];
      if (testResult.status === 'rejected') missing.push('Test executions');
      if (alertResult.status === 'rejected') missing.push('Alert volume');
      setFailed(missing);
      setData(buildSeries(tests, alerts, window));
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.id, window.from, window.to, refreshKey]);

  const tick = { fontSize: 11, fill: 'var(--muted-foreground)' };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Test Execution vs {vendor.alertsTitle} Volume
        </CardTitle>
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
          <>
            {failed.length > 0 && (
              <p role="status" className="pb-2 text-xs text-warning">
                {failed.map((f) => `${f} unavailable`).join('; ')}
              </p>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) =>
                    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })
                  }
                  tick={tick}
                  stroke="var(--muted-foreground)"
                />
                <YAxis yAxisId="tests" orientation="left" tick={tick} stroke="var(--muted-foreground)" />
                <YAxis yAxisId="alerts" orientation="right" tick={tick} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--foreground)',
                  }}
                />
                <Area
                  yAxisId="tests"
                  type="monotone"
                  dataKey="tests"
                  name="Test executions"
                  stroke={EXEC}
                  fill={EXEC}
                  fillOpacity={0.2}
                />
                <Bar yAxisId="alerts" dataKey="linked" name="Alerts linked to a test" stackId="alerts" fill={LINKED} />
                <Bar yAxisId="alerts" dataKey="organic" name="Organic alerts" stackId="alerts" fill={ORGANIC} fillOpacity={0.6} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-[11px] text-muted-foreground">
              <LegendItem color={EXEC} label="Test executions" />
              <LegendItem color={LINKED} label="Alerts linked to a test" />
              <LegendItem color={ORGANIC} label="Organic alerts" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
