import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import type { AgentTask, TaskStatus } from '@/types/agent';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import TaskList from '@/components/endpoints/tasks/TaskList';
import TaskCreatorDialog from '@/components/endpoints/tasks/TaskCreatorDialog';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';

const TOAST_DURATION_MS = 4000;

export default function TasksPage() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const filters = statusFilter ? { status: statusFilter } : {};
      const result = await agentApi.listTasks(filters);
      setTasks(result);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Silent poll — refresh task list without loading spinner
  const pollTasks = useCallback(async () => {
    try {
      const filters = statusFilter ? { status: statusFilter } : {};
      const result = await agentApi.listTasks(filters);
      setTasks(result);
    } catch {
      // Silent — don't surface transient poll failures
    }
  }, [statusFilter]);

  useEffect(() => {
    const id = setInterval(pollTasks, 10_000);
    return () => clearInterval(id);
  }, [pollTasks]);

  function showToast(message: string): void {
    setSuccessMessage(message);
    globalThis.setTimeout(() => setSuccessMessage(null), TOAST_DURATION_MS);
  }

  async function handleCancel(taskId: string): Promise<void> {
    try {
      await agentApi.cancelTask(taskId);
      showToast('Task cancelled');
      fetchTasks();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }

  return (
    <>
      <PageContainer>
        <PageHeader
          title="Tasks"
          description="Create and monitor security test tasks"
          actions={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Task
            </Button>
          }
        />

        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <div className="flex gap-4 items-center">
            <div className="min-w-40">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="assigned">Assigned</option>
                <option value="downloading">Downloading</option>
                <option value="executing">Executing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="flex-grow" />
            <Button variant="outline" onClick={fetchTasks}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <Loading message="Loading tasks..." />
        ) : (
          <TaskList tasks={tasks} loading={loading} onCancel={handleCancel} />
        )}

        <TaskCreatorDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={fetchTasks}
        />

        {successMessage && (
          <div className="fixed bottom-4 right-4 z-50">
            <Toast variant="success" message={successMessage} onClose={() => setSuccessMessage(null)} />
          </div>
        )}
      </PageContainer>
    </>
  );
}
