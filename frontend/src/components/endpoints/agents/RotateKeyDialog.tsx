import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
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
import { agentApi } from '@/services/api/agent';

interface RotateKeyDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  onRotated: () => void;
}

export default function RotateKeyDialog({
  open,
  onClose,
  agentId,
  onRotated,
}: RotateKeyDialogProps) {
  const [phase, setPhase] = useState<'confirm' | 'result'>('confirm');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleClose() {
    // Reset state for next open
    setPhase('confirm');
    setLoading(false);
    setError(null);
    setNewKey(null);
    setCopied(false);
    onClose();
  }

  async function handleRotate() {
    setLoading(true);
    setError(null);
    try {
      const result = await agentApi.rotateAgentKey(agentId);
      setNewKey(result.agent_key);
      setPhase('result');
      onRotated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rotate key';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onClose={phase === 'result' ? handleClose : onClose}>
      {phase === 'confirm' ? (
        <>
          <DialogHeader onClose={onClose}>
            <DialogTitle>Rotate API Key</DialogTitle>
            <DialogDescription>
              Generate a new API key for this agent
            </DialogDescription>
          </DialogHeader>
          <DialogContent>
            <Alert variant="warning">
              This will immediately invalidate the agent's current API key. The
              agent will be unable to communicate until its config file is updated
              with the new key.
            </Alert>
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
            <Button variant="destructive" onClick={handleRotate} disabled={loading}>
              {loading && <Spinner className="w-4 h-4 mr-2" />}
              Rotate Key
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>New API Key Generated</DialogTitle>
            <DialogDescription>
              Copy this key now — it will not be shown again
            </DialogDescription>
          </DialogHeader>
          <DialogContent>
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <code className="text-sm font-mono break-all select-all">
                {newKey}
              </code>
            </div>
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="w-4 h-4 mr-2" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {copied ? 'Copied' : 'Copy to Clipboard'}
              </Button>
            </div>
            <Alert variant="warning" className="mt-3">
              Update the agent's config file with this new key. The agent cannot
              authenticate until the config is updated and the agent process is
              restarted.
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
