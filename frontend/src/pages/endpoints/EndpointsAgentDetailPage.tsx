import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import { useHasPermission } from '@/hooks/useAppRole';
import type { Agent, AgentEvent, AgentTask, HeartbeatHistoryPoint } from '@/types/agent';
import { OsPill } from './components/OsPill';
import { StatusPill } from './components/StatusPill';
import { HealthBadge } from './components/HealthBadge';
import { EpSpark } from './components/EpSpark';
import { EpLineChart } from './components/EpLineChart';
import { ExecutionDetailDrawer } from './components/ExecutionDetailDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { formatRelativeTime, formatDuration, formatBytes, formatUptime, isOnline } from './utils/format';

type TabKey = 'overview' | 'tasks' | 'heartbeat' | 'events';

const VALID_TABS: TabKey[] = ['overview', 'tasks', 'heartbeat', 'events'];

interface InfoRowProps {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}

function InfoRow({ icon, label, value, valueColor }: InfoRowProps) {
  return (
    <div className="ep-info-row">
      <span className="label">
        {icon}
        {label}
      </span>
      <span className="value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

export default function EndpointsAgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'overview';
  const activeTab: TabKey = VALID_TABS.includes(tab) ? tab : 'overview';

  const canWrite = useHasPermission('endpoints:agents:write');
  const canDelete = useHasPermission('endpoints:agents:delete');

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecom, setConfirmDecom] = useState(false);
  const [decomLoading, setDecomLoading] = useState(false);
  const [decomError, setDecomError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!agentId) return;
    try {
      const a = await agentApi.getAgent(agentId);
      setAgent(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  function setTab(next: TabKey) {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  }

  async function decommission() {
    if (!agent) return;
    setDecomLoading(true);
    setDecomError(null);
    try {
      const updated = await agentApi.updateAgent(agent.id, { status: 'decommissioned' });
      setAgent(updated);
      setConfirmDecom(false);
    } catch (err) {
      setDecomError(err instanceof Error ? err.message : 'Failed to decommission agent');
    } finally {
      setDecomLoading(false);
    }
  }

  if (loading) return <div className="ep-content"><div className="ep-loading">Loading agent…</div></div>;
  if (error) {
    return (
      <div className="ep-content">
        <div className="ep-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      </div>
    );
  }
  if (!agent) return <div className="ep-content"><div className="ep-loading">Agent not found</div></div>;

  const online = isOnline(agent.last_heartbeat);
  const status = online ? 'online' : 'offline';

  return (
    <div className="ep-content">
      <div className="ep-crumb">
        <a onClick={() => navigate('/endpoints/agents')}>← Agents</a>
        <span className="ep-crumb-sep">/</span>
        <span style={{ color: 'var(--text-primary)' }}>{agent.hostname}</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 4,
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '.04em',
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              {agent.hostname}
            </h1>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className={`ep-status-dot ${online ? '' : 'is-offline'}`} />
              <StatusPill status={status} />
            </span>
            <OsPill os={agent.os} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
              {agent.arch} · v{agent.agent_version}
            </span>
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
            ID: {agent.id}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="ep-btn" onClick={() => navigate('/endpoints/tasks?create=true&agent=' + agent.id)}>
            <Icon size={12}>{I.play}</Icon> Run Task
          </button>
          <button className="ep-btn" onClick={reload}>
            <Icon size={12}>{I.sync}</Icon> Refresh
          </button>
          {(canWrite || canDelete) && agent.status === 'active' && (
            <button className="ep-btn danger" onClick={() => setConfirmDecom(true)}>
              <Icon size={12}>{I.lock}</Icon> Decommission
            </button>
          )}
        </div>
      </div>

      <div className="ep-tabs">
        <button className={`ep-tab ${activeTab === 'overview' ? 'is-active' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={`ep-tab ${activeTab === 'tasks' ? 'is-active' : ''}`} onClick={() => setTab('tasks')}>
          Task History
        </button>
        <button className={`ep-tab ${activeTab === 'heartbeat' ? 'is-active' : ''}`} onClick={() => setTab('heartbeat')}>
          Heartbeat
        </button>
        <button className={`ep-tab ${activeTab === 'events' ? 'is-active' : ''}`} onClick={() => setTab('events')}>
          Event Log
        </button>
      </div>

      {activeTab === 'overview' && <OverviewTab agent={agent} />}
      {activeTab === 'tasks' && <TaskHistoryTab agent={agent} />}
      {activeTab === 'heartbeat' && <HeartbeatTab agentId={agent.id} />}
      {activeTab === 'events' && <EventLogTab agentId={agent.id} />}

      <ConfirmDialog
        open={confirmDecom}
        title="Decommission agent"
        description={`Mark ${agent.hostname} as decommissioned?`}
        body={
          <p className="text-sm text-muted-foreground">
            The agent will stop receiving new tasks. The host record stays in the fleet, and you can re-enroll
            later.
          </p>
        }
        confirmLabel="Decommission"
        loading={decomLoading}
        error={decomError}
        onClose={() => {
          setConfirmDecom(false);
          setDecomError(null);
        }}
        onConfirm={decommission}
      />
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────
function OverviewTab({ agent }: { agent: Agent }) {
  const hb = agent.last_heartbeat_data;
  return (
    <>
      <div className="ep-grid">
        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.monitor}</Icon> System Information
            </div>
          </div>
          <InfoRow icon={<Icon size={12}>{I.layout}</Icon>} label="Hostname" value={agent.hostname} />
          <InfoRow
            icon={<Icon size={12}>{I.monitor}</Icon>}
            label="OS / Arch"
            value={`${agent.os} / ${agent.arch}`}
          />
          <InfoRow icon={<Icon size={12}>{I.cog}</Icon>} label="Agent Version" value={`v${agent.agent_version}`} />
          {hb && (
            <>
              <InfoRow
                icon={<Icon size={12}>{I.chart}</Icon>}
                label="CPU"
                value={`${hb.system.cpu_percent.toFixed(1)}%`}
                valueColor="var(--accent)"
              />
              <InfoRow
                icon={<Icon size={12}>{I.layout}</Icon>}
                label="Memory"
                value={formatBytes(hb.system.memory_mb, 'gb')}
              />
              <InfoRow
                icon={<Icon size={12}>{I.bookmark}</Icon>}
                label="Disk Free"
                value={formatBytes(hb.system.disk_free_mb, 'gb')}
              />
              <InfoRow icon={<Icon size={12}>{I.clock}</Icon>} label="Uptime" value={formatUptime(hb.system.uptime_seconds)} />
            </>
          )}
        </div>

        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.shield}</Icon> Metadata
            </div>
          </div>
          <InfoRow label="Enrolled" value={formatRelativeTime(agent.enrolled_at)} />
          <InfoRow label="Last Heartbeat" value={formatRelativeTime(agent.last_heartbeat)} />
          <div className="ep-info-row">
            <span className="label">Status</span>
            <span>
              <StatusPill status={agent.status} />
            </span>
          </div>
          <div className="ep-info-row">
            <span className="label">Health Score</span>
            <span>
              <HealthBadge value={agent.health_score ?? null} />
            </span>
          </div>
          <InfoRow
            icon={<Icon size={12}>{I.bookmark}</Icon>}
            label="Tags"
            value={agent.tags && agent.tags.length > 0 ? agent.tags.join(', ') : 'No tags'}
            valueColor={agent.tags && agent.tags.length > 0 ? undefined : 'var(--text-faint)'}
          />
          {agent.health_score != null && agent.health_score < 50 && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                background: 'rgba(255,200,87,.06)',
                border: '1px solid rgba(255,200,87,.25)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Icon size={14}>{I.alert}</Icon>
              <div>
                <div style={{ fontSize: 12, color: 'var(--warn-bright)', fontWeight: 600 }}>
                  Health below 50
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Recurring task failures or stale heartbeats are likely contributing.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <RecentTasksCard agentId={agent.id} />
    </>
  );
}

function RecentTasksCard({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);

  useEffect(() => {
    agentApi
      .listTasks({ agent_id: agentId, limit: 5 })
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]));
  }, [agentId]);

  return (
    <div className="ep-card" style={{ marginTop: 14 }}>
      <div className="ep-card-head">
        <div className="ep-card-title">
          <Icon size={14}>{I.task}</Icon> Recent Tasks
        </div>
      </div>
      {tasks.length === 0 ? (
        <p className="ep-empty" style={{ padding: 0 }}>
          No tasks yet
        </p>
      ) : (
        tasks.map((t) => (
          <div className="ep-recent-row" key={t.id}>
            <StatusPill status={t.status} />
            <span className="ep-recent-name">{t.payload?.test_name ?? t.type}</span>
            <span className="ep-recent-when">{formatRelativeTime(t.created_at)}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ── Task History Tab ─────────────────────────────────────────────
function TaskHistoryTab({ agent }: { agent: Agent }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerTask, setDrawerTask] = useState<AgentTask | null>(null);

  useEffect(() => {
    agentApi
      .listTasks({ agent_id: agent.id, limit: 100 })
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [agent.id]);

  return (
    <>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Status</th>
              <th>Task</th>
              <th style={{ width: 160 }}>Started</th>
              <th style={{ width: 100 }}>Duration</th>
              <th style={{ width: 80 }}>Exit</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="ep-empty">
                  Loading task history…
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="ep-empty">
                  No tasks for this host yet
                </td>
              </tr>
            ) : (
              tasks.map((t) => {
                const exit = t.result?.exit_code;
                return (
                  <tr key={t.id} onClick={() => setDrawerTask(t)} style={{ cursor: 'pointer' }}>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>{t.payload?.test_name ?? t.type}</td>
                    <td className="col-mono" style={{ color: 'var(--text-muted)' }}>
                      {formatRelativeTime(t.assigned_at ?? t.created_at)}
                    </td>
                    <td className="col-mono">
                      {t.result?.execution_duration_ms != null
                        ? formatDuration(t.result.execution_duration_ms)
                        : '—'}
                    </td>
                    <td
                      className="col-mono"
                      style={{
                        color:
                          exit == null
                            ? 'var(--text-muted)'
                            : exit !== 0 && exit !== 100
                              ? 'var(--danger)'
                              : 'var(--text-primary)',
                      }}
                    >
                      {exit ?? '—'}
                    </td>
                    <td className="col-actions">
                      <button
                        className="ep-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTask(t);
                        }}
                        aria-label="Open execution detail"
                      >
                        <Icon size={14}>{I.chevronRight}</Icon>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {drawerTask && (
        <ExecutionDetailDrawer
          task={drawerTask}
          agentHostname={agent.hostname}
          onClose={() => setDrawerTask(null)}
        />
      )}
    </>
  );
}

// ── Heartbeat Tab ─────────────────────────────────────────────────
type Period = '7d' | '14d' | '30d';
type Metric = 'cpu' | 'mem' | 'disk' | 'agent';

function HeartbeatTab({ agentId }: { agentId: string }) {
  const [period, setPeriod] = useState<Period>('7d');
  const [activeMetric, setActiveMetric] = useState<Metric>('cpu');
  const [history, setHistory] = useState<HeartbeatHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = period === '7d' ? 7 : period === '14d' ? 14 : 30;
    agentApi
      .getHeartbeatHistory(agentId, days)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [agentId, period]);

  const cpuHost = history.map((p) => p.cpu_percent ?? 0);
  const cpuAgent = history.map((p) => p.process_cpu_percent ?? 0);
  const memHost = history.map((p) => (p.memory_mb ?? 0) / 1024); // GB
  const memAgent = history.map((p) => p.process_memory_mb ?? 0);
  const diskFree = history.map((p) => (p.disk_free_mb ?? 0) / 1024); // GB

  const last = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

  const sparks = [
    {
      id: 'cpu' as Metric,
      label: 'CPU · Host',
      val: cpuHost.length ? `${(last(cpuHost) ?? 0).toFixed(1)}%` : '—',
      sub: cpuAgent.length ? `agent: ${(last(cpuAgent) ?? 0).toFixed(1)}%` : 'agent: —',
      data: cpuHost,
      color: '#00e68a',
    },
    {
      id: 'mem' as Metric,
      label: 'Memory · Host',
      val: memHost.length ? `${(last(memHost) ?? 0).toFixed(1)} GB` : '—',
      sub: memAgent.length ? `agent: ${Math.round(last(memAgent) ?? 0)} MB` : 'agent: —',
      data: memHost,
      color: '#7eaaff',
    },
    {
      id: 'disk' as Metric,
      label: 'Disk Free',
      val: diskFree.length ? `${(last(diskFree) ?? 0).toFixed(0)} GB` : '—',
      sub: 'free space',
      data: diskFree,
      color: '#ffc857',
    },
    {
      id: 'agent' as Metric,
      label: 'Agent Memory',
      val: memAgent.length ? `${Math.round(last(memAgent) ?? 0)} MB` : '—',
      sub: memHost.length ? `host: ${(last(memHost) ?? 0).toFixed(1)} GB` : 'host: —',
      data: memAgent,
      color: '#a78bfa',
    },
  ];

  const active = sparks.find((s) => s.id === activeMetric)!;

  const expandedSeries =
    activeMetric === 'cpu'
      ? [
          { data: cpuHost, color: '#00e68a' },
          { data: cpuAgent, color: '#a78bfa', opacity: 0.7 },
        ]
      : activeMetric === 'mem'
        ? [{ data: memHost, color: '#7eaaff' }]
        : activeMetric === 'disk'
          ? [{ data: diskFree, color: '#ffc857' }]
          : [{ data: memAgent, color: '#a78bfa' }];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.18em',
          }}
        >
          Period
        </span>
        <div className="ep-period">
          {(['7d', '14d', '30d'] as Period[]).map((p) => (
            <button key={p} className={p === period ? 'is-active' : ''} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {history.length} data points
        </span>
      </div>

      <div className="ep-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {sparks.map((s) => (
          <div
            key={s.id}
            className={`ep-spark-card ${activeMetric === s.id ? 'is-active' : ''}`}
            onClick={() => setActiveMetric(s.id)}
            role="button"
            tabIndex={0}
          >
            <div className="ep-spark-head">
              <span className="ep-spark-name">{s.label}</span>
            </div>
            <div className="ep-spark-val">{s.val}</div>
            <div className="ep-spark-sub">{s.sub}</div>
            <div style={{ marginTop: 8 }}>
              <EpSpark data={s.data} color={s.color} w={200} h={28} />
            </div>
          </div>
        ))}
      </div>

      <div className="ep-card">
        <div className="ep-card-head">
          <div className="ep-card-title">
            <Icon size={14}>{I.chart}</Icon> {active.label} — {period}
          </div>
          {expandedSeries.length > 1 && (
            <div style={{ display: 'flex', gap: 14 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 2, background: '#00e68a' }} /> Host
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 2, background: '#a78bfa' }} /> Agent
              </span>
            </div>
          )}
        </div>
        {loading ? (
          <div className="ep-loading">Loading heartbeat history…</div>
        ) : history.length === 0 ? (
          <p className="ep-empty" style={{ padding: 0 }}>
            No heartbeat history available
          </p>
        ) : (
          <EpLineChart series={expandedSeries} height={220} />
        )}
      </div>
    </>
  );
}

// ── Event Log Tab ─────────────────────────────────────────────────
const EVENT_FILTERS: { id: string; label: string; type?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'enrolled', label: 'Enrolled', type: 'enrolled' },
  { id: 'came_online', label: 'Came Online', type: 'came_online' },
  { id: 'went_offline', label: 'Went Offline', type: 'went_offline' },
  { id: 'task_completed', label: 'Task Completed', type: 'task_completed' },
  { id: 'task_failed', label: 'Task Failed', type: 'task_failed' },
  { id: 'version_updated', label: 'Version Updated', type: 'version_updated' },
  { id: 'key_rotated', label: 'Key Rotated', type: 'key_rotated' },
  { id: 'status_changed', label: 'Status Changed', type: 'status_changed' },
  { id: 'decommissioned', label: 'Decommissioned', type: 'decommissioned' },
];

function eventPillFor(type: string): { cls: string; label: string } {
  switch (type) {
    case 'task_completed':
      return { cls: 'is-completed', label: 'Task Completed' };
    case 'task_failed':
      return { cls: 'is-failed', label: 'Task Failed' };
    case 'came_online':
      return { cls: 'is-online', label: 'Came Online' };
    case 'went_offline':
      return { cls: 'is-offline', label: 'Went Offline' };
    case 'enrolled':
      return { cls: 'is-info', label: 'Enrolled' };
    case 'version_updated':
      return { cls: 'is-info', label: 'Version Updated' };
    case 'key_rotated':
      return { cls: 'is-violet', label: 'Key Rotated' };
    case 'status_changed':
      return { cls: 'is-warn', label: 'Status Changed' };
    case 'decommissioned':
      return { cls: 'is-failed', label: 'Decommissioned' };
    default:
      return { cls: '', label: type };
  }
}

function eventDetailText(e: AgentEvent): string {
  if (typeof e.details === 'object' && e.details) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(e.details)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        parts.push(`${k}: ${v}`);
      }
    }
    return parts.join(' · ') || e.event_type;
  }
  return e.event_type;
}

function EventLogTab({ agentId }: { agentId: string }) {
  const [filter, setFilter] = useState<string>('all');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const filterDef = EVENT_FILTERS.find((f) => f.id === filter);
    agentApi
      .getAgentEvents(agentId, {
        limit: 100,
        event_type: filterDef?.type as never,
      })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [agentId, filter]);

  return (
    <>
      <div className="ep-event-chips">
        {EVENT_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`ep-event-chip ${filter === f.id ? 'is-active' : ''}`}
            onClick={() => setFilter(f.id)}
            type="button"
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="ep-loading">Loading events…</div>
      ) : events.length === 0 ? (
        <p className="ep-empty">No events for this filter</p>
      ) : (
        <div>
          {events.map((e) => {
            const p = eventPillFor(e.event_type);
            return (
              <div key={e.id} className="ep-event-row">
                <span className={`ep-event-pill ${p.cls}`}>{p.label}</span>
                <span className="ep-event-detail">{eventDetailText(e)}</span>
                <span className="ep-event-when">{formatRelativeTime(e.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
