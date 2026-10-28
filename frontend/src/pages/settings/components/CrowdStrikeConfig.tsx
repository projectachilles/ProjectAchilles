import { useState, useEffect } from 'react';
import { CheckCircle, ExternalLink, Unlink } from 'lucide-react';
import { integrationsApi } from '@/services/api/integrations';
import type { CrowdStrikeRegion } from '@/services/api/integrations';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { CrowdStrikeAutoResolveSection } from './CrowdStrikeAutoResolveSection';

// Server-side region→URL mirror (display-only helper text). The backend
// resolves API URLs from its own constant region map — custom base URLs are
// intentionally not configurable (SSRF hardening); the masked settings GET
// returns a derived `base_url` for display.
const REGION_BASE_URLS: Record<CrowdStrikeRegion, string> = {
  'us-1': 'https://api.crowdstrike.com',
  'us-2': 'https://api.us-2.crowdstrike.com',
  'eu-1': 'https://api.eu-1.crowdstrike.com',
  'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
};

const REGION_OPTIONS = [
  { value: 'us-1', label: 'US-1 (default)' },
  { value: 'us-2', label: 'US-2' },
  { value: 'eu-1', label: 'EU-1' },
  { value: 'us-gov-1', label: 'US Gov (GovCloud)' },
];

interface CrowdStrikeConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function CrowdStrikeConfig({ onStatusChange }: CrowdStrikeConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [region, setRegion] = useState<CrowdStrikeRegion>('us-1');
  const [derivedBaseUrl, setDerivedBaseUrl] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  useEffect(() => {
    loadExistingSettings();
  }, []);

  const loadExistingSettings = async () => {
    try {
      const settings = await integrationsApi.getCrowdStrikeSettings();
      if (settings.configured) {
        setEditMode(true);
        setLabel(settings.label ?? '');
        setEnvConfigured(settings.env_configured ?? false);
        if (settings.region) setRegion(settings.region);
        // Derived display value from the masked GET; falls back to the local
        // region→URL mirror when absent.
        if (settings.base_url) setDerivedBaseUrl(settings.base_url);
        onStatusChange?.(true);
      }
    } catch {
      setEditMode(false);
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = () => ({
    region,
    client_id: clientId || undefined,
    client_secret: clientSecret || undefined,
  });

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      const result = await integrationsApi.testCrowdStrikeConnection(buildPayload());
      setTestResult({
        success: result.success,
        message: result.success ? (result.message ?? 'Connection successful') : (result.error ?? 'Connection test failed'),
      });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      if (!testResult?.success) {
        setTestResult(null);
        const result = await integrationsApi.testCrowdStrikeConnection(buildPayload());
        if (!result.success) {
          setTestResult({ success: false, message: result.error ?? 'Connection test failed' });
          setSaving(false);
          return;
        }
        setTestResult({ success: true, message: result.message ?? 'Connection successful' });
      }

      await integrationsApi.saveCrowdStrikeSettings({
        ...buildPayload(),
        label: label || undefined,
      });

      setEditMode(true);
      setSuccessMessage('CrowdStrike credentials saved successfully!');
      onStatusChange?.(true);

      // Clear sensitive fields after save
      setClientId('');
      setClientSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      setError(null);
      await integrationsApi.deleteCrowdStrikeSettings();
      setEditMode(false);
      setRegion('us-1');
      setDerivedBaseUrl(null);
      setClientId('');
      setClientSecret('');
      setLabel('');
      setTestResult(null);
      setSuccessMessage(null);
      setShowDisconnectConfirm(false);
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
      {/* Env override notice */}
      {envConfigured && (
        <Alert variant="default">
          <div>
            <p className="font-medium">Environment variable configuration detected</p>
            <p className="text-sm text-muted-foreground mt-1">
              CrowdStrike credentials are set via environment variables. Settings saved here will take priority.
            </p>
          </div>
        </Alert>
      )}

      {/* Edit mode info banner */}
      {editMode && !envConfigured && (
        <Alert variant="default">
          <div>
            <p className="font-medium">Editing existing configuration</p>
            <p className="text-sm text-muted-foreground mt-1">
              Leave credential fields blank to keep your current credentials.
            </p>
          </div>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          {successMessage}
        </Alert>
      )}

      {/* Cloud / region — region-only; the backend resolves the API base URL
          from a server-side map (custom URLs are not accepted). */}
      <Select
        label="Falcon Cloud"
        value={region}
        onChange={(e) => { setRegion(e.target.value as CrowdStrikeRegion); setDerivedBaseUrl(null); setTestResult(null); }}
        options={REGION_OPTIONS}
      />
      <p className="text-xs text-muted-foreground -mt-4">
        API base URL: <span className="font-mono">{derivedBaseUrl ?? REGION_BASE_URLS[region]}</span>
      </p>

      {/* Core identity fields */}
      <Input
        label="Client ID"
        placeholder={editMode ? 'Leave blank to keep current' : '32-character hex string'}
        value={clientId}
        onChange={(e) => { setClientId(e.target.value.trim()); setTestResult(null); }}
        helperText={editMode ? 'Optional: Only fill in to update' : 'From Falcon → Support → API Clients and Keys'}
      />
      <Input
        label="Client Secret"
        type="password"
        placeholder={editMode ? 'Leave blank to keep current' : 'Client secret value'}
        value={clientSecret}
        onChange={(e) => { setClientSecret(e.target.value); setTestResult(null); }}
        helperText={editMode ? 'Optional: Only fill in to update' : undefined}
      />

      <Input
        label="Label (optional)"
        placeholder="e.g. Contoso Production"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        helperText="User-friendly name for this Falcon tenant (shown in analytics)"
      />

      {/* Required scopes info */}
      <div className="rounded-lg bg-raised/50 p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-card-foreground">Required CrowdStrike API Scopes</p>
        <p>Create an API client in the Falcon console (Support → API Clients and Keys) with these scopes:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><span className="font-mono text-xs">Alerts: read</span> — alert sync and detection correlation</li>
          <li><span className="font-mono text-xs">Alerts: write</span> — auto-resolve of correlated alerts (optional)</li>
          <li><span className="font-mono text-xs">Zero Trust Assessment: read</span> — posture score (optional; requires Falcon Insight licensing)</li>
        </ul>
        <a
          href="https://falcon.crowdstrike.com/documentation/page/a2a7fc0e/crowdstrike-oauth2-based-apis"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
        >
          CrowdStrike OAuth2 API reference
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {testResult && (
        <Alert variant={testResult.success ? 'success' : 'destructive'}>
          {testResult.message}
        </Alert>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTestConnection} disabled={!isValid || testing}>
          {testing ? <><Spinner size="sm" /> Testing...</> : <><CheckCircle className="w-4 h-4" /> Test Connection</>}
        </Button>
        <Button onClick={handleSave} disabled={!isValid || saving}>
          {saving ? (
            <><Spinner size="sm" /> {editMode ? 'Updating...' : 'Saving...'}</>
          ) : editMode ? 'Update Settings' : 'Save Settings'}
        </Button>
      </div>

      {editMode && !envConfigured && (
        <div className="border-t border-border pt-4 mt-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Disconnect Integration</p>
              <p className="text-xs text-muted-foreground">
                Remove stored credentials. CrowdStrike data in Elasticsearch will be preserved.
              </p>
            </div>
            {!showDisconnectConfirm ? (
              <Button variant="outline" size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setShowDisconnectConfirm(true)}>
                <Unlink className="w-4 h-4" />
                Disconnect
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowDisconnectConfirm(false)} disabled={disconnecting}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? <><Spinner size="sm" /> Disconnecting...</> : 'Confirm Disconnect'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {editMode && <CrowdStrikeAutoResolveSection />}
    </div>
  );
}
