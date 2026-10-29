import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, ExternalLink, Unlink, RefreshCw } from 'lucide-react';
import { sophosApi } from '@/services/api/sophos';
import { sophosAnalyticsApi } from '@/services/api/sophosAnalytics';
import type {
  SophosPermissionMode,
  SophosCapabilities,
  SophosCapabilityState,
  SophosSyncGap,
  SophosSyncStatus,
} from '@/services/api/sophos';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { SophosAutoResolveSection } from './SophosAutoResolveSection';

const MODE_OPTIONS = [
  { value: 'read_only', label: 'Read-only — extract alerts only' },
  { value: 'response', label: 'Response — read + opt-in auto-resolve' },
];

const CAPABILITY_LABELS: Array<{ key: keyof SophosCapabilities; label: string }> = [
  { key: 'alerts', label: 'Alerts' },
  { key: 'siem', label: 'SIEM events' },
  { key: 'xdr_graphql', label: 'XDR detections (GraphQL)' },
  { key: 'xdr_rest', label: 'XDR detections (REST)' },
  { key: 'health_check', label: 'Account Health Check' },
];

export const CAPABILITY_STATE_TEXT: Record<SophosCapabilityState, string> = {
  available: 'Available',
  not_licensed: 'Not licensed',
  forbidden: "This credential's role can't read it",
  unknown: 'Unknown (see sync status)',
};

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'never');

interface TestResult {
  success: boolean;
  message: string;
  region?: string;
  capabilities?: SophosCapabilities;
}

interface SophosConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function SophosConfig({ onStatusChange }: SophosConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [secretSet, setSecretSet] = useState(false);
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<SophosPermissionMode>('read_only');
  const [savedMode, setSavedMode] = useState<SophosPermissionMode>('read_only');
  const [pollMinutes, setPollMinutes] = useState('5');
  const [backfillDays, setBackfillDays] = useState('30');

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [syncGap, setSyncGap] = useState<SophosSyncGap | null>(null);

  const [syncStatus, setSyncStatus] = useState<SophosSyncStatus | null>(null);
  const [indexedAlerts, setIndexedAlerts] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refreshRuntime = useCallback(async () => {
    const [status, total, settings] = await Promise.all([
      sophosApi.getSyncStatus().catch(() => null),
      sophosAnalyticsApi.getAlerts({ pageSize: 1 }).then((r) => r.total).catch(() => null),
      sophosApi.getSettings().catch(() => null),
    ]);
    if (!mounted.current) return;
    setSyncStatus(status);
    setIndexedAlerts(total);
    setSyncGap(status?.syncGap ?? settings?.sync_gap ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await sophosApi.getSettings();
        if (s.configured) {
          setEditMode(true);
          setClientId(s.client_id ?? '');
          setSecretSet(!!s.client_secret_set);
          setLabel(s.label ?? '');
          setEnvConfigured(s.env_configured ?? false);
          setMode(s.permission_mode ?? 'read_only');
          setSavedMode(s.permission_mode ?? 'read_only');
          setPollMinutes(String(s.poll_interval_minutes ?? 5));
          setBackfillDays(String(s.detection_backfill_days ?? 30));
          setSyncGap(s.sync_gap ?? null);
          onStatusChange?.(true);
          refreshRuntime();
        } else {
          setEnvConfigured(s.env_configured ?? false);
          onStatusChange?.(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Sophos settings');
        onStatusChange?.(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [onStatusChange, refreshRuntime]);

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      const result = await sophosApi.testConnection({ client_id: clientId || undefined, client_secret: clientSecret || undefined });
      if (result.success) {
        setTestResult({ success: true, message: 'Connection successful', region: result.region, capabilities: result.capabilities });
      } else {
        setTestResult({ success: false, message: result.error || 'Connection test failed' });
      }
      return result.success;
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Connection test failed' });
      return false;
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      if (!testResult?.success && !(await handleTestConnection())) return;

      await sophosApi.saveSettings({
        client_id: clientId || undefined,
        client_secret: clientSecret || undefined,
        label: label || undefined,
        permission_mode: mode,
        poll_interval_minutes: Number(pollMinutes) || 5,
        detection_backfill_days: Math.min(Math.max(Number(backfillDays) || 30, 1), 90),
      });
      setEditMode(true);
      setSavedMode(mode);
      if (clientSecret) setSecretSet(true);
      setClientSecret('');
      setSuccessMessage('Sophos settings saved — alert sync started.');
      onStatusChange?.(true);
      setTimeout(refreshRuntime, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async (reset: boolean) => {
    try {
      setSyncing(true);
      setError(null);
      const started = await sophosApi.triggerSync(reset);
      if (!started.started && reset) setError('A sync is already running; re-backfill was not started. Try again when it finishes.');
      await sophosApi.waitForSync({ isCancelled: () => !mounted.current, onStatus: setSyncStatus });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      if (mounted.current) {
        setSyncing(false);
        refreshRuntime();
      }
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      setError(null);
      await sophosApi.deleteSettings();
      setEditMode(false);
      setClientId('');
      setClientSecret('');
      setSecretSet(false);
      setLabel('');
      setMode('read_only');
      setSavedMode('read_only');
      setTestResult(null);
      setSuccessMessage(null);
      setShowDisconnectConfirm(false);
      setSyncStatus(null);
      setIndexedAlerts(null);
      setSyncGap(null);
      onStatusChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const isValid = editMode ? true : !!(clientId && clientSecret);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {envConfigured && (
        <Alert variant="default">
          <div>
            <p className="font-medium">Environment variable configuration detected</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sophos credentials are set via environment variables (SOPHOS_CLIENT_ID, SOPHOS_CLIENT_SECRET). Remove them to manage the credential here.
            </p>
          </div>
        </Alert>
      )}

      {editMode && !envConfigured && (
        <Alert variant="default">
          <div>
            <p className="font-medium">Editing existing configuration</p>
            <p className="text-sm text-muted-foreground mt-1">
              Leave the client secret blank to keep the current one. The saved secret is only used with the saved client ID; enter a new secret when you change the client ID.
            </p>
          </div>
        </Alert>
      )}

      {syncGap && (
        <Alert variant="destructive">
          Sophos events between {fmt(syncGap.from)} and {fmt(syncGap.to)} were not collected (Sophos keeps 24 hours).
        </Alert>
      )}

      {successMessage && <Alert variant="success">{successMessage}</Alert>}

      <Input
        label="Client ID"
        placeholder="Sophos Central API credential client ID"
        value={clientId}
        onChange={(e) => { setClientId(e.target.value.trim()); setTestResult(null); }}
        helperText="Sophos Central → Global Settings → Access Control → API Credentials. The data region is discovered automatically."
      />
      <Input
        label="Client secret"
        type="password"
        placeholder={secretSet ? 'Leave blank to keep current' : 'Client secret'}
        value={clientSecret}
        onChange={(e) => { setClientSecret(e.target.value.trim()); setTestResult(null); }}
        helperText={secretSet
          ? 'A secret is set. Stored encrypted (AES-256-GCM); never shown again or logged.'
          : 'Stored encrypted (AES-256-GCM); never shown again or logged.'}
      />
      <Input label="Label (optional)" placeholder="e.g. Production tenant" value={label} onChange={(e) => setLabel(e.target.value)} />

      <Select
        label="Permission mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as SophosPermissionMode)}
        options={MODE_OPTIONS}
      />
      <p className="text-xs text-muted-foreground -mt-4">
        {mode === 'read_only'
          ? 'Only read requests are made. Every write is blocked server-side.'
          : 'Allows the opt-in auto-resolve pass below to acknowledge alerts and resolve XDR detections in Sophos Central. It stays off until you enable it.'}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Input label="Polling interval (minutes)" type="number" min={1} max={1440} value={pollMinutes} onChange={(e) => setPollMinutes(e.target.value)} />
        <Input
          label="Initial detection backfill (days)"
          type="number"
          min={1}
          max={90}
          value={backfillDays}
          onChange={(e) => setBackfillDays(e.target.value)}
          helperText="Max 90"
        />
      </div>

      <div className="rounded-lg bg-raised/50 p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-card-foreground">Required Sophos Central role</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><span className="font-medium">Read-only:</span> an API credential with the <span className="font-mono text-xs">Service Principal Read-Only</span> role</li>
          <li><span className="font-medium">Response:</span> <span className="font-mono text-xs">Service Principal Management</span> (or Super Admin), so alerts can be acknowledged and detections resolved</li>
        </ul>
        <a
          href="https://developer.sophos.com/getting-started"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
        >
          Sophos Central API reference
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {testResult && (
        <Alert variant={testResult.success ? 'success' : 'destructive'}>
          <div>
            <p>{testResult.message}{testResult.region ? ` — region ${testResult.region}` : ''}</p>
            {testResult.capabilities && (
              <ul className="mt-2 space-y-1 text-sm">
                {CAPABILITY_LABELS.map(({ key, label: capLabel }) => (
                  <li key={key} className="flex justify-between gap-4">
                    <span>{capLabel}</span>
                    <span>{CAPABILITY_STATE_TEXT[testResult.capabilities![key]] ?? CAPABILITY_STATE_TEXT.unknown}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTestConnection} disabled={!(clientId || editMode) || testing}>
          {testing ? <><Spinner size="sm" /> Testing...</> : <><CheckCircle className="w-4 h-4" /> Test Connection</>}
        </Button>
        <Button onClick={handleSave} disabled={!isValid || saving || envConfigured}>
          {saving ? <><Spinner size="sm" /> {editMode ? 'Updating...' : 'Saving...'}</> : editMode ? 'Update Settings' : 'Save Settings'}
        </Button>
      </div>

      {editMode && (
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Alert sync</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleSyncNow(false)} disabled={syncing}>
                {syncing ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />} Sync now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleSyncNow(true)} disabled={syncing} title="Clear checkpoints and re-run the initial backfill">
                Re-backfill
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              SIEM checkpoint: {fmt(syncStatus?.lastSiemSync)} · Alerts: {fmt(syncStatus?.lastAlertSync)} · XDR detections: {fmt(syncStatus?.lastDetectionSync)}
            </p>
            <p>Last attempt: {fmt(syncStatus?.lastAttemptAt)}{syncStatus?.inProgress ? ' (running…)' : ''}</p>
            {indexedAlerts !== null && <p>Indexed in Elasticsearch (achilles-sophos): {indexedAlerts} alert(s). Browse them in Analytics → Sophos.</p>}
          </div>
          {syncStatus?.lastError && <Alert variant="destructive">{syncStatus.lastError.stage}: {syncStatus.lastError.message}</Alert>}
        </div>
      )}

      {editMode && <SophosAutoResolveSection permissionMode={savedMode} />}

      {editMode && (
        <div className="border-t border-border pt-4 mt-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Disconnect Integration</p>
              <p className="text-xs text-muted-foreground">
                {envConfigured
                  ? 'Credentials come from environment variables; remove them there to disconnect.'
                  : 'Remove stored credentials. Sophos data in Elasticsearch will be preserved.'}
              </p>
            </div>
            {!showDisconnectConfirm ? (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" disabled={envConfigured} onClick={() => setShowDisconnectConfirm(true)}>
                <Unlink className="w-4 h-4" />
                Disconnect
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowDisconnectConfirm(false)} disabled={disconnecting}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? <><Spinner size="sm" /> Disconnecting...</> : 'Confirm Disconnect'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
