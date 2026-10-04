import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';

interface DefenderTabHeaderProps {
  lastSync: string | null;
  syncing: boolean;
  /** Last sync failure (manual run or background), shown until a clean sync. */
  syncError?: string | null;
  onSync: () => void;
}

export default function DefenderTabHeader({ lastSync, syncing, syncError, onSync }: DefenderTabHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Microsoft Defender</h2>
          <p className="text-sm text-muted-foreground">
            Secure Score, security alerts, and remediation controls
            {lastSync && (
              <span className="ml-2">
                &middot; Last synced {new Date(lastSync).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Sync Now
        </Button>
      </div>
      {syncError && (
        <Alert variant="destructive" title="Defender sync failed">
          <span className="break-words">{syncError}</span>
        </Alert>
      )}
    </div>
  );
}
