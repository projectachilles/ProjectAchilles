// Defender auto-resolve settings section (Wave 7).
//
// Mounts inside the existing Defender integration card once Defender is
// configured. Three-state mode selector, permission-warning banner for
// non-disabled modes, stats strip, and a recent-receipts table.

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import {
  integrationsApi,
  type AutoResolveMode,
  type AutoResolveStatus,
  type AutoResolveReceipt,
} from '@/services/api/integrations';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

const RECEIPT_PAGE_SIZE = 20;

export function DefenderAutoResolveSection() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<AutoResolveStatus | null>(null);
  const [receipts, setReceipts] = useState<AutoResolveReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResp, receiptsResp] = await Promise.all([
        integrationsApi.getAutoResolveStatus(),
        integrationsApi.getAutoResolveReceipts(RECEIPT_PAGE_SIZE, 0),
      ]);
      setStatus(statusResp);
      setReceipts(receiptsResp.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auto-resolve status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadData();
  }, [expanded, loadData]);

  const handleModeChange = async (newMode: AutoResolveMode) => {
    if (!status || newMode === status.mode) return;
    setSaving(true);
    setError(null);
    try {
      await integrationsApi.setAutoResolveMode(newMode);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Backend returns 400 with a descriptive error when Defender isn't
      // configured or when the scope grant is missing on the Azure app.
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground hover:text-primary"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>Alert auto-resolution</span>
        {status && status.mode !== 'disabled' && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
            {status.mode === 'dry_run' ? 'Dry-run' : 'Enabled'}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading…
            </div>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}

          {status && (
            <>
              <ModeSelector
                currentMode={status.mode}
                onChange={handleModeChange}
                disabled={saving}
              />

              {status.mode !== 'disabled' && (
                <Alert variant="default" className="text-sm">
                  <AlertTriangle size={16} className="inline mr-1" />
                  Auto-resolve requires <code className="font-mono text-xs">SecurityAlert.ReadWrite.All</code> granted
                  to your Azure AD app registration (in addition to the read-only scopes already in use). If a PATCH
                  returns 403, the pass halts cleanly until consent is granted.
                </Alert>
              )}

              <StatsStrip counts={status.counts} />

              <ReceiptsTable receipts={receipts} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

interface ModeSelectorProps {
  currentMode: AutoResolveMode;
  onChange: (mode: AutoResolveMode) => void;
  disabled: boolean;
}

function ModeSelector({ currentMode, onChange, disabled }: ModeSelectorProps) {
  const modes: Array<{ value: AutoResolveMode; label: string; description: string }> = [
    {
      value: 'disabled',
      label: 'Disabled',
      description: 'No alerts are auto-resolved. Default for all customers.',
    },
    {
      value: 'dry_run',
      label: 'Dry-run',
      description: 'Log what would be resolved without calling Microsoft Graph. Recommended for a 7-day trial.',
    },
    {
      value: 'enabled',
      label: 'Enabled',
      description: 'Programmatically resolve correlated alerts in Microsoft Defender.',
    },
  ];

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground mb-2">Mode</legend>
      {modes.map((m) => (
        <label
          key={m.value}
          className="flex items-start gap-3 p-3 border border-border rounded cursor-pointer hover:bg-muted/30"
        >
          <input
            type="radio"
            name="auto-resolve-mode"
            value={m.value}
            checked={currentMode === m.value}
            onChange={() => onChange(m.value)}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">{m.label}</div>
            <div className="text-xs text-muted-foreground">{m.description}</div>
          </div>
        </label>
      ))}
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────

interface StatsStripProps {
  counts: { last24h: number; last7d: number; last30d: number };
}

function StatsStrip({ counts }: StatsStripProps) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {([
        ['Last 24h', counts.last24h],
        ['Last 7d', counts.last7d],
        ['Last 30d', counts.last30d],
      ] as const).map(([label, n]) => (
        <div key={label} className="p-2 border border-border rounded">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold text-foreground">{n}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

interface ReceiptsTableProps {
  receipts: AutoResolveReceipt[];
}

function ReceiptsTable({ receipts }: ReceiptsTableProps) {
  if (receipts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded">
        <Info size={14} className="inline mr-1" />
        No auto-resolve receipts yet. They appear here once correlated alerts are processed.
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
            <th className="text-left p-2">Sev</th>
            <th className="text-left p-2">Mode</th>
            <th className="text-left p-2">Test</th>
            <th className="text-left p-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.alert_id} className="border-b border-border/50">
              <td className="p-2 text-xs font-mono">
                {r.auto_resolved_at ? new Date(r.auto_resolved_at).toISOString().slice(0, 19).replace('T', ' ') : '—'}
              </td>
              <td className="p-2 truncate max-w-[240px]" title={r.alert_title}>
                {r.alert_title || r.alert_id}
              </td>
              <td className="p-2">
                <span className={severityClass(r.severity)}>{r.severity}</span>
              </td>
              <td className="p-2">
                <span className={modeBadgeClass(r.auto_resolve_mode)}>
                  {r.auto_resolve_mode ?? '—'}
                </span>
              </td>
              <td className="p-2 font-mono text-xs truncate max-w-[160px]" title={r.achilles_test_uuid ?? ''}>
                {r.achilles_test_uuid ? r.achilles_test_uuid.slice(0, 8) : '—'}
              </td>
              <td className="p-2 text-xs text-destructive">{r.auto_resolve_error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function severityClass(sev: string): string {
  switch (sev?.toLowerCase()) {
    case 'high': return 'text-destructive font-medium';
    case 'medium': return 'text-orange-500 font-medium';
    case 'low': return 'text-yellow-500';
    default: return 'text-muted-foreground';
  }
}

function modeBadgeClass(mode: AutoResolveMode | null): string {
  if (mode === 'enabled') return 'text-green-600 font-medium';
  if (mode === 'dry_run') return 'text-blue-500 font-medium';
  return 'text-muted-foreground';
}
