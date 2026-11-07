import { UserCheck } from 'lucide-react';
import { analystResponse } from '../utils/initiatedBy';

/**
 * Marks an alert a person raised (e.g. a SentinelOne Deep Visibility
 * mitigation). Neutral styling on purpose: it is a response, not the EDR's
 * own prevention, so it never looks like the green prevention badge.
 */
export default function AnalystResponseBadge({ initiatedBy }: { initiatedBy?: string | null }) {
  const info = analystResponse(initiatedBy);
  if (!info) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={info.detail}
    >
      <UserCheck className="w-3 h-3" />
      {info.label}
    </span>
  );
}
