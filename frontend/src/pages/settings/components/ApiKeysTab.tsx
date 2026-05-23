import { useEffect, useState, useCallback } from 'react';
import { apiKeysApi, type ApiKeyInfo, type ApiKeyScope, type GeneratedApiKey } from '@/services/api/apiKeys';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Copy, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

function timeAgoIso(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'destructive' } | null>(null);

  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKeyScope>('read');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<GeneratedApiKey | null>(null);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setKeys(await apiKeysApi.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await apiKeysApi.create(name.trim(), scope, undefined);
      setRevealed(result);
      setName('');
      setScope('read');
      await fetchKeys();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to create key', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (confirmRevokeId !== id) {
      setConfirmRevokeId(id);
      setTimeout(() => setConfirmRevokeId((p) => (p === id ? null : p)), 3000);
      return;
    }
    setConfirmRevokeId(null);
    setRevokingId(id);
    try {
      await apiKeysApi.revoke(id);
      setToast({ message: 'Key revoked', variant: 'success' });
      await fetchKeys();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to revoke', variant: 'destructive' });
    } finally {
      setRevokingId(null);
    }
  }

  async function copyKey() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.key);
    setToast({ message: 'Key copied to clipboard', variant: 'success' });
  }

  if (error) return <div className="text-destructive">{error}</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Long-lived credentials for programmatic API access. Use as <code>Authorization: Bearer pa_…</code>.
          </p>
        </div>
        <button onClick={fetchKeys} className="p-2 rounded-lg hover:bg-accent text-muted-foreground" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex items-end gap-3 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Name (e.g. Splunk exporter)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ApiKeyScope)}
          disabled={creating}
          className="h-[42px] text-sm rounded-lg border border-border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="read">read (analytics, results, agents — read-only)</option>
          <option value="read-write">read-write (operator — no destructive actions)</option>
        </select>
        <Button type="submit" size="sm" disabled={creating || !name.trim()} className="h-[42px]">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
        </Button>
      </form>

      {/* One-time key reveal */}
      {revealed && (
        <div className="mb-6 p-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Copy this key now — it will not be shown again.
              </p>
              <pre className="mt-2 text-xs font-mono break-all text-amber-900 dark:text-amber-100">
                {revealed.key}
              </pre>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button size="sm" onClick={copyKey}>
                <Copy className="w-4 h-4" /> Copy
              </Button>
              <button
                onClick={() => setRevealed(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3 inline" /> Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Key list */}
      {loading ? (
        <Loading message="Loading API keys..." />
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {keys.map((k) => {
            const revoked = !!k.revoked_at;
            return (
              <div key={k.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {k.name}
                    {revoked && <span className="ml-2 text-xs text-muted-foreground">(revoked)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</div>
                  <div className="text-xs text-muted-foreground">
                    {k.scope} · created {timeAgoIso(k.created_at)} · last used {timeAgoIso(k.last_used_at)}
                  </div>
                </div>
                {!revoked && (
                  revokingId === k.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : confirmRevokeId === k.id ? (
                    <Button size="sm" variant="destructive" onClick={() => handleRevoke(k.id)}>
                      Confirm
                    </Button>
                  ) : (
                    <button
                      onClick={() => handleRevoke(k.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Revoke"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <Toast variant={toast.variant} message={toast.message} onClose={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}
