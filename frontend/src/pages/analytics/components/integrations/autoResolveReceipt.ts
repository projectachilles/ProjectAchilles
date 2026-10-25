// How to label an alert's auto-resolve receipt (`f0rtika.auto_resolved*`).
// A receipt exists for real resolves, but also for dry runs and for alerts
// Achilles shelved without resolving them (not found in the console, no
// change applied, invalid id). Only the first is "Auto-resolved by Achilles".

export interface AutoResolveReceiptFields {
  auto_resolved?: boolean;
  auto_resolve_mode?: 'disabled' | 'dry_run' | 'enabled' | null;
  auto_resolve_error?: string | null;
}

export interface AutoResolveReceiptLabel {
  label: string;
  /** resolved: Achilles changed the alert; info: dry run or skipped, nothing changed. */
  tone: 'resolved' | 'info';
}

const SKIP_REASONS: Record<string, string> = {
  not_found: 'alert not found in the console',
  not_applied: 'the console applied no change',
  invalid_id: 'invalid alert id',
};

export function describeAutoResolveReceipt(alert: AutoResolveReceiptFields): AutoResolveReceiptLabel | null {
  if (!alert.auto_resolved) return null;
  if (alert.auto_resolve_error) {
    const reason = SKIP_REASONS[alert.auto_resolve_error] ?? alert.auto_resolve_error;
    return { label: `Auto-resolve skipped: ${reason}`, tone: 'info' };
  }
  if (alert.auto_resolve_mode === 'dry_run') return { label: 'Auto-resolve dry run: would resolve', tone: 'info' };
  if (alert.auto_resolve_mode === 'enabled') return { label: 'Auto-resolved by Achilles', tone: 'resolved' };
  return null; // unknown / disabled: claim nothing
}
