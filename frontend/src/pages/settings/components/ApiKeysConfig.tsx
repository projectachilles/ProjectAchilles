import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Trash2, Plus, Loader2, Key, Terminal } from 'lucide-react';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { apikeysApi, type ApiKeyInfo } from '@/services/api/apikeys';

export function ApiKeysConfig({ onStatusChange }: { onStatusChange?: (configured: boolean) => void }) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const { keys: list } = await apikeysApi.list();
      setKeys(list);
      onStatusChange?.(list.length > 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [onStatusChange]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleGenerate = async () => {
    setGenerating(true);
    setNewKey(null);
    try {
      const result = await apikeysApi.generate(newLabel || 'External Integration');
      setNewKey(result.key);
      setNewLabel('');
      await loadKeys();
    } catch { /* ignore */ }
    finally { setGenerating(false); }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apikeysApi.revoke(id);
      await loadKeys();
      if (newKey) setNewKey(null);
    } catch { /* ignore */ }
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const baseUrl = window.location.origin;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Generated key — shown once */}
      {newKey && (
        <Alert variant="success">
          <div className="space-y-2">
            <p className="font-medium">API key created. Copy it now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-black/20 rounded px-2.5 py-1.5 font-mono break-all">
                {newKey}
              </code>
              <Button variant="outline" onClick={handleCopy} className="shrink-0 gap-1.5">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {/* Generate new key */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="Key label"
            placeholder="e.g. Banking Compliance Platform"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            helperText="A name to identify what this key is used for"
          />
        </div>
        <Button onClick={handleGenerate} disabled={generating} className="gap-1.5 shrink-0 mb-[2px]">
          {generating
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Plus className="w-4 h-4" />}
          Generate Key
        </Button>
      </div>

      {/* Existing keys */}
      {keys.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Key className="w-3.5 h-3.5" />
            Active Keys ({keys.length})
          </div>
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{k.label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{k.prefix}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(k.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(k.id)}
                    title="Revoke key"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API docs quick reference */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" />
          Quick Reference
        </div>
        <div className="p-3 space-y-3 text-xs">
          <div>
            <p className="text-muted-foreground mb-1">List all tests:</p>
            <code className="block bg-black/20 rounded px-2.5 py-1.5 font-mono text-[11px] break-all">
              curl -H "X-API-Key: ak_..." {baseUrl}/api/v1/tests
            </code>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">MITRE ATT&CK coverage:</p>
            <code className="block bg-black/20 rounded px-2.5 py-1.5 font-mono text-[11px] break-all">
              curl -H "X-API-Key: ak_..." {baseUrl}/api/v1/coverage/mitre
            </code>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Filter by severity:</p>
            <code className="block bg-black/20 rounded px-2.5 py-1.5 font-mono text-[11px] break-all">
              curl -H "X-API-Key: ak_..." {baseUrl}/api/v1/tests?severity=critical
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
