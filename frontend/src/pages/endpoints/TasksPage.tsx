import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Search, X, Trash2, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import type { AgentTask, TaskGroup, TaskStatus, Schedule } from '@/types/agent';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import TaskList from '@/components/endpoints/tasks/TaskList';
import ScheduleList from '@/components/endpoints/tasks/ScheduleList';
import TaskCreatorDialog from '@/components/endpoints/tasks/TaskCreatorDialog';
import TaskNotesDialog from '@/components/endpoints/tasks/TaskNotesDialog';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';

const TOAST_DURATION_MS = 4000;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const SEARCH_DEBOUNCE_MS = 300;

export default function TasksPage() {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notesTask, setNotesTask] = useState<AgentTask | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));

  function buildFilters() {
    return {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };
  }

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setSelectedTasks([]);
    try {
      const result = await agentApi.listTasksGrouped(buildFilters());
      setGroups(result.groups);
      setTotalGroups(result.total);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch, page, pageSize]);

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
  // Does NOT clear selectedTasks to preserve in-progress selection
  const poll = useCallback(async () => {
    try {
      const filters = buildFilters();
      const [taskResult, scheduleResult] = await Promise.all([
        agentApi.listTasksGrouped(filters),
        agentApi.listSchedules(),
      ]);
      setGroups(taskResult.groups);
      setTotalGroups(taskResult.total);
      setSchedules(scheduleResult);
    } catch {
      // Silent — don't surface transient poll failures
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch, page, pageSize]);

  useEffect(() => {
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [poll]);

  // --- Search ---

  function handleSearchChange(value: string): void {
    setSearchTerm(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  // --- Filters ---

  function handleStatusFilterChange(value: TaskStatus | ''): void {
    setStatusFilter(value);
    setPage(1);
  }

  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  // --- Selection ---

  function handleToggleSelect(taskId: string): void {
    setSelectedTasks((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  }

  function handleToggleSelectAll(): void {
    const allTaskIds = groups.flatMap((g) => g.tasks.map((t) => t.id));
    const allSelected = allTaskIds.length > 0 && allTaskIds.every((id) => selectedTasks.includes(id));
    if (allSelected) {
      setSelectedTasks([]);
    } else {
      setSelectedTasks(allTaskIds);
    }
  }

  function handleToggleGroupSelect(batchId: string): void {
    const group = groups.find((g) => g.batch_id === batchId);
    if (!group) return;
    const groupTaskIds = group.tasks.map((t) => t.id);
    const allGroupSelected = groupTaskIds.every((id) => selectedTasks.includes(id));
    if (allGroupSelected) {
      setSelectedTasks((prev) => prev.filter((id) => !groupTaskIds.includes(id)));
    } else {
      setSelectedTasks((prev) => [...new Set([...prev, ...groupTaskIds])]);
    }
  }

  // --- Toasts ---

  function showToast(message: string): void {
    setSuccessMessage(message);
    globalThis.setTimeout(() => setSuccessMessage(null), TOAST_DURATION_MS);
  }

  // --- Single actions ---

  async function handleCancel(taskId: string): Promise<void> {
    try {
      await agentApi.cancelTask(taskId);
      showToast('Task cancelled');
      fetchTasks();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  }

  async function handleDelete(taskId: string): Promise<void> {
    try {
      await agentApi.deleteTask(taskId);
      showToast('Task deleted');
      fetchTasks();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  // --- Bulk actions ---

  async function handleBulkCancel(): Promise<void> {
    let count = 0;
    for (const taskId of selectedTasks) {
      try {
        await agentApi.cancelTask(taskId);
        count++;
      } catch {
        // continue with remaining tasks
      }
    }
    showToast(`${count} task(s) cancelled`);
    setSelectedTasks([]);
    fetchTasks();
  }

  async function handleBulkDelete(): Promise<void> {
    let count = 0;
    for (const taskId of selectedTasks) {
      try {
        await agentApi.deleteTask(taskId);
        count++;
      } catch {
        // continue with remaining tasks
      }
    }
    showToast(`${count} task(s) deleted`);
    setSelectedTasks([]);
    fetchTasks();
  }

  // --- Bulk action enablement ---

  const allTasks = groups.flatMap((g) => g.tasks);
  const selectedTaskObjects = allTasks.filter((t) => selectedTasks.includes(t.id));
  const canBulkCancel = selectedTaskObjects.length > 0 && selectedTaskObjects.every(
    (t) => t.status === 'pending' || t.status === 'assigned'
  );
  const canBulkDelete = selectedTaskObjects.length > 0 && selectedTaskObjects.every(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'expired'
  );

  // --- Schedules ---

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

  const rangeStart = totalGroups === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalGroups);

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

        {/* Filter bar */}
        <div className="border border-border rounded-lg bg-card p-4 mb-4">
          <div className="flex gap-4 items-center">
            <div className="min-w-40">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value as TaskStatus | '')}
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
            <div className="flex-grow max-w-sm">
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>
            <div className="flex-grow" />
            <Button variant="outline" onClick={() => { fetchTasks(); fetchSchedules(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Bulk actions bar */}
        {selectedTasks.length > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
            <span className="text-sm font-medium">
              {selectedTasks.length} task(s) selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canBulkCancel}
                onClick={handleBulkCancel}
              >
                <X className="w-4 h-4 mr-1" />
                Cancel Selected
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!canBulkDelete}
                onClick={handleBulkDelete}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete Selected
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <Loading message="Loading tasks..." />
        ) : (
          <TaskList
            groups={groups}
            loading={loading}
            selectedTasks={selectedTasks}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onToggleGroupSelect={handleToggleGroupSelect}
            onCancel={handleCancel}
            onDelete={handleDelete}
            onOpenNotes={setNotesTask}
          />
        )}

        {/* Pagination controls */}
        {!loading && totalGroups > 0 && (
          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>Showing {rangeStart}&ndash;{rangeEnd} of {totalGroups}</span>
              <select
                className="rounded border border-border bg-background px-2 py-1 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-3 text-foreground">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
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
