/**
 * CLI device flow verification page.
 *
 * The CLI displays a code and sends the user here. Since they're already
 * logged in via Clerk, this page just confirms the code and calls the
 * backend to link the CLI session to their identity.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';

export default function CliAuthPage() {
  const [searchParams] = useSearchParams();
  const codeFromUrl = searchParams.get('code') ?? '';
  const [code, setCode] = useState(codeFromUrl);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { getToken } = useAuth();

  // Auto-verify if code came from URL
  useEffect(() => {
    if (codeFromUrl && status === 'idle') {
      verify(codeFromUrl);
    }
  }, [codeFromUrl]);

  async function verify(userCode: string) {
    if (!userCode.trim()) return;

    setStatus('verifying');
    setErrorMessage('');

    try {
      const token = await getToken();
      const response = await fetch('/api/cli/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-primary mb-2">◆ ProjectAchilles</div>
          <div className="text-muted-foreground">CLI Authorization</div>
        </div>

        <div className="border border-border rounded-lg bg-card p-6 shadow-lg">
          {status === 'success' ? (
            <div className="text-center space-y-4">
              <div className="text-4xl">✓</div>
              <h2 className="text-xl font-semibold text-green-500">CLI Authorized</h2>
              <p className="text-muted-foreground">
                Your CLI session has been authenticated. You can close this tab
                and return to the terminal.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-lg font-semibold mb-1">Authorize CLI Access</h2>
                <p className="text-sm text-muted-foreground">
                  Enter the code shown in your terminal to authorize the CLI.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Device Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest
                             bg-background border border-border rounded-md
                             focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={status === 'verifying'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') verify(code);
                  }}
                  autoFocus={!codeFromUrl}
                />
              </div>

              {status === 'error' && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <p className="text-sm text-destructive">{errorMessage}</p>
                </div>
              )}

              <button
                onClick={() => verify(code)}
                disabled={!code.trim() || status === 'verifying'}
                className="w-full py-3 px-4 rounded-md font-medium
                           bg-primary text-primary-foreground
                           hover:bg-primary/90
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
              >
                {status === 'verifying' ? 'Verifying...' : 'Authorize CLI'}
              </button>

              <p className="text-xs text-center text-muted-foreground">
                This grants the CLI access to your ProjectAchilles account.
                The session expires in 30 days.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
