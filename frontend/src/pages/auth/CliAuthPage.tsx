/**
 * CLI device-flow verification page.
 *
 * The CLI displays a code and sends the user here. Since they're already
 * logged in via Clerk, this page just confirms the code and calls the
 * backend to link the CLI session to their identity.
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Check } from 'lucide-react';
import { I, Icon } from '@/components/layout/AchillesShell';
import '@/pages/settings/settings.css';

export default function CliAuthPage() {
  const [searchParams] = useSearchParams();
  const codeFromUrl = searchParams.get('code') ?? '';
  const [code, setCode] = useState(codeFromUrl);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { getToken, isLoaded } = useAuth();
  const autoVerifyAttempted = useRef(false);

  // Auto-verify once Clerk is loaded and a code is present in the URL.
  // useRef guard prevents React Strict Mode double-fire.
  useEffect(() => {
    if (codeFromUrl && isLoaded && !autoVerifyAttempted.current) {
      autoVerifyAttempted.current = true;
      verify(codeFromUrl);
    }
  }, [codeFromUrl, isLoaded]);

  async function verify(userCode: string) {
    if (!userCode.trim()) return;

    setStatus('verifying');
    setErrorMessage('');

    try {
      const token = await getToken();
      if (!token) {
        setStatus('error');
        setErrorMessage('Not authenticated. Please sign in first.');
        return;
      }
      const apiBase = window.__env__?.VITE_API_URL || import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBase}/api/cli/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_code: userCode.trim().toUpperCase() }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(data.error ?? 'Verification failed');
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <div className="cli-auth-shell">
      <div className="cli-auth-card">
        <div className="cli-auth-brand">
          <div className="cli-auth-brand-mark">
            <span className="accent-dot" />
            ProjectAchilles
          </div>
          <div className="cli-auth-brand-sub">CLI Authorization</div>
        </div>

        <section className="dash-card" style={{ padding: 24 }}>
          {status === 'success' ? (
            <div className="cli-auth-success">
              <span className="cli-auth-success-icon">
                <Check size={26} strokeWidth={2.5} />
              </span>
              <h2 className="cli-auth-success-title">CLI Authorized</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: 0 }}>
                Your CLI session has been authenticated. You can close this tab and return to
                the terminal.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <header style={{ textAlign: 'center' }}>
                <h2 className="dash-card-title" style={{ justifyContent: 'center', marginBottom: 6 }}>
                  <span className="accent-dot" />
                  Authorize CLI Access
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
                  Enter the code shown in your terminal to authorize the CLI.
                </p>
              </header>

              <div>
                <label className="mono-label" style={{ display: 'block', marginBottom: 8 }}>
                  Device Code
                </label>
                <input
                  type="text"
                  className="cli-auth-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  disabled={status === 'verifying'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') verify(code);
                  }}
                  autoFocus={!codeFromUrl}
                />
              </div>

              {status === 'error' && <div className="cli-auth-error">{errorMessage}</div>}

              <button
                type="button"
                className="dash-quick-btn primary"
                style={{ width: '100%', justifyContent: 'center', padding: '10px 14px' }}
                onClick={() => verify(code)}
                disabled={!code.trim() || status === 'verifying'}
              >
                <Icon size={12}>{I.bolt}</Icon>
                {status === 'verifying' ? 'Verifying…' : 'Authorize CLI'}
              </button>

              <p className="cli-auth-foot">
                This grants the CLI access to your ProjectAchilles account. The session
                expires in 7 days.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
