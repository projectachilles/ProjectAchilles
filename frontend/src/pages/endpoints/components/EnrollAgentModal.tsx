import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';

interface EnrollAgentModalProps {
  onClose: () => void;
}

interface OsCommand {
  id: string;
  label: string;
  cmd: string;
}

function buildOsCommands(token: string, serverUrl: string): OsCommand[] {
  const url = serverUrl.replace(/\/$/, '');
  const dl = (os: string, arch: string) =>
    `${url}/api/agent/download?os=${os}&arch=${arch}`;
  return [
    {
      id: 'windows',
      label: 'Windows (PowerShell)',
      cmd: `Invoke-WebRequest -Uri "${dl('windows', 'amd64')}" -OutFile achilles-agent.exe; .\\achilles-agent.exe install -t ${token}`,
    },
    {
      id: 'linux64',
      label: 'Linux (amd64)',
      cmd: `curl -fSL "${dl('linux', 'amd64')}" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent install -t ${token}`,
    },
    {
      id: 'linuxarm',
      label: 'Linux (arm64)',
      cmd: `curl -fSL "${dl('linux', 'arm64')}" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent install -t ${token}`,
    },
    {
      id: 'macarm',
      label: 'macOS (Apple Silicon)',
      cmd: `curl -fSL "${dl('darwin', 'arm64')}" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent install -t ${token}`,
    },
    {
      id: 'macintel',
      label: 'macOS (Intel)',
      cmd: `curl -fSL "${dl('darwin', 'amd64')}" -o achilles-agent && chmod +x achilles-agent && sudo ./achilles-agent install -t ${token}`,
    },
  ];
}

export function EnrollAgentModal({ onClose }: EnrollAgentModalProps) {
  const [ttl, setTtl] = useState('24');
  const [maxUses, setMaxUses] = useState('1');
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('https://your-achilles-server');
  const [open, setOpen] = useState<string | null>('windows');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    agentApi
      .getConfig()
      .then((c) => setServerUrl(c.server_url))
      .catch(() => undefined);
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const t = await agentApi.createToken({
        org_id: 'default',
        ttl_hours: Number(ttl),
        max_uses: Number(maxUses),
      });
      setToken(t.token ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setGenerating(false);
    }
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  const commands = buildOsCommands(token ?? '<TOKEN_HERE>', serverUrl);

  return (
    <div className="ep-modal-shell" onClick={onClose}>
      <div className="ep-modal is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="ep-modal-head">
          <div>
            <div className="ep-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={16}>{I.shield}</Icon> Enroll Agent
            </div>
            <div className="ep-modal-sub">
              Generate a one-time token, then run the install command on the target host
            </div>
          </div>
          <button className="ep-icon-btn" onClick={onClose} aria-label="Close">
            <Icon size={14}>{I.alert}</Icon>
          </button>
        </div>

        <div className="ep-modal-body">
          <div className="ep-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="ep-field" style={{ margin: 0 }}>
              <label className="ep-field-label">TTL (hours)</label>
              <input
                className="ep-field-input"
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
                type="number"
                min={1}
              />
            </div>
            <div className="ep-field" style={{ margin: 0 }}>
              <label className="ep-field-label">Max Uses</label>
              <input
                className="ep-field-input"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                type="number"
                min={1}
              />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="ep-field-label" style={{ marginBottom: 6 }}>
              Token
            </div>
            <div className="ep-token">
              <span className="ep-token-text">{token ?? 'Click "Generate New Token" to create one'}</span>
              {token && (
                <button
                  className="ep-icon-btn"
                  onClick={() => copy(token, 'token')}
                  aria-label="Copy token"
                >
                  <Icon size={12}>{I.task}</Icon>
                </button>
              )}
            </div>
            {copied === 'token' && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>Copied!</div>
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="ep-field-label" style={{ marginBottom: 8 }}>
              Install Commands
            </div>
            {commands.map((os) => (
              <div className="ep-os-block" key={os.id}>
                <button
                  className={`ep-os-block-head ${open === os.id ? 'is-open' : ''}`}
                  type="button"
                  onClick={() => setOpen(open === os.id ? null : os.id)}
                >
                  <Icon size={12}>{I.monitor}</Icon>
                  <span>{os.label}</span>
                  <span className="ep-os-block-chev">
                    <Icon size={11}>{I.chevronRight}</Icon>
                  </span>
                </button>
                {open === os.id && (
                  <div className="ep-os-block-body">
                    <code>{os.cmd}</code>
                    <button
                      className="ep-icon-btn"
                      onClick={() => copy(os.cmd, os.id)}
                      aria-label={`Copy ${os.label} command`}
                    >
                      <Icon size={11}>{I.task}</Icon>
                    </button>
                  </div>
                )}
                {copied === os.id && (
                  <div style={{ padding: '4px 14px', fontSize: 11, color: 'var(--accent)' }}>Copied!</div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: '10px 14px',
              background: 'rgba(79,142,255,.06)',
              border: '1px solid rgba(79,142,255,.2)',
              borderRadius: 6,
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <Icon size={14}>{I.shield}</Icon>
            <span>
              Token expires in {ttl}h · single-use · agent fingerprint pinned at first heartbeat. Active
              tokens appear in the Tokens table after generation.
            </span>
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: 'rgba(255,59,92,.08)',
                border: '1px solid rgba(255,59,92,.3)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="ep-modal-foot">
          <button className="ep-btn" onClick={onClose}>
            Close
          </button>
          <button className="ep-btn primary" onClick={generate} disabled={generating}>
            <Icon size={12}>{I.sync}</Icon>
            {generating ? 'Generating…' : token ? 'Generate New Token' : 'Generate Token'}
          </button>
        </div>
      </div>
    </div>
  );
}
