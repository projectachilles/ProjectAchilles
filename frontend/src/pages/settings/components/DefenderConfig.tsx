import { useState, useEffect, useRef } from 'react';
import { CheckCircle, Info, ExternalLink, Unlink, Upload, FileKey } from 'lucide-react';
import { integrationsApi } from '@/services/api/integrations';
import type { DefenderAuthMethod } from '@/services/api/integrations';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { DefenderAutoResolveSection } from './DefenderAutoResolveSection';

interface DefenderConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function DefenderConfig({ onStatusChange }: DefenderConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [label, setLabel] = useState('');

  // Auth method
  const [authMethod, setAuthMethod] = useState<DefenderAuthMethod>('client_secret');

  // Secret auth
  const [clientSecret, setClientSecret] = useState('');

  // Certificate auth — PEM paste
  const [certThumbprint, setCertThumbprint] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');

  // Certificate auth — PFX upload
  const [certInputMode, setCertInputMode] = useState<'pfx' | 'pem'>('pfx');
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [pfxPassphrase, setPfxPassphrase] = useState('');
  const [pfxParsed, setPfxParsed] = useState<{ subjectCn: string; notAfter: string } | null>(null);
  const [pfxParsing, setPfxParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const settings = await integrationsApi.getDefenderSettings();
      if (settings.configured) {
        setEditMode(true);
        setLabel(settings.label ?? '');
        setEnvConfigured(settings.env_configured ?? false);
        if (settings.auth_method) setAuthMethod(settings.auth_method);
        onStatusChange?.(true);
      }
    } catch {
      setEditMode(false);
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const handleParsePfx = async () => {
    if (!pfxFile) return;
    try {
      setPfxParsing(true);
      setError(null);
      const result = await integrationsApi.parsePfx(pfxFile, pfxPassphrase);
      setCertThumbprint(result.thumbprint);
      setPrivateKeyPem(result.private_key_pem);
      setPfxParsed({ subjectCn: result.subject_cn, notAfter: result.not_after });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse PFX file');
      setPfxParsed(null);
    } finally {
      setPfxParsing(false);
    }
  };

  const buildTestPayload = () => ({
    tenant_id: tenantId || undefined,
    client_id: clientId || undefined,
    auth_method: authMethod,
    ...(authMethod === 'certificate'
      ? { cert_thumbprint: certThumbprint || undefined, private_key_pem: privateKeyPem || undefined }
      : { client_secret: clientSecret || undefined }),
  });

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      const result = await integrationsApi.testDefenderConnection(buildTestPayload());
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
        const result = await integrationsApi.testDefenderConnection(buildTestPayload());
        if (!result.success) {
          setTestResult({ success: false, message: result.error ?? 'Connection test failed' });
          setSaving(false);
          return;
        }
        setTestResult({ success: true, message: result.message ?? 'Connection successful' });
      }

      await integrationsApi.saveDefenderSettings({
        tenant_id: tenantId || undefined,
        client_id: clientId || undefined,
        label: label || undefined,
        auth_method: authMethod,
        ...(authMethod === 'certificate'
          ? { cert_thumbprint: certThumbprint || undefined, private_key_pem: privateKeyPem || undefined }
          : { client_secret: clientSecret || undefined }),
      });

      setEditMode(true);
      setSuccessMessage('Defender credentials saved successfully!');
      onStatusChange?.(true);

      // Clear sensitive fields after save
      setTenantId('');
      setClientId('');
      setClientSecret('');
      setCertThumbprint('');
      setPrivateKeyPem('');
      setPfxFile(null);
      setPfxPassphrase('');
      setPfxParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      await integrationsApi.deleteDefenderSettings();
      setEditMode(false);
      setTenantId('');
      setClientId('');
      setClientSecret('');
      setCertThumbprint('');
      setPrivateKeyPem('');
      setPfxFile(null);
      setPfxPassphrase('');
      setPfxParsed(null);
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

  const isCertReady = authMethod === 'certificate' && !!(certThumbprint && privateKeyPem);
  const isSecretReady = authMethod === 'client_secret' && !!clientSecret;
  const hasCredentials = isCertReady || isSecretReady;

  const isValid = editMode ? true : !!(tenantId && clientId && hasCredentials);

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
          <Info className="w-4 h-4" />
          <div>
            <p className="font-medium">Environment variable configuration detected</p>
            <p className="text-sm text-muted-foreground mt-1">
              Defender credentials are set via environment variables. Settings saved here will take priority.
            </p>
          </div>
        </Alert>
      )}

      {/* Edit mode info banner */}
      {editMode && !envConfigured && (
        <Alert variant="default">
          <Info className="w-4 h-4" />
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
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      {/* Core identity fields */}
      <Input
        label="Tenant ID"
        placeholder={editMode ? 'Leave blank to keep current' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
        helperText={editMode ? 'Optional: Only fill in to update' : 'Azure AD / Entra ID tenant ID'}
      />
      <Input
        label="Client ID (Application ID)"
        placeholder={editMode ? 'Leave blank to keep current' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        helperText={editMode ? 'Optional: Only fill in to update' : 'App Registration Application (client) ID'}
      />

      {/* Auth method toggle */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Authentication Method</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setAuthMethod('client_secret'); setTestResult(null); }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              authMethod === 'client_secret'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
            }`}
          >
            Client Secret
          </button>
          <button
            type="button"
            onClick={() => { setAuthMethod('certificate'); setTestResult(null); }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              authMethod === 'certificate'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
            }`}
          >
            Certificate
          </button>
        </div>
      </div>

      {/* Secret auth fields */}
      {authMethod === 'client_secret' && (
        <Input
          label="Client Secret"
          type="password"
          placeholder={editMode ? 'Leave blank to keep current' : 'Client secret value'}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          helperText={editMode ? 'Optional: Only fill in to update' : undefined}
        />
      )}

      {/* Certificate auth fields */}
      {authMethod === 'certificate' && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileKey className="w-4 h-4" />
            Certificate Credentials
          </div>

          {/* Input mode tabs */}
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setCertInputMode('pfx')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                certInputMode === 'pfx'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Upload PFX / P12
            </button>
            <button
              type="button"
              onClick={() => setCertInputMode('pem')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                certInputMode === 'pem'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Paste PEM
            </button>
          </div>

          {certInputMode === 'pfx' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">PFX / P12 File</label>
                <div
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  {pfxFile ? (
                    <span className="text-foreground">{pfxFile.name}</span>
                  ) : (
                    <span>Click to select .pfx or .p12 file</span>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pfx,.p12"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setPfxFile(f);
                    setPfxParsed(null);
                    setCertThumbprint('');
                    setPrivateKeyPem('');
                  }}
                />
              </div>
              <Input
                label="PFX Passphrase"
                type="password"
                placeholder="Leave blank if no passphrase"
                value={pfxPassphrase}
                onChange={(e) => { setPfxPassphrase(e.target.value); setPfxParsed(null); }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleParsePfx}
                disabled={!pfxFile || pfxParsing}
              >
                {pfxParsing ? <><Spinner size="sm" /> Parsing...</> : 'Extract Certificate'}
              </Button>
              {pfxParsed && (
                <Alert variant="success">
                  <CheckCircle className="w-4 h-4" />
                  <div className="text-xs space-y-0.5">
                    <p className="font-medium">Certificate extracted</p>
                    <p>Subject: {pfxParsed.subjectCn}</p>
                    <p>Expires: {new Date(pfxParsed.notAfter).toLocaleDateString()}</p>
                    <p className="font-mono">Thumbprint: {certThumbprint}</p>
                  </div>
                </Alert>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                label="Certificate Thumbprint"
                placeholder={editMode ? 'Leave blank to keep current' : 'A1B2C3... (hex, from Azure portal)'}
                value={certThumbprint}
                onChange={(e) => setCertThumbprint(e.target.value.replace(/\s/g, ''))}
                helperText="SHA-1 fingerprint shown on your App Registration → Certificates & secrets"
              />
              <div className="space-y-1">
                <label className="text-sm font-medium">Private Key (PEM)</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={6}
                  placeholder={editMode ? 'Leave blank to keep current' : '-----BEGIN PRIVATE KEY-----\n...'}
                  value={privateKeyPem}
                  onChange={(e) => setPrivateKeyPem(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The RSA private key corresponding to the certificate uploaded to Azure
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <Input
        label="Tenant Label (optional)"
        placeholder="e.g. Contoso Production"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        helperText="User-friendly name for this tenant (shown in analytics)"
      />

      {/* Required permissions info */}
      <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-card-foreground">Required Azure App Registration Permissions</p>
        <p>The service principal needs this Microsoft Graph API permission (Application type, admin consent required):</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><span className="font-mono text-xs">SecurityEvents.Read.All</span> — Read Secure Score, alerts, and control profiles</li>
        </ul>
        {authMethod === 'certificate' && (
          <p className="mt-2 text-xs">
            For certificate auth: upload the public certificate (.cer / .pem) to your App Registration under{' '}
            <em>Certificates &amp; secrets → Certificates</em>. The thumbprint shown there is what you enter above.
          </p>
        )}
        <a
          href="https://learn.microsoft.com/en-us/graph/api/security-list-securescores?view=graph-rest-1.0"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
        >
          Microsoft Graph Security API reference
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
                Remove stored credentials. Defender data in Elasticsearch will be preserved.
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

      {editMode && <DefenderAutoResolveSection />}
    </div>
  );
}
