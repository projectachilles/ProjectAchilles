import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardData } from '../useDashboardData';
import { FULL } from './scoreMovementFixture';

const getScoreMovement = vi.fn();
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getScoreMovement: (...a: unknown[]) => getScoreMovement(...a) } }));

const caps = { scoreMovement: false };
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));

const dashboard: Partial<DashboardData> = { loading: false, analyticsConfigured: true, attentionItems: [], trend: [] };
vi.mock('../useDashboardData', () => ({ useDashboardData: () => dashboard }));

// The page's other cards are not under test here.
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }));
vi.mock('../components/AttentionBanner', () => ({ AttentionBanner: () => null }));
vi.mock('../components/AttackOutcomeMatrix', () => ({ AttackOutcomeMatrix: () => null }));
vi.mock('../components/FleetHealthCard', () => ({ FleetHealthCard: () => null }));
vi.mock('../components/KpiCard', () => ({ KpiCard: () => null }));
vi.mock('../components/KpiGrid', () => ({ KpiGrid: () => null }));
vi.mock('../components/RecentExecutionsCard', () => ({ RecentExecutionsCard: () => null }));
vi.mock('../components/TestingCadenceCard', () => ({ TestingCadenceCard: () => null }));
vi.mock('../components/ThreatActorReadinessCard', () => ({ ThreatActorReadinessCard: () => null }));
vi.mock('../components/TopControlsCard', () => ({ TopControlsCard: () => null }));
vi.mock('../components/TrendOverviewChart', () => ({ TrendOverviewChart: () => null }));

const { default: DashboardPage } = await import('../DashboardPage');

const renderPage = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );

describe('DashboardPage: What moved the score row', () => {
  beforeEach(() => {
    getScoreMovement.mockReset();
    getScoreMovement.mockResolvedValue(FULL);
    caps.scoreMovement = false;
    dashboard.analyticsConfigured = true;
  });

  it('is absent and makes no request when the capability is off', () => {
    renderPage();
    expect(screen.queryByText(/What moved the score/)).toBeNull();
    expect(getScoreMovement).not.toHaveBeenCalled();
  });

  it('is absent and makes no request when Analytics is not configured', () => {
    caps.scoreMovement = true;
    dashboard.analyticsConfigured = false;
    renderPage();
    expect(screen.queryByText(/What moved the score/)).toBeNull();
    expect(getScoreMovement).not.toHaveBeenCalled();
  });

  it('is requested and shown when the capability is on and Analytics is configured', async () => {
    caps.scoreMovement = true;
    renderPage();
    expect(await screen.findByText(/What moved the score/)).toBeInTheDocument();
    expect(getScoreMovement).toHaveBeenCalledTimes(1);
  });
});
