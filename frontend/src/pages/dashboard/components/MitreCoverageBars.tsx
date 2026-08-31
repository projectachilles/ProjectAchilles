import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TacticCoverage {
  /** Short code shown under the bar (IA, EX, PE, …). */
  code: string;
  name: string;
  /** Distinct techniques covered in this tactic. */
  count: number;
}

interface MitreCoverageBarsProps {
  tactics: TacticCoverage[];
  totalTechniques: number;
  coveredTactics: number;
  totalTactics: number;
  mappedTests: number;
  loading?: boolean;
}

/** Density tiers via accent opacity — literal-free for the chart color guard. */
function barClass(count: number): string {
  if (count >= 18) return 'bg-accent';
  if (count >= 10) return 'bg-accent/65';
  return 'bg-accent/40';
}

export function MitreCoverageBars({
  tactics,
  totalTechniques,
  coveredTactics,
  totalTactics,
  mappedTests,
  loading,
}: MitreCoverageBarsProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const max = Math.max(1, ...tactics.map((t) => t.count));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 grid-rows-1">
        <CardTitle>MITRE ATT&CK coverage</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="accent">{totalTechniques} techniques</Badge>
          <Badge variant="default">{coveredTactics}/{totalTactics} tactics</Badge>
          <Badge variant="default">{mappedTests} tests mapped</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-2">
          {tactics.map((tactic) => (
            <Tooltip key={tactic.code}>
              <TooltipTrigger asChild>
                <Link
                  to={`/tests?tactic=${encodeURIComponent(tactic.code)}`}
                  aria-label={`${tactic.name}: ${tactic.count} techniques`}
                  className="flex h-full flex-1 items-end"
                >
                  <div
                    className={cn('w-full rounded-t transition-colors hover:bg-accent-hover', barClass(tactic.count))}
                    style={{ height: `${Math.max(3, (tactic.count / max) * 100)}%` }}
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent>{tactic.name}: {tactic.count} techniques</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2">
          {tactics.map((tactic) => (
            <span key={tactic.code} className="flex-1 text-center font-mono text-[10px] text-faint">
              {tactic.code}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-faint">Click a tactic bar to explore technique coverage</p>
      </CardContent>
    </Card>
  );
}
