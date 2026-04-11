import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shield, Lock, User, AlertCircle, Globe, Cloud, Users } from 'lucide-react';
import { useAppAuth } from '@/contexts/AuthContext';
import { authProvidersApi } from '@/services/api/authProviders';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<string[]>(['basic']);
  const { login, loginWithToken, isSignedIn } = useAppAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle OAuth callback token in URL
  useEffect(() => {
    const token = searchParams.get('token');
    const userParam = searchParams.get('user');
    if (token && userParam) {
      try {
        const user = JSON.parse(userParam);
        loginWithToken(token, user);
        navigate('/dashboard', { replace: true });
      } catch {
        setError('Invalid authentication callback');
      }
    }
  }, [searchParams]);

  // Redirect if already signed in
  useEffect(() => {
    if (isSignedIn) navigate('/dashboard', { replace: true });
  }, [isSignedIn]);

  // Fetch configured providers
  useEffect(() => {
    authProvidersApi.getProviders()
      .then((res) => setProviders(res.providers))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = (provider: string) => {
    // Redirect to backend OAuth authorize endpoint
    const backendUrl = window.location.origin;
    window.location.href = `${backendUrl}/api/auth/${provider}/authorize`;
  };

  const hasProvider = (p: string) => providers.includes(p);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a1929] px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#0d3048] mb-4">
            <Shield className="w-8 h-8 text-[#12C69F]" />
          </div>
          <h1 className="text-2xl font-bold text-white">ProjectAchilles</h1>
          <p className="text-sm text-[#5c7f91] mt-1">Purple Team Platform</p>
        </div>

        {/* Card */}
        <div className="bg-[#0d3048] rounded-xl border border-[#1a3a52] shadow-2xl overflow-hidden">
          <div className="p-6 space-y-4">
            {/* OAuth Buttons — only shown if providers are configured */}
            {(hasProvider('azuread') || hasProvider('google') || hasProvider('clerk')) && (
              <>
                <div className="space-y-3">
                  {hasProvider('azuread') && (
                    <button
                      onClick={() => handleOAuthLogin('azuread')}
                      className="w-full flex items-center justify-center gap-3 py-2.5 bg-[#091c2e] border border-[#1a3a52] rounded-lg text-white hover:bg-[#0f2840] transition-colors"
                    >
                      <Cloud className="w-5 h-5 text-[#00a4ef]" />
                      Sign in with Microsoft
                    </button>
                  )}
                  {hasProvider('google') && (
                    <button
                      onClick={() => handleOAuthLogin('google')}
                      className="w-full flex items-center justify-center gap-3 py-2.5 bg-[#091c2e] border border-[#1a3a52] rounded-lg text-white hover:bg-[#0f2840] transition-colors"
                    >
                      <Globe className="w-5 h-5 text-[#4285f4]" />
                      Sign in with Google
                    </button>
                  )}
                  {hasProvider('clerk') && (
                    <button
                      onClick={() => handleOAuthLogin('clerk')}
                      className="w-full flex items-center justify-center gap-3 py-2.5 bg-[#091c2e] border border-[#1a3a52] rounded-lg text-white hover:bg-[#0f2840] transition-colors"
                    >
                      <Users className="w-5 h-5 text-[#6c47ff]" />
                      Sign in with Clerk
                    </button>
                  )}
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#1a3a52]" />
                  <span className="text-xs text-[#2a4a5c] uppercase">or</span>
                  <div className="flex-1 h-px bg-[#1a3a52]" />
                </div>
              </>
            )}

            {/* Basic Auth Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-[#5c7f91] mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5c7f91]" />
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-[#091c2e] border border-[#1a3a52] rounded-lg text-white placeholder-[#2a4a5c] focus:outline-none focus:ring-2 focus:ring-[#12C69F]/30 focus:border-[#12C69F]/50 transition-colors"
                    placeholder="achillesadm"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[#5c7f91] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5c7f91]" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-[#091c2e] border border-[#1a3a52] rounded-lg text-white placeholder-[#2a4a5c] focus:outline-none focus:ring-2 focus:ring-[#12C69F]/30 focus:border-[#12C69F]/50 transition-colors"
                    placeholder="Check backend console for password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-[#C13410] bg-[#C13410]/10 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !username || !password}
                className="w-full py-2.5 bg-[#12C69F] hover:bg-[#10b08d] text-[#0a1929] font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-[#2a4a5c] mt-6">
          Continuous Security Validation
        </p>
      </div>
    </div>
  );
}
