import { useEffect, useState, useCallback, useRef } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Search, X, Trash2, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ChevronDown } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, TaskGroup, TaskStatus, Schedule } from '@/types/agent';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import TaskStream from '@/components/endpoints/tasks/TaskStream';
import ScheduleList from '@/components/endpoints/tasks/ScheduleList';
import TaskCreatorDialog from '@/components/endpoints/tasks/TaskCreatorDialog';
import TaskNotesDialog from '@/components/endpoints/tasks/TaskNotesDialog';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Loading } from '@/components/shared/ui/Spinner';
import { Toast } from '@/components/shared/ui/Alert';
import { useHasPermission } from '@/hooks/useAppRole';

const TOAST_DURATION_MS = 4000;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const SEARCH_DEBOUNCE_MS = 300;

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  // Clear ?search= from URL after consuming it (keeps address bar clean)
  useEffect(() => {
    if (initialSearch) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [totalGroups, setTotalGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notesTask, setNotesTask] = useState<AgentTask | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // Collapsed by default — schedules are configuration, the stream is the page
  const [schedulesCollapsed, setSchedulesCollapsed] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canCreateTask = useHasPermission('endpoints:tasks:create');
  const canCancelTask = useHasPermission('endpoints:tasks:cancel');
  const canDeleteTask = useHasPermission('endpoints:tasks:delete');
  const canDeleteSchedule = useHasPermission('endpoints:schedules:delete');
  const canWriteSchedule = useHasPermission('endpoints:schedules:write');
  const canSelectTasks = canCancelTask || canDeleteTask;

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
      const [taskResult, scheduleResult, metricsResult] = await Promise.all([
        agentApi.listTasksGrouped(filters),
        agentApi.listSchedules(),
        agentApi.getMetrics().catch(() => null),
      ]);
      setGroups(taskResult.groups);
      setTotalGroups(taskResult.total);
      setSchedules(scheduleResult);
      if (metricsResult) setMetrics(metricsResult);
    } catch {
      // Silent — don't surface transient poll failures
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch, page, pageSize]);

  usePolling(poll, 10_000);

  // Initial 24h KPI load (poll keeps it fresh afterwards)
  useEffect(() => {
    agentApi.getMetrics().then(setMetrics).catch(() => {});
  }, []);

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

  async function handleRetry(taskId: string): Promise<void> {
    try {
      await agentApi.retryTask(taskId);
      showToast('Retry dispatched');
      fetchTasks();
    } catch (err) {
      console.error('Failed to retry task:', err);
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
  const canBulkDelete = selectedTaskObjects.length > 0;

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
          description="Task activity across the fleet — last 24 hours"
          actions={canCreateTask ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Task
            </Button>
          ) : undefined}
        />

        {/* 24h task-activity KPI mini-row */}
        {metrics && (
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {([
              { label: 'Completed', value: metrics.task_activity_24h.completed, cls: 'text-accent' },
              { label: 'Failed', value: metrics.task_activity_24h.failed, cls: metrics.task_activity_24h.failed > 0 ? 'text-danger' : '' },
              { label: 'In progress', value: metrics.task_activity_24h.in_progress, cls: '' },
              { label: 'Success rate', value: `${Math.round(metrics.task_activity_24h.success_rate)}%`, cls: '' },
            ] as const).map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-border bg-surface p-4">
                <div className="text-[11px] uppercase tracking-wider text-faint">{kpi.label}</div>
                <div className={`mt-2 text-2xl font-semibold tracking-tight ${kpi.cls}`}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Schedules section (collapsible) */}
        {schedules.length > 0 && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setSchedulesCollapsed(prev => !prev)}
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2 hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${schedulesCollapsed ? '-rotate-90' : ''}`} />
              Scheduled Tasks ({schedules.length})
            </button>
            {!schedulesCollapsed && (
              <ScheduleList
                schedules={schedules}
                onTogglePause={canWriteSchedule ? handleTogglePause : undefined}
                onDelete={canDeleteSchedule ? handleDeleteSchedule : undefined}
              />
            )}
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
        {canSelectTasks && selectedTasks.length > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-accent/25 bg-accent-dim px-4 py-3">
            <span className="text-sm font-medium">
              <span className="text-accent">{selectedTasks.length} selected</span>
            </span>
            <div className="flex items-center gap-2">
              {canCancelTask && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canBulkCancel}
                  onClick={handleBulkCancel}
                >
                  <X className="w-4 h-4 mr-1" />
                  Cancel Selected
                </Button>
              )}
              {canDeleteTask && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canBulkDelete}
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete Selected
                </Button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <Loading message="Loading tasks..." />
        ) : (
          <TaskStream
            groups={groups}
            loading={loading}
            selectedTasks={canSelectTasks ? selectedTasks : []}
            onToggleSelect={canSelectTasks ? handleToggleSelect : undefined}
            onToggleSelectAll={canSelectTasks ? handleToggleSelectAll : undefined}
            onToggleGroupSelect={canSelectTasks ? handleToggleGroupSelect : undefined}
            onCancel={canCancelTask ? handleCancel : undefined}
            onRetry={canCreateTask ? handleRetry : undefined}
            onDelete={canDeleteTask ? handleDelete : undefined}
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
                <ChevronsLeft className="w-4 h-4 mr-1" />
                Newest
              </Button>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Newer
              </Button>
              <span className="px-3 font-mono text-xs text-faint">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Older
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
                Oldest
                <ChevronsRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {canCreateTask && (
          <TaskCreatorDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            onCreated={handleCreated}
          />
        )}

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
