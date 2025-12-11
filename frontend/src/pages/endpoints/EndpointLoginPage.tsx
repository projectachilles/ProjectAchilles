/**
 * Login Page Component
 * ACHILLES - Endpoint Management
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cpu } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import { login, clearError } from '../../store/endpointAuthSlice';
import { Button } from '../../components/shared/ui/Button';
import { Input } from '../../components/shared/ui/Input';
import { Checkbox } from '../../components/shared/ui/Checkbox';
import { Alert } from '../../components/shared/ui/Alert';
import { Spinner } from '../../components/shared/ui/Spinner';

export default function EndpointLoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error } = useAppSelector((state) => state.endpointAuth);

  const [formData, setFormData] = useState({
    oid: '',
    apiKey: '',
    orgName: '',
    saveCredentials: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, checked, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error when user starts typing
    if (error) {
      dispatch(clearError());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await dispatch(login(formData));

    if (login.fulfilled.match(result)) {
      navigate('/endpoints/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-purple-800 p-4">
      <div className="w-full max-w-md">
        {/* Login Card */}
        <div className="bg-card border border-border rounded-xl shadow-2xl p-8">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center mb-4">
              <Cpu className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-center">ACHILLES</h1>
            <p className="text-sm text-muted-foreground mt-1">Endpoint Management</p>
          </div>

          {/* Subtitle */}
          <p className="text-center text-muted-foreground mb-6">
            Sign in with your LimaCharlie credentials
          </p>

          {/* Error Alert */}
          {error && (
            <Alert
              variant="destructive"
              className="mb-6"
              onClose={() => dispatch(clearError())}
            >
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
              autoFocus
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

            <div className="pt-2">
              <Checkbox
                name="saveCredentials"
                label="Save credentials for future sessions"
                checked={formData.saveCredentials}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              className="w-full mt-6 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* Footer Link */}
          <p className="text-center text-sm text-muted-foreground mt-6">
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

        {/* Version Footer */}
        <p className="text-center text-sm text-white/70 mt-6">
          ACHILLES v1.0.0
        </p>
      </div>
    </div>
  );
}
