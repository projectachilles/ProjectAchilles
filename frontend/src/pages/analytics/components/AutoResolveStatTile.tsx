import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  integrationsApi,
  type AutoResolveStatus,
  type AutoResolveMode,
  type AutoResolveReceipt,
} from '@/services/api/integrations';
import HeroStatTile from './HeroStatTile';

const MODE_META: Record<AutoResolveMode, { label: string; tone: string }> = {
  disabled: { label: 'Disabled', tone: 'text-muted-foreground' },
  dry_run: { label: 'Dry Run', tone: 'text-amber-500' },
  enabled: { label: 'Enabled', tone: 'text-emerald-500' },
};

const SPARKLINE_DAYS = 30;
const RECEIPT_FETCH_LIMIT = 100;

/**
 * Build a 30-bucket daily count series from receipts, indexed oldest → newest
 * by UTC day. Receipts are bucketed by `auto_resolved_at.slice(0,10)` which
 * matches the `now-30d` ES range filter in /auto-resolve/status (so the
 * sparkline sums approximately equal the displayed 30d count).
 */
function buildDailySparkline(items: AutoResolveReceipt[]): number[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const buckets = new Map<string, number>();
  for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const r of items) {
    if (!r.auto_resolved_at) continue;
    const key = r.auto_resolved_at.slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.values());
}

export default function AutoResolveStatTile() {
  const [status, setStatus] = useState<AutoResolveStatus | null>(null);
  const [sparkline, setSparkline] = useState<number[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [statusR, receiptsR] = await Promise.allSettled([
        integrationsApi.getAutoResolveStatus(),
        integrationsApi.getAutoResolveReceipts(RECEIPT_FETCH_LIMIT, 0),
      ]);

      if (cancelled) return;

      if (statusR.status === 'fulfilled') {
        setStatus(statusR.value);
        setError(null);
      } else {
        setError((statusR.reason as Error)?.message ?? 'Failed to load');
      }

      // Receipt failure is non-fatal — the headline number still renders
      // from the (independent) /status call. The sparkline is best-effort.
      if (receiptsR.status === 'fulfilled') {
        setSparkline(buildDailySparkline(receiptsR.value.items));
      }

      setLoading(false);
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
      sparklineData={sparkline}
      sparklineClass="text-emerald-500"
      href="/settings"
    />
  );
}
