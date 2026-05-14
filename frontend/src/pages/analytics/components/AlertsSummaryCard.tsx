import { AlertTriangle, Bell, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AlertSummary, RecentAlertItem } from '@/services/api/defender';
import { getSeverityTokens } from '../utils/defenderSeverityTokens';

interface AlertsSummaryCardProps {
  data: AlertSummary | null;
  loading?: boolean;
}

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
        alerts.map((alert) => (
          <div key={alert.alert_id} className="flex items-start gap-1.5 text-xs">
            <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${iconClass}`} />
            <div className="flex-1 min-w-0">
              <div className="truncate">{alert.title}</div>
              <div className="text-muted-foreground">
                {alert.service_source} &middot; {formatTimeAgo(alert.created_at)}
              </div>
            </div>
          </div>
        ))
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
        <div className="px-4 py-2 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-6" />
            </div>
          ))}
        </div>
        <div className="border-t border-border mx-4" />
        <div className="flex-1 px-4 py-2 space-y-1.5 overflow-auto">
          <Skeleton className="h-3 w-28" />
          {[0, 1, 2, 3].map((i) => (
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

  const severityOrder = ['high', 'medium', 'low', 'informational'];
  const maxCount = Math.max(...severityOrder.map((s) => data.bySeverity[s] ?? 0), 1);

  return (
    <Card className="h-full flex flex-col p-0 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Defender Alerts</span>
        </div>
        <span className="text-2xl font-bold tabular-nums">
          {data.total.toLocaleString()}
        </span>
      </div>

      {/* Severity bars */}
      <div className="px-4 py-2 space-y-2">
        {severityOrder.map((sev) => {
          const count = data.bySeverity[sev] ?? 0;
          const tokens = getSeverityTokens(sev);
          const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;

          return (
            <div key={sev} className="flex items-center gap-2 text-xs">
              <span className={`w-20 capitalize ${tokens.text}`}>{sev}</span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${tokens.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 text-right tabular-nums font-medium">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="border-t border-border mx-4" />

      {/* Recent alerts — high + medium. The card's flex-1 + overflow-auto
          fills the row's stretched height with content; if both lists overflow
          the available space the inner area scrolls. */}
      <div className="flex-1 px-4 py-2 space-y-3 min-h-0 overflow-auto">
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
