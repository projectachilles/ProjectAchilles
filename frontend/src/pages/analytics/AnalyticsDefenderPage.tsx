import { useEffect, useMemo, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import {
  defenderApi,
  type SecureScoreSummary,
  type SecureScoreTrendPoint,
  type ControlItem,
  type DetectionRateResponse,
  type TechniqueOverlapItem,
} from '@/services/api/defender';
import { analyticsApi } from '@/services/api/analytics';
import { AnalyticsLayout } from './AnalyticsLayout';
import { MultiTrendChart } from './components/charts/MultiTrendChart';
import './analytics.css';

export default function AnalyticsDefenderPage() {
  const { configured } = useDefenderConfig();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [score, setScore] = useState<SecureScoreSummary | null>(null);
  const [trend, setTrend] = useState<SecureScoreTrendPoint[]>([]);
  const [controls, setControls] = useState<ControlItem[]>([]);
  const [detection, setDetection] = useState<DetectionRateResponse | null>(null);
  const [overlap, setOverlap] = useState<TechniqueOverlapItem[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [activeRiskCount, setActiveRiskCount] = useState(0);

  useEffect(() => {
    analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 })
      .then((r) => setActiveRiskCount(r.total))
      .catch(() => setActiveRiskCount(0));
  }, []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      defenderApi.getSecureScore().catch(() => null),
      defenderApi.getSecureScoreTrend(30).catch(() => []),
      defenderApi.getControls({ deprecated: false }).catch(() => []),
      defenderApi.getDetectionRate(30).catch(() => null),
      defenderApi.getTechniqueOverlap().catch(() => []),
      fetch('/api/integrations/defender/sync/status').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([s, t, c, d, o, sync]) => {
      if (cancelled) return;
      setScore(s);
      setTrend(t);
      setControls((c ?? []).slice().sort((a, b) => b.max_score - a.max_score).slice(0, 10));
      setDetection(d);
      setOverlap(o);
      if (sync && (sync.lastScoreSync || sync.lastAlertSync)) {
        setLastSync(sync.lastScoreSync || sync.lastAlertSync);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [configured]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/integrations/defender/sync', { method: 'POST' });
      if (res.ok) {
        const [s, t] = await Promise.all([
          defenderApi.getSecureScore().catch(() => null),
          defenderApi.getSecureScoreTrend(30).catch(() => []),
        ]);
        setScore(s);
        setTrend(t);
        setLastSync(new Date().toISOString());
      }
    } finally {
      setSyncing(false);
    }
  };

  const trendSeries = useMemo(() => {
    return trend.map((p) => ({
      label: shortDate(p.date),
      secure: p.percentage,
      defense: null,
      error: null,
    }));
  }, [trend]);

  const detectionItems = useMemo(() => {
    return (detection?.byTechnique ?? []).slice(0, 10);
  }, [detection]);

  return (
    <AnalyticsLayout riskCount={activeRiskCount}>
      <div className="an-defender-head">
        <div>
          <h2>Microsoft Defender</h2>
          <p>
            Secure Score, security alerts, and remediation controls
            {lastSync && (
              <>
                {' · Last synced '}
                <code>{relativeTime(lastSync)}</code>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="an-pill"
          onClick={handleSync}
          disabled={syncing}
        >
          <Icon size={11}>{I.sync}</Icon>
          {syncing ? 'SYNCING…' : 'SYNC NOW'}
        </button>
      </div>

      {!configured ? (
        <div className="an-page-empty">
          DEFENDER NOT CONFIGURED · CONFIGURE THE INTEGRATION IN SETTINGS TO POPULATE THIS DASHBOARD
        </div>
      ) : (
        <div className="an-grid">
          {/* Hero — Secure score (4) + Top remediation controls (8) */}
          <div className="col-4">
            <SecureScoreHeroCard data={score} loading={loading} />
          </div>
          <div className="col-8">
            <RemediationControlsCard controls={controls} loading={loading} />
          </div>

          {/* Detection analysis (7) + Secure score trend (5) */}
          <div className="col-7">
            <DetectionAnalysisCard items={detectionItems} overall={detection?.overall} loading={loading} />
          </div>
          <div className="col-5">
            <SecureScoreTrendCard data={trendSeries} loading={loading} />
          </div>

          {/* Technique overlap grid */}
          <div className="col-12">
            <TechniqueOverlapCard items={overlap} loading={loading} />
          </div>
        </div>
      )}
    </AnalyticsLayout>
  );
}

// ───────────────────────── Cards ─────────────────────────

function SecureScoreHeroCard({ data, loading }: { data: SecureScoreSummary | null; loading?: boolean }) {
  return (
    <div className="an-card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="an-hero-score">
        <span className="an-hero-score-label">
          <Icon size={14}>{I.shield}</Icon>
          Secure Score
        </span>
        <div className="an-hero-score-value is-secure">
          {loading ? '…' : data ? `${data.percentage.toFixed(1)}%` : '—'}
        </div>
        {data?.averageComparative != null && (
          <div className="an-hero-score-delta">
            INDUSTRY AVG · {data.averageComparative.toFixed(1)}
          </div>
        )}
        <div className="an-hero-score-sub">
          {data ? `${data.currentScore.toFixed(1)} / ${data.maxScore.toFixed(1)} pts` : ''}
        </div>
      </div>
      <div className="an-kpi-strip">
        <div className="an-kpi-cell">
          <span className="an-kpi-cell-label">CURRENT</span>
          <span className="an-kpi-cell-value">{data ? Math.round(data.currentScore).toLocaleString() : '—'}</span>
        </div>
        <div className="an-kpi-cell">
          <span className="an-kpi-cell-label">MAX</span>
          <span className="an-kpi-cell-value" style={{ color: 'var(--accent)' }}>
            {data ? Math.round(data.maxScore).toLocaleString() : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

function RemediationControlsCard({ controls, loading }: { controls: ControlItem[]; loading?: boolean }) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.shield}</Icon> Top Remediation Controls
          </div>
          <div className="an-card-sub">RANKED BY DEFENDER · MAX-SCORE WEIGHT</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : controls.length === 0 ? (
        <div className="an-page-empty">NO CONTROLS DATA · SYNC DEFENDER FIRST</div>
      ) : (
        <div className="an-list">
          {controls.map((c, i) => (
            <div key={c.control_name} className="an-list-row">
              <span className="an-list-rank">{String(i + 1).padStart(2, '0')}</span>
              {c.action_url ? (
                <a className="an-list-title" href={c.action_url} target="_blank" rel="noreferrer">
                  {c.title}
                </a>
              ) : (
                <span className="an-list-title">{c.title}</span>
              )}
              <span className="an-list-cat">{c.control_category}</span>
              <span className="an-list-score">+{c.max_score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DetectionAnalysisCardProps {
  items: Array<{ technique: string; testExecutions: number; correlatedAlerts: number; detected: boolean }>;
  overall?: { testedTechniques: number; detectedTechniques: number; detectionRate: number };
  loading?: boolean;
}

function DetectionAnalysisCard({ items, overall, loading }: DetectionAnalysisCardProps) {
  const max = Math.max(1, ...items.map(i => i.testExecutions));
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.target}</Icon> Detection Analysis
          </div>
          <div className="an-card-sub">DEFENDER ALERTS PER ATT&amp;CK TECHNIQUE · LAST 30 DAYS</div>
        </div>
        {overall && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
              {overall.detectionRate.toFixed(1)}%
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '.15em' }}>
              DETECTION RATE
            </div>
          </div>
        )}
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : items.length === 0 ? (
        <div className="an-page-empty">NO TECHNIQUE EXECUTIONS</div>
      ) : (
        <div>
          {items.map((it) => {
            const pct = (it.testExecutions / max) * 100;
            return (
              <div key={it.technique} className="an-detection-bar">
                <span className="an-detection-id">{it.technique}</span>
                <div className="an-detection-track">
                  <div className={`an-detection-fill ${it.detected ? 'is-detected' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="an-detection-tests">{it.testExecutions} tests</span>
                <span className={`an-detection-alert ${it.detected ? 'is-alert' : 'is-none'}`}>
                  {it.detected ? (
                    <>
                      <Icon size={10}>{I.alert}</Icon>
                      {it.correlatedAlerts} alert{it.correlatedAlerts === 1 ? '' : 's'}
                    </>
                  ) : (
                    'no alerts'
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {overall && (
        <div style={{ marginTop: 12, display: 'flex', gap: 14, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          <span><span className="an-legend-dot" style={{ background: 'var(--accent)' }}/>Detected by Defender</span>
          <span><span className="an-legend-dot" style={{ background: 'var(--danger)' }}/>No matching alert</span>
          <span style={{ marginLeft: 'auto' }}>
            {overall.detectedTechniques}/{overall.testedTechniques} techniques generated alerts
          </span>
        </div>
      )}
    </div>
  );
}

function SecureScoreTrendCard({ data, loading }: { data: Array<{ label: string; secure?: number | null; defense?: number | null; error?: number | null }>; loading?: boolean }) {
  const startVal = data.find(d => d.secure != null)?.secure ?? null;
  const endVal = [...data].reverse().find(d => d.secure != null)?.secure ?? null;
  const delta = startVal != null && endVal != null ? endVal - startVal : null;
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.chart}</Icon> Secure Score Trend
          </div>
          <div className="an-card-sub">DAILY SNAPSHOT · 30 DAYS</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : data.length === 0 ? (
        <div className="an-page-empty">NO TREND DATA</div>
      ) : (
        <MultiTrendChart data={data} width={520} height={220} />
      )}
      <div className="an-trend-legend" style={{ marginTop: 6 }}>
        <span className="an-trend-legend-item">
          <span className="an-trend-legend-swatch" style={{ background: 'var(--accent)' }}/>
          Secure Score
        </span>
        {delta != null && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} pts in window
          </span>
        )}
      </div>
    </div>
  );
}

function TechniqueOverlapCard({ items, loading }: { items: TechniqueOverlapItem[]; loading?: boolean }) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.grid}</Icon> Technique Overlap · ATT&amp;CK ↔ Defender Alerts
          </div>
          <div className="an-card-sub">CROSS-REFERENCE TEST EXECUTIONS WITH DEFENDER ALERTS BY TECHNIQUE</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : items.length === 0 ? (
        <div className="an-page-empty">NO TECHNIQUE OVERLAP DATA</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          {items.map((t) => {
            const detected = t.defenderAlerts > 0;
            return (
              <div
                key={t.technique}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  padding: '10px 12px',
                  background: detected ? 'rgba(0,230,138,.05)' : 'rgba(255,59,92,.04)',
                  borderLeft: `3px solid ${detected ? 'var(--accent)' : 'var(--danger)'}`,
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: detected ? 'var(--accent)' : 'var(--danger)', fontWeight: 600 }}>
                  {t.technique}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>{t.testResults} tests</span>
                  <span style={{ color: detected ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {detected ? `${t.defenderAlerts} alert${t.defenderAlerts > 1 ? 's' : ''}` : 'no alert'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Helpers ─────────────────────────

function shortDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function relativeTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
