import { useCallback, useEffect, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useHasPermission } from '@/hooks/useAppRole';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { analyticsApi, type RiskAcceptance } from '@/services/api/analytics';
import { AnalyticsLayout } from './AnalyticsLayout';
import './analytics.css';

type StatusFilter = 'active' | 'revoked' | 'all';

const PAGE_SIZE = 25;

export default function AnalyticsRiskPage() {
  const { settingsVersion } = useAnalyticsAuth();
  const canWrite = useHasPermission('analytics:risk:write');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const [acceptances, setAcceptances] = useState<RiskAcceptance[]>([]);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [revokedCount, setRevokedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [revokeTarget, setRevokeTarget] = useState<RiskAcceptance | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = statusFilter === 'all' ? undefined : statusFilter;
      const [main, active, revoked] = await Promise.all([
        analyticsApi.listAcceptances({ status: statusParam, page, pageSize: PAGE_SIZE }),
        analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 }),
        analyticsApi.listAcceptances({ status: 'revoked', page: 1, pageSize: 1 }),
      ]);
      setAcceptances(main.data);
      setTotal(main.total);
      setActiveCount(active.total);
      setRevokedCount(revoked.total);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load risk acceptances:', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { load(); }, [load, settingsVersion]);

  const handleStatusChange = (next: StatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget || revokeReason.trim().length < 10) return;
    setRevoking(true);
    try {
      await analyticsApi.revokeRisk(revokeTarget.acceptance_id, revokeReason.trim());
      setRevokeTarget(null);
      setRevokeReason('');
      await load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to revoke acceptance:', e);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <AnalyticsLayout riskCount={activeCount}>
      <div style={{ display: 'flex', gap: 8, padding: '4px 0 12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`an-pill ${statusFilter === 'active' ? 'primary' : ''}`}
          onClick={() => handleStatusChange('active')}
        >
          <Icon size={11}>{I.shield}</Icon>
          ACTIVE · {activeCount}
        </button>
        <button
          type="button"
          className={`an-pill ${statusFilter === 'revoked' ? 'primary' : ''}`}
          onClick={() => handleStatusChange('revoked')}
        >
          <Icon size={11}>{I.bell}</Icon>
          REVOKED · {revokedCount}
        </button>
        <button
          type="button"
          className={`an-pill ${statusFilter === 'all' ? 'primary' : ''}`}
          onClick={() => handleStatusChange('all')}
        >
          <Icon size={11}>{I.grid}</Icon>
          ALL · {activeCount + revokedCount}
        </button>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {activeCount} ACTIVE · {revokedCount} REVOKED
        </span>
      </div>

      <div className="an-card" style={{ padding: 0 }}>
        <table className="an-risk-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Control</th>
              <th>Scope</th>
              <th>Justification</th>
              <th>Accepted by</th>
              <th>When</th>
              <th>Status</th>
              {canWrite && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canWrite ? 8 : 7}>
                  <div className="an-page-loading">LOADING…</div>
                </td>
              </tr>
            ) : acceptances.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 8 : 7}>
                  <div className="an-page-empty">
                    {statusFilter === 'active'
                      ? 'NO ACTIVE RISK ACCEPTANCES · ALL CONTROLS CONTRIBUTE TO DEFENSE SCORE'
                      : statusFilter === 'revoked'
                        ? 'NO REVOKED RISK ACCEPTANCES'
                        : 'NO RISK ACCEPTANCES FOUND'}
                  </div>
                </td>
              </tr>
            ) : (
              acceptances.map((r) => {
                const scope = r.scope ?? (r.hostname ? 'host' : 'global');
                const isGlobal = scope === 'global';
                return (
                  <tr key={r.acceptance_id}>
                    <td><span className="an-risk-test">{r.test_name}</span></td>
                    <td>
                      {r.control_id ? (
                        <span className="an-exec-host">{r.control_id}</span>
                      ) : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {isGlobal ? (
                        <span
                          className="an-exec-cat"
                          style={{
                            background: 'rgba(167,139,250,.10)',
                            borderColor: 'rgba(167,139,250,.3)',
                            color: '#a78bfa',
                          }}
                        >
                          <Icon size={10}>{I.target}</Icon>
                          GLOBAL
                        </span>
                      ) : (
                        <span className="an-exec-host">{r.hostname ?? 'unknown'}</span>
                      )}
                    </td>
                    <td>
                      <span className="an-risk-just">
                        {r.justification.length > 140
                          ? `${r.justification.slice(0, 140)}…`
                          : r.justification}
                        {r.status === 'revoked' && (r.revocation_reason || r.revoked_by_name) && (
                          <span className="an-risk-revoked-meta">
                            ↳ revoked
                            {r.revoked_by_name ? ` by ${r.revoked_by_name}` : ''}
                            {r.revocation_reason ? `: ${r.revocation_reason}` : ''}
                          </span>
                        )}
                      </span>
                    </td>
                    <td><span className="an-risk-by">{r.accepted_by_name || r.accepted_by}</span></td>
                    <td><span className="an-risk-when">{relativeTime(r.accepted_at)}</span></td>
                    <td>
                      <span className={`an-risk-status ${r.status === 'active' ? 'is-active' : 'is-revoked'}`}>
                        {r.status === 'active' ? (
                          <>
                            <Icon size={9}>{I.alert}</Icon>
                            ACTIVE
                          </>
                        ) : (
                          <>
                            <Icon size={9}>{I.check}</Icon>
                            REVOKED
                          </>
                        )}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        {r.status === 'active' && (
                          <button
                            type="button"
                            className="an-pill"
                            style={{ padding: '4px 10px' }}
                            onClick={() => setRevokeTarget(r)}
                          >
                            REVOKE
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > PAGE_SIZE && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 4px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span>Page {page} of {totalPages} · {PAGE_SIZE} per page</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="an-pill" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              ← PREV
            </button>
            <button type="button" className="an-pill" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              NEXT →
            </button>
          </div>
        </div>
      )}

      {revokeTarget && (
        <RevokeDialog
          target={revokeTarget}
          reason={revokeReason}
          setReason={setRevokeReason}
          revoking={revoking}
          onCancel={() => { setRevokeTarget(null); setRevokeReason(''); }}
          onConfirm={handleRevokeConfirm}
        />
      )}
    </AnalyticsLayout>
  );
}

interface RevokeDialogProps {
  target: RiskAcceptance;
  reason: string;
  setReason: (v: string) => void;
  revoking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function RevokeDialog({ target, reason, setReason, revoking, onCancel, onConfirm }: RevokeDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Revoke risk acceptance"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
        display: 'grid', placeItems: 'center', zIndex: 60,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="an-card" style={{ width: 'min(520px, 92vw)', padding: 22 }}>
        <div className="an-card-head">
          <div>
            <div className="an-card-title">
              <Icon size={13}>{I.alert}</Icon>
              Revoke Risk Acceptance
            </div>
            <div className="an-card-sub">REQUIRES A JUSTIFICATION OF AT LEAST 10 CHARACTERS</div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Revoking the acceptance for <strong style={{ color: 'var(--text-primary)' }}>{target.test_name}</strong>{' '}
          {target.hostname ? <>on <code style={{ fontFamily: 'var(--font-mono)' }}>{target.hostname}</code></> : '(global)'} will
          re-include it in the Defense Score immediately.
        </div>
        <textarea
          aria-label="Revocation reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for revocation (e.g. policy update completed)…"
          rows={3}
          style={{
            width: '100%', padding: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--line)',
            borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
            fontSize: 12, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="an-pill" onClick={onCancel} disabled={revoking}>CANCEL</button>
          <button
            type="button"
            className="an-pill primary"
            onClick={onConfirm}
            disabled={revoking || reason.trim().length < 10}
          >
            {revoking ? 'REVOKING…' : 'CONFIRM REVOKE'}
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
