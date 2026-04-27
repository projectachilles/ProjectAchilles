import { useEffect, useMemo, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useAnalyticsFilters, getWindowDaysForDateRange } from '@/hooks/useAnalyticsFilters';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { useScoringMode } from '@/hooks/useScoringMode';
import { analyticsApi } from '@/services/api/analytics';
import { defenderApi, type SecureScoreSummary, type SecureScoreTrendPoint } from '@/services/api/defender';
import type {
  TrendDataPoint,
  ErrorTypeBreakdown,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  CategorySubcategoryBreakdownItem,
  EnrichedTestExecution,
  DefenseScoreByHostItem,
  ErrorRateTrendDataPoint,
} from '@/services/api/analytics';
import { AnalyticsLayout } from './AnalyticsLayout';
import { MultiTrendChart } from './components/charts/MultiTrendChart';
import { Donut } from './components/charts/Donut';
import { Sunburst, type SunburstCategory } from './components/charts/Sunburst';
import './analytics.css';

const CATEGORY_PALETTE: Record<string, string> = {
  'cyber-hygiene': '#22d3ee',
  'intel-driven':  '#a78bfa',
  'mitre-top10':   '#4f8eff',
  'phase-aligned': '#00e68a',
};

const ERROR_TYPE_PALETTE: Record<string, string> = {
  protected:    '#00e68a',
  unprotected:  '#ff3b5c',
  inconclusive: '#ffaa2e',
  contextual:   '#ffaa2e',
  error:        '#ff8a3b',
};

interface DefenseScoreData {
  overall: number;
  total: number;
  protected: number;
  realScore?: number;
  riskAcceptedCount?: number;
}

interface DashboardData {
  defenseScore: DefenseScoreData | null;
  uniqueHostnames: number;
  uniqueTests: number;
  trend: TrendDataPoint[];
  errorRateTrend: ErrorRateTrendDataPoint[];
  errorTypes: ErrorTypeBreakdown[];
  techniqueDist: TechniqueDistributionItem[];
  hostMatrix: HostTestMatrixCell[];
  categories: CategorySubcategoryBreakdownItem[];
  recentTests: EnrichedTestExecution[];
  hostScores: DefenseScoreByHostItem[];
  errorRate: number | null;
  secureScore: SecureScoreSummary | null;
  secureScoreTrend: SecureScoreTrendPoint[];
}

const EMPTY_DATA: DashboardData = {
  defenseScore: null,
  uniqueHostnames: 0,
  uniqueTests: 0,
  trend: [],
  errorRateTrend: [],
  errorTypes: [],
  techniqueDist: [],
  hostMatrix: [],
  categories: [],
  recentTests: [],
  hostScores: [],
  errorRate: null,
  secureScore: null,
  secureScoreTrend: [],
};

export default function AnalyticsDashboardPage() {
  const filterState = useAnalyticsFilters(true);
  const { settingsVersion } = useAnalyticsAuth();
  const { configured: defenderConfigured } = useDefenderConfig();
  const { scoringMode } = useScoringMode();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [activeRiskCount, setActiveRiskCount] = useState(0);

  // Risk count for sub-nav badge
  useEffect(() => {
    analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 })
      .then((r) => setActiveRiskCount(r.total))
      .catch(() => setActiveRiskCount(0));
  }, [settingsVersion]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = filterState.getApiParams();
    const scoreParams = { ...params, scoringMode };
    const windowDays = getWindowDaysForDateRange(filterState.filters.dateRange);

    Promise.all([
      analyticsApi.getDefenseScore(scoreParams),
      analyticsApi.getUniqueHostnames(params),
      analyticsApi.getUniqueTests(params),
      analyticsApi.getDefenseScoreTrend({ ...scoreParams, interval: 'day', windowDays }),
      analyticsApi.getResultsByErrorType(params),
      analyticsApi.getTechniqueDistribution(params),
      analyticsApi.getHostTestMatrix(params),
      analyticsApi.getDefenseScoreByCategorySubcategory(scoreParams),
      analyticsApi.getPaginatedExecutions({
        ...params,
        pageSize: 5,
        sortField: 'routing.event_time',
        sortOrder: 'desc',
      }),
      analyticsApi.getDefenseScoreByHostname(scoreParams),
      analyticsApi.getErrorRate(params),
      analyticsApi.getErrorRateTrend({ ...params, interval: 'day', windowDays }),
    ]).then(async ([
      score,
      hostnameCount,
      testCount,
      trend,
      errorTypes,
      techDist,
      matrix,
      categories,
      recent,
      hostScores,
      errorRateRes,
      errorRateTrend,
    ]) => {
      if (cancelled) return;

      let secureScore: SecureScoreSummary | null = null;
      let secureScoreTrend: SecureScoreTrendPoint[] = [];
      if (defenderConfigured) {
        const presetDaysMap: Record<string, number> = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, all: 90 };
        const trendDays = presetDaysMap[filterState.filters.dateRange.preset] ?? 90;
        try {
          const [s, t] = await Promise.all([
            defenderApi.getSecureScore(),
            defenderApi.getSecureScoreTrend(trendDays),
          ]);
          secureScore = s;
          secureScoreTrend = t;
        } catch {
          // Defender data is supplementary
        }
      }
      if (cancelled) return;

      setData({
        defenseScore: {
          overall: score.score,
          total: score.totalExecutions,
          protected: score.protectedCount,
          realScore: score.realScore,
          riskAcceptedCount: score.riskAcceptedCount,
        },
        uniqueHostnames: hostnameCount,
        uniqueTests: testCount,
        trend,
        errorRateTrend,
        errorTypes,
        techniqueDist: techDist.slice(0, 10),
        hostMatrix: matrix,
        categories,
        recentTests: recent.data,
        hostScores,
        errorRate: errorRateRes.errorRate,
        secureScore,
        secureScoreTrend,
      });
    }).catch((e) => {
      if (!cancelled) {
        // eslint-disable-next-line no-console
        console.error('Failed to load analytics dashboard:', e);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
    // useAnalyticsFilters returns a fresh top-level object every render; only
    // the inner .filters reference is stable React state. Depending on the
    // whole filterState caused an infinite refetch loop (12 endpoints x N
    // renders). filterState.getApiParams reads filters via closure and is
    // safe to call inside the effect without being a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState.filters, settingsVersion, defenderConfigured, scoringMode]);

  // Build the trend series the chart expects
  const trendSeries = useMemo(() => {
    const byTs = new Map<string, { defense?: number | null; secure?: number | null; error?: number | null }>();
    data.trend.forEach((p) => {
      byTs.set(p.timestamp, { defense: p.score });
    });
    data.errorRateTrend.forEach((p) => {
      const existing = byTs.get(p.timestamp) ?? {};
      existing.error = p.errorRate;
      byTs.set(p.timestamp, existing);
    });
    data.secureScoreTrend.forEach((p) => {
      const existing = byTs.get(p.date) ?? {};
      existing.secure = p.percentage;
      byTs.set(p.date, existing);
    });
    const sorted = [...byTs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([ts, vals]) => ({
      label: formatShortDay(ts),
      defense: vals.defense ?? null,
      secure: vals.secure ?? null,
      error: vals.error ?? null,
    }));
  }, [data.trend, data.errorRateTrend, data.secureScoreTrend]);

  const sunburstData: SunburstCategory[] = useMemo(() => {
    return data.categories.map((c) => ({
      id: String(c.category),
      name: String(c.category),
      score: c.score,
      color: CATEGORY_PALETTE[String(c.category)] ?? '#4f8eff',
      subs: (c.subcategories ?? []).map((s) => ({
        name: s.subcategory,
        score: s.score,
      })),
    }));
  }, [data.categories]);

  const errorTypeSlices = useMemo(() => {
    return data.errorTypes.map((e) => ({
      name: e.name,
      pct: e.count,
      color: ERROR_TYPE_PALETTE[e.name.toLowerCase()] ?? '#6b7388',
    }));
  }, [data.errorTypes]);

  const errorTypeTotal = errorTypeSlices.reduce((s, x) => s + x.pct, 0);

  return (
    <AnalyticsLayout
      executionsCount={data.defenseScore?.total}
      riskCount={activeRiskCount}
    >
      <div className="an-grid">
        {/* Row 1 — Defense hero (4) + Trend overview (8) */}
        <div className="col-4">
          <HeroScoreCard
            kind="defense"
            value={data.defenseScore?.overall}
            endpoints={data.uniqueHostnames}
            tests={data.uniqueTests}
            errorRate={data.errorRate}
            realScore={data.defenseScore?.realScore}
            riskAccepted={data.defenseScore?.riskAcceptedCount}
            loading={loading}
          />
        </div>
        <div className="col-8">
          <TrendOverviewCard
            data={trendSeries}
            loading={loading}
            totalExecutions={data.defenseScore?.total ?? 0}
            uniqueTests={data.uniqueTests}
            windowDays={getWindowDaysForDateRange(filterState.filters.dateRange)}
          />
        </div>

        {/* Row 2 — Secure hero (4) + Top failing controls (8) */}
        <div className="col-4">
          {defenderConfigured && data.secureScore ? (
            <HeroScoreCard
              kind="secure"
              value={data.secureScore.percentage}
              currentScore={data.secureScore.currentScore}
              maxScore={data.secureScore.maxScore}
              loading={loading}
            />
          ) : (
            <BottomControlsCard
              hostScores={data.hostScores}
              loading={loading}
            />
          )}
        </div>
        <div className="col-8">
          <TopFailingControlsCard
            categories={data.categories}
            loading={loading}
          />
        </div>

        {/* Row 3 — Distribution */}
        <div className="col-4">
          <ScoreByCategoryCard data={sunburstData} loading={loading} />
        </div>
        <div className="col-4">
          <TestActivityCard tests={data.recentTests} loading={loading} />
        </div>
        <div className="col-4">
          <ErrorTypeCard slices={errorTypeSlices} total={errorTypeTotal} loading={loading} />
        </div>

        {/* Row 4 — Coverage */}
        <div className="col-6">
          <TechniqueDistCard items={data.techniqueDist} loading={loading} />
        </div>
        <div className="col-6">
          <DefenseByHostCard hosts={data.hostScores} loading={loading} />
        </div>

        {/* Row 5 — Heatmap */}
        <div className="col-12">
          <HostTechniqueHeatmapCard matrix={data.hostMatrix} loading={loading} />
        </div>
      </div>
    </AnalyticsLayout>
  );
}

// ───────────────────────── Cards ─────────────────────────

interface HeroScoreCardProps {
  kind: 'defense' | 'secure';
  value?: number | null;
  endpoints?: number;
  tests?: number;
  currentScore?: number;
  maxScore?: number;
  errorRate?: number | null;
  realScore?: number | null;
  riskAccepted?: number | null;
  loading?: boolean;
}

function HeroScoreCard({
  kind,
  value,
  endpoints,
  tests,
  currentScore,
  maxScore,
  errorRate,
  realScore,
  riskAccepted,
  loading,
}: HeroScoreCardProps) {
  const isDefense = kind === 'defense';
  const label = isDefense ? 'Defense Score' : 'Secure Score';
  const valStr = value != null ? `${value.toFixed(1)}%` : '—';

  // Color the value: defense uses red (legacy danger glow) until score >= 80,
  // secure uses accent.
  let valueClass = '';
  if (isDefense) {
    if (value == null) valueClass = '';
    else if (value >= 80) valueClass = 'is-good';
    else if (value >= 60) valueClass = 'is-warn';
    else valueClass = 'is-defense';
  } else {
    valueClass = 'is-secure';
  }

  const sub = isDefense
    ? `Across ${endpoints ?? 0} endpoints · ${tests ?? 0} tests`
    : currentScore != null && maxScore != null
      ? `${currentScore.toFixed(1)} / ${maxScore.toFixed(1)} pts`
      : '';

  return (
    <div className="an-card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="an-hero-score">
        <span className="an-hero-score-label">
          <Icon size={14}>{I.shield}</Icon>
          {label}
        </span>
        <div className={`an-hero-score-value ${valueClass}`}>{loading ? '…' : valStr}</div>
        {realScore != null && riskAccepted != null && riskAccepted > 0 && value != null && Math.abs(realScore - value) > 0.05 && (
          <div className="an-hero-score-delta" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
            EDR-only · {realScore.toFixed(1)}% · {riskAccepted} excluded
          </div>
        )}
        {errorRate != null && errorRate > 0 && (
          <div className="an-hero-score-delta" style={{ background: 'rgba(255,170,46,.10)', color: 'var(--warn-bright)', borderColor: 'rgba(255,170,46,.3)' }}>
            <Icon size={9} sw={2}>{I.alert}</Icon>
            {errorRate.toFixed(1)}% inconclusive
          </div>
        )}
        <div className="an-hero-score-sub">{sub}</div>
      </div>
      {isDefense && (
        <div className="an-kpi-strip">
          <div className="an-kpi-cell">
            <span className="an-kpi-cell-label"><Icon size={10}>{I.monitor}</Icon> ENDPOINTS</span>
            <span className="an-kpi-cell-value">{(endpoints ?? 0).toLocaleString()}</span>
          </div>
          <div className="an-kpi-cell">
            <span className="an-kpi-cell-label"><Icon size={10}>{I.flask}</Icon> TESTS</span>
            <span className="an-kpi-cell-value">{(tests ?? 0).toLocaleString()}</span>
          </div>
        </div>
      )}
      {!isDefense && currentScore != null && maxScore != null && (
        <div className="an-kpi-strip">
          <div className="an-kpi-cell">
            <span className="an-kpi-cell-label">CURRENT</span>
            <span className="an-kpi-cell-value">{Math.round(currentScore).toLocaleString()}</span>
          </div>
          <div className="an-kpi-cell">
            <span className="an-kpi-cell-label">MAX</span>
            <span className="an-kpi-cell-value" style={{ color: 'var(--accent)' }}>{Math.round(maxScore).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface TrendOverviewCardProps {
  data: Array<{ label: string; defense?: number | null; secure?: number | null; error?: number | null }>;
  loading?: boolean;
  totalExecutions: number;
  uniqueTests: number;
  windowDays: number;
}

function TrendOverviewCard({ data, loading, totalExecutions, uniqueTests, windowDays }: TrendOverviewCardProps) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.chart}</Icon> Trend Overview
          </div>
          <div className="an-card-sub">{windowDays}D ROLLING · DEFENSE · SECURE · ERROR-RATE</div>
        </div>
        <div className="an-trend-stats">
          <span>WINDOW <span className="an-trend-stat-val">{windowDays}d</span></span>
          <span>EXECS <span className="an-trend-stat-val">{totalExecutions.toLocaleString()}</span></span>
          <span>TESTS <span className="an-trend-stat-val">{uniqueTests.toLocaleString()}</span></span>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : (
        <MultiTrendChart data={data} width={820} height={260} />
      )}
      <div className="an-trend-legend">
        <span className="an-trend-legend-item"><span className="an-trend-legend-swatch" style={{ background: 'var(--accent)' }}/>Secure Score</span>
        <span className="an-trend-legend-item"><span className="an-trend-legend-swatch" style={{ background: 'var(--signal)' }}/>Defense Score</span>
        <span className="an-trend-legend-item"><span className="an-trend-legend-swatch" style={{ background: 'var(--danger)', opacity: .6 }}/>Error Rate (right axis)</span>
      </div>
    </div>
  );
}

interface TopFailingControlsCardProps {
  categories: CategorySubcategoryBreakdownItem[];
  loading?: boolean;
}

function TopFailingControlsCard({ categories, loading }: TopFailingControlsCardProps) {
  // Flatten subcategories and sort ascending — bottom-5 are the "top failing".
  const rows = useMemo(() => {
    const flat: Array<{ name: string; cat: string; score: number }> = [];
    categories.forEach((c) => {
      (c.subcategories ?? []).forEach((s) => {
        flat.push({ name: s.subcategory, cat: String(c.category), score: s.score });
      });
    });
    return flat.sort((a, b) => a.score - b.score).slice(0, 8);
  }, [categories]);

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.alert}</Icon> Top Failing Subcategories
          </div>
          <div className="an-card-sub">RANKED BY DEFENSE SCORE · LOWEST FIRST</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : rows.length === 0 ? (
        <div className="an-page-empty">NO CATEGORY DATA</div>
      ) : (
        <div className="an-list">
          {rows.map((r, i) => (
            <div key={`${r.cat}-${r.name}`} className="an-list-row">
              <span className="an-list-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="an-list-title">{r.name}</span>
              <span className="an-list-cat">{r.cat}</span>
              <span className="an-list-score" style={{ color: r.score < 50 ? 'var(--danger)' : r.score < 70 ? 'var(--warn-bright)' : 'var(--accent)' }}>
                {r.score.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BottomControlsCardProps {
  hostScores: DefenseScoreByHostItem[];
  loading?: boolean;
}

/** Fallback for the "secure score" slot when Defender isn't configured —
 *  shows the bottom-3 hosts so the slot remains useful. */
function BottomControlsCard({ hostScores, loading }: BottomControlsCardProps) {
  const sorted = [...hostScores].sort((a, b) => a.score - b.score).slice(0, 5);
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.monitor}</Icon> Lowest-Scoring Hosts
          </div>
          <div className="an-card-sub">CONFIGURE DEFENDER FOR SECURE-SCORE HERO</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : sorted.length === 0 ? (
        <div className="an-page-empty">NO HOST DATA</div>
      ) : (
        <div className="an-list">
          {sorted.map((h, i) => (
            <div key={h.hostname} className="an-list-row">
              <span className="an-list-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="an-list-title">{h.hostname}</span>
              <span className="an-list-cat">{h.protected}/{h.total}</span>
              <span className="an-list-score" style={{ color: h.score < 50 ? 'var(--danger)' : h.score < 70 ? 'var(--warn-bright)' : 'var(--accent)' }}>
                {h.score.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ScoreByCategoryCardProps {
  data: SunburstCategory[];
  loading?: boolean;
}

function ScoreByCategoryCard({ data, loading }: ScoreByCategoryCardProps) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.target}</Icon> Score by Category
          </div>
          <div className="an-card-sub">CATEGORY · SUBCATEGORY · DEFENSE-WEIGHTED</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : data.length === 0 ? (
        <div className="an-page-empty">NO CATEGORY DATA</div>
      ) : (
        <div className="an-donut-wrap" style={{ gridTemplateColumns: '170px 1fr' }}>
          <Sunburst data={data} size={170} />
          <div>
            {data.map((c) => (
              <div key={c.id}>
                <div className="an-cat-row">
                  <span className="an-legend-dot" style={{ background: c.color }} />
                  <span className="an-cat-name">{c.name}</span>
                  <span className="an-cat-pct">{c.score.toFixed(1)}%</span>
                </div>
                {c.subs.slice(0, 3).map((s) => (
                  <div key={s.name} className="an-cat-row" style={{ paddingLeft: 22 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, opacity: .55 }} />
                    <span className="an-cat-sub">↳ {s.name}</span>
                    <span className="an-cat-pct">{s.score.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TestActivityCardProps {
  tests: EnrichedTestExecution[];
  loading?: boolean;
}

function TestActivityCard({ tests, loading }: TestActivityCardProps) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.bolt}</Icon> Recent Activity
          </div>
          <div className="an-card-sub">{tests.length} MOST RECENT EXECUTIONS</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : tests.length === 0 ? (
        <div className="an-page-empty">NO RECENT EXECUTIONS</div>
      ) : (
        <div className="an-activity-list">
          {tests.slice(0, 6).map((t, i) => {
            const isOk = isProtectedExec(t);
            const when = relativeTime(t.timestamp);
            return (
              <div key={`${t.test_uuid}-${t.timestamp}-${i}`} className="an-activity-item">
                <div className={`an-activity-item-icon ${isOk ? 'ok' : 'fail'}`}>
                  <Icon size={12} sw={2.4}>{isOk ? I.check : I.alert}</Icon>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="an-activity-item-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.test_name}
                  </div>
                  <div className="an-activity-item-host">{t.hostname}</div>
                </div>
                <div className="an-activity-item-when">{when}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ErrorTypeCardProps {
  slices: Array<{ name: string; pct: number; color: string }>;
  total: number;
  loading?: boolean;
}

function ErrorTypeCard({ slices, total, loading }: ErrorTypeCardProps) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.target}</Icon> Results by Error Type
          </div>
          <div className="an-card-sub">{total.toLocaleString()} EXECUTIONS</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : slices.length === 0 ? (
        <div className="an-page-empty">NO RESULT DATA</div>
      ) : (
        <div className="an-donut-wrap">
          <Donut data={slices} size={150} thickness={22} label={total.toLocaleString()} sublabel="TOTAL" />
          <div className="an-donut-legend">
            {slices.map((e) => {
              const pct = total > 0 ? (e.pct / total) * 100 : 0;
              return (
                <div key={e.name} className="an-donut-legend-row">
                  <span className="an-donut-swatch" style={{ background: e.color }} />
                  <span>
                    <span className="an-donut-name">{e.name}</span>
                    <span className="an-donut-name-sub"> · {e.pct.toLocaleString()}</span>
                  </span>
                  <span className="an-donut-pct">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface TechniqueDistCardProps {
  items: TechniqueDistributionItem[];
  loading?: boolean;
}

function TechniqueDistCard({ items, loading }: TechniqueDistCardProps) {
  const max = items.reduce((m, t) => Math.max(m, (t.protected ?? 0) + (t.unprotected ?? 0)), 1);
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.grid}</Icon> ATT&amp;CK Technique Distribution
          </div>
          <div className="an-card-sub">TOP 10 · EXECUTIONS PER TECHNIQUE</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : items.length === 0 ? (
        <div className="an-page-empty">NO TECHNIQUE DATA</div>
      ) : (
        <div>
          {items.map((t) => {
            const total = (t.protected ?? 0) + (t.unprotected ?? 0);
            const pct = (total / max) * 100;
            const protectedPct = total > 0 ? (t.protected / total) * 100 : 0;
            return (
              <div key={t.technique} className="an-tech-row">
                <span className="an-tech-id">{t.technique}</span>
                <div className="an-tech-bar">
                  <div className="an-tech-bar-fill" style={{ width: `${pct}%`, background: protectedPct >= 50 ? 'var(--accent)' : 'var(--danger)' }} />
                </div>
                <span className="an-tech-pct">{total.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DefenseByHostCardProps {
  hosts: DefenseScoreByHostItem[];
  loading?: boolean;
}

function DefenseByHostCard({ hosts, loading }: DefenseByHostCardProps) {
  const max = Math.max(1, ...hosts.map(h => h.score));
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.monitor}</Icon> Defense Score by Host
          </div>
          <div className="an-card-sub">PER-ENDPOINT BREAKDOWN · {hosts.length} HOSTS</div>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : hosts.length === 0 ? (
        <div className="an-page-empty">NO HOST DATA</div>
      ) : (
        <div>
          {hosts.slice(0, 10).map((h) => {
            const color = h.score >= 80 ? 'var(--accent)' : h.score >= 60 ? 'var(--warn-bright)' : 'var(--danger)';
            return (
              <div key={h.hostname} className="an-tech-row" style={{ gridTemplateColumns: '160px 1fr 60px' }}>
                <span className="an-tech-id" style={{ color: 'var(--text-primary)', fontSize: 11 }}>{h.hostname}</span>
                <div className="an-tech-bar" style={{ height: 14 }}>
                  <div className="an-tech-bar-fill" style={{ width: `${(h.score / max) * 100}%`, background: color }} />
                </div>
                <span className="an-tech-pct" style={{ color, fontWeight: 600 }}>{h.score.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HostTechniqueHeatmapCardProps {
  matrix: HostTestMatrixCell[];
  loading?: boolean;
}

function HostTechniqueHeatmapCard({ matrix, loading }: HostTechniqueHeatmapCardProps) {
  // Build a host × test grid. Cell value = run count (any positive).
  const { hosts, tests, grid, max } = useMemo(() => {
    const hostsSet = new Set<string>();
    const testsSet = new Set<string>();
    matrix.forEach((m) => {
      hostsSet.add(m.hostname);
      testsSet.add(m.testName);
    });
    const hostsArr = [...hostsSet].slice(0, 14);
    const testsArr = [...testsSet].slice(0, 18);
    const grid: Record<string, Record<string, number>> = {};
    let max = 0;
    hostsArr.forEach((h) => { grid[h] = {}; });
    matrix.forEach((m) => {
      if (grid[m.hostname]) {
        grid[m.hostname][m.testName] = (grid[m.hostname][m.testName] ?? 0) + m.count;
        max = Math.max(max, grid[m.hostname][m.testName]);
      }
    });
    return { hosts: hostsArr, tests: testsArr, grid, max: max || 1 };
  }, [matrix]);

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div>
          <div className="an-card-title">
            <Icon size={13}>{I.grid}</Icon> Host × Test Coverage
          </div>
          <div className="an-card-sub">DARKER GREEN = MORE COVERAGE · {hosts.length} HOSTS × {tests.length} TESTS</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          <span>0</span>
          <div style={{ width: 120, height: 8, borderRadius: 2, background: 'linear-gradient(90deg, rgba(0,230,138,.08), rgba(0,230,138,.7))', border: '1px solid var(--line)' }} />
          <span>{max}</span>
        </div>
      </div>
      {loading ? (
        <div className="an-page-loading">LOADING…</div>
      ) : hosts.length === 0 || tests.length === 0 ? (
        <div className="an-page-empty">NO COVERAGE DATA</div>
      ) : (
        <div className="an-heatmap-wrap">
          <table className="an-heatmap-table">
            <thead>
              <tr>
                <th>Host</th>
                {tests.map((t) => (
                  <th key={t} className="an-heatmap-techhead" title={t}>
                    {truncate(t, 28)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h}>
                  <td className="an-heatmap-host">{h}</td>
                  {tests.map((t) => {
                    const v = grid[h]?.[t] ?? 0;
                    const ratio = v / max;
                    return (
                      <td key={`${h}-${t}`} className="an-heatmap-cell">
                        <div
                          className="an-heatmap-cell-inner"
                          style={{
                            background: v > 0 ? `rgba(0,230,138,${0.06 + ratio * 0.6})` : 'rgba(255,255,255,.04)',
                            color: ratio > 0.4 ? '#062013' : 'var(--text-muted)',
                            fontWeight: ratio > 0.4 ? 700 : 400,
                          }}
                        >
                          {v || ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Helpers ─────────────────────────

function isProtectedExec(t: EnrichedTestExecution): boolean {
  if (typeof t.error_code === 'number') {
    return [105, 126, 127].includes(t.error_code);
  }
  return t.is_protected === true;
}

function relativeTime(ts: string): string {
  if (!ts) return '';
  let d: Date;
  if (/^\d+$/.test(ts)) d = new Date(parseInt(ts, 10));
  else d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function formatShortDay(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts.slice(0, 5);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
