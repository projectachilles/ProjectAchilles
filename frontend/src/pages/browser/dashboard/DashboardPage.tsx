import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BranchPill,
  QuickActions,
  I,
  type QuickAction,
} from '@/components/layout/AchillesShell';
import { browserApi } from '@/services/api/browser';
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
  const [syncing, setSyncing] = useState(false);
  const data = useDashboardData();

  const handleSync = async () => {
    setSyncing(true);
    try {
      await browserApi.syncTests();
    } finally {
      setSyncing(false);
    }
  };

  const actions: QuickAction[] = [
    { icon: I.bolt, label: 'Run all critical', tone: 'primary', onClick: () => navigate('/browser?sev=critical') },
    { icon: I.play, label: 'Run new tests', onClick: () => navigate('/browser?recent=true') },
    { icon: I.target, label: 'Plan campaign', onClick: () => navigate('/endpoints/tasks') },
    { icon: I.download, label: 'Export report', onClick: () => navigate('/analytics/dashboard') },
    { icon: I.filter, label: 'Filters', onClick: () => navigate('/browser') },
  ];

  return (
    <main className="v1-content">
      <BranchPill onSync={handleSync} syncing={syncing} />
      <QuickActions actions={actions} />

      {data.error && (
        <div
          className="dash-card"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          Failed to load dashboard data: {data.error}
        </div>
      )}

      {/* KPI strip */}
      <div className="v1-grid v1-row-kpis">
        <KpiCard
          icon={I.flask}
          label="Total Tests"
          value={data.totalTests}
          trend={data.totalTests > 0 ? '↑' : '—'}
          foot={data.totalTests === 0 ? 'no tests synced' : 'across catalog'}
          sparkData={data.trends.tests}
        />
        <KpiCard
          icon={I.target}
          label="MITRE Techniques"
          value={data.techniqueCount}
          trend={data.techniqueCount > 0 ? '↑' : '—'}
          foot={`across ${data.tacticCount} tactics`}
          sparkData={data.trends.techniques}
        />
        <KpiCard
          icon={I.grid}
          label="Categories"
          value={data.categoryCount}
          trend="—"
          foot={data.categories.map((c) => c.name).join(' · ') || 'none'}
          sparkData={data.trends.categories}
          sparkColor="var(--cyan)"
        />
        <KpiCard
          icon={I.star}
          label="Avg Score"
          value={data.avgScore.toFixed(2)}
          trend={data.avgScore > 0 ? '↑' : '—'}
          foot={`${data.testsScored} scored`}
          sparkData={data.trends.score}
          sparkColor="var(--accent-bright)"
        />
      </div>

      {/* Main row: MITRE matrix + right column (Top Rated + Severity / Category) */}
      <div className="v1-grid v1-row-main">
        <div className="v1-cell-mitre">
          <MitreMatrix tactics={data.tactics} />
        </div>
        <div className="v1-cell-side v1-col-stretch">
          <TopRated items={data.topRated} />
          <div className="v1-grid2 v1-grid2-stretch">
            <SeverityCard severity={data.severity} />
            <CategoryDonut categories={data.categories} />
          </div>
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
