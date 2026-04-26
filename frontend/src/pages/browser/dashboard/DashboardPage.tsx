import { useNavigate } from 'react-router-dom';
import {
  BranchPill,
  QuickActions,
  I,
  type QuickAction,
} from '@/components/layout/AchillesShell';
import { KpiCard } from './cards/KpiCard';
import { MitreMatrix } from './cards/MitreMatrix';
import { TopRated } from './cards/TopRated';
import { SeverityCard } from './cards/SeverityCard';
import { CategoryDonut } from './cards/CategoryDonut';
import { RecentlyModified } from './cards/RecentlyModified';
import { RunQueue } from './cards/RunQueue';
import { useDashboardData } from './useDashboardData';
import './dashboard.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const data = useDashboardData();

  const actions: QuickAction[] = [
    { icon: I.bolt, label: 'Run all critical', tone: 'primary', onClick: () => navigate('/browser?sev=critical') },
    { icon: I.play, label: 'Run new tests', onClick: () => navigate('/browser?recent=true') },
    { icon: I.target, label: 'Plan campaign', onClick: () => navigate('/endpoints/tasks') },
    { icon: I.download, label: 'Export report', onClick: () => navigate('/analytics/dashboard') },
    { icon: I.filter, label: 'Filters', onClick: () => navigate('/browser') },
  ];

  return (
    <main className="v1-content">
      <BranchPill onAfterSync={data.refresh} />
      <QuickActions actions={actions} />

      {data.error && (
        <div
          className="dash-card"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          Failed to load dashboard data: {data.error}
        </div>
      )}

      {/* KPI strip — semantics match TestLibraryOverview so the dashboard
          and the legacy Browser page report the same headline numbers. */}
      <div className="v1-grid v1-row-kpis">
        <KpiCard
          icon={I.flask}
          label="Total Tests"
          value={data.totalTests}
          foot={
            data.totalTests === 0
              ? 'no tests synced'
              : data.critHighCount > 0
                ? `${data.critHighCount} critical/high severity`
                : 'across catalog'
          }
        />
        <KpiCard
          icon={I.target}
          label="MITRE Techniques"
          value={data.techniqueCount}
          foot={`across ${data.tacticCount} tactics`}
        />
        <KpiCard
          icon={I.grid}
          label="Categories"
          value={data.categoryCount}
          foot={data.categories.map((c) => c.name).join(' · ') || 'none'}
        />
        <KpiCard
          icon={I.star}
          label="Avg Score"
          value={data.avgScore > 0 ? data.avgScore.toFixed(3) : '—'}
          foot={`across ${data.testsScored} scored tests`}
        />
      </div>

      {/* Main row: MITRE matrix + right column (Top Rated + Severity / Category) */}
      <div className="v1-grid v1-row-main">
        <div className="v1-cell-mitre">
          <MitreMatrix tactics={data.tactics} />
        </div>
        <div className="v1-cell-side v1-col-stack">
          <TopRated items={data.topRated} />
          <SeverityCard severity={data.severity} />
          <CategoryDonut categories={data.categories} />
        </div>
      </div>

      {/* Tests row: Recently Modified + Run Queue */}
      <div className="v1-grid v1-row-tests">
        <div className="v1-cell-mitre">
          <RecentlyModified items={data.recentlyModified} />
        </div>
        <div className="v1-cell-side">
          <RunQueue items={data.runQueue} />
        </div>
      </div>
    </main>
  );
}
