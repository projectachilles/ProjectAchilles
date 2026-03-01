import { ShieldOff, Globe, Monitor, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RiskAcceptance } from '@/services/api/analytics';

interface RiskAcceptanceSummaryCardProps {
  riskAcceptances: Map<string, RiskAcceptance[]>;
  onViewAll?: () => void;
}

export default function RiskAcceptanceSummaryCard({
  riskAcceptances,
  onViewAll,
}: RiskAcceptanceSummaryCardProps) {
  // Flatten and deduplicate acceptances by acceptance_id
  const allAcceptances = new Map<string, RiskAcceptance>();
  for (const list of riskAcceptances.values()) {
    for (const acc of list) {
      allAcceptances.set(acc.acceptance_id, acc);
    }
  }

  const total = allAcceptances.size;
  if (total === 0) return null;

  const globalCount = [...allAcceptances.values()].filter(a => !a.hostname).length;
  const hostCount = total - globalCount;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <ShieldOff className="w-4 h-4" />
          Accepted Risk
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-3xl font-bold text-foreground">{total}</span>
          <span className="text-sm text-muted-foreground">
            control{total !== 1 ? 's' : ''} with accepted risk
          </span>
        </div>

        <div className="flex gap-4 text-sm text-muted-foreground mb-3">
          {globalCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>{globalCount} global</span>
            </div>
          )}
          {hostCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5" />
              <span>{hostCount} host-specific</span>
            </div>
          )}
        </div>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            View in Executions
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
