import { useEffect, useState } from 'react';
import { agentApi } from '@/services/api/agent';

/**
 * 24h heartbeat-cadence sparkline for one agent: heartbeat timestamps are
 * bucketed per hour and plotted as a polyline. Results are cached
 * module-wide for 5 minutes so the 15s fleet poll doesn't refetch, and so
 * navigating away/back stays cheap.
 *
 * Follow-up (noted in the PR): a bulk `/agents/heartbeats` endpoint would
 * collapse the per-agent requests; at current fleet sizes (~tens of agents,
 * one cheap SQLite query each) this is acceptable.
 */
const cache = new Map<string, { at: number; buckets: number[] }>();
const CACHE_TTL_MS = 5 * 60_000;
const BUCKETS = 24;

async function loadBuckets(agentId: string): Promise<number[]> {
  const cached = cache.get(agentId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.buckets;

  const points = await agentApi.getHeartbeatHistory(agentId, 1);
  const now = Date.now();
  const buckets = new Array(BUCKETS).fill(0);
  for (const point of points) {
    const age = now - new Date(point.timestamp).getTime();
    const bucket = BUCKETS - 1 - Math.floor(age / 3_600_000);
    if (bucket >= 0 && bucket < BUCKETS) buckets[bucket] += 1;
  }
  cache.set(agentId, { at: Date.now(), buckets });
  return buckets;
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
