import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';

interface DefenderTabHeaderProps {
  lastSync: string | null;
  syncing: boolean;
  onSync: () => void;
}

export default function DefenderTabHeader({ lastSync, syncing, onSync }: DefenderTabHeaderProps) {
  return (
    <div className="flex items-center justify-between">
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
  );
}
