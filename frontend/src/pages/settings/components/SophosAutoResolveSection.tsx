// Sophos auto-resolve section for the Sophos integration card (mirrors the
// SentinelOne one). Acknowledges matched alerts and resolves matched XDR
// detections as benign security testing; never mitigates or touches test docs.
// Enabled needs Response mode: the backend refuses writes in read-only mode.

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import {
  sophosApi,
  type SophosAutoMode,
  type SophosAutoResolveStatus,
  type SophosPermissionMode,
  type SophosReceipt,
  type SophosReceiptCounts,
} from '@/services/api/sophos';
import { describeAutoResolveReceipt } from '@/pages/analytics/components/integrations/autoResolveReceipt';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { AutoResolveLastPass } from './AutoResolveLastPass';

const RECEIPT_PAGE_SIZE = 20;
const fmtTs = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 19).replace('T', ' ') : '—');
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface SectionProps {
  /** Permission mode as saved on the server (not the unsaved form value). */
  permissionMode: SophosPermissionMode;
}

export function SophosAutoResolveSection({ permissionMode }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<SophosAutoResolveStatus | null>(null);
  const [receipts, setReceipts] = useState<SophosReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        sophosApi.getAutoResolveStatus(),
        sophosApi.getAutoResolveReceipts(RECEIPT_PAGE_SIZE, 0),
      ]);
      setStatus(s);
      setReceipts(r.items);
    } catch (err) {
      setError(errMsg(err) || 'Failed to load auto-resolve status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadData();
  }, [expanded, loadData, permissionMode]);

  const handleModeChange = async (mode: SophosAutoMode) => {
    if (!status || mode === status.mode) return;
    setSaving(true);
    setError(null);
    try {
      await sophosApi.setAutoResolveMode(mode);
      await loadData();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const responseMode = permissionMode === 'response';

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground hover:text-primary"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>Alert auto-resolution</span>
        {status && status.mode !== 'disabled' && <ModeBadge mode={status.mode} />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading…</div>}
          {error && <Alert variant="destructive">{error}</Alert>}
          <p className="text-xs text-muted-foreground">
            For alerts and XDR detections matched to an Achilles test, Achilles acknowledges the alert in Sophos Central and
            resolves the detection as <span className="font-mono">TRUE_POSITIVE_BENIGN</span>, with a note naming the test. It does not
            isolate, scan, clean or remediate anything, and never touches test results.
          </p>
          {status && (
            <>
              <ModeSelector
                name="sophos-auto-resolve-mode"
                currentMode={status.mode}
                onChange={handleModeChange}
                disabled={saving}
                enabledLocked={!responseMode}
                descriptions={{
                  disabled: 'Nothing is resolved. Default.',
                  dry_run: 'Log and record what would be resolved without calling Sophos Central.',
                  enabled: 'Acknowledge matched alerts and resolve matched XDR detections in Sophos Central.',
                }}
              />
              {!responseMode && (
                <p className="text-xs text-muted-foreground">
                  <Info size={12} className="inline mr-1" />
                  Enabled requires Response mode: in read-only mode the backend never sends write requests.
                </p>
              )}
              {status.mode === 'enabled' && (
                <Alert variant="default" className="text-sm">
                  <AlertTriangle size={16} className="inline mr-1" />
                  The API credential's role must allow acknowledging alerts and updating detections. If Sophos returns 401/403,
                  the pass stops until the role is fixed.
                </Alert>
              )}
              <StatsStrip counts={status.counts} />
              <AutoResolveLastPass last={status.lastAutoResolve} />
              {status.dry_run_counts && (
                <>
                  <p className="text-xs text-muted-foreground">Dry run: would resolve</p>
                  <StatsStrip counts={status.dry_run_counts} />
                </>
              )}
              <ReceiptsTable
                receipts={receipts}
                empty="No auto-resolve receipts yet. They appear once matched alerts are processed."
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: SophosAutoMode }) {
  return (
    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
      {mode === 'dry_run' ? 'Dry-run' : 'Enabled'}
    </span>
  );
}

interface ModeSelectorProps {
  name: string;
  currentMode: SophosAutoMode;
  onChange: (mode: SophosAutoMode) => void;
  disabled: boolean;
  enabledLocked?: boolean;
  descriptions: Record<SophosAutoMode, string>;
}

function ModeSelector({ name, currentMode, onChange, disabled, enabledLocked, descriptions }: ModeSelectorProps) {
  const modes: Array<{ value: SophosAutoMode; label: string }> = [
    { value: 'disabled', label: 'Disabled' },
    { value: 'dry_run', label: 'Dry-run' },
    { value: 'enabled', label: 'Enabled' },
  ];
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground mb-2">Mode</legend>
      {modes.map((m) => {
        const locked = m.value === 'enabled' && enabledLocked;
        return (
          <label
            key={m.value}
            className={`flex items-start gap-3 p-3 border border-border rounded ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-raised/30'}`}
          >
            <input
              type="radio"
              name={name}
              value={m.value}
              checked={currentMode === m.value}
              onChange={() => onChange(m.value)}
              disabled={locked}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{m.label}</div>
              <div className="text-xs text-muted-foreground">{descriptions[m.value]}</div>
            </div>
          </label>
        );
      })}
    </fieldset>
  );
}

function StatsStrip({ counts }: { counts: SophosReceiptCounts }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {([['Last 24h', counts.last24h], ['Last 7d', counts.last7d], ['Last 30d', counts.last30d]] as const).map(([label, n]) => (
        <div key={label} className="p-2 border border-border rounded">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold text-foreground">{n}</div>
        </div>
      ))}
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  alert: 'Alert',
  xdr_detection: 'XDR detection',
  siem_event: 'SIEM event',
};

/** Dry-run receipts say what would have happened; errors go through the shared receipt label. */
function receiptResult(r: SophosReceipt): string {
  const described = describeAutoResolveReceipt({
    auto_resolved: true,
    auto_resolve_mode: r.auto_resolve_mode,
    auto_resolve_error: r.auto_resolve_error,
  });
  if (r.auto_resolve_error && described) return described.label;
  // A leftover dry_run_at on an alert a later enabled pass really resolved must not read as a dry run.
  const realResolve = !!r.auto_resolved_at && r.auto_resolve_mode !== 'dry_run';
  if (!realResolve && (r.auto_resolve_mode === 'dry_run' || r.auto_resolve_dry_run_at)) return 'Would resolve';
  return described ? 'Resolved' : '—';
}

function ReceiptsTable({ receipts, empty }: { receipts: SophosReceipt[]; empty: string }) {
  if (receipts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded">
        <Info size={14} className="inline mr-1" />
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground uppercase border-b border-border">
          <tr>
            <th className="text-left p-2">When</th>
            <th className="text-left p-2">Alert</th>
            <th className="text-left p-2">Type</th>
            <th className="text-left p-2">Sev</th>
            <th className="text-left p-2">Result</th>
            <th className="text-left p-2">Test</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={`${r.source_type}-${r.alert_id}`} className="border-b border-border/50">
              <td className="p-2 text-xs font-mono">{fmtTs(r.auto_resolved_at ?? r.auto_resolve_dry_run_at)}</td>
              <td className="p-2 truncate max-w-[240px]" title={r.alert_title}>{r.alert_title || r.alert_id}</td>
              <td className="p-2 text-xs">{r.source_type ? SOURCE_TYPE_LABELS[r.source_type] ?? r.source_type : '—'}</td>
              <td className="p-2 text-xs">{r.severity}</td>
              <td className={`p-2 text-xs ${r.auto_resolve_error ? 'text-destructive' : ''}`}>{receiptResult(r)}</td>
              <td className="p-2 font-mono text-xs" title={r.achilles_test_uuid ?? ''}>{r.achilles_test_uuid ? r.achilles_test_uuid.slice(0, 8) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
