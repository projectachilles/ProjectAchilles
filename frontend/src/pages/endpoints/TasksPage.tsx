import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import type { AgentTask, TaskStatus, Schedule } from '@/types/agent';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import TaskList from '@/components/endpoints/tasks/TaskList';
import ScheduleList from '@/components/endpoints/tasks/ScheduleList';
import TaskCreatorDialog from '@/components/endpoints/tasks/TaskCreatorDialog';
import TaskNotesDialog from '@/components/endpoints/tasks/TaskNotesDialog';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';

const TOAST_DURATION_MS = 4000;

export default function TasksPage() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notesTask, setNotesTask] = useState<AgentTask | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

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

  const fetchSchedules = useCallback(async () => {
    try {
      const result = await agentApi.listSchedules();
      setSchedules(result);
    } catch {
      // Silent
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchSchedules();
  }, [fetchTasks, fetchSchedules]);

  // Silent poll — refresh task list and schedules without loading spinner
  const poll = useCallback(async () => {
    try {
      const filters = statusFilter ? { status: statusFilter } : {};
      const [taskResult, scheduleResult] = await Promise.all([
        agentApi.listTasks(filters),
        agentApi.listSchedules(),
      ]);
      setTasks(taskResult);
      setSchedules(scheduleResult);
    } catch {
      // Silent — don't surface transient poll failures
    }
  }, [statusFilter]);

  useEffect(() => {
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [poll]);

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

  async function handleTogglePause(id: string, newStatus: 'active' | 'paused'): Promise<void> {
    try {
      await agentApi.updateSchedule(id, { status: newStatus });
      showToast(`Schedule ${newStatus === 'paused' ? 'paused' : 'resumed'}`);
      fetchSchedules();
    } catch (err) {
      console.error('Failed to update schedule:', err);
    }
  }

  async function handleDeleteSchedule(id: string): Promise<void> {
    try {
      await agentApi.deleteSchedule(id);
      showToast('Schedule deleted');
      fetchSchedules();
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  }

  function handleCreated(): void {
    fetchTasks();
    fetchSchedules();
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

        {/* Schedules section */}
        {schedules.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Scheduled Tasks ({schedules.length})
            </h2>
            <ScheduleList
              schedules={schedules}
              onTogglePause={handleTogglePause}
              onDelete={handleDeleteSchedule}
            />
          </div>
        )}

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
            <Button variant="outline" onClick={() => { fetchTasks(); fetchSchedules(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <Loading message="Loading tasks..." />
        ) : (
          <TaskList tasks={tasks} loading={loading} onCancel={handleCancel} onOpenNotes={setNotesTask} />
        )}

        <TaskCreatorDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={handleCreated}
        />

        <TaskNotesDialog
          open={notesTask !== null}
          onClose={() => setNotesTask(null)}
          task={notesTask}
          onSaved={fetchTasks}
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
