import { useState, useEffect } from 'react';
import { Loader2, ExternalLink, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { defenderApi, type ControlItem } from '@/services/api/defender';

const TOP_N = 10;

interface TopControlsCardProps {
  /** When true, stretches to fill parent height (for grid placement). */
  compact?: boolean;
}

export default function TopControlsCard({ compact }: TopControlsCardProps) {
  const [controls, setControls] = useState<ControlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    defenderApi.getControls({ deprecated: false })
      .then((all) => {
        const sorted = [...all].sort((a, b) => b.max_score - a.max_score);
        setControls(sorted.slice(0, TOP_N));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
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
            {controls.map((ctrl, idx) => (
              <div
                key={ctrl.control_name}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors"
              >
                {/* Rank */}
                <span className="text-sm font-medium text-muted-foreground tabular-nums w-5 shrink-0">
                  {idx + 1}
                </span>

                {/* Title + external link */}
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
                </div>

                {/* Category badge */}
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {ctrl.control_category}
                </Badge>

                {/* Score gain */}
                <span className="text-sm font-semibold tabular-nums text-green-500 shrink-0 w-14 text-right">
                  +{ctrl.max_score.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
