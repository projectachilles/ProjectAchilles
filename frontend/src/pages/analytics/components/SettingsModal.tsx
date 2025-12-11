import { useState, useEffect } from 'react';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { analyticsApi } from '../../../services/api/analytics';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export default function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [connectionType, setConnectionType] = useState<'cloud' | 'direct'>('cloud');
  const [cloudId, setCloudId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [node, setNode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [indexPattern, setIndexPattern] = useState('f0rtika-results-*');

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; version?: string; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load current settings
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  async function loadSettings() {
    try {
      const settings = await analyticsApi.getSettings();
      if (settings.configured && settings.connectionType) {
        setConnectionType(settings.connectionType);
        setIndexPattern(settings.indexPattern || 'f0rtika-results-*');
        // Note: Credentials come back masked, so we don't populate them
      }
    } catch (err) {
      // Ignore - will use defaults
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await analyticsApi.testConnection({
        connectionType,
        cloudId: connectionType === 'cloud' ? cloudId : undefined,
        apiKey,
        node: connectionType === 'direct' ? node : undefined,
        username: connectionType === 'direct' ? username : undefined,
        password: connectionType === 'direct' ? password : undefined,
      });
      setTestResult(result);
    } catch (err: any) {
      setError(err.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    setError(null);

    try {
      await analyticsApi.saveSettings({
        connectionType,
        cloudId: connectionType === 'cloud' ? cloudId : undefined,
        apiKey,
        node: connectionType === 'direct' ? node : undefined,
        username: connectionType === 'direct' ? username : undefined,
        password: connectionType === 'direct' ? password : undefined,
        indexPattern
      });
      onSave?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">Elasticsearch Connection</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Connection Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Connection Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="connectionType"
                  checked={connectionType === 'cloud'}
                  onChange={() => setConnectionType('cloud')}
                  className="w-4 h-4 text-primary"
                />
                <span>Elastic Cloud</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="connectionType"
                  checked={connectionType === 'direct'}
                  onChange={() => setConnectionType('direct')}
                  className="w-4 h-4 text-primary"
                />
                <span>Direct URL</span>
              </label>
            </div>
          </div>

          {/* Cloud ID (for cloud) */}
          {connectionType === 'cloud' && (
            <div>
              <label className="block text-sm font-medium mb-1">Cloud ID</label>
              <input
                type="text"
                value={cloudId}
                onChange={(e) => setCloudId(e.target.value)}
                placeholder="your-deployment:dXMtY2VudHJhbDEuZ2NwLmNsb3VkLmVzLmlvJDEy..."
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Find this in Elastic Cloud &gt; Deployment &gt; Cloud ID
              </p>
            </div>
          )}

          {/* Node URL (for direct) */}
          {connectionType === 'direct' && (
            <div>
              <label className="block text-sm font-medium mb-1">Elasticsearch URL</label>
              <input
                type="text"
                value={node}
                onChange={(e) => setNode(e.target.value)}
                placeholder="https://localhost:9200"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API key"
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Username/Password (for direct, alternative to API key) */}
          {connectionType === 'direct' && (
            <>
              <div className="text-center text-sm text-muted-foreground">
                Or use username/password:
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="elastic"
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </>
          )}

          {/* Index Pattern */}
          <div>
            <label className="block text-sm font-medium mb-1">Index Pattern</label>
            <input
              type="text"
              value={indexPattern}
              onChange={(e) => setIndexPattern(e.target.value)}
              placeholder="f0rtika-results-*"
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>Connected! Elasticsearch v{testResult.version}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5" />
                    <span>{testResult.error || 'Connection failed'}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <button
            onClick={handleTest}
            disabled={testing || loading}
            className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {testing && <Loader2 className="w-4 h-4 animate-spin" />}
            Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={loading || testing}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
