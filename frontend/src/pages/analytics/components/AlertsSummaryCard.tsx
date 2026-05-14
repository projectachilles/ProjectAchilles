import { AlertTriangle, Bell, AlertCircle } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { AlertSummary, RecentAlertItem } from '@/services/api/defender';
import { formatServiceSource } from '../utils/defenderServiceSource';

interface AlertsSummaryCardProps {
  data: AlertSummary | null;
  loading?: boolean;
}

// Tailwind palette values mapped to severity. Recharts needs explicit colors
// (CSS classes don't apply to SVG fill via className), so we hardcode the
// hex equivalents of red-500 / amber-500 / blue-500 / gray-400.
const SEVERITY_COLORS = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3b82f6',
  informational: '#9ca3af',
} as const;

const SEVERITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
} as const;

type SeverityKey = keyof typeof SEVERITY_COLORS;
const SEVERITY_ORDER: readonly SeverityKey[] = ['high', 'medium', 'low', 'informational'];

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Section header + list of alert rows, used for both High and Medium lists. */
function RecentAlertList({
  title,
  alerts,
  icon: Icon,
  iconClass,
  emptyText,
}: {
  title: string;
  alerts: RecentAlertItem[];
  icon: typeof AlertTriangle;
  iconClass: string;
  emptyText: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {alerts.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">{emptyText}</div>
      ) : (
        alerts.map((alert) => {
          const source = formatServiceSource(alert.service_source);
          return (
            <div key={alert.alert_id} className="flex items-start gap-1.5 text-xs">
              <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${iconClass}`} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{alert.title}</div>
                <div className="text-muted-foreground">
                  {source && (
                    <>
                      {source} &middot;{' '}
                    </>
                  )}
                  {formatTimeAgo(alert.created_at)}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function AlertsSummaryCard({ data, loading }: AlertsSummaryCardProps) {
  if (loading || !data) {
    return (
      <Card className="h-full flex flex-col p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Bell className="w-4 h-4" />
            <span className="text-sm font-medium">Defender Alerts</span>
          </div>
          <Skeleton className="h-7 w-12" />
        </div>
        <div className="flex items-center gap-3 px-4 py-2">
          <Skeleton className="w-[100px] h-[100px] rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border mx-4" />
        <div className="flex-1 px-4 py-2 space-y-1.5 overflow-auto">
          <Skeleton className="h-3 w-28" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Skeleton className="h-3 w-3 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // Build donut data + chartConfig once per render. Filter zero-value slices
  // so Recharts doesn't render invisible artifacts, but keep all severities
  // in the legend so the user sees the count of every tier.
  const chartData = SEVERITY_ORDER.map((sev) => ({
    name: SEVERITY_LABELS[sev],
    severity: sev,
    value: data.bySeverity[sev] ?? 0,
    fill: SEVERITY_COLORS[sev],
  })).filter((entry) => entry.value > 0);

  const chartConfig: ChartConfig = SEVERITY_ORDER.reduce((acc, sev) => {
    acc[SEVERITY_LABELS[sev]] = { label: SEVERITY_LABELS[sev], color: SEVERITY_COLORS[sev] };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card className="h-full flex flex-col p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Defender Alerts</span>
        </div>
        <span className="text-2xl font-bold tabular-nums">
          {data.total.toLocaleString()}
        </span>
      </div>

      {/* Severity donut + legend (legend lists all four severities so an empty
          tier is visibly empty rather than silently missing) */}
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="w-[100px] h-[100px] flex-shrink-0">
          {chartData.length === 0 ? (
            <div className="w-full h-full rounded-full border-2 border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
              no data
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="90%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.severity} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => {
                        const v = Number(value);
                        const pct = data.total > 0 ? ((v / data.total) * 100).toFixed(1) : '0';
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{item.payload.name}</span>
                            <span className="text-foreground font-bold tabular-nums">
                              {v.toLocaleString()} alerts
                            </span>
                            <span className="text-xs text-muted-foreground">{pct}% of total</span>
                          </div>
                        );
                      }}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
          )}
        </div>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          {SEVERITY_ORDER.map((sev) => {
            const count = data.bySeverity[sev] ?? 0;
            return (
              <div key={sev} className="flex items-center gap-2 text-xs">
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: SEVERITY_COLORS[sev] }}
                />
                <span className="text-muted-foreground flex-1">{SEVERITY_LABELS[sev]}</span>
                <span className="font-medium tabular-nums">{count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border mx-4" />

      {/* Recent alerts — high + medium lists. flex-1 + overflow-auto so this
          area fills available card height and scrolls if both lists overflow. */}
      <div className="flex-1 px-4 py-2 space-y-3 min-h-0 overflow-y-auto">
        <RecentAlertList
          title="Recent High Alerts"
          alerts={data.recentHigh}
          icon={AlertTriangle}
          iconClass="text-red-500"
          emptyText="No recent high-severity alerts"
        />
        <RecentAlertList
          title="Recent Medium Alerts"
          alerts={data.recentMedium}
          icon={AlertCircle}
          iconClass="text-amber-500"
          emptyText="No recent medium-severity alerts"
        />
      </div>
    </Card>
  );
}
