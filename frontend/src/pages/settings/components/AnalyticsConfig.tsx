import { useState, useEffect } from 'react';
import { Cloud, Server, CheckCircle, Info } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { IndexManagement } from './IndexManagement';

interface AnalyticsConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function AnalyticsConfig({ onStatusChange }: AnalyticsConfigProps) {
  const { updateSettings } = useAnalyticsAuth();

  const [editMode, setEditMode] = useState(false);
  const [connectionType, setConnectionType] = useState<'cloud' | 'direct'>('cloud');
  const [cloudId, setCloudId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [node, setNode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [indexPattern, setIndexPattern] = useState('achilles-results-*');

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing settings on mount
  useEffect(() => {
    loadExistingSettings();
  }, []);

  const loadExistingSettings = async () => {
    try {
      const settings = await analyticsApi.getSettings();
      if (settings.configured) {
        setEditMode(true);
        setConnectionType(settings.connectionType || 'cloud');
        setIndexPattern(settings.indexPattern || 'achilles-results-*');
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

      const credentials =
        connectionType === 'cloud'
          ? { connectionType, cloudId, apiKey }
          : { connectionType, node, username, password };

      const result = await analyticsApi.testConnection(credentials);

      if (result.success) {
        setTestResult({
          success: true,
          message: `Connected successfully! ES version: ${result.version}`,
        });
      } else {
        setTestResult({ success: false, message: result.error || 'Connection failed' });
      }
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

      const credentials =
        connectionType === 'cloud'
          ? { connectionType, cloudId, apiKey }
          : { connectionType, node, username, password };

      // Auto-test connection if not already tested successfully
      if (!testResult?.success) {
        setTestResult(null);
        const result = await analyticsApi.testConnection(credentials);

        if (!result.success) {
          setTestResult({ success: false, message: result.error || 'Connection failed' });
          setSaving(false);
          return;
        }
        setTestResult({
          success: true,
          message: `Connected successfully! ES version: ${result.version}`,
        });
      }

      const settings =
        connectionType === 'cloud'
          ? { connectionType, cloudId, apiKey, indexPattern }
          : { connectionType, node, username, password, indexPattern };

      await analyticsApi.saveSettings(settings);

      // Update context state
      updateSettings({
        configured: true,
        connectionType,
        indexPattern,
      });

      setEditMode(true);
      setSuccessMessage('Settings saved successfully!');
      onStatusChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Validation
  const isValid = editMode
    ? true
    : connectionType === 'cloud'
      ? cloudId && apiKey
      : !!node; // Auth is optional for direct connections (e.g. local ES with security disabled)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Edit mode info banner */}
      {editMode && (
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

      {/* Connection Type Toggle */}
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => setConnectionType('cloud')}
          className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
            connectionType === 'cloud'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <Cloud
            className={`w-6 h-6 mx-auto mb-2 ${connectionType === 'cloud' ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <p className="font-medium text-card-foreground">Elastic Cloud</p>
          <p className="text-sm text-muted-foreground">Connect via Cloud ID</p>
        </button>
        <button
          type="button"
          onClick={() => setConnectionType('direct')}
          className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
            connectionType === 'direct'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <Server
            className={`w-6 h-6 mx-auto mb-2 ${connectionType === 'direct' ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <p className="font-medium text-card-foreground">Direct URL</p>
          <p className="text-sm text-muted-foreground">Connect to self-hosted</p>
        </button>
      </div>

      {/* Cloud Connection Fields */}
      {connectionType === 'cloud' && (
        <>
          <Input
            label="Cloud ID"
            placeholder={editMode ? 'Leave blank to keep current' : 'deployment:region:base64...'}
            value={cloudId}
            onChange={(e) => setCloudId(e.target.value)}
          />
          <Input
            label="API Key"
            type="password"
            placeholder={editMode ? 'Leave blank to keep current' : 'Your Elasticsearch API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helperText={editMode ? 'Optional: Only fill in to update' : undefined}
          />
        </>
      )}

      {/* Direct Connection Fields */}
      {connectionType === 'direct' && (
        <>
          <Input
            label="Elasticsearch URL"
            placeholder={editMode ? 'Leave blank to keep current' : 'https://localhost:9200'}
            value={node}
            onChange={(e) => setNode(e.target.value)}
          />
          <Input
            label="API Key (preferred)"
            type="password"
            placeholder={editMode ? 'Leave blank to keep current' : 'Your Elasticsearch API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helperText={editMode ? 'Optional: Only fill in to update' : 'Optional for local instances with security disabled'}
          />
          <div className="text-center text-sm text-muted-foreground">— or —</div>
          <Input
            label="Username"
            placeholder={editMode ? 'Leave blank to keep current' : 'elastic'}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText={editMode ? 'Optional: Only fill in to update' : undefined}
          />
          <Input
            label="Password"
            type="password"
            placeholder={editMode ? 'Leave blank to keep current' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText={editMode ? 'Optional: Only fill in to update' : undefined}
          />
        </>
      )}

      {/* Index Pattern */}
      <Input
        label="Index Pattern"
        placeholder="achilles-results-*"
        value={indexPattern}
        onChange={(e) => setIndexPattern(e.target.value)}
      />

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
              Testing...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Test Connection
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

      {/* Index Management — only when ES is configured */}
      {editMode && (
        <>
          <div className="border-t border-border my-6" />
          <IndexManagement onSelectIndex={setIndexPattern} />
        </>
      )}
    </div>
  );
}
