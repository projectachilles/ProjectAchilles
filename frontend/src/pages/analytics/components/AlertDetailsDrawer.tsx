import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { defenderApi, type DefenderAlertItem } from '@/services/api/defender';
import { getSeverityTokens } from '../utils/defenderSeverityTokens';

interface AlertDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  technique?: string;
  title?: string;
}

const PAGE_SIZE = 100;

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function filterByTechnique(
  alerts: DefenderAlertItem[],
  technique: string | undefined
): DefenderAlertItem[] {
  if (!technique) return alerts;
  return alerts.filter((a) =>
    a.mitre_techniques?.some((t) => t === technique || t.startsWith(`${technique}.`))
  );
}

export default function AlertDetailsDrawer({
  open,
  onClose,
  technique,
  title,
}: AlertDetailsDrawerProps) {
  const [alerts, setAlerts] = useState<DefenderAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    defenderApi
      .getAlerts({
        pageSize: PAGE_SIZE,
        sortField: 'created_at',
        sortOrder: 'desc',
      })
      .then((res) => {
        if (cancelled) return;
        setAlerts(filterByTechnique(res.data, technique));
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message ?? 'Failed to load alerts');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, technique]);

  if (!open) return null;

  const headerTitle = title ?? (technique ? `Alerts for ${technique}` : 'Recent Defender Alerts');

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={headerTitle}
        className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border shadow-xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{headerTitle}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? 'Loading…' : `${alerts.length.toLocaleString()} alerts`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
              <AlertTriangle className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{error}</span>
            </div>
          ) : alerts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
              <AlertTriangle className="w-6 h-6 text-muted-foreground opacity-60" />
              <span className="text-sm text-muted-foreground">
                {technique ? `No alerts found for ${technique}` : 'No recent alerts'}
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {alerts.map((alert) => {
                const tokens = getSeverityTokens(alert.severity);
                return (
                  <li key={alert.alert_id} className="p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${tokens.bar}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-tight break-words">
                          {alert.alert_title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className={`uppercase font-semibold ${tokens.text}`}>
                            {alert.severity}
                          </span>
                          <span>·</span>
                          <span>{alert.status}</span>
                          <span>·</span>
                          <span>{formatTimeAgo(alert.created_at)}</span>
                          <span>·</span>
                          <span>{alert.service_source}</span>
                        </div>
                        {alert.mitre_techniques && alert.mitre_techniques.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {alert.mitre_techniques.slice(0, 6).map((t) => (
                              <span
                                key={t}
                                className="text-[10px] font-mono px-1.5 py-0.5 bg-muted text-muted-foreground rounded"
                              >
                                {t}
                              </span>
                            ))}
                            {alert.mitre_techniques.length > 6 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{alert.mitre_techniques.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
