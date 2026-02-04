import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from '@/components/shared/ui/Dialog';
import { Button } from '@/components/shared/ui/Button';
import { agentApi } from '@/services/api/agent';
import type { AgentTask } from '@/types/agent';

interface TaskNotesDialogProps {
  open: boolean;
  onClose: () => void;
  task: AgentTask | null;
  onSaved: () => void;
}

export default function TaskNotesDialog({ open, onClose, task, onSaved }: TaskNotesDialogProps) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (task && open) {
      setContent(task.notes ?? '');
      setHistoryOpen(false);
    }
  }, [task, open]);

  async function handleSave(): Promise<void> {
    if (!task) return;
    setSaving(true);
    try {
      await agentApi.updateTaskNotes(task.id, content);
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSaving(false);
    }
  }

  const history = task?.notes_history ?? [];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader onClose={onClose}>
        <DialogTitle>Task Notes</DialogTitle>
        <DialogDescription>
          {task?.payload.test_name ?? 'Task'} &mdash; {task?.id.slice(0, 8)}...
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <textarea
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[120px]"
          rows={5}
          placeholder="Add a note about this task..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        {history.length > 0 && (
          <div className="mt-4">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              {historyOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Edit history ({history.length})
            </button>

            {historyOpen && (
              <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                {[...history].reverse().map((entry, i) => (
                  <div key={i} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>{entry.editedBy.slice(0, 12)}</span>
                      <span>{new Date(entry.editedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-foreground whitespace-pre-wrap">{entry.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
