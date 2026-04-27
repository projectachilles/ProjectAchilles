import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';
import { getLatestPerPlatform } from '@/pages/endpoints/utils/versionHelpers';

const apiBaseUrl = window.__env__?.VITE_API_URL || import.meta.env.VITE_API_URL || '';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Collapsed strip listing the available agent binaries per platform.
 * Restyled to the Tactical Green design.
 */
export function AvailableBinariesStrip() {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    agentApi
      .listVersions()
      .then(setVersions)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || versions.length === 0) return null;

  const latest = getLatestPerPlatform(versions);

  return (
    <div>
      <button
        className="ep-strip"
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', textAlign: 'left' }}
      >
        <div className="ep-strip-info">
          <Icon size={14}>{I.cog}</Icon>
          <span>Available Binaries</span>
          <span className="ep-pill" style={{ color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
            {latest.length} platform{latest.length === 1 ? '' : 's'}
          </span>
        </div>
        <span className={`ep-strip-chev ${open ? 'is-open' : ''}`}>
          <Icon size={14}>{I.chevronRight}</Icon>
        </span>
      </button>

      {open && (
        <div className="ep-strip-content">
          <table className="ep-table" style={{ border: 'none', background: 'transparent' }}>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Version</th>
                <th>Size</th>
                <th className="col-actions">Download</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((v) => (
                <tr key={`${v.os}-${v.arch}`}>
                  <td className="col-mono">
                    {v.os}/{v.arch}
                  </td>
                  <td className="col-mono">v{v.version}</td>
                  <td className="col-mono">{formatSize(v.binary_size)}</td>
                  <td className="col-actions">
                    <a
                      className="ep-btn"
                      href={`${apiBaseUrl}/agent/download?os=${v.os}&arch=${v.arch}&version=${v.version}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon size={12}>{I.download}</Icon> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
