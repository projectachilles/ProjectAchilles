import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { topBypassedTechniques } from '../utils/analyticsDerivations';
import type { TechniqueDistributionItem } from '@/services/api/analytics';

interface TopBypassedTechniquesProps {
  items: TechniqueDistributionItem[];
  loading?: boolean;
}

// Dimmed variant for every row except the single worst offender, which stays
// at full saturation to draw the eye first.
const DIMMED_BYPASSED = 'color-mix(in oklab, var(--chart-bypassed) 55%, transparent)';

const SKELETON_ROW_COUNT = 5;

function TopBypassedTechniques({ items, loading }: TopBypassedTechniquesProps) {
  const rows = topBypassedTechniques(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Bypassed Techniques</CardTitle>
        <p className="text-xs text-muted-foreground">sorted by bypass rate</p>
      </CardHeader>
      <CardContent aria-busy={loading || undefined}>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-16 shrink-0" />
                <Skeleton className="h-2 flex-1" />
                <Skeleton className="h-3 w-8 shrink-0" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bypassed techniques in range.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.technique} className="flex items-center gap-3">
                <span className="text-xs font-mono text-foreground w-20 shrink-0 truncate">
                  {row.technique}
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    data-testid="bypass-bar"
                    className="h-full rounded-full"
                    style={{
                      width: `${row.bypassRate}%`,
                      backgroundColor: index === 0 ? 'var(--chart-bypassed)' : DIMMED_BYPASSED,
                    }}
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-foreground w-10 shrink-0 text-right">
                  {row.bypassRate}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { TopBypassedTechniques };
export default TopBypassedTechniques;
