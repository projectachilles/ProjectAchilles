import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { login, clearError, logout } from '@/store/endpointAuthSlice';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Checkbox } from '@/components/shared/ui/Checkbox';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

interface EndpointsConfigProps {
  onStatusChange?: (authenticated: boolean) => void;
}

export function EndpointsConfig({ onStatusChange }: EndpointsConfigProps) {
  const dispatch = useAppDispatch();
  const { loading, error, isAuthenticated, organization } = useAppSelector(
    (state) => state.endpointAuth
  );

  const [formData, setFormData] = useState({
    oid: '',
    apiKey: '',
    orgName: '',
    saveCredentials: false,
  });

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.(isAuthenticated);
  }, [isAuthenticated, onStatusChange]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, checked, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (error) {
      dispatch(clearError());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatch(login(formData));
  };

  const handleDisconnect = () => {
    dispatch(logout());
  };

  // If already connected, show connection info
  if (isAuthenticated && organization) {
    return (
      <div className="space-y-4">
        <Alert variant="success">
          Connected to LimaCharlie organization
        </Alert>

        <div className="space-y-2 p-4 rounded-lg bg-muted/50">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Organization ID:</span>
            <span className="font-mono">{organization.oid}</span>
          </div>
          {organization.name && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Organization Name:</span>
              <span>{organization.name}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" onClose={() => dispatch(clearError())}>
          {error}
        </Alert>
      )}

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Organization ID"
          name="oid"
          id="oid"
          required
          autoComplete="organization"
          value={formData.oid}
          onChange={handleChange}
          disabled={loading}
          placeholder="Enter your organization ID"
        />

        <Input
          label="API Key"
          name="apiKey"
          id="apiKey"
          type="password"
          required
          autoComplete="current-password"
          value={formData.apiKey}
          onChange={handleChange}
          disabled={loading}
          placeholder="Enter your API key"
        />

        <div>
          <Input
            label="Organization Name (Optional)"
            name="orgName"
            id="orgName"
            value={formData.orgName}
            onChange={handleChange}
            disabled={loading}
            placeholder="Give this organization a friendly name"
          />
          <p className="text-xs text-muted-foreground mt-1">
            A friendly name to identify this organization
          </p>
        </div>

        <Checkbox
          name="saveCredentials"
          label="Save credentials for future sessions"
          checked={formData.saveCredentials}
          onChange={handleChange}
          disabled={loading}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" />
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </Button>
        </div>
      </form>

      {/* Footer Link */}
      <p className="text-center text-sm text-muted-foreground pt-2">
        Don't have LimaCharlie credentials?{' '}
        <a
          href="https://limacharlie.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Get started
        </a>
      </p>
    </div>
  );
}
