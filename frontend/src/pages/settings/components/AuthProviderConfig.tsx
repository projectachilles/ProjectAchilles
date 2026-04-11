import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { authProvidersApi } from '@/services/api/authProviders';

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password';
  helperText?: string;
}

interface AuthProviderConfigProps {
  provider: 'azuread' | 'google' | 'clerk';
  fields: FieldDef[];
  onStatusChange?: (configured: boolean) => void;
}

export function AuthProviderConfig({ provider, fields, onStatusChange }: AuthProviderConfigProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Load existing settings
  useEffect(() => {
    authProvidersApi.getSettings(provider)
      .then((settings) => {
        if (settings.configured) {
          setEditMode(true);
          // Pre-fill with masked values
          const masked: Record<string, string> = {};
          for (const field of fields) {
            const val = settings[field.key];
            if (typeof val === 'string') masked[field.key] = val;
          }
          setValues(masked);
          onStatusChange?.(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [provider]);

  const handleChange = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setTestResult(null);
    setError('');
    setSuccessMessage('');
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const result = await authProvidersApi.test(provider, values);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  }, [provider, values]);

  const handleSave = useCallback(async () => {
    if (!testResult?.success) {
      setError('Please test the connection first');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authProvidersApi.save(provider, values);
      setEditMode(true);
      setSuccessMessage('Configuration saved successfully');
      onStatusChange?.(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [provider, values, testResult, onStatusChange]);

  const handleDisconnect = useCallback(async () => {
    try {
      await authProvidersApi.remove(provider);
      setValues({});
      setEditMode(false);
      setTestResult(null);
      setSuccessMessage('');
      onStatusChange?.(false);
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    }
  }, [provider, onStatusChange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allFilled = fields.every(f => values[f.key]?.trim() && !values[f.key]?.startsWith('****'));

  return (
    <div className="space-y-4">
      {editMode && (
        <Alert variant="default">
          This provider is configured. Leave fields blank to keep existing values, or enter new values to update.
        </Alert>
      )}

      {fields.map((field) => (
        <Input
          key={field.key}
          label={field.label}
          type={field.type || 'text'}
          placeholder={field.placeholder}
          value={values[field.key] || ''}
          onChange={(e) => handleChange(field.key, e.target.value)}
          helperText={field.helperText}
        />
      ))}

      {/* Test result */}
      {testResult && (
        <Alert variant={testResult.success ? 'success' : 'destructive'}>
          <span className="flex items-center gap-2">
            {testResult.success
              ? <CheckCircle className="w-4 h-4" />
              : <AlertCircle className="w-4 h-4" />}
            {testResult.message}
          </span>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">{error}</Alert>
      )}

      {successMessage && (
        <Alert variant="success">{successMessage}</Alert>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !allFilled}
        >
          {testing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing...</> : 'Test Connection'}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !testResult?.success}
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</> : 'Save'}
        </Button>
      </div>

      {/* Disconnect */}
      {editMode && (
        <div className="border-t border-border pt-4 mt-4">
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
