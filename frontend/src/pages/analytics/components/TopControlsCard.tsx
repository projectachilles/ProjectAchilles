import { useState, useEffect, memo } from 'react';
import { Loader2, ExternalLink, ShieldAlert, Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

  return (
    <Card className={compact ? 'h-full flex flex-col' : undefined}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Remediation Controls</CardTitle>
        {!compact && (
          <CardDescription>
            Highest impact actions to improve your Secure Score
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className={compact ? 'flex-1 min-h-0 overflow-y-auto' : undefined}>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
          <div className="space-y-1">
            {controls.map((ctrl, idx) => {
              const corr = correlations.get(ctrl.control_name);
              const showCorrelation =
                !!corr && corr.alertCount > 0 && !!onSelectControlAlerts;
              return (
                <div
                  key={ctrl.control_name}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors"
                >
                  {/* Rank */}
                  <span className="text-sm font-medium text-muted-foreground tabular-nums w-5 shrink-0 pt-0.5">
                    {idx + 1}
                  </span>

                  {/* Title + correlation sub-line */}
                  <div className="flex-1 min-w-0">
                    {ctrl.action_url ? (
                      <a
                        href={ctrl.action_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline inline-flex items-center gap-1 max-w-full"
                      >
                        <span className="truncate">{ctrl.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium truncate block">
                        {ctrl.title}
                      </span>
                    )}
                    {showCorrelation && (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectControlAlerts!(corr!.coveredTechniques, ctrl.title)
                        }
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                        aria-label={`View ${corr!.alertCount} Defender alerts addressed by this control`}
                      >
                        <Bell className="w-3 h-3" />
                        <span>
                          {corr!.alertCount.toLocaleString()}{' '}
                          {corr!.alertCount === 1 ? 'alert' : 'alerts'} addressed in last{' '}
                          {CORRELATION_DAYS}d
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Category badge */}
                  <Badge variant="secondary" className="shrink-0 text-xs mt-0.5">
                    {ctrl.control_category}
                  </Badge>

                  {/* Score gain */}
                  <span className="text-sm font-semibold tabular-nums text-green-500 shrink-0 w-14 text-right mt-0.5">
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
