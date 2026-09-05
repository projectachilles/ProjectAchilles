import { useState, useEffect, memo } from 'react';
import { ExternalLink, ShieldAlert, Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  defenderApi,
  type ControlItem,
  type ControlCorrelationResult,
} from '@/services/api/defender';

const TOP_N = 10;
const CORRELATION_DAYS = 30;

interface TopControlsCardProps {
  compact?: boolean;
  /**
   * Fires when the user clicks the per-control alert correlation badge.
   * techniques: MITRE techniques the control is mapped to (≥1)
   * controlTitle: human-readable title for the drawer header
   */
  onSelectControlAlerts?: (techniques: string[], controlTitle: string) => void;
}

function TopControlsCard({ compact, onSelectControlAlerts }: TopControlsCardProps) {
  const [controls, setControls] = useState<ControlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [correlations, setCorrelations] = useState<Map<string, ControlCorrelationResult>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    defenderApi
      .getControls({ deprecated: false })
      .then((all) => {
        if (cancelled) return;
        const sorted = [...all].sort((a, b) => b.max_score - a.max_score);
        const top = sorted.slice(0, TOP_N);
        setControls(top);
        // Fan-out parallel correlation lookups. Failures are silent — a control
        // without a mapping (or a tenant whose ES index isn't reachable for this
        // call) just shows no correlation badge.
        return Promise.allSettled(
          top.map((c) =>
            defenderApi.getControlCorrelation(c.title, CORRELATION_DAYS),
          ),
        ).then((results) => {
          if (cancelled) return;
          const map = new Map<string, ControlCorrelationResult>();
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              map.set(top[i].control_name, r.value);
            }
          });
          setCorrelations(map);
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Impact bars are relative to the strongest control in the list
  const maxImpact = controls.length > 0 ? Math.max(...controls.map((c) => c.max_score)) : 0;

  return (
    <Card className={compact ? 'h-full flex flex-col' : undefined}>
      <CardHeader className={compact ? 'flex flex-row items-baseline justify-between space-y-0' : undefined}>
        <CardTitle className="text-sm font-medium">Top Remediation Controls</CardTitle>
        {compact ? (
          <span className="text-xs text-faint">ranked by Secure Score impact</span>
        ) : (
          <CardDescription>
            Highest impact actions to improve your Secure Score
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className={compact ? 'flex-1 min-h-0 overflow-y-auto' : undefined}>
        {loading ? (
          <div className="space-y-1" aria-busy="true">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-5 shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16 shrink-0" />
                <Skeleton className="h-4 w-10 shrink-0" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center text-muted-foreground py-8">
            Failed to load controls
          </div>
        ) : controls.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <ShieldAlert className="w-8 h-8" />
            <p className="text-sm">No controls data — sync Defender first</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {controls.map((ctrl, idx) => {
              const corr = correlations.get(ctrl.control_name);
              const showCorrelation =
                !!corr && corr.alertCount > 0 && !!onSelectControlAlerts;
              const isIdentity = /identity/i.test(ctrl.control_category);
              return (
                <div
                  key={ctrl.control_name}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 transition-colors hover:bg-raised/40 ${
                    idx < controls.length - 1 ? 'border-b border-raised' : ''
                  }`}
                >
                  {/* Rank */}
                  <span className="w-4 shrink-0 font-mono text-[11px] text-faint">
                    {idx + 1}
                  </span>

                  {/* Title + correlation sub-line */}
                  <div className="min-w-0 flex-1 basis-48">
                    {ctrl.action_url ? (
                      <a
                        href={ctrl.action_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-[13px] hover:underline"
                      >
                        <span className="truncate">{ctrl.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-faint" />
                      </a>
                    ) : (
                      <span className="block truncate text-[13px]">
                        {ctrl.title}
                      </span>
                    )}
                    {showCorrelation && (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectControlAlerts!(corr!.coveredTechniques, ctrl.title)
                        }
                        className="mt-0.5 inline-flex items-center gap-1 rounded text-xs text-warning hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label={`View ${corr!.alertCount} Defender alerts addressed by this control`}
                      >
                        <Bell className="h-3 w-3" />
                        <span>
                          {corr!.alertCount.toLocaleString()}{' '}
                          {corr!.alertCount === 1 ? 'alert' : 'alerts'} addressed in last{' '}
                          {CORRELATION_DAYS}d
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Category chip — Identity gets the info tint, device stays neutral */}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      isIdentity ? 'bg-info-dim text-info' : 'bg-raised text-muted'
                    }`}
                  >
                    {ctrl.control_category}
                  </span>

                  {/* Relative impact bar */}
                  <div className="h-[5px] w-[72px] shrink-0 rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${maxImpact > 0 ? (ctrl.max_score / maxImpact) * 100 : 0}%` }}
                    />
                  </div>

                  {/* Score gain */}
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-accent">
                    +{ctrl.max_score.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(TopControlsCard);
