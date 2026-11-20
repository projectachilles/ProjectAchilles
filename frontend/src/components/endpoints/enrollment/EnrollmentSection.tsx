import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, Trash2, Key } from 'lucide-react';
import { Alert } from '@/components/shared/ui/Alert';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Button } from '@/components/shared/ui/Button';
import { CopyButton } from '@/components/shared/ui/CopyButton';
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
import type { AgentVersion, EnrollmentToken, PlatformReadiness } from '@/types/agent';
import { useInstallReadiness } from '@/hooks/useInstallReadiness';
import { fieldLabelClass } from '@/components/shared/ui/formStyles';
import { pillClass } from '@/components/shared/ui/pillStyles';
import { buildInstallCommands, type InstallCommand } from './installCommands';
import { ManagementToolPanel, type ManagementToolPanelProps } from './ManagementToolPanel';
import { getLatestPerPlatform } from '@/pages/endpoints/utils/versionHelpers';

interface EnrollmentSectionProps {
  orgId: string;
}

type TokenStatus = 'expired' | 'exhausted' | 'active';

function getTokenStatus(token: EnrollmentToken): TokenStatus {
  if (new Date(token.expires_at) < new Date()) return 'expired';
  if (token.use_count >= token.max_uses) return 'exhausted';
  return 'active';
}

/** Where an agent binary is built or uploaded. */
const AGENT_SETTINGS_URL = '/settings?tab=agent';

const buildLinkClass =
  'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover';

/** The readiness entry behind an install command: ids are `<os>` (amd64) or `<os>-<arch>`. */
function readinessFor(
  id: InstallCommand['id'],
  platforms: PlatformReadiness[] | null,
): PlatformReadiness | null {
  if (!platforms) return null;
  const [os, arch = 'amd64'] = id.split('-');
  return platforms.find((p) => p.os === os && p.arch === arch) ?? null;
}

/** Shown in place of a command whose download would fail. */
function MissingBinaryPanel({ label, platform, othersReady }: {
  label: string;
  platform: PlatformReadiness;
  /** Whether some other platform has a binary, so the token is usable there. */
  othersReady: boolean;
}): React.ReactElement {
  return (
    <div role="tabpanel" aria-label={label} className="rounded-md border border-warning/40 bg-background">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-warning">
        No agent binary for {label}
      </div>
      <div className="space-y-3 p-3">
        <p className="text-sm leading-relaxed">
          {platform.reason === 'file missing'
            ? `Agent ${platform.version} for ${label} is registered, but its file is gone from the server, so the download would fail. Build or upload it again.`
            : `This server has no agent for ${label}, so the install command would stop at the download with a 404.${othersReady ? ' The token above is fine and works for the other platforms.' : ''}`}
        </p>
        <Link to={AGENT_SETTINGS_URL} className={buildLinkClass}>
          Build for {label}
        </Link>
      </div>
    </div>
  );
}

/** The tab after the platforms: an unattended script for a management tool. */
const MANAGEMENT_TAB = 'management' as const;
type InstallTab = InstallCommand['id'] | typeof MANAGEMENT_TAB;

function InstallCommands({
  serverUrl,
  token,
  platforms,
  tokenLimits,
  windowsVersion,
}: {
  serverUrl: string;
  token: string;
  /** null while readiness is unknown: every command is then shown as before. */
  platforms: PlatformReadiness[] | null;
  tokenLimits: ManagementToolPanelProps['tokenLimits'];
  /** Latest registered Windows amd64 version; null when the versions list did not load or has none. */
  windowsVersion: AgentVersion | null;
}): React.ReactElement {
  const commands = buildInstallCommands(serverUrl, token);
  // The user's choice wins; until they pick, start on the first platform whose download works.
  const [picked, setPicked] = useState<InstallTab | null>(null);
  const firstReady = commands.find((c) => readinessFor(c.id, platforms)?.ready);
  const selected = picked ?? firstReady?.id ?? commands[0].id;
  const current = commands.find((c) => c.id === selected) ?? commands[0];
  const currentReadiness = readinessFor(current.id, platforms);
  const managementSelected = selected === MANAGEMENT_TAB;
  const windowsReadiness = readinessFor('windows', platforms);

  return (
    <div className="mt-4 space-y-2">
      <div className={fieldLabelClass}>Install command</div>
      <div role="tablist" aria-label="Platform" className="flex flex-wrap gap-2">
        {commands.map((c) => {
          const readiness = readinessFor(c.id, platforms);
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === selected}
              className={pillClass(c.id === selected)}
              onClick={() => setPicked(c.id)}
            >
              {c.label}
              {readiness && (
                <>
                  {' '}
                  <span className={`font-mono text-[11px] ${readiness.ready ? 'opacity-70' : 'text-warning'}`}>
                    {readiness.ready ? readiness.version : 'no binary'}
                  </span>
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={managementSelected}
          className={pillClass(managementSelected)}
          onClick={() => setPicked(MANAGEMENT_TAB)}
        >
          Management tool
        </button>
      </div>
      {managementSelected ? (
        windowsReadiness && !windowsReadiness.ready ? (
          <MissingBinaryPanel label="Windows" platform={windowsReadiness} othersReady={firstReady !== undefined} />
        ) : (
          <ManagementToolPanel
            serverUrl={serverUrl}
            token={token}
            tokenLimits={tokenLimits}
            // Offer the script only for a Windows agent the server confirmed it can
            // serve, and only when the version list describes that same agent: the
            // pinned certificate is read from the list.
            windowsVersion={windowsReadiness?.ready && windowsVersion && windowsVersion.version === windowsReadiness.version
              ? { version: windowsVersion.version, signed: windowsVersion.signed === true, signerSubject: windowsVersion.signer_subject ?? null, signerFingerprint: windowsVersion.signer_fingerprint ?? null }
              : null}
          />
        )
      ) : currentReadiness && !currentReadiness.ready ? (
        <MissingBinaryPanel label={current.label} platform={currentReadiness} othersReady={firstReady !== undefined} />
      ) : (
        <div role="tabpanel" aria-label={current.label} className="rounded-md border border-border bg-background">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <span className="text-xs text-muted">{current.hint}</span>
            <CopyButton text={current.command} label="Copy command" variant="accent" />
          </div>
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed">{current.command}</pre>
        </div>
      )}
    </div>
  );
}

export default function EnrollmentSection({ orgId }: EnrollmentSectionProps): React.ReactElement {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [, setLoading] = useState(true);
  const [ttlHours, setTtlHours] = useState('24');
  const [maxUses, setMaxUses] = useState('1');
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<EnrollmentToken | null>(null);
  const newToken = createdToken ? (createdToken.token ?? createdToken.id) : null;
  // The registered Windows agent, for the management-tool script's signature check.
  const [windowsVersion, setWindowsVersion] = useState<AgentVersion | null>(null);
  const loadWindowsVersion = useCallback(() => {
    agentApi.listVersions()
      .then((versions) => {
        setWindowsVersion(getLatestPerPlatform(versions).find((v) => v.os === 'windows' && v.arch === 'amd64') ?? null);
      })
      .catch(() => { /* unknown: the management tab then offers no script */ });
  }, []);
  useEffect(() => { loadWindowsVersion(); }, [loadWindowsVersion]);
  const readiness = useInstallReadiness();
  // Only a completed check counts: while loading or unknown, nothing changes.
  const platforms = readiness.status === 'ready' ? readiness.data.platforms : null;
  const noBinary = readiness.status === 'ready' && !readiness.data.any_ready;

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const result = await agentApi.listTokens(orgId);
      setTokens(result);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

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
      setCreatedToken(result);
      // The script pins what is registered now, not when the dialog opened.
      loadWindowsVersion();
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
    <div className="min-w-0 space-y-6">
      {/* Generate Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Generate Enrollment Token
          </CardTitle>
        </CardHeader>
        <CardContent>
          {noBinary && (
            <Alert variant="warning" title="No agent binary on this server" className="mb-4">
              <p className="text-foreground">
                The install command downloads the agent from this server. None is registered yet, so the
                command would fail at the download step on every platform.
              </p>
              <Link to={AGENT_SETTINGS_URL} className={`mt-3 ${buildLinkClass}`}>
                Build or upload an agent
              </Link>
            </Alert>
          )}
          <div className="flex flex-wrap gap-4 items-end">
            {/* Input's own wrapper is full width, so the width goes on a wrapper here:
                on the input alone, each field took a whole row. */}
            <div className="w-32">
              <Input
                label="TTL (hours)"
                type="number"
                value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value)}
              />
            </div>
            <div className="w-32">
              <Input
                label="Max Uses"
                type="number"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
            <Button onClick={handleCreate} disabled={creating} variant={noBinary ? 'outline' : undefined}>
              <Plus className="w-4 h-4 mr-2" />
              {creating ? 'Generating...' : noBinary ? 'Generate token anyway' : 'Generate Token'}
            </Button>
          </div>
          {noBinary && (
            <p className="mt-3 text-xs text-muted">
              A token generated now stays valid for its TTL, so you can build the agent afterwards and install later.
            </p>
          )}

          {newToken && (
            <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-primary">Token Generated</span>
                <CopyButton text={newToken} ariaLabel="Copy token" />
              </div>
              <code className="block break-all rounded-md border border-border bg-background p-3 font-mono text-xs">
                {newToken}
              </code>

              <InstallCommands
                serverUrl={serverUrl}
                token={newToken}
                platforms={platforms}
                windowsVersion={windowsVersion}
                tokenLimits={createdToken?.expires_at && createdToken.max_uses
                  ? { maxUses: createdToken.max_uses, expiresAt: createdToken.expires_at }
                  : null}
              />
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
