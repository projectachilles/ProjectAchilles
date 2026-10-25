import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Skeleton } from '@/components/ui/skeleton';
import { crowdstrikeApi, type CrowdStrikeAlertItem, type PaginatedCrowdStrikeAlerts } from '@/services/api/crowdstrike';
import { sentineloneAnalyticsApi } from '@/services/api/sentineloneAnalytics';
import { getSeverityTokens } from '../../utils/crowdstrikeSeverityTokens';
import { formatCrowdStrikeProduct } from '../../utils/crowdstrikeProduct';
import PreventionBadge from '../PreventionBadge';
import { VENDORS } from './vendorConfig';

import type { TimeWindow } from '@/services/api/integrationTypes';

/** Vendors whose alert docs share the CrowdStrike alert shape (see vendorConfig `endpointEdr`). */
export type EndpointVendorId = 'crowdstrike' | 'sentinelone';

/** The CrowdStrike-shaped alert list of each endpoint vendor. */
const ALERT_LISTS: Record<EndpointVendorId, (params: Parameters<typeof crowdstrikeApi.getAlerts>[0]) => Promise<PaginatedCrowdStrikeAlerts>> = {
  crowdstrike: crowdstrikeApi.getAlerts,
  sentinelone: sentineloneAnalyticsApi.getAlerts,
};

interface EndpointAlertDetailsDrawerProps {
  vendor: EndpointVendorId;
  open: boolean;
  onClose: () => void;
  /** Single MITRE technique filter (convenience for the chart click-throughs). */
  technique?: string;
  /** Multi-technique OR filter. Takes precedence over `technique`. */
  techniques?: string[];
  /** Optional title override (e.g., "Alerts addressed by 'BlockExeFromEmail'"). */
  title?: string;
  /** created_at window sent as from/to. Absent = unbounded (as before). */
  window?: TimeWindow;
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

/** Alert list drawer for the endpoint-EDR tabs (chart and technique click-throughs). */
export default function EndpointAlertDetailsDrawer({
  vendor: vendorId,
  open,
  onClose,
  technique,
  techniques,
  title,
  window,
}: EndpointAlertDetailsDrawerProps) {
  const vendor = VENDORS[vendorId];
  const consoleLink = vendor.consoleLink;
  const [alerts, setAlerts] = useState<CrowdStrikeAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleBase, setConsoleBase] = useState(consoleLink?.defaultBase ?? '');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus trap + Escape-to-close + focus restoration on close
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer one frame so the dialog mounts before we move focus into it
    queueMicrotask(() => closeButtonRef.current?.focus());

    const focusableSelector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Restore focus to the trigger element when the drawer closes
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Resolve the console base once per open when the vendor needs one
  // (CrowdStrike: the configured region; also warms the module-wide cache
  // for the executions panel).
  useEffect(() => {
    if (!open || !consoleLink) return;
    let cancelled = false;
    consoleLink.resolveBase().then((base) => {
      if (!cancelled) setConsoleBase(base);
    });
    return () => {
      cancelled = true;
    };
  }, [open, consoleLink]);

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
    ALERT_LISTS[vendorId]({
        pageSize: PAGE_SIZE,
        sortField: 'created_at',
        sortOrder: 'desc',
        techniques: effectiveTechniques,
        ...(window && { from: window.from, to: window.to }),
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
  }, [open, techniquesKey, window?.from, window?.to, vendorId]);

  if (!open) return null;

  const defaultHeader =
    !effectiveTechniques
      ? `Recent ${vendor.shortName} Alerts`
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={headerTitle}
        className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border shadow-xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{headerTitle}</h3>
            <p className="text-xs text-muted-foreground mt-0.5" aria-live="polite">
              {loading ? 'Loading alerts…' : `${alerts.length.toLocaleString()} alerts`}
            </p>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
          >
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
                  <li key={alert.alert_id} className="p-3 hover:bg-raised/30 transition-colors">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${tokens.bar}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-tight break-words">
                            {alert.alert_title}
                          </div>
                          {(consoleLink || alert.portal_url) && (
                            <a
                              href={consoleLink ? consoleLink.url(alert.portal_url, consoleBase) : alert.portal_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 p-1 -m-1 rounded hover:bg-raised text-muted-foreground hover:text-foreground transition-colors"
                              aria-label={vendor.portalLabel}
                              title={vendor.portalLabel}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className={`uppercase font-semibold ${tokens.text}`}>
                            {alert.severity}
                          </span>
                          <span>·</span>
                          <span>{alert.status}</span>
                          <span>·</span>
                          <span>{formatTimeAgo(alert.created_at)}</span>
                          {formatCrowdStrikeProduct(alert.product) && (
                            <>
                              <span>·</span>
                              <span>{formatCrowdStrikeProduct(alert.product)}</span>
                            </>
                          )}
                          <PreventionBadge
                            action={alert.prevention_action}
                            rawStatus={alert.pattern_disposition_description}
                          />
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
                                className="text-[10px] font-mono px-1.5 py-0.5 bg-raised text-muted-foreground rounded"
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
