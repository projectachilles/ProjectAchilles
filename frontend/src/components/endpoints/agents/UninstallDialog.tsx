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

interface UninstallDialogProps {
  open: boolean;
  onClose: () => void;
  agents: AgentSummary[];
  onUninstalled: () => void;
}

export default function UninstallDialog({
  open,
  onClose,
  agents,
  onUninstalled,
}: UninstallDialogProps) {
  const [phase, setPhase] = useState<'confirm' | 'result'>('confirm');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cleanup, setCleanup] = useState(false);

  function handleClose() {
    setPhase('confirm');
    setLoading(false);
    setError(null);
    setConfirmed(false);
    setCleanup(false);
    onClose();
  }

  async function handleUninstall() {
    setLoading(true);
    setError(null);
    try {
      await agentApi.createUninstallTasks({
        org_id: 'default',
        agent_ids: agents.map((a) => a.id),
        cleanup,
      });
      setPhase('result');
      onUninstalled();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create uninstall tasks';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const count = agents.length;
  const plural = count === 1 ? '' : 's';

  return (
    <Dialog open={open} onClose={phase === 'result' ? handleClose : onClose}>
      {phase === 'confirm' ? (
        <>
          <DialogHeader onClose={onClose}>
            <DialogTitle>Uninstall Agent{plural}</DialogTitle>
            <DialogDescription>
              Remove {count} agent{plural} from your fleet
            </DialogDescription>
          </DialogHeader>
          <DialogContent>
            <Alert variant="destructive">
              This will send an uninstall command to {count} agent{plural}. The
              agent{plural} will stop {cleanup ? 'and delete all files' : 'the service'} on the
              next poll cycle (~30s).
            </Alert>

            <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/50 p-2">
              {agents.map((a) => (
                <div key={a.id} className="text-sm py-0.5 font-mono">
                  {a.hostname} <span className="text-muted-foreground">({a.os})</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-start gap-2">
              <Checkbox checked={cleanup} onChange={() => setCleanup((v) => !v)} />
              <div>
                <p className="text-sm font-medium">Also delete all agent files</p>
                <p className="text-xs text-muted-foreground">
                  Config, logs, binaries, and task data. {cleanup ? 'This is irreversible.' : 'Leave unchecked to stop the service only.'}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2">
              <Checkbox checked={confirmed} onChange={() => setConfirmed((v) => !v)} />
              <p className="text-sm">
                I confirm I want to uninstall {count} agent{plural}
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
              onClick={handleUninstall}
              disabled={loading || !confirmed}
            >
              {loading && <Spinner className="w-4 h-4 mr-2" />}
              Uninstall{count > 1 ? ` (${count})` : ''}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>Uninstall Queued</DialogTitle>
            <DialogDescription>
              Uninstall tasks created for {count} agent{plural}
            </DialogDescription>
          </DialogHeader>
          <DialogContent>
            <Alert variant="warning">
              The agent{plural} will uninstall on the next poll cycle (~30 seconds).
              The agent record{plural} will be marked as &quot;uninstalled&quot; once
              the agent{plural} acknowledge{count === 1 ? 's' : ''} the task.
            </Alert>
          </DialogContent>
          <DialogFooter>
            <Button variant="primary" onClick={handleClose}>
              Done
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
