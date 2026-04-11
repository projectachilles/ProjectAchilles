import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Cloud, Globe, Users, Eye, EyeOff } from 'lucide-react';
import { useAppAuth } from '@/contexts/AuthContext';
import { authProvidersApi } from '@/services/api/authProviders';

// --- Subtle background grid ---
function GridBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg, #040812 0%, #080e1c 40%, #0b1222 100%)
          `,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '64px 64px',
        }}
      />
      {/* Radial glow at center-top */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px]"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0, 230, 138, 0.06) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}

// --- Animated shield logo ---
function AchillesLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 500" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M 250,28 L 480,458 L 20,458 Z M 250,252 L 312,458 L 230,458 L 150,360 L 195,310 L 155,250 Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<string[]>(['basic']);
  const [mounted, setMounted] = useState(false);
  const { login, loginWithToken, isSignedIn } = useAppAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const usernameRef = useRef<HTMLInputElement>(null);

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

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

  // Autofocus
  useEffect(() => {
    if (mounted) usernameRef.current?.focus();
  }, [mounted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = (provider: string) => {
    window.location.href = `${window.location.origin}/api/auth/${provider}/authorize`;
  };

  const hasProvider = (p: string) => providers.includes(p);
  const hasOAuth = hasProvider('azuread') || hasProvider('google') || hasProvider('clerk');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative isolate px-4">
      <GridBackground />

      {/* Content wrapper — staggered entrance */}
      <div
        className="w-full max-w-[380px] relative z-10 flex flex-col items-center"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Logo + wordmark */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <AchillesLogo className="w-11 h-11 text-[#00e68a]" />
            {/* Subtle glow behind logo */}
            <div
              className="absolute inset-0 -m-3 rounded-full blur-xl pointer-events-none"
              style={{ background: 'rgba(0, 230, 138, 0.12)' }}
            />
          </div>
          <h1
            className="text-[22px] font-semibold tracking-[-0.02em] text-[#f0f2f5]"
            style={{ fontFamily: "'Rajdhani', system-ui, sans-serif" }}
          >
            Sign in to Achilles
          </h1>
          <p className="text-[13px] text-[#4a5268] mt-1.5">
            Continuous security validation
          </p>
        </div>

        {/* OAuth providers */}
        {hasOAuth && (
          <div
            className="w-full space-y-2.5 mb-6"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.7s 0.1s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s 0.1s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {hasProvider('azuread') && (
              <OAuthButton
                onClick={() => handleOAuthLogin('azuread')}
                icon={<Cloud className="w-[18px] h-[18px]" />}
                iconColor="#00a4ef"
                label="Continue with Microsoft"
              />
            )}
            {hasProvider('google') && (
              <OAuthButton
                onClick={() => handleOAuthLogin('google')}
                icon={<Globe className="w-[18px] h-[18px]" />}
                iconColor="#4285f4"
                label="Continue with Google"
              />
            )}
            {hasProvider('clerk') && (
              <OAuthButton
                onClick={() => handleOAuthLogin('clerk')}
                icon={<Users className="w-[18px] h-[18px]" />}
                iconColor="#6c47ff"
                label="Continue with Clerk"
              />
            )}

            {/* Divider */}
            <div className="flex items-center gap-4 py-1">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#1e2536] to-transparent" />
              <span className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#3a4258]">or</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#1e2536] to-transparent" />
            </div>
          </div>
        )}

        {/* Credentials form */}
        <form
          onSubmit={handleSubmit}
          className="w-full space-y-3.5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.7s 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Username */}
          <div>
            <label htmlFor="login-user" className="block text-[12px] font-medium text-[#6b7394] mb-1.5 tracking-[0.01em]">
              Username
            </label>
            <input
              ref={usernameRef}
              id="login-user"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              className="w-full px-3.5 py-2.5 rounded-lg text-[14px] text-[#e8eaf0] placeholder-[#2e3548]
                bg-[#0c1120] border border-[#1a2035]
                focus:outline-none focus:border-[#00e68a]/40 focus:ring-1 focus:ring-[#00e68a]/20
                transition-all duration-200"
              placeholder="Enter username"
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-pass" className="block text-[12px] font-medium text-[#6b7394] mb-1.5 tracking-[0.01em]">
              Password
            </label>
            <div className="relative">
              <input
                id="login-pass"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className="w-full px-3.5 py-2.5 pr-10 rounded-lg text-[14px] text-[#e8eaf0] placeholder-[#2e3548]
                  bg-[#0c1120] border border-[#1a2035]
                  focus:outline-none focus:border-[#00e68a]/40 focus:ring-1 focus:ring-[#00e68a]/20
                  transition-all duration-200"
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3a4258] hover:text-[#6b7394] transition-colors"
                tabIndex={-1}
              >
                {showPassword
                  ? <EyeOff className="w-4 h-4" />
                  : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 text-[13px] text-[#ff5c5c] bg-[#ff5c5c]/[0.06] border border-[#ff5c5c]/10 rounded-lg px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="group w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-semibold
              bg-[#00e68a] text-[#040812]
              hover:bg-[#00ff9d] active:bg-[#00cc7a]
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#00e68a]
              transition-all duration-200"
            style={{ fontFamily: "'Rajdhani', system-ui, sans-serif" }}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-[#040812]/30 border-t-[#040812] rounded-full animate-spin" />
                Authenticating
              </span>
            ) : (
              <>
                Sign In
                <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p
          className="mt-8 text-[11px] text-[#2a3044] tracking-[0.03em]"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.7s 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          Protected by ProjectAchilles
        </p>
      </div>
    </div>
  );
}

// --- OAuth button component ---
function OAuthButton({
  onClick,
  icon,
  iconColor,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  iconColor: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium
        bg-[#0c1120] border border-[#1a2035] text-[#c0c6d8]
        hover:border-[#2a3352] hover:bg-[#0e1426] hover:text-[#e0e4f0]
        active:bg-[#0a0e1c]
        transition-all duration-200"
    >
      <span style={{ color: iconColor }} className="shrink-0 transition-transform duration-200 group-hover:scale-110">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
