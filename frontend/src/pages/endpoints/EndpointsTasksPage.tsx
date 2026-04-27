import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import { useHasPermission } from '@/hooks/useAppRole';
import type { AgentTask, Schedule, TaskGroup, TaskStatus } from '@/types/agent';
import { StatusPill } from './components/StatusPill';
import { CreateTaskModal } from './components/CreateTaskModal';
import { ExecutionDetailDrawer } from './components/ExecutionDetailDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { formatDuration, formatRelativeTime } from './utils/format';

const STATUS_OPTIONS: { value: 'all' | TaskStatus; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'executing', label: 'Executing' },
];

export default function EndpointsTasksPage() {
  const canWrite = useHasPermission('endpoints:tasks:create');
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(params.get('create') === 'true');
  const [drawerTask, setDrawerTask] = useState<AgentTask | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [scheduleAction, setScheduleAction] = useState<{ id: string; action: 'pause' | 'resume' | 'delete' } | null>(null);
  const [scheduleActionLoading, setScheduleActionLoading] = useState(false);
  const [scheduleActionError, setScheduleActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      agentApi.listTasksGrouped({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        limit: 50,
      }),
      agentApi.listSchedules().catch(() => [] as Schedule[]),
    ])
      .then(([t, s]) => {
        if (!cancelled) {
          setGroups(t.groups);
          setSchedules(s);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tasks');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, search, refreshSeq]);

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function closeCreate() {
    setShowCreate(false);
    if (params.get('create')) {
      const p = new URLSearchParams(params);
      p.delete('create');
      p.delete('agent');
      setParams(p, { replace: true });
    }
  }

  async function executeScheduleAction() {
    if (!scheduleAction) return;
    setScheduleActionLoading(true);
    setScheduleActionError(null);
    try {
      if (scheduleAction.action === 'delete') {
        await agentApi.deleteSchedule(scheduleAction.id);
      } else {
        await agentApi.updateSchedule(scheduleAction.id, {
          status: scheduleAction.action === 'pause' ? 'paused' : 'active',
        });
      }
      setScheduleAction(null);
      setRefreshSeq((s) => s + 1);
    } catch (err) {
      setScheduleActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setScheduleActionLoading(false);
    }
  }

  return (
    <div className="ep-content">
      <div className="ep-page-head">
        <div>
          <h1>Tasks</h1>
          <p>
            Create and monitor security test tasks · {groups.length} bundle{groups.length === 1 ? '' : 's'} ·{' '}
            {schedules.length} scheduled
          </p>
        </div>
        {canWrite && (
          <button className="ep-btn primary" onClick={() => setShowCreate(true)}>
            <Icon size={13}>{I.bolt}</Icon> Create Task
          </button>
        )}
      </div>

      {error && (
        <div className="ep-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Scheduled Tasks */}
      <div className="ep-section-title">
        <Icon size={14}>{I.clock}</Icon>
        <span>Scheduled Tasks</span>
        <span className="ep-section-count">({schedules.length})</span>
      </div>
      {schedules.length === 0 ? (
        <div className="ep-card">
          <p className="ep-empty" style={{ padding: 0 }}>
            No scheduled tasks
          </p>
        </div>
      ) : (
        schedules.map((s) => (
          <div className="ep-sched-row" key={s.id}>
            <div className="ep-sched-info">
              <div className="ep-sched-name">
                <span>{s.name ?? s.test_name}</span>
                <StatusPill status={s.status} />
                <span className="ep-pill" style={{ color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
                  {s.schedule_type}
                </span>
              </div>
              <div className="ep-sched-cadence">{describeSchedule(s)}</div>
              <div className="ep-sched-meta">
                <span>Next: {s.next_run_at ? formatRelativeTime(s.next_run_at) : '—'}</span>
                <span>Last: {s.last_run_at ? formatRelativeTime(s.last_run_at) : '—'}</span>
                <span>{s.agent_ids.length} agent{s.agent_ids.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            {canWrite && (
              <div className="ep-sched-actions">
                {s.status === 'paused' ? (
                  <button
                    className="ep-icon-btn"
                    onClick={() => setScheduleAction({ id: s.id, action: 'resume' })}
                    aria-label="Resume schedule"
                  >
                    <Icon size={13}>{I.play}</Icon>
                  </button>
                ) : (
                  <button
                    className="ep-icon-btn"
                    onClick={() => setScheduleAction({ id: s.id, action: 'pause' })}
                    aria-label="Pause schedule"
                  >
                    <Icon size={13}>{I.lock}</Icon>
                  </button>
                )}
                <button
                  className="ep-icon-btn is-danger"
                  onClick={() => setScheduleAction({ id: s.id, action: 'delete' })}
                  aria-label="Delete schedule"
                >
                  <Icon size={13}>{I.alert}</Icon>
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {/* Executions */}
      <div className="ep-section-title">
        <Icon size={14}>{I.play}</Icon>
        <span>Executions</span>
        <span className="ep-section-count">({groups.length})</span>
      </div>

      <div
        className="ep-filter-row"
        style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}
      >
        <select
          className="ep-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="ep-filter-input" style={{ maxWidth: 280 }}>
          <Icon size={13}>{I.search}</Icon>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
          />
        </div>
        <div style={{ flex: 1 }} />
        <button className="ep-btn" onClick={() => setRefreshSeq((n) => n + 1)}>
          <Icon size={12}>{I.sync}</Icon> Refresh
        </button>
      </div>

      <div
        className="ep-table-wrap"
        style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}
      >
        <table className="ep-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <span className="ep-checkbox" />
              </th>
              <th style={{ width: 32 }}></th>
              <th style={{ width: 200 }}>Status</th>
              <th>Task</th>
              <th style={{ width: 100 }}>Agents</th>
              <th style={{ width: 110 }}>Created</th>
              <th style={{ width: 90 }}>Duration</th>
              <th style={{ width: 80 }}>Exit</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="ep-empty">
                  Loading executions…
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={9} className="ep-empty">
                  No executions yet — click Create Task to launch one
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <ExecutionRow
                  key={g.batch_id}
                  group={g}
                  expanded={expanded.has(g.batch_id)}
                  onToggle={() => toggle(g.batch_id)}
                  onPickTask={setDrawerTask}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateTaskModal
          onClose={closeCreate}
          onCreated={() => {
            setRefreshSeq((s) => s + 1);
          }}
          initialAgentIds={params.get('agent') ? [params.get('agent') as string] : []}
        />
      )}

      {drawerTask && (
        <ExecutionDetailDrawer
          task={drawerTask}
          agentHostname={drawerTask.agent_hostname ?? undefined}
          onClose={() => setDrawerTask(null)}
        />
      )}

      <ConfirmDialog
        open={scheduleAction !== null}
        title={
          scheduleAction?.action === 'delete'
            ? 'Delete schedule'
            : scheduleAction?.action === 'pause'
              ? 'Pause schedule'
              : 'Resume schedule'
        }
        description={
          scheduleAction?.action === 'delete'
            ? 'This permanently removes the schedule. Past runs are retained.'
            : scheduleAction?.action === 'pause'
              ? 'Pause this schedule. No new runs will be triggered until you resume it.'
              : 'Resume this schedule. The next run will fire on the configured cadence.'
        }
        confirmLabel={scheduleAction?.action === 'delete' ? 'Delete' : scheduleAction?.action === 'pause' ? 'Pause' : 'Resume'}
        variant={scheduleAction?.action === 'delete' ? 'destructive' : 'primary'}
        loading={scheduleActionLoading}
        error={scheduleActionError}
        onClose={() => {
          setScheduleAction(null);
          setScheduleActionError(null);
        }}
        onConfirm={executeScheduleAction}
      />
    </div>
  );
}

function describeSchedule(s: Schedule): string {
  const cfg = s.schedule_config as unknown as Record<string, unknown>;
  const time = (cfg.time as string) ?? '—';
  switch (s.schedule_type) {
    case 'daily':
      return `Daily at ${time}`;
    case 'weekly':
      return `Weekly · ${(cfg.days as number[] | undefined)?.join(', ') ?? '—'} at ${time}`;
    case 'monthly':
      return `Monthly · day ${(cfg.dayOfMonth as number | undefined) ?? '—'} at ${time}`;
    case 'once':
      return `Once at ${(cfg.date as string) ?? '—'} ${time}`;
    default:
      return s.schedule_type;
  }
}

interface ExecutionRowProps {
  group: TaskGroup;
  expanded: boolean;
  onToggle: () => void;
  onPickTask: (t: AgentTask) => void;
}

function ExecutionRow({ group, expanded, onToggle, onPickTask }: ExecutionRowProps) {
  const counts = group.status_counts;
  const taskName =
    group.payload?.test_name ??
    (group.payload?.command ? `cmd: ${group.payload.command}` : group.type);

  // Aggregate duration: max across child tasks (parallel execution).
  const durations = group.tasks
    .map((t) => t.result?.execution_duration_ms)
    .filter((d): d is number => typeof d === 'number');
  const maxDuration = durations.length ? Math.max(...durations) : null;

  return (
    <>
      <tr>
        <td onClick={(e) => e.stopPropagation()}>
          <span className="ep-checkbox" />
        </td>
        <td>
          <button
            className={`ep-expander ${expanded ? 'is-open' : ''}`}
            onClick={onToggle}
            aria-label={expanded ? 'Collapse group' : 'Expand group'}
          >
            <Icon size={12}>{I.chevronRight}</Icon>
          </button>
        </td>
        <td>
          <div className="ep-counts">
            {counts.completed && <span className="ep-count is-completed">completed ×{counts.completed}</span>}
            {counts.failed && <span className="ep-count is-failed">failed ×{counts.failed}</span>}
            {counts.pending && <span className="ep-count is-pending">pending ×{counts.pending}</span>}
            {counts.assigned && <span className="ep-count is-assigned">assigned ×{counts.assigned}</span>}
            {counts.executing && <span className="ep-count is-assigned">executing ×{counts.executing}</span>}
          </div>
        </td>
        <td style={{ color: 'var(--text-primary)' }}>{taskName}</td>
        <td className="col-mono" style={{ color: 'var(--signal)' }}>
          {group.agent_count} agent{group.agent_count === 1 ? '' : 's'}
        </td>
        <td className="col-mono" style={{ color: 'var(--text-muted)' }}>
          {formatRelativeTime(group.created_at)}
        </td>
        <td className="col-mono" style={{ color: maxDuration ? 'var(--text-secondary)' : 'var(--text-faint)' }}>
          {formatDuration(maxDuration)}
        </td>
        <td className="col-mono" style={{ color: 'var(--text-faint)' }}>
          —
        </td>
        <td className="col-actions">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
            {group.tasks.length}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ padding: 0, background: 'rgba(0,0,0,.18)' }}>
            <div style={{ padding: '8px 18px 14px 64px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '.18em',
                      }}
                    >
                      Agent
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '.18em',
                        width: 140,
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '.18em',
                        width: 100,
                      }}
                    >
                      Duration
                    </th>
                    <th
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9.5,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '.18em',
                        width: 80,
                      }}
                    >
                      Exit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((c) => {
                    const exit = c.result?.exit_code;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => onPickTask(c)}
                        style={{ borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}
                      >
                        <td
                          style={{
                            padding: '10px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        >
                          {c.agent_hostname ?? c.agent_id.slice(0, 8)}
                        </td>
                        <td style={{ padding: '10px' }}>
                          <StatusPill status={c.status} />
                        </td>
                        <td
                          style={{
                            padding: '10px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11.5,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {c.result?.execution_duration_ms != null
                            ? formatDuration(c.result.execution_duration_ms)
                            : '—'}
                        </td>
                        <td style={{ padding: '10px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '1px 7px',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10,
                              borderRadius: 3,
                              background:
                                exit == null
                                  ? 'transparent'
                                  : exit !== 0 && exit !== 100
                                    ? 'rgba(255,59,92,.10)'
                                    : 'rgba(0,230,138,.08)',
                              color:
                                exit == null
                                  ? 'var(--text-muted)'
                                  : exit !== 0 && exit !== 100
                                    ? 'var(--danger)'
                                    : 'var(--accent)',
                              border:
                                exit == null
                                  ? '1px solid var(--line)'
                                  : exit !== 0 && exit !== 100
                                    ? '1px solid rgba(255,59,92,.3)'
                                    : '1px solid rgba(0,230,138,.3)',
                            }}
                          >
                            {exit ?? '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
