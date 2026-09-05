import { Activity, FlaskConical, Server, ShieldAlert, ShieldCheck, Star } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHasPermission } from '@/hooks/useAppRole';
import { AttentionBanner } from './components/AttentionBanner';
import { CategoryBreakdownCard } from './components/CategoryBreakdownCard';
import { FleetHealthCard } from './components/FleetHealthCard';
import { KpiCard, type KpiCardProps } from './components/KpiCard';
import { MitreCoverageBars } from './components/MitreCoverageBars';
import { RecentExecutionsCard } from './components/RecentExecutionsCard';
import { SeverityDonut } from './components/SeverityDonut';
import { SyncChip } from './components/SyncChip';
import { TopControlsCard } from './components/TopControlsCard';
import { TrendOverviewChart } from './components/TrendOverviewChart';
import {
  DASHBOARD_RANGES,
  DEFAULT_DASHBOARD_RANGE,
  normalizeDashboardRange,
  useDashboardData,
  type DashboardRange,
} from './useDashboardData';

const DEFENSE_DANGER_THRESHOLD = 60;

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = normalizeDashboardRange(searchParams.get('range'));
  const data = useDashboardData(range);
  const canSync = useHasPermission('tests:sync:execute');

  const setRange = (next: DashboardRange) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        // The default stays out of the URL, matching the Analytics filter convention
        if (next === DEFAULT_DASHBOARD_RANGE) params.delete('range');
        else params.set('range', next);
        return params;
      },
      { replace: true },
    );
  };

  const kpis: KpiCardProps[] = [
    {
      label: `Defense score (${range})`,
      value: data.defenseScore ? `${data.defenseScore.score.toFixed(1)}%` : '—',
      sub: data.analyticsConfigured
        ? data.errorRate
          ? `${data.errorRate.errorRate.toFixed(1)}% inconclusive`
          : undefined
        : 'not configured',
      icon: ShieldAlert,
      to: '/analytics',
      tone:
        data.defenseScore && data.defenseScore.score < DEFENSE_DANGER_THRESHOLD ? 'danger' : 'default',
    },
    {
      label: 'Secure score',
      value: data.secureScore ? `${data.secureScore.percentage.toFixed(1)}%` : '—',
      sub: data.defenderConfigured
        ? data.secureScore
          ? `${data.secureScore.currentScore.toFixed(1)} / ${data.secureScore.maxScore.toFixed(1)} pts`
          : undefined
        : 'not configured',
      icon: ShieldCheck,
      to: '/analytics?tab=defender',
      tone: data.secureScore ? 'accent' : 'default',
    },
    {
      label: 'Total tests',
      value: data.testStats ? String(data.testStats.total) : '—',
      sub: data.testStats ? `${data.testStats.criticalHigh} critical/high` : undefined,
      icon: FlaskConical,
      to: '/tests',
    },
    {
      label: 'Avg score',
      value: data.testStats && data.testStats.scoredTests > 0 ? data.testStats.avgScore.toFixed(3) : '—',
      sub: data.testStats ? `across ${data.testStats.scoredTests} scored tests` : undefined,
      icon: Star,
      to: '/tests',
    },
    {
      label: 'Agents online',
      value: data.metrics ? `${data.metrics.online}/${data.metrics.total}` : '—',
      sub: data.metrics ? `${data.metrics.offline} offline` : undefined,
      icon: Server,
      to: '/agents',
      tone: data.metrics && data.metrics.offline > 0 ? 'danger' : 'default',
    },
    {
      label: 'Executions 7d',
      value: data.defense7 ? String(data.defense7.totalExecutions) : '—',
      sub: data.analyticsConfigured
        ? data.defense7
          ? `${data.defense7.score.toFixed(0)}% protected`
          : undefined
        : 'not configured',
      icon: Activity,
      to: '/analytics',
    },
  ];

  const fleetStats = data.metrics
    ? [
        {
          value: `${data.metrics.online}/${data.metrics.total}`,
          label: 'online',
          accent: true,
        },
        {
          value: data.fleetHealth ? `${Math.round(data.fleetHealth.task_success_rate_7d)}%` : '—',
          label: 'task 7d',
        },
        {
          value: data.fleetHealth?.mtbf_hours != null ? `${data.fleetHealth.mtbf_hours.toFixed(1)}h` : '—',
          label: 'mtbf',
        },
      ]
    : [];

  const fleetRows = data.metrics
    ? [
        ...Object.entries(data.metrics.by_os).map(([os, count]) => ({
          label: os,
          count,
          pct: data.metrics!.total > 0 ? (count / data.metrics!.total) * 100 : 0,
        })),
        ...Object.entries(data.metrics.by_version).map(([version, count]) => ({
          label: `agent ${version}`,
          count,
          pct: data.metrics!.total > 0 ? (count / data.metrics!.total) * 100 : 0,
        })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Security Dashboard"
        description="Posture across tests, endpoints, and analytics"
        className="mb-0"
      >
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {DASHBOARD_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                'inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-[11px] transition-colors',
                range === r
                  ? 'border-accent/25 bg-accent-dim text-accent'
                  : 'border-border bg-raised text-muted hover:bg-overlay',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <SyncChip
          branch={data.syncStatus?.branch}
          commit={data.syncStatus?.commitHash ?? undefined}
          lastSyncedAgo={data.lastSyncedAgo}
          syncing={data.syncing}
          canSync={canSync}
          onSync={() => void data.handleSync()}
        />
      </PageHeader>

      <AttentionBanner items={data.attentionItems} loading={data.loading} />

      {/* KPI row */}
      <div className="grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6 max-lg:[&>*]:min-w-0">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} loading={data.loading} />
        ))}
      </div>

      {/* Trend + severity */}
      <div className="grid gap-4 lg:grid-cols-3 max-lg:[&>*]:min-w-0">
        <div className="lg:col-span-2">
          <TrendOverviewChart
            data={data.trend}
            description={data.trendDescription}
            hasSecureScore={data.defenderConfigured}
            rangeLabel={range}
            loading={data.loading}
          />
        </div>
        <SeverityDonut
          mix={data.testStats?.severityMix ?? { high: 0, medium: 0, low: 0 }}
          loading={data.loading}
        />
      </div>

      {/* MITRE + categories */}
      <div className="grid gap-4 lg:grid-cols-3 max-lg:[&>*]:min-w-0">
        <div className="lg:col-span-2">
          <MitreCoverageBars
            tactics={data.testStats?.mitre.tactics ?? []}
            totalTechniques={data.testStats?.mitre.totalTechniques ?? 0}
            coveredTactics={data.testStats?.mitre.coveredTactics ?? 0}
            totalTactics={data.testStats?.mitre.totalTactics ?? 14}
            mappedTests={data.testStats?.mitre.mappedTests ?? 0}
            loading={data.loading}
          />
        </div>
        <CategoryBreakdownCard
          rows={data.testStats?.categories ?? []}
          avgScore={
            data.testStats && data.testStats.scoredTests > 0
              ? data.testStats.avgScore.toFixed(3)
              : undefined
          }
          scoredTests={data.testStats?.scoredTests}
          criticalHigh={data.testStats?.criticalHigh}
          loading={data.loading}
        />
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 lg:grid-cols-3 max-lg:[&>*]:min-w-0">
        <TopControlsCard
          controls={data.controls}
          configured={data.defenderConfigured}
          loading={data.loading}
        />
        <FleetHealthCard stats={fleetStats} rows={fleetRows} loading={data.loading} />
        <RecentExecutionsCard
          executions={data.recentExecutions}
          configured
          loading={data.loading}
        />
      </div>
    </div>
  );
}
