import { FlaskConical, Server, ShieldAlert, ShieldCheck, Star } from 'lucide-react';
import { CrowdStrikeLogo } from '@/components/shared/VendorLogos';
import { cn } from '@/lib/utils';
import { isLowSample, POSTURE_HELP, postureCaption, postureWindowLabel } from '@/lib/posture';
import { isSameTimeRange, TIME_RANGE_PRESETS, timeRangeButtonLabel } from '@/lib/timeRange';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHasPermission } from '@/hooks/useAppRole';
import { useSharedTimeRange } from '@/hooks/useSharedTimeRange';
import { AttentionBanner } from './components/AttentionBanner';
import { AttackOutcomeMatrix } from './components/AttackOutcomeMatrix';
import { FleetHealthCard } from './components/FleetHealthCard';
import { KpiCard, type KpiCardProps } from './components/KpiCard';
import { KpiGrid } from './components/KpiGrid';
import { RecentExecutionsCard } from './components/RecentExecutionsCard';
import { SyncChip } from './components/SyncChip';
import { TestingCadenceCard } from './components/TestingCadenceCard';
import { ThreatActorReadinessCard } from './components/ThreatActorReadinessCard';
import { TopControlsCard } from './components/TopControlsCard';
import { TrendOverviewChart } from './components/TrendOverviewChart';
import { useDashboardData } from './useDashboardData';

const DEFENSE_DANGER_THRESHOLD = 60;

function formatRangeDay(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

export default function DashboardPage() {
  const [range, setRange] = useSharedTimeRange();
  const data = useDashboardData(range);
  const canSync = useHasPermission('tests:sync:execute');
  // '30d', '1d', 'last 365d' (All), or a custom range's length
  const windowLabel = postureWindowLabel(range);

  const defenseCurrent = { score: data.defenseCurrentScore, pairCount: data.defensePairCount };

  const kpis: KpiCardProps[] = [
    {
      label: `Defense score (${windowLabel})`,
      value: defenseCurrent.score != null ? `${defenseCurrent.score.toFixed(1)}%` : '—',
      sub: data.analyticsConfigured
        ? postureCaption(defenseCurrent.pairCount, data.defenseDelta, windowLabel)
        : 'not configured',
      title: POSTURE_HELP,
      icon: ShieldAlert,
      to: '/analytics',
      tone: isLowSample(defenseCurrent.pairCount)
        ? 'muted'
        : defenseCurrent.score != null && defenseCurrent.score < DEFENSE_DANGER_THRESHOLD
          ? 'danger'
          : 'default',
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
    // CrowdStrike ZTA card — only joins the KPI grid when configured so the
    // 6-up layout isn't broken by a "not configured" placeholder.
    ...(data.crowdstrikeConfigured
      ? [{
          label: 'ZTA score',
          value: data.ztaScore ? `${data.ztaScore.overallScore.toFixed(1)}%` : '—',
          sub: data.ztaScore ? `${data.ztaScore.deviceCount.toLocaleString()} devices` : undefined,
          icon: CrowdStrikeLogo,
          to: '/analytics?tab=crowdstrike',
          tone: (data.ztaScore ? 'accent' : 'default') as KpiCardProps['tone'],
        }]
      : []),
    {
      label: 'Total tests',
      value: data.testStats ? String(data.testStats.total) : '—',
      sub: data.testStats ? `${data.testStats.intelDriven} intel-driven` : undefined,
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
          {TIME_RANGE_PRESETS.map((preset) => {
            const active = isSameTimeRange(range, { preset });
            return (
              <button
                key={preset}
                onClick={() => setRange({ preset })}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-accent/25 bg-accent-dim text-accent'
                    : 'border-border bg-raised text-muted hover:bg-overlay',
                )}
              >
                {timeRangeButtonLabel(preset)}
              </button>
            );
          })}
          {range.preset === 'custom' && (
            // A custom range is set from the Analytics date picker; shown here so
            // the Dashboard never silently uses a different window
            <span
              title={`${formatRangeDay(range.from)} – ${formatRangeDay(range.to)}`}
              className="inline-flex h-7 items-center rounded-md border border-accent/25 bg-accent-dim px-2.5 font-mono text-[11px] text-accent"
            >
              Custom
            </span>
          )}
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
      <KpiGrid>
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} loading={data.loading} />
        ))}
      </KpiGrid>

      {/* Trend + cadence */}
      <div className="grid gap-4 lg:grid-cols-3 max-lg:[&>*]:min-w-0">
        <div className="lg:col-span-2 [&>*]:h-full">
          <TrendOverviewChart
            data={data.trend}
            description={data.trendDescription}
            hasSecureScore={data.defenderConfigured}
            hasZtaScore={data.crowdstrikeConfigured && data.ztaScore != null}
            rangeLabel={windowLabel.startsWith('last') ? windowLabel : `last ${windowLabel}`}
            loading={data.loading}
          />
        </div>
        <TestingCadenceCard view={data.cadence} configured={data.analyticsConfigured} loading={data.loading} />
      </div>

      {/* ATT&CK outcomes + threat actors */}
      <div className="grid gap-4 lg:grid-cols-3 max-lg:[&>*]:min-w-0">
        <div className="lg:col-span-2 [&>*]:h-full">
          <AttackOutcomeMatrix
            view={data.attackMatrix}
            configured={data.analyticsConfigured}
            rangeLabel={windowLabel}
            loading={data.loading}
          />
        </div>
        <ThreatActorReadinessCard
          view={data.actorReadiness}
          configured={data.analyticsConfigured}
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
        <FleetHealthCard
          stats={fleetStats}
          rows={fleetRows}
          staleAgents={data.fleetHealth?.stale_agent_count}
          outdatedAgents={data.metrics ? data.outdatedAgents : undefined}
          totalAgents={data.metrics?.total}
          loading={data.loading}
        />
        <RecentExecutionsCard
          executions={data.recentExecutions}
          configured
          loading={data.loading}
        />
      </div>
    </div>
  );
}
