import { useEffect, useState } from 'react';
import { agentApi } from '@/services/api/agent';

/**
 * 24h heartbeat-cadence sparkline for one agent: server-bucketed hourly
 * counts plotted as a polyline. All visible sparklines share ONE bulk
 * request (`GET /agents/heartbeats`), cached module-wide for 5 minutes so
 * the 15s fleet poll doesn't refetch and navigating away/back stays cheap.
 */
const CACHE_TTL_MS = 5 * 60_000;
const BUCKETS = 24;

let bulkCache: { at: number; buckets: Record<string, number[]> } | null = null;
let inflight: Promise<Record<string, number[]>> | null = null;

async function loadBuckets(agentId: string): Promise<number[]> {
  if (!bulkCache || Date.now() - bulkCache.at >= CACHE_TTL_MS) {
    inflight ??= agentApi
      .getBulkHeartbeatBuckets(BUCKETS)
      .then((buckets) => {
        bulkCache = { at: Date.now(), buckets };
        return buckets;
      })
      .finally(() => {
        inflight = null;
      });
    await inflight;
  }
  // Agents with no heartbeats in the window are absent from the map → flat line.
  return bulkCache?.buckets[agentId] ?? new Array(BUCKETS).fill(0);
}

interface HeartbeatSparklineProps {
  agentId: string;
  /** Colors the line: accent when healthy, danger when the agent is offline. */
  online: boolean;
  width?: number;
  height?: number;
}

export function HeartbeatSparkline({ agentId, online, width = 110, height = 20 }: HeartbeatSparklineProps) {
  const [buckets, setBuckets] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBuckets(agentId)
      .then((b) => {
        if (!cancelled) setBuckets(b);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (failed) return <span className="text-xs text-faint">—</span>;
  if (!buckets) return <span className="inline-block h-[5px] w-full max-w-[110px] animate-pulse rounded-full bg-raised" />;

  const max = Math.max(1, ...buckets);
  const step = width / (BUCKETS - 1);
  const points = buckets
    .map((count, i) => `${(i * step).toFixed(1)},${(height - 2 - (count / max) * (height - 4)).toFixed(1)}`)
    .join(' ');
  const flat = buckets.every((b) => b === 0);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={flat ? `0,${height - 2} ${width},${height - 2}` : points}
        fill="none"
        stroke={flat ? 'var(--faint)' : online ? 'var(--accent)' : 'var(--faint)'}
        strokeWidth="1.5"
        opacity="0.7"
      />
    </svg>
  );
}
