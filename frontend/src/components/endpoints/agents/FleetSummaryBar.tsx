import { ChevronRight } from 'lucide-react';
import type { AgentMetrics } from '@/types/agent';

interface FleetSummaryBarProps {
  metrics: AgentMetrics | null;
  staleCount: number | null;
  onOpenDetails: () => void;
}

/** Compact fleet pulse for viewports below `lg`; opens the full rail in a sheet. */
export function FleetSummaryBar({ metrics, staleCount, onOpenDetails }: FleetSummaryBarProps) {
  const total = metrics?.total ?? 0;
  const online = metrics?.online ?? 0;
  const offline = metrics?.offline ?? 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono text-base font-semibold text-accent">
          {online}/{total}
        </span>
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
      <button
        type="button"
        onClick={onOpenDetails}
        className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-muted transition-colors hover:bg-raised hover:text-foreground"
      >
        Fleet details
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
