import { useCallback, useEffect, useState } from 'react';
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
  /** When provided, BranchPill renders a Sync button that POSTs the sync,
      refetches its own state, then calls this so the page can refresh too. */
  onAfterSync?: () => void;
}

type SyncPhase = 'idle' | 'syncing' | 'error';

/** Header status strip: branch + last sync + agent online + Sync action.
    Self-contained — owns its data fetching and the Sync flow. */
export function BranchPill({ onAfterSync }: BranchPillProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [agentOnline, setAgentOnline] = useState<number | null>(null);
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, agents] = await Promise.all([
      browserApi.getSyncStatus().catch(() => null),
      agentApi.listAgents().catch(() => []),
    ]);
    setStatus(s);
    setAgentOnline(agents.filter((a) => a.is_online).length);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSync = async () => {
    setPhase('syncing');
    setSyncError(null);
    try {
      await browserApi.syncTests();
      await refresh();
      setPhase('idle');
      onAfterSync?.();
    } catch (e) {
      setPhase('error');
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    }
  };

  const branch = status?.branch ?? 'unknown';
  const commit = (status?.commitHash ?? '').slice(0, 7) || '—';
  const synced = formatRelative(status?.lastSyncTime ?? null);

  // Three agent-online visual states: loading (muted) / connected (green pulse) / none (muted, no pulse)
  const isOnline = agentOnline != null && agentOnline > 0;
  const onlineLabel =
    agentOnline == null
      ? 'checking agents'
      : isOnline
        ? `${agentOnline} agent${agentOnline === 1 ? '' : 's'} online`
        : 'no agents online';
  const onlineColor = isOnline ? 'var(--accent)' : 'var(--text-muted)';

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
          className={isOnline ? 'dot dot-pulse' : 'dot'}
          style={{ background: onlineColor, color: onlineColor }}
        />
        <span style={{ color: onlineColor }}>{onlineLabel}</span>
      </div>
      <div className="dash-branch-spacer" />
      {syncError && (
        <span style={{ color: 'var(--danger)', fontSize: 11 }} title={syncError}>
          sync failed
        </span>
      )}
      <button
        type="button"
        className="dash-quick-btn primary"
        onClick={handleSync}
        disabled={phase === 'syncing'}
      >
        <span className={phase === 'syncing' ? 'dash-spin' : undefined}>
          <Icon size={12}>{I.sync}</Icon>
        </span>
        <span>{phase === 'syncing' ? 'Syncing…' : 'Sync'}</span>
      </button>
    </div>
  );
}
