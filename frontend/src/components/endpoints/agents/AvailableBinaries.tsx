import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import type { AgentVersion } from '@/types/agent';
import { getLatestPerPlatform } from '@/pages/endpoints/utils/versionHelpers';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const apiBaseUrl = window.__env__?.VITE_API_URL || import.meta.env.VITE_API_URL || '';

/**
 * Binaries rail card (approved rail-utilities design): the latest agent
 * binary per platform with a direct download per row — the old collapsible
 * table's payload was exactly this list, so it lives in the rail as a
 * plain card now. Size and build date ride in the row tooltip.
 */
export default function AvailableBinaries() {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    agentApi.listVersions()
      .then((v) => setVersions(v))
      .catch(() => {/* silent – card just won't show */})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || versions.length === 0) return null;

  const latest = getLatestPerPlatform(versions);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 text-[11px] uppercase tracking-wider text-faint">binaries</div>
      <div className="flex flex-col gap-1.5">
        {latest.map((v) => (
          <a
            key={`${v.os}-${v.arch}`}
            href={`${apiBaseUrl}/api/agent/download?os=${v.os}&arch=${v.arch}`}
            download
            title={`${formatSize(v.binary_size)} · ${new Date(v.created_at).toLocaleDateString()}`}
            className="group -mx-1.5 flex items-center justify-between rounded px-1.5 py-1 transition-colors hover:bg-raised"
          >
            <span className="font-mono text-[11px] text-muted">
              {v.os} · {v.arch}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-foreground">{v.version}</span>
              <Download className="h-3 w-3 text-accent opacity-70 transition-opacity group-hover:opacity-100" />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
