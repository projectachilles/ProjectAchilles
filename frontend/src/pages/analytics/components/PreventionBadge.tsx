import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { formatPreventionAction, isConfirmedPrevention } from '../utils/prevention';

interface PreventionBadgeProps {
  /** Normalized prevention action (shared vendor vocabulary). */
  action?: string;
  /** Raw vendor disposition for the tooltip — CrowdStrike
      pattern_disposition_description or Defender remediation_status. */
  rawStatus?: string;
  /**
   * The stage ran to completion (exit 101), so the action did not stop it and
   * the stage reads Detected. A confirmed action (quarantined, process killed,
   * blocked) is shown muted, as "<action>, stage still completed".
   */
  stageCompleted?: boolean;
}

/**
 * Vendor-confirmed prevention badge for an EDR alert row (Defender and
 * CrowdStrike share the normalized action vocabulary). Renders the action
 * (icon + label, semantic tokens) with the raw vendor disposition as the
 * tooltip for audit context. 'kill_failed' is styled as a warning — the
 * vendor attempted prevention and failed, which is a detection signal, not
 * prevention.
 */
export default function PreventionBadge({ action, rawStatus, stageCompleted }: PreventionBadgeProps) {
  const label = formatPreventionAction(action);
  if (!label) return null;
  if (stageCompleted && isConfirmedPrevention(action)) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted"
        title={`The stage ran to completion (exit 101), so this action did not stop it.${rawStatus ? ` (${rawStatus})` : ''}`}
      >
        <ShieldAlert className="w-3 h-3" />
        {`${label}, stage still completed`}
      </span>
    );
  }
  const failed = action === 'kill_failed';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
        failed
          ? 'border-warning/30 bg-warning-dim text-warning'
          : 'border-accent/30 bg-accent-dim text-accent'
      }`}
      title={rawStatus ?? undefined}
    >
      {failed ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
      {label}
    </span>
  );
}
