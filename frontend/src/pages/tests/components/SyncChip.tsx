import { GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SyncChipProps {
  branch?: string;
  commit?: string;
  lastSyncedAgo?: string;
  syncing?: boolean;
  canSync: boolean;
  onSync: () => void;
}

export function SyncChip({ branch, commit, lastSyncedAgo, syncing, canSync, onSync }: SyncChipProps) {
  return (
    <div className="flex items-center gap-2">
      {branch && (
        <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted">
          <GitBranch className="h-3.5 w-3.5 text-accent" />
          {branch}
          {commit && <span>({commit.slice(0, 7)})</span>}
          {lastSyncedAgo && <span>· {lastSyncedAgo}</span>}
        </span>
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
