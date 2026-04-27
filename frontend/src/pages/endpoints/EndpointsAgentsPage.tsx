import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import { useHasPermission } from '@/hooks/useAppRole';
import type { AgentSummary, AgentOS } from '@/types/agent';
import { OsPill } from './components/OsPill';
import { HealthBadge } from './components/HealthBadge';
import { EnrollAgentModal } from './components/EnrollAgentModal';
import { AgentRowMenu } from './components/AgentRowMenu';
import { AvailableBinariesStrip } from './components/AvailableBinariesStrip';
import { AutoRotationStrip } from './components/AutoRotationStrip';
import { formatRelativeTime } from './utils/format';

export default function EndpointsAgentsPage() {
  const navigate = useNavigate();
  const canEnroll = useHasPermission('endpoints:agents:write');
  const [searchParams] = useSearchParams();
  const initialStale = searchParams.get('stale') === 'true';

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostnameFilter, setHostnameFilter] = useState('');
  const [osFilter, setOsFilter] = useState<AgentOS | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'decommissioned' | 'uninstalled'>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(initialStale);
  const [showEnroll, setShowEnroll] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    agentApi
      .listAgents({
        os: osFilter === 'all' ? undefined : osFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        hostname: hostnameFilter || undefined,
        online_only: onlineOnly || undefined,
        stale_only: staleOnly || undefined,
      })
      .then((data) => {
        if (!cancelled) setAgents(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load agents');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [osFilter, statusFilter, hostnameFilter, onlineOnly, staleOnly, refreshSeq]);

  const visible = useMemo(() => {
    if (!hostnameFilter) return agents;
    const q = hostnameFilter.toLowerCase();
    return agents.filter((a) => a.hostname.toLowerCase().includes(q));
  }, [agents, hostnameFilter]);

  return (
    <div className="ep-content">
      <div className="ep-page-head">
        <div>
          <h1>Agents</h1>
          <p>
            Manage and monitor your Achilles agents · {agents.length} enrolled
          </p>
        </div>
        {canEnroll && (
          <button className="ep-btn primary" onClick={() => setShowEnroll(true)}>
            <Icon size={13}>{I.user}</Icon> Enroll Agent
          </button>
        )}
      </div>

      {error && (
        <div className="ep-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Collapsible strips */}
      <div className="ep-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <AvailableBinariesStrip />
        <AutoRotationStrip />
      </div>

      {/* Filter row */}
      <div
        className="ep-filter-row"
        style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}
      >
        <Icon size={14}>{I.filter}</Icon>
        <div className="ep-filter-input" style={{ flex: 1, maxWidth: 280 }}>
          <Icon size={13}>{I.search}</Icon>
          <input
            value={hostnameFilter}
            onChange={(e) => setHostnameFilter(e.target.value)}
            placeholder="Filter by hostname"
          />
        </div>
        <select
          className="ep-filter-select"
          value={osFilter}
          onChange={(e) => setOsFilter(e.target.value as AgentOS | 'all')}
        >
          <option value="all">All OS</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
        </select>
        <select
          className="ep-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="decommissioned">Decommissioned</option>
          <option value="uninstalled">Uninstalled</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
          <span
            className={`ep-toggle ${onlineOnly ? 'is-on' : ''}`}
            onClick={() => setOnlineOnly((v) => !v)}
            role="button"
            tabIndex={0}
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Online Only</span>
        </div>
        {initialStale && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className={`ep-toggle ${staleOnly ? 'is-on' : ''}`}
              onClick={() => setStaleOnly((v) => !v)}
              role="button"
              tabIndex={0}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Stale Only</span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
          {visible.length} agent{visible.length === 1 ? '' : 's'}
        </span>
        <button className="ep-btn" onClick={() => setRefreshSeq((s) => s + 1)}>
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
              <th style={{ width: 62 }}>Status</th>
              <th>Hostname</th>
              <th style={{ width: 90 }}>OS</th>
              <th style={{ width: 64 }}>Arch</th>
              <th style={{ width: 130 }}>Version</th>
              <th style={{ width: 110 }}>Last Seen</th>
              <th style={{ width: 70 }}>Health</th>
              <th>Tags</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="ep-empty">
                  Loading agents…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={10} className="ep-empty">
                  No agents match the current filters
                </td>
              </tr>
            ) : (
              visible.map((h) => (
                <tr
                  key={h.id}
                  onClick={() => navigate(`/endpoints/agents/${h.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="ep-checkbox" />
                  </td>
                  <td>
                    <span className={`ep-status-dot ${h.is_online ? '' : 'is-offline'}`} />
                  </td>
                  <td className="col-host">{h.hostname}</td>
                  <td>
                    <OsPill os={h.os} />
                  </td>
                  <td className="col-mono">{h.arch}</td>
                  <td className="col-mono">
                    {h.agent_version}
                    {h.is_stale && <span className="ep-stale-tag">stale</span>}
                  </td>
                  <td className="col-mono" style={{ color: 'var(--text-muted)' }}>
                    {formatRelativeTime(h.last_heartbeat)}
                  </td>
                  <td>
                    <HealthBadge value={h.health_score ?? null} />
                  </td>
                  <td>
                    {(h.tags ?? []).slice(0, 3).map((t) => (
                      <span key={t} className="ep-tag">
                        {t}
                      </span>
                    ))}
                    {(h.tags?.length ?? 0) > 3 && (
                      <span className="ep-tag" style={{ background: 'rgba(255,255,255,.04)', color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
                        +{(h.tags?.length ?? 0) - 3}
                      </span>
                    )}
                  </td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    <AgentRowMenu agent={h} onChanged={() => setRefreshSeq((s) => s + 1)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          showing 1–{visible.length} of {agents.length}
        </span>
        <span>page 1 of 1</span>
      </div>

      {showEnroll && <EnrollAgentModal onClose={() => setShowEnroll(false)} />}
    </div>
  );
}
