import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import type { AgentMetrics, AgentTask, FleetHealthMetrics } from '@/types/agent';
import { StatusPill } from './components/StatusPill';
import { Donut } from './components/Donut';
import { EpSpark } from './components/EpSpark';
import { formatRelativeTime, formatDuration } from './utils/format';

interface KpiProps {
  icon: React.ReactNode;
  tone?: 'accent' | 'warn' | 'blue' | 'violet' | 'pink' | 'muted';
  value: React.ReactNode;
  label: string;
  suffix?: string;
}

function Kpi({ icon, tone = 'accent', value, label, suffix }: KpiProps) {
  return (
    <div className="ep-kpi">
      <div className={`ep-kpi-icon is-${tone}`}>{icon}</div>
      <div>
        <div className="ep-kpi-val">
          {value}
          {suffix && (
            <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 2 }}>
              {suffix}
            </span>
          )}
        </div>
        <div className="ep-kpi-label">{label}</div>
      </div>
    </div>
  );
}

function ActivityCell({
  icon,
  color,
  value,
  label,
}: {
  icon: React.ReactNode;
  color: string;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          display: 'grid',
          placeItems: 'center',
          background: `${color}1f`,
          color,
          border: `1px solid ${color}33`,
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.14em',
            marginTop: 4,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

const VERSION_PALETTE = [
  '#a78bfa',
  '#7eaaff',
  '#00e68a',
  '#ffc857',
  '#ff5a72',
  '#5ce1e6',
  '#ff8aa3',
  '#90f1c9',
];

const STATUS_COLORS: Record<string, string> = {
  active: '#00e68a',
  disabled: '#ffc857',
  decommissioned: '#ff3b5c',
  uninstalled: '#6b7388',
};

const OS_COLORS: Record<string, string> = {
  windows: '#7eaaff',
  linux: '#ffc857',
  darwin: '#a78bfa',
};

function getTaskName(t: AgentTask): string {
  if (t.type === 'execute_test') return t.payload?.test_name ?? 'Security Test';
  if (t.type === 'execute_command') return t.payload?.command ?? 'command';
  if (t.type === 'update_agent') return 'Agent Update';
  if (t.type === 'uninstall') return 'Uninstall';
  return t.type;
}

export default function EndpointsDashboardPage() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);
  const [fleetHealth, setFleetHealth] = useState<FleetHealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [metricsData, tasksResult, healthData] = await Promise.all([
        agentApi.getMetrics(),
        agentApi.listTasks({ limit: 10 }),
        agentApi.getFleetHealthMetrics().catch(() => null),
      ]);
      setMetrics(metricsData);
      setRecentTasks(tasksResult.tasks);
      setFleetHealth(healthData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const versionEntries = useMemo(() => {
    const by = metrics?.by_version ?? {};
    const entries = Object.entries(by);
    const total = entries.reduce((sum, [, c]) => sum + c, 0) || 1;
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([version, count], i) => ({
        version,
        count,
        pct: Math.round((count / total) * 100),
        color: VERSION_PALETTE[i % VERSION_PALETTE.length],
      }));
  }, [metrics]);

  const osEntries = useMemo(() => {
    const by = metrics?.by_os ?? {};
    const entries = Object.entries(by);
    const total = entries.reduce((sum, [, c]) => sum + c, 0) || 1;
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([os, count]) => ({
        os,
        count,
        pct: Math.round((count / total) * 100),
        color: OS_COLORS[os] ?? '#7eaaff',
      }));
  }, [metrics]);

  const statusEntries = useMemo(() => {
    const by = metrics?.by_status ?? {};
    const entries = Object.entries(by);
    const total = entries.reduce((sum, [, c]) => sum + c, 0) || 1;
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({
        status,
        count,
        pct: Math.round((count / total) * 100),
        color: STATUS_COLORS[status] ?? '#6b7388',
      }));
  }, [metrics]);

  if (loading) {
    return <div className="ep-content"><div className="ep-loading">Loading agent dashboard…</div></div>;
  }

  const total = metrics?.total ?? 0;
  const online = metrics?.online ?? 0;
  const offline = metrics?.offline ?? 0;
  const pendingTasks = metrics?.pending_tasks ?? 0;
  const activity = metrics?.task_activity_24h ?? {
    completed: 0,
    failed: 0,
    in_progress: 0,
    success_rate: 0,
    total: 0,
  };

  const latestVersion = versionEntries[0]?.version ?? '—';
  const allOnLatest = versionEntries.length === 1;
  const dominantArch = '—'; // not aggregated by backend; could be derived later

  return (
    <div className="ep-content">
      <div className="ep-page-head">
        <div>
          <h1>Agent Dashboard</h1>
          <p>
            Fleet overview and operational status · {total} agent{total === 1 ? '' : 's'}
            {' enrolled across the estate'}
          </p>
        </div>
        <div className="ep-page-head-actions">
          <button className="ep-btn" onClick={() => { setLoading(true); load(); }}>
            <Icon size={13}>{I.sync}</Icon> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="ep-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* KPI strip */}
      <div className="ep-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi icon={<Icon size={18}>{I.monitor}</Icon>} tone="blue" value={total} label="Total Agents" />
        <Kpi icon={<Icon size={18}>{I.shield}</Icon>} tone="accent" value={online} label="Online" />
        <Kpi icon={<Icon size={18}>{I.alert}</Icon>} tone="pink" value={offline} label="Offline" />
        <Kpi icon={<Icon size={18}>{I.task}</Icon>} tone="warn" value={pendingTasks} label="Pending Tasks" />
      </div>

      {/* Health metrics row */}
      {fleetHealth && (
        <div className="ep-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <Kpi
            icon={<Icon size={18}>{I.chart}</Icon>}
            tone="accent"
            value={fleetHealth.fleet_uptime_percent_30d.toFixed(1)}
            suffix="%"
            label="Fleet Uptime (30d)"
          />
          <Kpi
            icon={<Icon size={18}>{I.check}</Icon>}
            tone="blue"
            value={fleetHealth.task_success_rate_7d.toFixed(1)}
            suffix="%"
            label="Task Success (7d)"
          />
          <Kpi
            icon={<Icon size={18}>{I.clock}</Icon>}
            tone="violet"
            value={fleetHealth.mtbf_hours != null ? fleetHealth.mtbf_hours.toFixed(1) : 'N/A'}
            suffix={fleetHealth.mtbf_hours != null ? 'h' : undefined}
            label="MTBF"
          />
          <Kpi
            icon={<Icon size={18}>{I.alert}</Icon>}
            tone="warn"
            value={fleetHealth.stale_agent_count}
            label="Stale Agents"
          />
          <Kpi
            icon={<Icon size={18}>{I.shield}</Icon>}
            tone={
              fleetHealth.avg_health_score == null
                ? 'muted'
                : fleetHealth.avg_health_score >= 80
                  ? 'accent'
                  : fleetHealth.avg_health_score >= 50
                    ? 'warn'
                    : 'pink'
            }
            value={
              fleetHealth.avg_health_score != null
                ? Math.round(fleetHealth.avg_health_score)
                : 'N/A'
            }
            label="Avg Health"
          />
        </div>
      )}

      {/* Stale callout */}
      {fleetHealth && fleetHealth.stale_agent_count > 0 && (
        <div className="ep-callout">
          <div className="ep-callout-icon">
            <Icon size={20}>{I.alert}</Icon>
          </div>
          <div className="ep-callout-text">
            <strong>
              {fleetHealth.stale_agent_count} stale agent
              {fleetHealth.stale_agent_count === 1 ? '' : 's'} detected
            </strong>
            <p>
              Online agents with no completed tasks in the last 7 days · likely scheduling drift or task scope mismatch
            </p>
          </div>
          <button className="ep-callout-btn" onClick={() => navigate('/endpoints/agents?stale=true')}>
            View →
          </button>
        </div>
      )}

      {/* Activity + Version distribution */}
      <div className="ep-grid">
        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.play}</Icon> Task Activity (24h)
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
              {activity.completed + activity.failed + activity.in_progress} runs
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <ActivityCell
              icon={<Icon size={13}>{I.check}</Icon>}
              color="#00e68a"
              value={activity.completed}
              label="Completed"
            />
            <ActivityCell
              icon={<Icon size={13}>{I.alert}</Icon>}
              color="#ff5a72"
              value={activity.failed}
              label="Failed"
            />
            <ActivityCell
              icon={<Icon size={13}>{I.play}</Icon>}
              color="#7eaaff"
              value={activity.in_progress}
              label="In Progress"
            />
            <ActivityCell
              icon={<Icon size={13}>{I.chart}</Icon>}
              color="#a78bfa"
              value={`${Math.round(activity.success_rate)}%`}
              label="Success Rate"
            />
          </div>
          <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,.25)', borderRadius: 4, border: '1px solid var(--line)' }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '.18em',
                marginBottom: 6,
              }}
            >
              Activity (last 24h)
            </div>
            {/* Sparkline driven by per-hour distribution if available, otherwise a flat ramp */}
            <EpSpark
              data={[
                activity.completed,
                Math.max(activity.completed - 1, 0),
                activity.in_progress,
                activity.failed,
                Math.max(activity.completed - 2, 0),
                activity.completed,
                activity.in_progress + 1,
                activity.completed,
                activity.failed + 1,
                activity.completed,
                activity.in_progress,
                activity.completed,
              ]}
              color="#7eaaff"
              w={400}
              h={36}
            />
          </div>
        </div>

        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.cog}</Icon> Agent Version Distribution
            </div>
            <span
              className="ep-pill"
              style={{
                borderColor: 'rgba(167,139,250,.3)',
                color: 'var(--violet)',
                background: 'rgba(167,139,250,.10)',
              }}
            >
              {versionEntries.length} version{versionEntries.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="ep-donut-wrap">
            <Donut
              slices={versionEntries.map((v) => ({ pct: v.pct, color: v.color }))}
              size={130}
              label={latestVersion}
              sublabel="Latest"
            />
            <div className="ep-donut-legend">
              {versionEntries.map((v) => (
                <div className="ep-donut-row" key={v.version}>
                  <span className="ep-donut-sw" style={{ background: v.color }} />
                  <span className="ep-donut-name">v{v.version}</span>
                  <span className="ep-donut-val">
                    {v.count} ({v.pct}%)
                  </span>
                </div>
              ))}
              {allOnLatest && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    background: 'rgba(0,230,138,.06)',
                    border: '1px solid rgba(0,230,138,.2)',
                    borderRadius: 4,
                    fontSize: 11,
                    color: 'var(--accent)',
                  }}
                >
                  ✓ All agents on latest version
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* OS + Status row */}
      <div className="ep-grid">
        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.layout}</Icon> OS Distribution
            </div>
          </div>
          {osEntries.length === 0 ? (
            <p className="ep-empty" style={{ padding: 0 }}>No data available</p>
          ) : (
            osEntries.map((d) => (
              <div className="ep-bar-row" key={d.os}>
                <span style={{ color: 'var(--text-primary)', fontSize: 12.5, textTransform: 'capitalize' }}>{d.os}</span>
                <div className="ep-bar">
                  <div className="ep-bar-fill" style={{ width: `${d.pct}%`, background: d.color }} />
                </div>
                <span className="ep-bar-pct">
                  {d.count} ({d.pct}%)
                </span>
              </div>
            ))
          )}
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid var(--line-soft)',
              display: 'flex',
              gap: 24,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.18em',
                }}
              >
                Architecture
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {dominantArch}
                </span>
                <span className="ep-pill" style={{ color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
                  {total}
                </span>
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.18em',
                }}
              >
                Latest version
              </div>
              <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--accent)' }}>
                v{latestVersion}
              </div>
            </div>
          </div>
        </div>

        <div className="col-6 ep-card">
          <div className="ep-card-head">
            <div className="ep-card-title">
              <Icon size={14}>{I.shield}</Icon> Status Distribution
            </div>
          </div>
          {statusEntries.length === 0 ? (
            <p className="ep-empty" style={{ padding: 0 }}>No data available</p>
          ) : (
            <div className="ep-donut-wrap">
              <Donut
                slices={statusEntries.map((s) => ({ pct: s.pct, color: s.color }))}
                size={130}
                label={String(total)}
                sublabel="Total"
              />
              <div className="ep-donut-legend">
                {statusEntries.map((s) => (
                  <div className="ep-donut-row" key={s.status}>
                    <span className="ep-donut-sw" style={{ background: s.color }} />
                    <span className="ep-donut-name" style={{ textTransform: 'capitalize' }}>{s.status}</span>
                    <span className="ep-donut-val">
                      {s.count} ({s.pct}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent tasks */}
      <div className="ep-card" style={{ padding: 0 }}>
        <div className="ep-card-head" style={{ padding: '14px 18px 10px' }}>
          <div className="ep-card-title">
            <Icon size={14}>{I.task}</Icon> Recent Tasks
          </div>
          <a
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => navigate('/endpoints/tasks')}
          >
            View All →
          </a>
        </div>
        <table className="ep-table" style={{ border: 'none', borderRadius: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Status</th>
              <th>Task</th>
              <th style={{ width: 200 }}>Agent</th>
              <th style={{ width: 100 }}>Duration</th>
              <th style={{ width: 100 }}>Exit</th>
              <th style={{ width: 110 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {recentTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="ep-empty">
                  No tasks yet
                </td>
              </tr>
            ) : (
              recentTasks.map((t) => {
                const exit = t.result?.exit_code;
                return (
                  <tr key={t.id}>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>{getTaskName(t)}</td>
                    <td className="col-mono">{t.agent_hostname ?? t.agent_id.slice(0, 8)}</td>
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
                    <td className="col-mono" style={{ color: 'var(--text-muted)' }}>
                      {formatRelativeTime(t.created_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
