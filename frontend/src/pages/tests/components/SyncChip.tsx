import { GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SyncChipProps {
  branch?: string;
  commit?: string;
  lastSyncedAgo?: string;
  /** When the published versions were last checked, e.g. "5m ago". */
  checkedAgo?: string;
  syncing?: boolean;
  canSync: boolean;
  onSync: () => void;
  /** Set to show a Check now button (the version banner carries it otherwise). */
  onCheck?: () => void;
  checking?: boolean;
  /** Quiet secondary text after the library line, e.g. why published versions are not checked. */
  note?: string;
}

export function SyncChip({ branch, commit, lastSyncedAgo, checkedAgo, syncing, canSync, onSync, onCheck, checking, note }: SyncChipProps) {
  return (
    <div className="flex items-center gap-2">
      {branch && (
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted">
          <GitBranch className="h-3.5 w-3.5 text-accent" />
          {branch}
          {commit && <span>({commit.slice(0, 7)})</span>}
          {lastSyncedAgo && <span>· {lastSyncedAgo}</span>}
          {checkedAgo && <span>· checked {checkedAgo}</span>}
        </span>
      )}
      {note && <span className="text-xs text-muted">{note}</span>}
      {canSync && onCheck && (
        <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
          Check now
        </Button>
      )}
      {canSync && (
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
          Sync
        </Button>
      )}
    </div>
  );
}
