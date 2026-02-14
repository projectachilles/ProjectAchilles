import { useState, useEffect } from 'react';
import { Hammer, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';

function getNextVersion(versions: AgentVersion[], os: string): string {
  let best: { major: number; minor: number; patch: number } | null = null;
  for (const v of versions) {
    if (v.os !== os) continue;
    const m = v.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const cur = { major: +m[1], minor: +m[2], patch: +m[3] };
    if (
      !best ||
      cur.major > best.major ||
      (cur.major === best.major && cur.minor > best.minor) ||
      (cur.major === best.major && cur.minor === best.minor && cur.patch > best.patch)
    ) {
      best = cur;
    }
  }
  if (!best) return '';
  return `${best.major}.${best.minor}.${best.patch + 1}`;
}

function getDefaultOs(versions: AgentVersion[]): string {
  return versions.length > 0 ? versions[0].os : 'linux';
}

const OS_OPTIONS = [
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows' },
  { value: 'darwin', label: 'macOS' },
];

const ARCH_OPTIONS = [
  { value: 'amd64', label: 'x86_64 (amd64)' },
  { value: 'arm64', label: 'ARM64' },
];

interface AgentBuildFromSourceProps {
  versions: AgentVersion[];
  onBuilt: () => void;
}

export function AgentBuildFromSource({ versions, onBuilt }: AgentBuildFromSourceProps) {
  const [os, setOs] = useState(() => getDefaultOs(versions));
  const [version, setVersion] = useState(() => getNextVersion(versions, os));
  const [arch, setArch] = useState('amd64');
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (versions.length === 0) return;
    setVersion(getNextVersion(versions, os));
  }, [versions, os]);

  async function handleBuild() {
    if (!version) return;

    setBuilding(true);
    setMessage(null);

    try {
      const result = await agentApi.buildVersion(version, os, arch);
      const signedLabel = result.signed ? ' (signed)' : '';
      setMessage({
        type: 'success',
        text: `Built ${result.version} for ${result.os}/${result.arch}${signedLabel} — ${formatSize(result.binary_size)}`,
      });
      // Bump to next patch version so the form is ready for another build
      const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
      setVersion(m ? `${m[1]}.${m[2]}.${+m[3] + 1}` : '');
      onBuilt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Build failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setBuilding(false);
    }
  }

  const canBuild = !!version.trim() && !building;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="Version"
          placeholder="0.5.0"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          disabled={building}
        />
        <Select
          label="Operating System"
          options={OS_OPTIONS}
          value={os}
          onChange={(e) => setOs(e.target.value)}
          disabled={building}
        />
        <Select
          label="Architecture"
          options={ARCH_OPTIONS}
          value={arch}
          onChange={(e) => setArch(e.target.value)}
          disabled={building}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {os === 'windows' ? (
          <>
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Windows binaries will be Authenticode-signed if an active certificate is configured</span>
          </>
        ) : os === 'darwin' ? (
          <>
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>macOS binaries will be ad-hoc signed via rcodesign if installed</span>
          </>
        ) : (
          <>
            <ShieldOff className="w-4 h-4" />
            <span>Code signing is not available for Linux binaries</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleBuild} disabled={!canBuild}>
          {building ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Building...
            </>
          ) : (
            <>
              <Hammer className="w-4 h-4 mr-2" />
              Build Binary
            </>
          )}
        </Button>
        {building && (
          <span className="text-sm text-muted-foreground">
            Go cross-compilation may take up to a minute...
          </span>
        )}
      </div>

      {message && (
        <Alert variant={message.type === 'success' ? 'default' : 'destructive'}>
          {message.text}
        </Alert>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
