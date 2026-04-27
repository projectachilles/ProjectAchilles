import { useEffect, useRef, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import { useHasPermission } from '@/hooks/useAppRole';
import type { AgentSummary } from '@/types/agent';
import { ConfirmDialog } from './ConfirmDialog';

interface AgentRowMenuProps {
  agent: AgentSummary;
  onChanged: () => void;
}

export function AgentRowMenu({ agent, onChanged }: AgentRowMenuProps) {
  const canWrite = useHasPermission('endpoints:agents:write');
  const canDelete = useHasPermission('endpoints:agents:delete');
  const [open, setOpen] = useState(false);
  const [confirmDecom, setConfirmDecom] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function decommission() {
    setLoading(true);
    setError(null);
    try {
      await agentApi.updateAgent(agent.id, { status: 'decommissioned' });
      onChanged();
      setConfirmDecom(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decommission agent');
    } finally {
      setLoading(false);
    }
  }

  async function deleteAgent() {
    setLoading(true);
    setError(null);
    try {
      await agentApi.deleteAgent(agent.id);
      onChanged();
      setConfirmDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setLoading(false);
    }
  }

  if (!canWrite && !canDelete) {
    return null;
  }

  return (
    <span className="ep-action-menu-wrap" ref={wrapRef}>
      <button className="ep-icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Agent actions">
        <Icon size={14}>{I.cog}</Icon>
      </button>
      {open && (
        <div className="ep-action-menu" role="menu">
          {canWrite && agent.status === 'active' && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmDecom(true);
              }}
            >
              <Icon size={12}>{I.lock}</Icon> Decommission
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                setOpen(false);
                setConfirmDelete(true);
              }}
            >
              <Icon size={12}>{I.alert}</Icon> Delete
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDecom}
        title="Decommission agent"
        description={`Mark ${agent.hostname} as decommissioned?`}
        body={
          <p className="text-sm text-muted-foreground">
            The agent will stop receiving new tasks. You can re-enroll the host later.
          </p>
        }
        confirmLabel="Decommission"
        loading={loading}
        error={error}
        onClose={() => {
          setConfirmDecom(false);
          setError(null);
        }}
        onConfirm={decommission}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete agent"
        description={`Permanently delete ${agent.hostname}?`}
        body={
          <p className="text-sm">
            This removes the agent record and all associated tasks. This action cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        loading={loading}
        error={error}
        onClose={() => {
          setConfirmDelete(false);
          setError(null);
        }}
        onConfirm={deleteAgent}
      />
    </span>
  );
}
