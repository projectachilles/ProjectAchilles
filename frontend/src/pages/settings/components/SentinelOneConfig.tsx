import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, Info, ExternalLink, Unlink, RefreshCw } from 'lucide-react';
import { sentinelOneApi } from '@/services/api/sentinelone';
import { sentineloneAnalyticsApi } from '@/services/api/sentineloneAnalytics';
import type {
  SentinelOnePermissionMode,
  SentinelOneSource,
  SentinelOneSeverity,
  SentinelOneIncidentStatus,
  SentinelOneSyncStatus,
  SentinelOneAuditRecord,
} from '@/services/api/sentinelone';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Checkbox } from '@/components/shared/ui/Checkbox';
import { SentinelOneAutoResolveSection, SentinelOneAutoMitigationSection } from './SentinelOneAutomationSections';

const MODE_OPTIONS = [
  { value: 'read_only', label: 'Read-only — extract alerts only' },
  { value: 'response', label: 'Response — read + opt-in auto-resolve / automatic mitigation' },
];

const SOURCE_OPTIONS: Array<{ value: SentinelOneSource; label: string }> = [
  { value: 'threats', label: 'Threats (/threats)' },
  { value: 'cloud_detection_alerts', label: 'Detection alerts (/cloud-detection/alerts)' },
];

const SEVERITY_OPTIONS: SentinelOneSeverity[] = ['critical', 'high', 'medium', 'low', 'informational'];
const STATUS_OPTIONS: SentinelOneIncidentStatus[] = ['unresolved', 'in_progress', 'resolved'];

/** "1, 2\n3" → ["1","2","3"] */
const parseIds = (value: string): string[] => value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'never');

interface SentinelOneConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function SentinelOneConfig({ onStatusChange }: SentinelOneConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<SentinelOnePermissionMode>('read_only');
  const [savedMode, setSavedMode] = useState<SentinelOnePermissionMode>('read_only');
  const [pollMinutes, setPollMinutes] = useState('5');
  const [backfillDays, setBackfillDays] = useState('365');
  const [sources, setSources] = useState<SentinelOneSource[]>(['threats', 'cloud_detection_alerts']);
  const [accountIds, setAccountIds] = useState('');
  const [siteIds, setSiteIds] = useState('');
  const [groupIds, setGroupIds] = useState('');
  const [severities, setSeverities] = useState<SentinelOneSeverity[]>([]);
  const [statuses, setStatuses] = useState<SentinelOneIncidentStatus[]>([]);

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const [syncStatus, setSyncStatus] = useState<SentinelOneSyncStatus | null>(null);
  const [indexedAlerts, setIndexedAlerts] = useState<number | null>(null);
  const [history, setHistory] = useState<SentinelOneAuditRecord[]>([]);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refreshRuntime = useCallback(async () => {
    const [status, latest, audit] = await Promise.all([
      sentinelOneApi.getSyncStatus().catch(() => null),
      sentineloneAnalyticsApi.getAlerts({ pageSize: 1 }).then((r) => r.total).catch(() => null),
      sentinelOneApi.getActionHistory(10).catch(() => []),
    ]);
    setSyncStatus(status);
    setIndexedAlerts(latest);
    setHistory(audit);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await sentinelOneApi.getSettings();
        if (s.configured) {
          setEditMode(true);
          setBaseUrl(s.base_url ?? '');
          setLabel(s.label ?? '');
          setEnvConfigured(s.env_configured ?? false);
          setMode(s.permission_mode ?? 'read_only');
          setSavedMode(s.permission_mode ?? 'read_only');
          setPollMinutes(String(s.poll_interval_minutes ?? 5));
          setBackfillDays(String(s.backfill_days ?? 365));
          setSources(s.sources ?? ['threats', 'cloud_detection_alerts']);
          setAccountIds((s.scope?.account_ids ?? []).join(', '));
          setSiteIds((s.scope?.site_ids ?? []).join(', '));
          setGroupIds((s.scope?.group_ids ?? []).join(', '));
          setSeverities(s.filters?.severities ?? []);
          setStatuses(s.filters?.incident_statuses ?? []);
          onStatusChange?.(true);
          refreshRuntime();
        } else {
          onStatusChange?.(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load SentinelOne settings');
        onStatusChange?.(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [onStatusChange, refreshRuntime]);

  const scope = () => ({
    account_ids: parseIds(accountIds),
    site_ids: parseIds(siteIds),
    group_ids: parseIds(groupIds),
  });

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      const { group_ids: _ignored, ...testScope } = scope();
      const result = await sentinelOneApi.testConnection({ base_url: baseUrl || undefined, api_token: apiToken || undefined, scope: testScope });
      setTestResult({ success: result.success, message: result.success ? (result.message ?? 'Connection successful') : (result.error ?? 'Connection test failed') });
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

      await sentinelOneApi.saveSettings({
        base_url: baseUrl || undefined,
        api_token: apiToken || undefined,
        label: label || undefined,
        permission_mode: mode,
        poll_interval_minutes: Number(pollMinutes) || 5,
        backfill_days: Math.min(Math.max(Number(backfillDays) || 365, 1), 365),
        sources,
        scope: scope(),
        filters: { severities, incident_statuses: statuses },
      });
      setEditMode(true);
      setSavedMode(mode);
      setApiToken('');
      setSuccessMessage('SentinelOne settings saved — alert sync started.');
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
      const started = await sentinelOneApi.triggerSync(reset);
      if (!started.started && reset) setError('A sync is already running; re-backfill was not started. Try again when it finishes.');
      // The sync runs in the background (a backfill can take minutes): poll its status.
      await sentinelOneApi.waitForSync({ isCancelled: () => !mounted.current, onStatus: setSyncStatus });
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
      await sentinelOneApi.deleteSettings();
      setEditMode(false);
      setBaseUrl('');
      setApiToken('');
      setLabel('');
      setMode('read_only');
      setSavedMode('read_only');
      setTestResult(null);
      setSuccessMessage(null);
      setShowDisconnectConfirm(false);
      setSyncStatus(null);
      setIndexedAlerts(null);
      onStatusChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const isValid = editMode ? sources.length > 0 : !!(baseUrl && apiToken && sources.length > 0);

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
          <Info className="w-4 h-4" />
          <div>
            <p className="font-medium">Environment variable configuration detected</p>
            <p className="text-sm text-muted-foreground mt-1">
              SentinelOne credentials are set via environment variables. Settings saved here will take priority.
            </p>
          </div>
        </Alert>
      )}

      {editMode && !envConfigured && (
        <Alert variant="default">
          <Info className="w-4 h-4" />
          <div>
            <p className="font-medium">Editing existing configuration</p>
            <p className="text-sm text-muted-foreground mt-1">Leave the API token blank to keep the current one.</p>
          </div>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      <Input
        label="Console URL"
        placeholder="https://<tenant>.sentinelone.net"
        value={baseUrl}
        onChange={(e) => { setBaseUrl(e.target.value.trim()); setTestResult(null); }}
        helperText="Your SentinelOne management console (*.sentinelone.net or *.s1gov.net)"
      />
      <Input
        label="API Token"
        type="password"
        placeholder={editMode ? 'Leave blank to keep current' : 'Settings → Users → Service Users → API token'}
        value={apiToken}
        onChange={(e) => { setApiToken(e.target.value.trim()); setTestResult(null); }}
        helperText="Stored encrypted (AES-256-GCM); never shown again or logged. Sent as Authorization: ApiToken <token>."
      />
      <Input label="Label (optional)" placeholder="e.g. Production console" value={label} onChange={(e) => setLabel(e.target.value)} />

      <Select
        label="Permission mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as SentinelOnePermissionMode)}
        options={MODE_OPTIONS}
      />
      <p className="text-xs text-muted-foreground -mt-4">
        {mode === 'read_only'
          ? 'Only GET requests are made. Every write is blocked server-side.'
          : 'Allows the opt-in auto-resolve and automatic mitigation passes below to write to the console. Both stay off until you enable them, and every mitigation is audited.'}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Input label="Polling interval (minutes)" type="number" min={1} max={1440} value={pollMinutes} onChange={(e) => setPollMinutes(e.target.value)} />
        <Input
          label="Initial backfill (days)"
          type="number"
          min={1}
          max={365}
          value={backfillDays}
          onChange={(e) => setBackfillDays(e.target.value)}
          helperText="Max 365 (console retention)"
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Data sources</p>
        {SOURCE_OPTIONS.map((s) => (
          <div key={s.value}>
            <Checkbox id={`s1-src-${s.value}`} label={s.label} checked={sources.includes(s.value)} onChange={() => setSources(toggle(sources, s.value))} />
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-raised/50 p-4 space-y-4">
        <p className="text-sm font-medium text-card-foreground">Segmentation (optional)</p>
        <Input label="Account IDs" placeholder="Comma-separated; empty = all accessible accounts" value={accountIds} onChange={(e) => setAccountIds(e.target.value)} />
        <Input label="Site IDs" placeholder="Comma-separated" value={siteIds} onChange={(e) => setSiteIds(e.target.value)} />
        <Input label="Group IDs" placeholder="Comma-separated" value={groupIds} onChange={(e) => setGroupIds(e.target.value)} />
        <div>
          <p className="text-sm font-medium mb-1.5 text-foreground">Severities (empty = all)</p>
          <div className="flex flex-wrap gap-4">
            {SEVERITY_OPTIONS.map((s) => (
              <Checkbox key={s} id={`s1-sev-${s}`} label={s} checked={severities.includes(s)} onChange={() => setSeverities(toggle(severities, s))} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-1.5 text-foreground">Incident status (empty = all)</p>
          <div className="flex flex-wrap gap-4">
            {STATUS_OPTIONS.map((s) => (
              <Checkbox key={s} id={`s1-st-${s}`} label={s} checked={statuses.includes(s)} onChange={() => setStatuses(toggle(statuses, s))} />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-raised/50 p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-card-foreground">Required SentinelOne role</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><span className="font-medium">Read-only:</span> a service user with the <span className="font-mono text-xs">Viewer</span> role on the accounts/sites in scope</li>
          <li><span className="font-medium">Response:</span> a role allowing incident status changes and threat mitigation (e.g. <span className="font-mono text-xs">IR Team</span> / <span className="font-mono text-xs">SOC</span>)</li>
        </ul>
        <a
          href="https://usea1-partners.sentinelone.net/api-doc/overview"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
        >
          SentinelOne API v2.1 reference
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {testResult && <Alert variant={testResult.success ? 'success' : 'destructive'}>{testResult.message}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTestConnection} disabled={!(baseUrl || editMode) || testing}>
          {testing ? <><Spinner size="sm" /> Testing...</> : <><CheckCircle className="w-4 h-4" /> Test Connection</>}
        </Button>
        <Button onClick={handleSave} disabled={!isValid || saving}>
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
            <p>Threats checkpoint: {fmt(syncStatus?.lastThreatSync)} · Alerts checkpoint: {fmt(syncStatus?.lastAlertSync)}</p>
            <p>Last attempt: {fmt(syncStatus?.lastAttemptAt)}{syncStatus?.inProgress ? ' (running…)' : ''}</p>
            {syncStatus?.lastSyncResult?.threats && (
              <p>Threats: {syncStatus.lastSyncResult.threats.synced} synced / {syncStatus.lastSyncResult.threats.fetched} fetched ({syncStatus.lastSyncResult.threats.filtered} filtered)</p>
            )}
            {syncStatus?.lastSyncResult?.cloud_detection_alerts && (
              <p>Alerts: {syncStatus.lastSyncResult.cloud_detection_alerts.synced} synced / {syncStatus.lastSyncResult.cloud_detection_alerts.fetched} fetched ({syncStatus.lastSyncResult.cloud_detection_alerts.filtered} filtered)</p>
            )}
            {indexedAlerts !== null && <p>Indexed in Elasticsearch (achilles-sentinelone): {indexedAlerts} alert(s). Browse them in Analytics → SentinelOne.</p>}
          </div>
          {syncStatus?.lastError && <Alert variant="destructive">{syncStatus.lastError.stage}: {syncStatus.lastError.message}</Alert>}
        </div>
      )}

      {editMode && history.length > 0 && (
        <div className="border-t border-border pt-4 text-xs text-muted-foreground space-y-1">
          <p className="text-sm font-medium text-foreground">Mitigation audit</p>
          {history.map((h, i) => (
            <p key={`${h.timestamp}-${i}`}>
              {fmt(h.timestamp)} — {h.action} on {h.target_ids.length} target(s) by {h.requested_by}: <span className={h.outcome === 'success' ? 'text-green-500' : 'text-destructive'}>{h.outcome}</span>
              {h.error ? ` (${h.error})` : ''}
            </p>
          ))}
        </div>
      )}

      {editMode && <SentinelOneAutoResolveSection permissionMode={savedMode} />}
      {editMode && <SentinelOneAutoMitigationSection permissionMode={savedMode} />}

      {editMode && !envConfigured && (
        <div className="border-t border-border pt-4 mt-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Disconnect Integration</p>
              <p className="text-xs text-muted-foreground">Remove stored credentials. SentinelOne data in Elasticsearch will be preserved.</p>
            </div>
            {!showDisconnectConfirm ? (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDisconnectConfirm(true)}>
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
