import type { AgentMetrics } from '@/types/agent';
import { cn } from '@/lib/utils';

interface GroupCount {
  tag: string;
  count: number;
}

interface FleetPulseRailProps {
  metrics: AgentMetrics | null;
  staleCount: number | null;
  groups: GroupCount[];
  activeTag: string | undefined;
  staleActive: boolean;
  onTagFilter: (tag: string | undefined) => void;
  onStaleFilter: () => void;
}

const CIRCUMFERENCE = 2 * Math.PI * 16;

export function FleetPulseRail({
  metrics,
  staleCount,
  groups,
  activeTag,
  staleActive,
  onTagFilter,
  onStaleFilter,
}: FleetPulseRailProps) {
  const total = metrics?.total ?? 0;
  const online = metrics?.online ?? 0;
  const offline = metrics?.offline ?? 0;
  const onlineArc = total > 0 ? (online / total) * CIRCUMFERENCE : 0;
  const offlineArc = total > 0 ? (offline / total) * CIRCUMFERENCE : 0;

  const versions = Object.entries(metrics?.by_version ?? {}).sort((a, b) => b[1] - a[1]);
  const maxVersionCount = Math.max(1, ...versions.map(([, count]) => count));

  return (
    <div className="flex w-60 shrink-0 flex-col gap-4">
      {/* Fleet pulse donut */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 text-[11px] uppercase tracking-wider text-faint">fleet pulse</div>
        <div className="flex items-center gap-3.5">
          <svg width="72" height="72" viewBox="0 0 42 42" aria-hidden="true">
            <circle cx="21" cy="21" r="16" fill="none" stroke="var(--raised)" strokeWidth="6" />
            <circle
              cx="21" cy="21" r="16" fill="none"
              stroke="var(--accent)" strokeWidth="6"
              strokeDasharray={`${onlineArc} ${CIRCUMFERENCE}`}
              transform="rotate(-90 21 21)"
            />
            <circle
              cx="21" cy="21" r="16" fill="none"
              stroke="var(--danger)" strokeWidth="6"
              strokeDasharray={`${offlineArc} ${CIRCUMFERENCE}`}
              strokeDashoffset={-onlineArc}
              transform="rotate(-90 21 21)"
            />
            <text x="21" y="24" textAnchor="middle" fill="var(--foreground)" fontSize="9" fontFamily="var(--font-mono)" fontWeight="600">
              {online}/{total}
            </text>
          </svg>
          <div className="flex flex-col gap-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" />online {online}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-danger" />offline {offline}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-warning" />stale {staleCount ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Needs attention */}
      {staleCount != null && staleCount > 0 && (
        <button
          onClick={onStaleFilter}
          className={cn(
            'rounded-lg border p-3 text-left text-xs transition-colors',
            staleActive
              ? 'border-warning bg-warning-dim text-warning'
              : 'border-warning/40 bg-warning-dim text-warning hover:border-warning',
          )}
        >
          <div className="mb-1 text-[11px] uppercase tracking-wider">needs attention</div>
          {staleCount} stale — no tasks in 7 days →
        </button>
      )}

      {/* Version distribution */}
      {versions.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2.5 text-[11px] uppercase tracking-wider text-faint">versions</div>
          <div className="flex flex-col gap-2.5">
            {versions.map(([version, count]) => (
              <div key={version}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span>{version}</span>
                  <span className="text-muted">{count}</span>
                </div>
                <div className="mt-1 h-[5px] rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent/70"
                    style={{ width: `${(count / maxVersionCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group filter */}
      {groups.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2.5 text-[11px] uppercase tracking-wider text-faint">groups</div>
          <div className="flex flex-col gap-1.5 text-xs">
            <button
              onClick={() => onTagFilter(undefined)}
              className={cn(
                'flex justify-between rounded-md border px-2.5 py-1.5 text-left transition-colors',
                !activeTag
                  ? 'border-accent/25 bg-accent-dim text-accent'
                  : 'border-transparent text-muted hover:bg-raised hover:text-foreground',
              )}
            >
              all agents
            </button>
            {groups.map((group) => (
              <button
                key={group.tag}
                onClick={() => onTagFilter(activeTag === group.tag ? undefined : group.tag)}
                className={cn(
                  'flex justify-between rounded-md border px-2.5 py-1.5 text-left transition-colors',
                  activeTag === group.tag
                    ? 'border-accent/25 bg-accent-dim text-accent'
                    : 'border-transparent text-muted hover:bg-raised hover:text-foreground',
                )}
              >
                {group.tag}
                <span className="font-mono text-[10px] text-faint">{group.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
