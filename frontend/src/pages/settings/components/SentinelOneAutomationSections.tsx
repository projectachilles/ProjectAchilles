// SentinelOne automation sections for the S1 integration card:
//  - Alert auto-resolution (mirrors DefenderAutoResolveSection): sets the S1
//    incident status of alerts matched to an Achilles test to "resolved".
//    Never sets an analyst verdict and never mitigates anything.
//  - Automatic mitigation (opt-in, off by default): kill or quarantine
//    unmitigated threats matched to an Achilles test. Only available in
//    Response mode; the backend enforces this independently of the UI.

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Info, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import {
  sentinelOneApi,
  type SentinelOneAutoMode,
  type SentinelOneAutoMitigationAction,
  type SentinelOneAutoResolveStatus,
  type SentinelOneAutoMitigationStatus,
  type SentinelOnePermissionMode,
  type SentinelOneReceipt,
  type SentinelOneReceiptCounts,
} from '@/services/api/sentinelone';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Button } from '@/components/shared/ui/Button';
import { Select } from '@/components/shared/ui/Select';
import { Checkbox } from '@/components/shared/ui/Checkbox';

const RECEIPT_PAGE_SIZE = 20;
const fmtTs = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 19).replace('T', ' ') : '—');
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface SectionProps {
  /** Permission mode as saved on the server (not the unsaved form value). */
  permissionMode: SentinelOnePermissionMode;
}

// ─────────────────────────────────────────────────────────────────────
// Auto-resolve
// ─────────────────────────────────────────────────────────────────────

export function SentinelOneAutoResolveSection({ permissionMode }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<SentinelOneAutoResolveStatus | null>(null);
  const [receipts, setReceipts] = useState<SentinelOneReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        sentinelOneApi.getAutoResolveStatus(),
        sentinelOneApi.getAutoResolveReceipts(RECEIPT_PAGE_SIZE, 0),
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

  const handleModeChange = async (mode: SentinelOneAutoMode) => {
    if (!status || mode === status.mode) return;
    setSaving(true);
    setError(null);
    try {
      await sentinelOneApi.setAutoResolveMode(mode);
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
            Marks the SentinelOne incident status as <span className="font-mono">resolved</span> for unresolved threats and
            detection alerts that were matched to an Achilles test and are inside the configured scope. Threats also get a note
            naming the test. It does not set an analyst verdict and does not kill, quarantine or remediate anything.
          </p>
          {status && (
            <>
              <ModeSelector
                name="s1-auto-resolve-mode"
                currentMode={status.mode}
                onChange={handleModeChange}
                disabled={saving}
                enabledLocked={!responseMode}
                descriptions={{
                  disabled: 'Nothing is resolved. Default (same as Defender).',
                  dry_run: 'Log and record what would be resolved without calling SentinelOne.',
                  enabled: 'Resolve the incident status of matched alerts in SentinelOne.',
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
                  The service user needs permission to change threat and alert incident status. If SentinelOne returns 401/403,
                  the pass stops until the role is fixed.
                </Alert>
              )}
              <StatsStrip counts={status.counts} />
              <ReceiptsTable
                receipts={receipts}
                at={(r) => r.auto_resolved_at}
                mode={(r) => r.auto_resolve_mode}
                error={(r) => r.auto_resolve_error}
                empty="No auto-resolve receipts yet. They appear once matched alerts are processed."
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Automatic mitigation
// ─────────────────────────────────────────────────────────────────────

const ACTION_OPTIONS: Array<{ value: SentinelOneAutoMitigationAction; label: string }> = [
  { value: 'kill', label: 'Kill (stop the process)' },
  { value: 'quarantine', label: 'Quarantine (stop + move the file)' },
];

export function SentinelOneAutoMitigationSection({ permissionMode }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<SentinelOneAutoMitigationStatus | null>(null);
  const [receipts, setReceipts] = useState<SentinelOneReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        sentinelOneApi.getAutoMitigationStatus(),
        sentinelOneApi.getAutoMitigationReceipts(RECEIPT_PAGE_SIZE, 0),
      ]);
      setStatus(s);
      setReceipts(r.items);
    } catch (err) {
      setError(errMsg(err) || 'Failed to load automatic mitigation status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadData();
  }, [expanded, loadData, permissionMode]);

  const save = async (update: { mode?: SentinelOneAutoMode; action?: SentinelOneAutoMitigationAction }) => {
    setSaving(true);
    setError(null);
    try {
      await sentinelOneApi.setAutoMitigation(update);
      setPendingEnable(false);
      setAcknowledged(false);
      await loadData();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const handleModeChange = (mode: SentinelOneAutoMode) => {
    if (!status || mode === status.mode) return;
    if (mode === 'enabled') {
      // Turning real mitigation on needs an explicit acknowledgement.
      setPendingEnable(true);
      return;
    }
    setPendingEnable(false);
    void save({ mode });
  };

  const responseMode = permissionMode === 'response';
  const on = status && status.mode !== 'disabled';

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground hover:text-primary"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>Automatic mitigation</span>
        {on ? <ModeBadge mode={status!.mode} /> : <span className="ml-2 text-xs text-muted-foreground font-normal">Off</span>}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Loading…</div>}
          {error && <Alert variant="destructive">{error}</Alert>}

          <Alert variant="destructive" className="text-sm">
            <ShieldAlert size={16} className="inline mr-1" />
            <span>
              <span className="font-medium">This acts on real endpoints.</span> When enabled, every sync kills or quarantines
              SentinelOne threats that SentinelOne itself left unmitigated (detect mode) and that were matched to an Achilles test
              inside the configured scope — up to 10 per sync. A wrong match stops a real process. Try dry run first and check the
              receipts. Remediate, rollback and network isolation are never automatic.
            </span>
          </Alert>

          {!responseMode && (
            <p className="text-xs text-muted-foreground">
              <Info size={12} className="inline mr-1" />
              Available only in Response mode. In read-only mode it is off and the backend refuses to turn it on.
            </p>
          )}

          {status && (
            <>
              <div className="max-w-sm">
                <Select
                  label="Action"
                  value={status.action}
                  onChange={(e) => void save({ action: e.target.value as SentinelOneAutoMitigationAction })}
                  options={ACTION_OPTIONS}
                  disabled={saving}
                />
              </div>
              <ModeSelector
                name="s1-auto-mitigation-mode"
                currentMode={pendingEnable ? 'enabled' : status.mode}
                onChange={handleModeChange}
                disabled={saving || !responseMode}
                descriptions={{
                  disabled: 'No automatic mitigation. Default.',
                  dry_run: 'Log and record which threats would be mitigated, without calling SentinelOne.',
                  enabled: `Automatically ${status.action} matched, unmitigated threats in SentinelOne.`,
                }}
              />
              {pendingEnable && (
                <div className="rounded border border-destructive/40 p-3 space-y-3">
                  <Checkbox
                    id="s1-auto-mitigation-ack"
                    label={`I understand Achilles will ${status.action} matched threats on real endpoints without asking.`}
                    checked={acknowledged}
                    onChange={() => setAcknowledged((v) => !v)}
                  />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setPendingEnable(false); setAcknowledged(false); }} disabled={saving}>Cancel</Button>
                    <Button variant="destructive" size="sm" onClick={() => void save({ mode: 'enabled' })} disabled={!acknowledged || saving}>
                      {saving ? <Spinner size="sm" /> : null} Enable automatic mitigation
                    </Button>
                  </div>
                </div>
              )}
              <StatsStrip counts={status.counts} />
              <ReceiptsTable
                receipts={receipts}
                at={(r) => r.auto_mitigated_at}
                mode={(r) => r.auto_mitigation_mode}
                error={(r) => r.auto_mitigation_error}
                extra={(r) => r.auto_mitigation_action ?? '—'}
                extraLabel="Action"
                empty="No automatic mitigation receipts yet."
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: SentinelOneAutoMode }) {
  return (
    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
      {mode === 'dry_run' ? 'Dry-run' : 'Enabled'}
    </span>
  );
}

interface ModeSelectorProps {
  name: string;
  currentMode: SentinelOneAutoMode;
  onChange: (mode: SentinelOneAutoMode) => void;
  disabled: boolean;
  enabledLocked?: boolean;
  descriptions: Record<SentinelOneAutoMode, string>;
}

function ModeSelector({ name, currentMode, onChange, disabled, enabledLocked, descriptions }: ModeSelectorProps) {
  const modes: Array<{ value: SentinelOneAutoMode; label: string }> = [
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

function StatsStrip({ counts }: { counts: SentinelOneReceiptCounts }) {
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

interface ReceiptsTableProps {
  receipts: SentinelOneReceipt[];
  at: (r: SentinelOneReceipt) => string | null | undefined;
  mode: (r: SentinelOneReceipt) => SentinelOneAutoMode | null | undefined;
  error: (r: SentinelOneReceipt) => string | null | undefined;
  extra?: (r: SentinelOneReceipt) => string;
  extraLabel?: string;
  empty: string;
}

function ReceiptsTable({ receipts, at, mode, error, extra, extraLabel, empty }: ReceiptsTableProps) {
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
            <th className="text-left p-2">Mode</th>
            {extra && <th className="text-left p-2">{extraLabel}</th>}
            <th className="text-left p-2">Test</th>
            <th className="text-left p-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={`${r.source_type}-${r.alert_id}`} className="border-b border-border/50">
              <td className="p-2 text-xs font-mono">{fmtTs(at(r))}</td>
              <td className="p-2 truncate max-w-[240px]" title={r.alert_title}>{r.alert_title || r.alert_id}</td>
              <td className="p-2 text-xs">{r.source_type === 'cloud_detection_alerts' ? 'Detection alert' : 'Threat'}</td>
              <td className="p-2 text-xs">{r.severity}</td>
              <td className="p-2 text-xs">{mode(r) ?? '—'}</td>
              {extra && <td className="p-2 text-xs">{extra(r)}</td>}
              <td className="p-2 font-mono text-xs" title={r.achilles_test_uuid ?? ''}>{r.achilles_test_uuid ? r.achilles_test_uuid.slice(0, 8) : '—'}</td>
              <td className="p-2 text-xs text-destructive">{error(r) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
