import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  integrationsApi,
  type AutoResolveStatus,
  type AutoResolveMode,
} from '@/services/api/integrations';
import HeroStatTile from './HeroStatTile';

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
      <HeroStatTile
        title="Auto-Resolve"
        icon={<ShieldCheck className="w-4 h-4 text-primary" />}
        value=""
        loading
      />
    );
  }

  if (error || !status) {
    return (
      <HeroStatTile
        title="Auto-Resolve"
        icon={<ShieldCheck className="w-4 h-4 text-primary" />}
        value=""
        error="Auto-resolve status unavailable"
      />
    );
  }

  const modeMeta = MODE_META[status.mode];
  const subValue = (
    <span className="flex flex-col gap-0.5">
      <span>resolved in last 30d</span>
      <span className="inline-flex items-center gap-1.5">
        <span className={`font-medium ${modeMeta.tone}`}>{modeMeta.label}</span>
        <span>·</span>
        <span>24h: {status.counts.last24h.toLocaleString()}</span>
      </span>
    </span>
  );

  return (
    <HeroStatTile
      title="Auto-Resolve"
      icon={<ShieldCheck className="w-4 h-4 text-primary" />}
      value={status.counts.last30d.toLocaleString()}
      subValue={subValue}
      href="/settings"
    />
  );
}
