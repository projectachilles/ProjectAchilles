import { Download } from 'lucide-react';
import { chipClass } from '@/components/shared/ui/pillStyles';

interface OutdatedAgentsRowProps {
  outdated: number;
  total: number;
  /** Omit to hide the action (no permission to update agents). */
  onUpdateAll?: () => void;
}

/** Agents page attention row: the dashboard's quiet count chip plus the Update all action. */
export function OutdatedAgentsRow({ outdated, total, onUpdateAll }: OutdatedAgentsRowProps) {
  if (outdated === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
      <span className="mr-1 font-sans text-[11px] uppercase tracking-wider text-faint">attention</span>
      <span
        className={chipClass(false, 'cursor-default hover:bg-raised hover:text-muted')}
        title={`${outdated} of ${total} agent(s) running an outdated version`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
        <span className="text-foreground">{outdated}</span> of {total} outdated
      </span>
      {onUpdateAll && (
        <button type="button" onClick={onUpdateAll} className={chipClass(false, 'font-sans font-medium text-foreground')}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Update all ({outdated})
        </button>
      )}
    </div>
  );
}
