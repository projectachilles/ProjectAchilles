import { useEffect, useState } from 'react';
import { X, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Skeleton } from '@/components/ui/skeleton';
import { defenderApi, type DefenderAlertItem } from '@/services/api/defender';
import { getSeverityTokens } from '../utils/defenderSeverityTokens';

const DEFENDER_PORTAL_BASE = 'https://security.microsoft.com/alerts';

interface AlertDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Single MITRE technique filter (convenience for the chart click-throughs). */
  technique?: string;
  /** Multi-technique OR filter (used by control click-throughs). Takes precedence over `technique`. */
  techniques?: string[];
  /** Optional title override (e.g., "Alerts addressed by 'BlockExeFromEmail'"). */
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

export default function AlertDetailsDrawer({
  open,
  onClose,
  technique,
  techniques,
  title,
}: AlertDetailsDrawerProps) {
  const [alerts, setAlerts] = useState<DefenderAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Normalize to a single source-of-truth array. `techniques` takes precedence
  // when provided; otherwise wrap the legacy single-technique prop.
  const effectiveTechniques =
    techniques && techniques.length > 0
      ? techniques
      : technique
      ? [technique]
      : undefined;
  // Stable cache key for the effect dep array (avoids array-identity churn)
  const techniquesKey = effectiveTechniques ? effectiveTechniques.join(',') : '';

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
        techniques: effectiveTechniques,
      })
      .then((res) => {
        if (cancelled) return;
        setAlerts(res.data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, techniquesKey]);

  if (!open) return null;

  const defaultHeader =
    !effectiveTechniques
      ? 'Recent Defender Alerts'
      : effectiveTechniques.length === 1
      ? `Alerts for ${effectiveTechniques[0]}`
      : `Alerts for ${effectiveTechniques.join(', ')}`;
  const headerTitle = title ?? defaultHeader;

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
            <ul className="divide-y divide-border" aria-label="Loading alerts">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="p-3">
                  <div className="flex items-start gap-2">
                    <Skeleton className="h-2 w-2 mt-1.5 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <div className="flex gap-1">
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-3 w-10" />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
              <AlertTriangle className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{error}</span>
            </div>
          ) : alerts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
              <AlertTriangle className="w-6 h-6 text-muted-foreground opacity-60" />
              <span className="text-sm text-muted-foreground">
                {effectiveTechniques
                  ? `No alerts found for ${effectiveTechniques.join(', ')}`
                  : 'No recent alerts'}
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-tight break-words">
                            {alert.alert_title}
                          </div>
                          <a
                            href={`${DEFENDER_PORTAL_BASE}/${alert.alert_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 p-1 -m-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Open in Microsoft Defender"
                            title="Open in Microsoft Defender"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
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
                        {alert.auto_resolved && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-3 h-3" />
                            <span>
                              Auto-resolved by Achilles
                              {alert.auto_resolved_at && (
                                <> · {formatTimeAgo(alert.auto_resolved_at)}</>
                              )}
                              {alert.auto_resolve_mode && alert.auto_resolve_mode !== 'enabled' && (
                                <> · {alert.auto_resolve_mode === 'dry_run' ? 'dry-run' : alert.auto_resolve_mode}</>
                              )}
                            </span>
                          </div>
                        )}
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
