import { useState, useEffect, useRef } from 'react';
import { CheckCircle, Info, ExternalLink, Unlink, Upload, KeyRound } from 'lucide-react';
import { integrationsApi } from '@/services/api/integrations';
import type { AzureAuthMethod } from '@/services/api/integrations';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

interface AzureConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function AzureConfig({ onStatusChange }: AzureConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [authMethod, setAuthMethod] = useState<AzureAuthMethod>('client_secret');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');

  // Certificate — PFX upload sub-tab
  const [certTab, setCertTab] = useState<'pfx' | 'pem'>('pfx');
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [pfxPassphrase, setPfxPassphrase] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractedCn, setExtractedCn] = useState('');
  const [extractedExpiry, setExtractedExpiry] = useState('');
  // Certificate — resolved fields (either from PFX extraction or manual PEM paste)
  const [certThumbprint, setCertThumbprint] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');

  const pfxInputRef = useRef<HTMLInputElement>(null);

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
      const settings = await integrationsApi.getAzureSettings();
      if (settings.configured) {
        setEditMode(true);
        setLabel(settings.label ?? '');
        setAuthMethod(settings.auth_method ?? 'client_secret');
        setEnvConfigured(settings.env_configured ?? false);
        onStatusChange?.(true);
      }
    } catch {
      setEditMode(false);
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractPfx = async () => {
    if (!pfxFile) return;
    try {
      setExtracting(true);
      setError(null);
      const result = await integrationsApi.parsePfxForAzure(pfxFile, pfxPassphrase);
      setCertThumbprint(result.thumbprint);
      setPrivateKeyPem(result.private_key_pem);
      setExtractedCn(result.subject_cn);
      setExtractedExpiry(new Date(result.not_after).toLocaleDateString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse PFX file');
    } finally {
      setExtracting(false);
    }
  };

  const buildTestPayload = () => {
    if (authMethod === 'certificate') {
      return {
        tenant_id: tenantId || undefined,
        client_id: clientId || undefined,
        auth_method: 'certificate' as const,
        cert_thumbprint: certThumbprint || undefined,
        private_key_pem: privateKeyPem || undefined,
      };
    }
    return {
      tenant_id: tenantId || undefined,
      client_id: clientId || undefined,
      client_secret: clientSecret || undefined,
    };
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);
      const result = await integrationsApi.testAzureConnection(buildTestPayload());
      setTestResult({
        success: result.success,
        message: result.success ? (result.message ?? 'Credentials look valid') : (result.error ?? 'Validation failed'),
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
        const result = await integrationsApi.testAzureConnection(buildTestPayload());
        if (!result.success) {
          setTestResult({ success: false, message: result.error ?? 'Validation failed' });
          setSaving(false);
          return;
        }
        setTestResult({ success: true, message: result.message ?? 'Credentials look valid' });
      }

      await integrationsApi.saveAzureSettings({
        tenant_id: tenantId || undefined,
        client_id: clientId || undefined,
        client_secret: authMethod === 'client_secret' ? (clientSecret || undefined) : undefined,
        label: label || undefined,
        auth_method: authMethod,
        cert_thumbprint: authMethod === 'certificate' ? (certThumbprint || undefined) : undefined,
        private_key_pem: authMethod === 'certificate' ? (privateKeyPem || undefined) : undefined,
      });

      setEditMode(true);
      setSuccessMessage('Azure / Entra ID credentials saved successfully!');
      onStatusChange?.(true);

      // Clear sensitive fields after save
      setTenantId('');
      setClientId('');
      setClientSecret('');
      setCertThumbprint('');
      setPrivateKeyPem('');
      setPfxFile(null);
      setPfxPassphrase('');
      setExtractedCn('');
      setExtractedExpiry('');
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
      await integrationsApi.deleteAzureSettings();
      setEditMode(false);
      setAuthMethod('client_secret');
      setTenantId('');
      setClientId('');
      setClientSecret('');
      setCertThumbprint('');
      setPrivateKeyPem('');
      setPfxFile(null);
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

  const isCertReady = !!(certThumbprint && privateKeyPem);
  const isSecretReady = !!clientSecret;
  const isValid = editMode
    ? true
    : !!(tenantId && clientId && (authMethod === 'certificate' ? isCertReady : isSecretReady));

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
              Azure credentials are set via environment variables. Settings saved here will take priority.
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

      {/* Auth method toggle */}
      <div>
        <p className="text-sm font-medium mb-2">Authentication Method</p>
        <div className="flex gap-2">
          {(['client_secret', 'certificate'] as AzureAuthMethod[]).map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => { setAuthMethod(method); setTestResult(null); }}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                authMethod === method
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary/50'
              }`}
            >
              {method === 'client_secret' ? 'Client Secret' : 'Certificate'}
            </button>
          ))}
        </div>
      </div>

      {/* Common fields */}
      <Input
        label="Tenant ID"
        placeholder={editMode ? 'Leave blank to keep current' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
        helperText={editMode ? 'Optional: Only fill in to update' : 'Azure AD / Entra ID tenant ID (Directory ID)'}
      />
      <Input
        label="Client ID (Application ID)"
        placeholder={editMode ? 'Leave blank to keep current' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        helperText={editMode ? 'Optional: Only fill in to update' : 'App Registration Application (client) ID'}
      />

      {/* Secret auth */}
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

      {/* Certificate auth */}
      {authMethod === 'certificate' && (
        <div className="space-y-4">
          {/* Sub-tab selector */}
          <div className="flex gap-1 border-b border-border">
            {(['pfx', 'pem'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setCertTab(tab)}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  certTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'pfx' ? 'Upload PFX / P12' : 'Paste PEM'}
              </button>
            ))}
          </div>

          {certTab === 'pfx' && (
            <div className="space-y-3">
              {/* File drop area */}
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => pfxInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) { setPfxFile(file); setExtractedCn(''); setExtractedExpiry(''); setCertThumbprint(''); setPrivateKeyPem(''); }
                }}
              >
                <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                {pfxFile ? (
                  <p className="text-sm font-medium">{pfxFile.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Drop a PFX / P12 file or click to browse</p>
                )}
                <input
                  ref={pfxInputRef}
                  type="file"
                  accept=".pfx,.p12"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) { setPfxFile(file); setExtractedCn(''); setExtractedExpiry(''); setCertThumbprint(''); setPrivateKeyPem(''); }
                  }}
                />
              </div>

              <Input
                label="PFX Passphrase"
                type="password"
                placeholder="Leave blank if no passphrase"
                value={pfxPassphrase}
                onChange={(e) => setPfxPassphrase(e.target.value)}
              />

              <Button
                variant="outline"
                onClick={handleExtractPfx}
                disabled={!pfxFile || extracting}
              >
                {extracting ? <><Spinner size="sm" /> Extracting...</> : <><KeyRound className="w-4 h-4" /> Extract Certificate</>}
              </Button>

              {extractedCn && (
                <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                  <p className="font-medium text-green-600 dark:text-green-400">Certificate extracted</p>
                  <p className="text-muted-foreground">Subject: {extractedCn}</p>
                  <p className="text-muted-foreground">Expires: {extractedExpiry}</p>
                  <p className="text-muted-foreground font-mono text-xs">Thumbprint: {certThumbprint}</p>
                </div>
              )}
            </div>
          )}

          {certTab === 'pem' && (
            <div className="space-y-3">
              <Input
                label="Certificate Thumbprint"
                placeholder="SHA-1 hex (e.g. A1B2C3... — as shown in Azure portal)"
                value={certThumbprint}
                onChange={(e) => setCertThumbprint(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))}
                helperText={editMode ? 'Optional: Only fill in to update' : undefined}
              />
              <div>
                <label className="block text-sm font-medium mb-1">Private Key (PEM)</label>
                <textarea
                  className="w-full h-36 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={editMode ? 'Leave blank to keep current' : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                  value={privateKeyPem}
                  onChange={(e) => setPrivateKeyPem(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {editMode ? 'Optional: Only fill in to update' : 'RSA private key corresponding to the uploaded certificate'}
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
        <p>The service principal needs these Microsoft Graph API permissions (Application type):</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Directory.Read.All</li>
          <li>Policy.Read.All</li>
          <li>SecurityEvents.Read.All</li>
          <li>UserAuthenticationMethod.Read.All</li>
          <li>RoleManagement.Read.Directory</li>
        </ul>
        {authMethod === 'certificate' && (
          <p className="text-xs mt-2">
            For certificate auth: upload the <strong>public</strong> certificate (.cer/.pem) to the App Registration under{' '}
            <em>Certificates &amp; secrets → Certificates</em>. The thumbprint shown there must match what you enter here.
          </p>
        )}
        <a
          href="https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline mt-1"
        >
          Microsoft Entra permissions reference
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
          {testing ? (
            <><Spinner size="sm" /> Validating...</>
          ) : (
            <><CheckCircle className="w-4 h-4" /> Validate Credentials</>
          )}
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
              <p className="text-xs text-muted-foreground">Remove stored credentials. Azure data will be preserved.</p>
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
    </div>
  );
}
