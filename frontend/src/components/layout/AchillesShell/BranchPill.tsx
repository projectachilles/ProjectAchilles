import { useEffect, useState } from 'react';
import { browserApi } from '@/services/api/browser';
import { agentApi } from '@/services/api/agent';
import type { SyncStatus } from '@/types/test';
import { Icon, I } from './icons';

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface BranchPillProps {
  /** Optional sync trigger; if omitted, the Sync button hides. */
  onSync?: () => void;
  syncing?: boolean;
}

export function BranchPill({ onSync, syncing }: BranchPillProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [agentOnline, setAgentOnline] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi
      .getSyncStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => {});
    agentApi
      .listAgents()
      .then((agents) => {
        if (cancelled) return;
        setAgentOnline(agents.filter((a) => a.is_online).length);
      })
      .catch(() => setAgentOnline(0));
    return () => {
      cancelled = true;
    };
  }, []);

  const branch = status?.branch ?? 'unknown';
  const commit = (status?.commitHash ?? '').slice(0, 7) || '—';
  const synced = formatRelative(status?.lastSyncTime ?? null);
  const onlineLabel =
    agentOnline == null
      ? 'agents'
      : agentOnline > 0
        ? `${agentOnline} agent${agentOnline === 1 ? '' : 's'} online`
        : 'no agents online';
  const onlineColor = agentOnline && agentOnline > 0 ? 'var(--accent)' : 'var(--text-muted)';

  return (
    <div className="dash-branch">
      <div className="dash-branch-item">
        <Icon size={12}>{I.branch}</Icon>
        <span>{branch}</span>
        <span className="dash-branch-sha">{commit}</span>
      </div>
      <div className="dash-branch-sep" />
      <div className="dash-branch-item">
        <Icon size={12}>{I.clock}</Icon>
        <span>synced {synced}</span>
      </div>
      <div className="dash-branch-sep" />
      <div className="dash-branch-item">
        <span
          className="dot dot-pulse"
          style={{ background: onlineColor, color: onlineColor }}
        />
        <span style={{ color: onlineColor }}>{onlineLabel}</span>
      </div>
      <div className="dash-branch-spacer" />
      {onSync && (
        <button
          type="button"
          className="dash-quick-btn primary"
          onClick={onSync}
          disabled={syncing}
        >
          <Icon size={12}>{I.sync}</Icon>
          <span>{syncing ? 'Syncing…' : 'Sync'}</span>
        </button>
      )}
    </div>
  );
}
