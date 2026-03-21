import { useState } from 'react';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '../../shared/ui/Dialog';
import { Button } from '../../shared/ui/Button';
import { Alert } from '../../shared/ui/Alert';
import { Spinner } from '../../shared/ui/Spinner';
import { Checkbox } from '../../shared/ui/Checkbox';
import { agentApi } from '@/services/api/agent';
import type { AgentSummary } from '@/types/agent';

interface BulkDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  agents: AgentSummary[];
  onDeleted: () => void;
}

export default function BulkDeleteDialog({
  open,
  onClose,
  agents,
  onDeleted,
}: BulkDeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleClose() {
    setLoading(false);
    setError(null);
    setConfirmed(false);
    onClose();
  }

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      for (const agent of agents) {
        await agentApi.deleteAgent(agent.id);
      }
      onDeleted();
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete agents';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const count = agents.length;
  const plural = count === 1 ? '' : 's';

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader onClose={onClose}>
        <DialogTitle>Delete Agent{plural}</DialogTitle>
        <DialogDescription>
          Decommission {count} agent{plural} from your fleet
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <Alert variant="destructive">
          This will mark {count} agent{plural} as decommissioned. They will no longer
          appear in the active agent list or be able to receive tasks.
        </Alert>

        <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/50 p-2">
          {agents.map((a) => (
            <div key={a.id} className="text-sm py-0.5 font-mono">
              {a.hostname} <span className="text-muted-foreground">({a.os})</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2">
          <Checkbox checked={confirmed} onChange={() => setConfirmed((v) => !v)} />
          <p className="text-sm">
            I confirm I want to delete {count} agent{plural}
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mt-3">
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={loading || !confirmed}
        >
          {loading && <Spinner className="w-4 h-4 mr-2" />}
          Delete{count > 1 ? ` (${count})` : ''}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
