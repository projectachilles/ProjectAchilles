import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, Settings, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  integrationsApi,
  type AutoResolveStatus,
  type AutoResolveMode,
} from '@/services/api/integrations';

const MODE_META: Record<AutoResolveMode, { label: string; tone: string }> = {
  disabled: { label: 'Disabled', tone: 'text-muted-foreground' },
  dry_run: { label: 'Dry Run', tone: 'text-amber-500' },
  enabled: { label: 'Enabled', tone: 'text-emerald-500' },
};

export default function AutoResolveStatTile() {
  const [status, setStatus] = useState<AutoResolveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await integrationsApi.getAutoResolveStatus();
        if (!cancelled) {
          setStatus(s);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card className="h-full flex flex-col items-center justify-center text-center p-4 gap-2">
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          Auto-resolve status unavailable
        </span>
      </Card>
    );
  }

  const modeMeta = MODE_META[status.mode];

  return (
    <Card className="h-full flex flex-col p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Auto-Resolve</span>
        </div>
        <Link
          to="/settings"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Configure auto-resolve"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-1 px-4 py-3">
        <span className="text-3xl font-bold tabular-nums">
          {status.counts.last30d.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground">resolved in last 30d</span>
      </div>

      <div className="border-t border-border mx-4" />

      <div className="px-4 py-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Mode</span>
        <span className={`font-medium ${modeMeta.tone}`}>{modeMeta.label}</span>
      </div>
      <div className="px-4 pb-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Last 24h</span>
        <span className="font-medium tabular-nums">
          {status.counts.last24h.toLocaleString()}
        </span>
      </div>
    </Card>
  );
}
