import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { formatTimestamp } from './shared';

interface MultiTestAlert {
  alert_id: string;
  alert_title: string;
  created_at?: string;
  auto_resolved_at?: string | null;
}

/**
 * Alerts that name the files of several Achilles tests but single out none of
 * this run's (backend `attribution: 'multi_test'`, edr/multiTestEvidence.ts):
 * typically a listing of C:\F0 holding leftovers of earlier runs. Not evidence
 * for the run, so one muted line instead of a row per alert; the list stays one
 * click away so nothing seems to have gone missing.
 */
export function MultiTestAlertsNote({ vendor, alerts }: { vendor: string; alerts: MultiTestAlert[] }) {
  const [open, setOpen] = useState(false);
  if (alerts.length === 0) return null;
  const resolved = alerts.filter((a) => a.auto_resolved_at).length;
  const noun = alerts.length === 1 ? 'alert lists' : 'alerts list';
  return (
    <div className="rounded-md border border-border bg-surface p-3" data-testid="multi-test-alerts-note">
      <div className="flex items-start gap-2">
        <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-muted">
          {alerts.length} {vendor} {noun} files from several Achilles tests on this host without singling out
          this run&apos;s. Not evidence for this run.
          {resolved > 0 ? ` ${resolved} auto-resolved in ${vendor}.` : ''}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-raised"
        >
          {open ? 'Hide' : `Show ${alerts.length}`}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 border-t border-border pl-6 pt-2">
          {alerts.map((a) => (
            <li key={a.alert_id} className="flex items-center gap-2 text-xs text-muted">
              {a.created_at && <span className="shrink-0 font-mono text-[11px] text-faint">{formatTimestamp(a.created_at, false)}</span>}
              <span className="min-w-0 flex-1 truncate">{a.alert_title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
