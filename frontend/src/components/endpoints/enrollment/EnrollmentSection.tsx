import { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, RefreshCw, Trash2, Key, Terminal, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Badge } from '@/components/shared/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/ui/Table';
import { agentApi } from '@/services/api/agent';
import type { EnrollmentToken } from '@/types/agent';

interface EnrollmentSectionProps {
  orgId: string;
}

type TokenStatus = 'expired' | 'exhausted' | 'active';

function getTokenStatus(token: EnrollmentToken): TokenStatus {
  if (new Date(token.expires_at) < new Date()) return 'expired';
  if (token.use_count >= token.max_uses) return 'exhausted';
  return 'active';
}

function CopyButton({ text, className = '' }: { text: string; className?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="ghost" size="sm" className={className} onClick={handleCopy}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function InstallCommand({
  label,
  command,
}: {
  label: string;
  command: string;
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium mb-1">
        <Terminal className="w-4 h-4" />
        {label}
      </div>
      <div className="relative">
        <pre className="text-xs bg-background p-3 rounded overflow-x-auto">{command}</pre>
        <CopyButton text={command} className="absolute top-1 right-1" />
      </div>
    </div>
  );
}

export default function EnrollmentSection({ orgId }: EnrollmentSectionProps): React.ReactElement {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [, setLoading] = useState(true);
  const [ttlHours, setTtlHours] = useState('24');
  const [maxUses, setMaxUses] = useState('1');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const result = await agentApi.listTokens();
      setTokens(result);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      const result = await agentApi.createToken({
        org_id: orgId,
        ttl_hours: parseInt(ttlHours) || 24,
        max_uses: parseInt(maxUses) || 1,
      });
      setNewToken(result.token ?? result.id);
      fetchTokens();
    } catch (err) {
      console.error('Failed to create token:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    try {
      await agentApi.revokeToken(tokenId);
      fetchTokens();
    } catch (err) {
      console.error('Failed to revoke token:', err);
    }
  }

  const [serverUrl, setServerUrl] = useState(window.location.origin);

  useEffect(() => {
    agentApi.getConfig()
      .then((config) => setServerUrl(config.server_url))
      .catch(() => { /* keep window.location.origin fallback */ });
  }, []);

  return (
    <div className="space-y-6">
      {/* Generate Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Generate Enrollment Token
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <Input
              label="TTL (hours)"
              type="number"
              value={ttlHours}
              onChange={(e) => setTtlHours(e.target.value)}
              className="w-32"
            />
            <Input
              label="Max Uses"
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="w-32"
            />
            <Button onClick={handleCreate} disabled={creating}>
              <Plus className="w-4 h-4 mr-2" />
              {creating ? 'Generating...' : 'Generate Token'}
            </Button>
          </div>

          {newToken && (
            <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-primary">Token Generated</span>
                <CopyButton text={newToken} />
              </div>
              <code className="block text-sm font-mono bg-background p-3 rounded break-all">
                {newToken}
              </code>

              <div className="mt-4 space-y-3">
                <InstallCommand
                  label="Linux (amd64)"
                  command={`curl -fSL -H "ngrok-skip-browser-warning: true" "${serverUrl}/api/agent/download?os=linux&arch=amd64" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent --enroll ${newToken} --server ${serverUrl} --install`}
                />
                <InstallCommand
                  label="Linux (arm64)"
                  command={`curl -fSL -H "ngrok-skip-browser-warning: true" "${serverUrl}/api/agent/download?os=linux&arch=arm64" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent --enroll ${newToken} --server ${serverUrl} --install`}
                />
                <InstallCommand
                  label="Windows (PowerShell)"
                  command={`Invoke-WebRequest -Uri "${serverUrl}/api/agent/download?os=windows&arch=amd64" -Headers @{"ngrok-skip-browser-warning"="true"} -OutFile achilles-agent.exe; .\\achilles-agent.exe --enroll ${newToken} --server ${serverUrl} --install`}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Tokens</CardTitle>
            <Button variant="outline" size="sm" onClick={fetchTokens}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                    No tokens found
                  </TableCell>
                </TableRow>
              ) : (
                tokens.map((token) => {
                  const status = getTokenStatus(token);
                  const isInactive = status !== 'active';
                  return (
                    <TableRow key={token.id}>
                      <TableCell className="font-mono text-xs">
                        {token.id.slice(0, 12)}...
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(token.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(token.expires_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {token.use_count} / {token.max_uses}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isInactive ? 'destructive' : 'success'}>
                          {status === 'expired'
                            ? 'Expired'
                            : status === 'exhausted'
                              ? 'Exhausted'
                              : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRevoke(token.id)}
                          disabled={isInactive}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
