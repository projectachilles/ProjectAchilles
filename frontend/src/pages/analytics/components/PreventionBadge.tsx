import { Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { formatPreventionAction } from '../utils/prevention';

interface PreventionBadgeProps {
  /** Normalized prevention action (shared vendor vocabulary). */
  action?: string;
  /** Raw vendor disposition for the tooltip — CrowdStrike
      pattern_disposition_description or Defender remediation_status. */
  rawStatus?: string;
  /**
   * The action came after the run ended, on a stage that ran to completion
   * (exit 101): cleanup, not prevention, so the stage reads Detected. Shown
   * muted, as "<action> after the run".
   */
  afterRun?: boolean;
}

/**
 * Vendor-confirmed prevention badge for an EDR alert row (Defender and
 * CrowdStrike share the normalized action vocabulary). Renders the action
 * (icon + label, semantic tokens) with the raw vendor disposition as the
 * tooltip for audit context. 'kill_failed' is styled as a warning — the
 * vendor attempted prevention and failed, which is a detection signal, not
 * prevention.
 */
export default function PreventionBadge({ action, rawStatus, afterRun }: PreventionBadgeProps) {
  const label = formatPreventionAction(action);
  if (!label) return null;
  if (afterRun) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted"
        title={`The EDR acted after the run ended: cleanup, not prevention.${rawStatus ? ` (${rawStatus})` : ''}`}
      >
        <Clock className="w-3 h-3" />
        {label} after the run
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
