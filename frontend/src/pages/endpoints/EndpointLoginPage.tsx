import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cpu, Key, Building2 } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import { login, clearError } from '../../store/endpointAuthSlice';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/shared/ui/Card';
import { Input } from '../../components/shared/ui/Input';
import { Button } from '../../components/shared/ui/Button';
import { Alert } from '../../components/shared/ui/Alert';
import { Spinner } from '../../components/shared/ui/Spinner';

export default function EndpointLoginPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { isAuthenticated, loading, error } = useAppSelector((state) => state.endpointAuth);

  const [oid, setOid] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/endpoints');
    }
  }, [isAuthenticated, navigate]);

  // Clear error when inputs change
  useEffect(() => {
    if (error) {
      dispatch(clearError());
    }
  }, [oid, apiKey, dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oid || !apiKey) return;

    await dispatch(login({ oid, apiKey }));
  };

  const isValid = oid && apiKey;

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Cpu className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Endpoint Management</h1>
          <p className="text-muted-foreground">
            Sign in with your LimaCharlie credentials
          </p>
        </div>

        {/* Login Form */}
        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle>LimaCharlie Authentication</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Organization ID"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={oid}
                onChange={(e) => setOid(e.target.value)}
                leftIcon={<Building2 className="w-4 h-4" />}
                autoComplete="username"
              />
              <Input
                label="API Key"
                type="password"
                placeholder="Your LimaCharlie API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                leftIcon={<Key className="w-4 h-4" />}
                autoComplete="current-password"
              />

              {error && (
                <Alert variant="destructive">{error}</Alert>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={!isValid || loading}
              >
                {loading ? (
                  <>
                    <Spinner size="sm" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Help Text */}
        <p className="text-center text-sm text-muted-foreground mt-4">
          Need credentials?{' '}
          <a
            href="https://app.limacharlie.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Visit LimaCharlie
          </a>
        </p>
      </div>
    </div>
  );
}
