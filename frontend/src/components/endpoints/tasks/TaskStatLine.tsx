import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { breakdownGroups } from '@/pages/endpoints/utils/taskTiles';
import type { BreakdownTile, TaskTiles } from '@/pages/endpoints/utils/taskTiles';
import type { TaskBreakdownRow, TaskOutcomes7d } from '@/types/agent';


interface TaskStatLineProps {
  tiles: TaskTiles;
  outcomes?: TaskOutcomes7d;
  onSelectBreakdown?: (row: TaskBreakdownRow, tile: BreakdownTile) => void;
}

/** One-line 7-day summary for the Tasks page header; Protected / Unprotected / No verdict open the exit-code breakdown. */
export function TaskStatLine({ tiles, outcomes, onSelectBreakdown }: TaskStatLineProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{tiles.window}</span>
      {tiles.tiles.map((tile) => {
        const label = tile.label.toLowerCase();
        const value = (
          <span className={`font-mono ${tile.cls}`} title={tile.sub}>{tile.value}</span>
        );
        const kind: BreakdownTile | null =
          tile.id === 'protected' || tile.id === 'unprotected' || tile.id === 'no-verdict' ? tile.id : null;
        const groups = kind && outcomes ? breakdownGroups(outcomes, kind) : null;
        const n = Number(tile.value);
        const interactive = kind && groups && n > 0;
        const max = groups ? Math.max(1, ...groups.flatMap((g) => g.rows.map((r) => r.count))) : 1;

        return (
          <span key={tile.id} className="inline-flex items-center gap-1">
            <span className="text-faint">·</span>
            {interactive ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Show breakdown of ${tile.value} ${label}`}
                  className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {value}
                  <span>{label}</span>
                  <ChevronDown className="h-3 w-3" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-72">
                  {groups.map((g) => (
                    <DropdownMenuGroup key={g.title ?? 'all'}>
                      {g.title && (
                        <DropdownMenuLabel className="text-xs font-normal text-muted">
                          {g.title} · {g.total}
                        </DropdownMenuLabel>
                      )}
                      {g.rows.map((r) => (
                        <DropdownMenuItem key={r.key} onSelect={() => onSelectBreakdown?.(r, kind)}>
                          {r.code != null && <span className="w-9 font-mono text-xs text-muted">{r.code}</span>}
                          <span className="flex-1 truncate">{r.name}</span>
                          <span className="h-1.5 w-16 rounded-full bg-border" aria-hidden>
                            <span
                              className={`block h-full rounded-full ${barClass(kind, r.outcome)}`}
                              style={{ width: `${(r.count / max) * 100}%` }}
                            />
                          </span>
                          <span className="w-8 text-right font-mono text-xs">{r.count}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  ))}
                  <div className="px-2 py-1.5 text-xs text-muted">Click a row to filter the list · Esc to close</div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                {value}
                <span>{label}</span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

function barClass(tile: BreakdownTile, outcome: TaskBreakdownRow['outcome']): string {
  if (tile === 'protected') return 'bg-accent';
  if (tile === 'unprotected') return 'bg-danger';
  return outcome === 'inconclusive' ? 'bg-faint' : 'bg-warning';
}
