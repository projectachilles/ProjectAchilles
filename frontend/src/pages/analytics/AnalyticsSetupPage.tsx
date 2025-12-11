import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Cloud, Server, CheckCircle, ArrowLeft, Info } from 'lucide-react';
import { analyticsApi } from '../../services/api/analytics';
import { useAnalyticsAuth } from '../../hooks/useAnalyticsAuth';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/shared/ui/Card';
import { Input } from '../../components/shared/ui/Input';
import { Button } from '../../components/shared/ui/Button';
import { Alert } from '../../components/shared/ui/Alert';
import { Spinner } from '../../components/shared/ui/Spinner';

export default function AnalyticsSetupPage() {
  const navigate = useNavigate();
  const { checkConfiguration } = useAnalyticsAuth();

  const [editMode, setEditMode] = useState(false);
  const [connectionType, setConnectionType] = useState<'cloud' | 'direct'>('cloud');
  const [cloudId, setCloudId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [node, setNode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [indexPattern, setIndexPattern] = useState('f0rtika-results-*');

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
        setConnectionType(settings.connectionType);
        setIndexPattern(settings.indexPattern || 'f0rtika-results-*');
        // Note: Credentials are not returned for security, so fields remain empty
        // When saving with empty credentials, backend will keep existing ones
      }
    } catch (err) {
      // If settings don't exist or error, stay in initial setup mode
      setEditMode(false);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      const credentials = connectionType === 'cloud'
        ? { connectionType, cloudId, apiKey }
        : { connectionType, node, username, password };

      const result = await analyticsApi.testConnection(credentials);

      if (result.success) {
        setTestResult({ success: true, message: `Connected successfully! ES version: ${result.version}` });
      } else {
        setTestResult({ success: false, message: result.error || 'Connection failed' });
      }
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

      const settings = connectionType === 'cloud'
        ? { connectionType, cloudId, apiKey, indexPattern }
        : { connectionType, node, username, password, indexPattern };

      await analyticsApi.saveSettings(settings);
      await checkConfiguration();

      if (editMode) {
        setSuccessMessage('Settings updated successfully!');
        // Reload settings to reflect changes
        setTimeout(() => loadExistingSettings(), 500);
      } else {
        navigate('/analytics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Validation: In edit mode, allow empty credentials (keeps existing)
  // In new setup mode, require all credentials
  const isValid = editMode
    ? true // In edit mode, user can update without providing credentials
    : connectionType === 'cloud'
      ? cloudId && apiKey
      : node && (apiKey || (username && password));

  // Show loading spinner while checking existing configuration
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      {/* Back button for edit mode */}
      {editMode && (
        <Button
          variant="ghost"
          onClick={() => navigate('/analytics')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>
      )}

      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <Database className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">
          {editMode ? 'Edit Analytics Configuration' : 'Analytics Setup'}
        </h1>
        <p className="text-muted-foreground">
          {editMode
            ? 'Update your Elasticsearch connection settings'
            : 'Connect to Elasticsearch to view test results and analytics'
          }
        </p>
      </div>

      {/* Edit mode info banner */}
      {editMode && (
        <Alert variant="default" className="mb-6">
          <Info className="w-4 h-4" />
          <div>
            <p className="font-medium">Editing existing configuration</p>
            <p className="text-sm text-muted-foreground mt-1">
              Leave credential fields blank to keep your current credentials. Only fill them in if you want to update them.
            </p>
          </div>
        </Alert>
      )}

      {/* Success message */}
      {successMessage && (
        <Alert variant="success" className="mb-6">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Elasticsearch Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Type Toggle */}
          <div className="flex gap-4">
            <button
              onClick={() => setConnectionType('cloud')}
              className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
                connectionType === 'cloud'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <Cloud className={`w-6 h-6 mx-auto mb-2 ${connectionType === 'cloud' ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="font-medium">Elastic Cloud</p>
              <p className="text-sm text-muted-foreground">Connect via Cloud ID</p>
            </button>
            <button
              onClick={() => setConnectionType('direct')}
              className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
                connectionType === 'direct'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <Server className={`w-6 h-6 mx-auto mb-2 ${connectionType === 'direct' ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="font-medium">Direct URL</p>
              <p className="text-sm text-muted-foreground">Connect to self-hosted</p>
            </button>
          </div>

          {/* Cloud Connection Fields */}
          {connectionType === 'cloud' && (
            <>
              <Input
                label="Cloud ID"
                placeholder={editMode ? "Leave blank to keep current" : "deployment:region:base64..."}
                value={cloudId}
                onChange={(e) => setCloudId(e.target.value)}
              />
              <Input
                label="API Key"
                type="password"
                placeholder={editMode ? "Leave blank to keep current" : "Your Elasticsearch API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText={editMode ? "Optional: Only fill in to update" : undefined}
              />
            </>
          )}

          {/* Direct Connection Fields */}
          {connectionType === 'direct' && (
            <>
              <Input
                label="Elasticsearch URL"
                placeholder={editMode ? "Leave blank to keep current" : "https://localhost:9200"}
                value={node}
                onChange={(e) => setNode(e.target.value)}
              />
              <Input
                label="API Key (preferred)"
                type="password"
                placeholder={editMode ? "Leave blank to keep current" : "Your Elasticsearch API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText={editMode ? "Optional: Only fill in to update" : undefined}
              />
              <div className="text-center text-sm text-muted-foreground">— or —</div>
              <Input
                label="Username"
                placeholder={editMode ? "Leave blank to keep current" : "elastic"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                helperText={editMode ? "Optional: Only fill in to update" : undefined}
              />
              <Input
                label="Password"
                type="password"
                placeholder={editMode ? "Leave blank to keep current" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText={editMode ? "Optional: Only fill in to update" : undefined}
              />
            </>
          )}

          {/* Index Pattern */}
          <Input
            label="Index Pattern"
            placeholder="f0rtika-results-*"
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
          {error && (
            <Alert variant="destructive">{error}</Alert>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={!isValid || testing}
          >
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
          <Button
            onClick={handleSave}
            disabled={!isValid || !testResult?.success || saving}
          >
            {saving ? (
              <>
                <Spinner size="sm" />
                {editMode ? 'Updating...' : 'Saving...'}
              </>
            ) : (
              editMode ? 'Update Settings' : 'Save & Continue'
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
