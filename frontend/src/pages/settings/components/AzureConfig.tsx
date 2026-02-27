import { useState, useEffect } from 'react';
import { CheckCircle, Info, ExternalLink } from 'lucide-react';
import { integrationsApi } from '@/services/api/integrations';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

interface AzureConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function AzureConfig({ onStatusChange }: AzureConfigProps) {
  const [editMode, setEditMode] = useState(false);
  const [tenantId, setTenantId] = useState('');
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

  useEffect(() => {
    loadExistingSettings();
  }, []);

  const loadExistingSettings = async () => {
    try {
      const settings = await integrationsApi.getAzureSettings();
      if (settings.configured) {
        setEditMode(true);
        setLabel(settings.label ?? '');
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

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      const result = await integrationsApi.testAzureConnection({
        tenant_id: tenantId || undefined,
        client_id: clientId || undefined,
        client_secret: clientSecret || undefined,
      });

      setTestResult({
        success: result.success,
        message: result.success
          ? (result.message ?? 'Credentials look valid')
          : (result.error ?? 'Validation failed'),
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Auto-test if not already tested successfully
      if (!testResult?.success) {
        setTestResult(null);
        const result = await integrationsApi.testAzureConnection({
          tenant_id: tenantId || undefined,
          client_id: clientId || undefined,
          client_secret: clientSecret || undefined,
        });

        if (!result.success) {
          setTestResult({
            success: false,
            message: result.error ?? 'Validation failed',
          });
          setSaving(false);
          return;
        }
        setTestResult({
          success: true,
          message: result.message ?? 'Credentials look valid',
        });
      }

      await integrationsApi.saveAzureSettings({
        tenant_id: tenantId || undefined,
        client_id: clientId || undefined,
        client_secret: clientSecret || undefined,
        label: label || undefined,
      });

      setEditMode(true);
      setSuccessMessage('Azure credentials saved successfully!');
      onStatusChange?.(true);

      // Clear inputs after save (they're now stored encrypted)
      setTenantId('');
      setClientId('');
      setClientSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Validation: on initial setup, all three are required. On edit, all are optional.
  const isValid = editMode
    ? true
    : !!(tenantId && clientId && clientSecret);

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
              Azure credentials are set via AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET
              environment variables. Settings saved here will take priority.
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

      {/* Success message */}
      {successMessage && (
        <Alert variant="success">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      {/* Form fields */}
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
      <Input
        label="Client Secret"
        type="password"
        placeholder={editMode ? 'Leave blank to keep current' : 'Client secret value'}
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        helperText={editMode ? 'Optional: Only fill in to update' : undefined}
      />
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

      {/* Test Result */}
      {testResult && (
        <Alert variant={testResult.success ? 'success' : 'destructive'}>
          {testResult.message}
        </Alert>
      )}

      {/* Error */}
      {error && <Alert variant="destructive">{error}</Alert>}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTestConnection} disabled={!isValid || testing}>
          {testing ? (
            <>
              <Spinner size="sm" />
              Validating...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Validate Credentials
            </>
          )}
        </Button>
        <Button onClick={handleSave} disabled={!isValid || saving}>
          {saving ? (
            <>
              <Spinner size="sm" />
              {editMode ? 'Updating...' : 'Saving...'}
            </>
          ) : editMode ? (
            'Update Settings'
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  );
}
