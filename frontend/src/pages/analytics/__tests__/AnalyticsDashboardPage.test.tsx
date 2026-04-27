import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsDashboardPage from '../AnalyticsDashboardPage';

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({ configured: true, loading: false, settingsVersion: 0 }),
}));
vi.mock('@/hooks/useDefenderConfig', () => ({
  useDefenderConfig: () => ({ configured: false, loading: false }),
}));
vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'admin',
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getDefenseScore: vi.fn().mockResolvedValue({
      score: 72.4,
      protectedCount: 145,
      unprotectedCount: 55,
      totalExecutions: 200,
      realScore: 70.1,
      riskAcceptedCount: 3,
    }),
    getUniqueHostnames: vi.fn().mockResolvedValue(8),
    getUniqueTests: vi.fn().mockResolvedValue(122),
    getDefenseScoreTrend: vi.fn().mockResolvedValue([
      { timestamp: '2026-04-20', score: 70, total: 100, protected: 70 },
      { timestamp: '2026-04-21', score: 72, total: 100, protected: 72 },
    ]),
    getResultsByErrorType: vi.fn().mockResolvedValue([
      { name: 'protected', code: 105, count: 145 },
      { name: 'unprotected', code: 101, count: 55 },
    ]),
    getTechniqueDistribution: vi.fn().mockResolvedValue([
      { technique: 'T1110', protected: 18, unprotected: 4 },
      { technique: 'T1059', protected: 22, unprotected: 8 },
    ]),
    getHostTestMatrix: vi.fn().mockResolvedValue([
      { hostname: 'LAP-01', testName: 'PUA Protection', count: 4 },
      { hostname: 'LAP-02', testName: 'Behavior Monitoring', count: 2 },
    ]),
    getDefenseScoreByCategorySubcategory: vi.fn().mockResolvedValue([
      {
        category: 'cyber-hygiene',
        score: 52.9,
        count: 80,
        protected: 42,
        unprotected: 38,
        subcategories: [
          { subcategory: 'cis-windows-l1', score: 50.7, count: 30, protected: 15, unprotected: 15 },
          { subcategory: 'baseline', score: 45.6, count: 50, protected: 27, unprotected: 23 },
        ],
      },
    ]),
    getPaginatedExecutions: vi.fn().mockResolvedValue({
      data: [
        {
          test_uuid: 't-1',
          test_name: 'Behavior Monitoring',
          hostname: 'LAP-01',
          is_protected: true,
          org: 'org',
          timestamp: '2026-04-25T12:00:00Z',
          error_code: 105,
        },
      ],
      pagination: { page: 1, pageSize: 5, totalItems: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    }),
    getDefenseScoreByHostname: vi.fn().mockResolvedValue([
      { hostname: 'LAP-01', score: 80.0, protected: 16, unprotected: 4, total: 20 },
      { hostname: 'LAP-02', score: 50.0, protected: 5, unprotected: 5, total: 10 },
    ]),
    getErrorRate: vi.fn().mockResolvedValue({
      errorRate: 0.5, errorCount: 1, conclusiveCount: 199, totalTestActivity: 200,
    }),
    getErrorRateTrend: vi.fn().mockResolvedValue([
      { timestamp: '2026-04-20', errorRate: 0.5, errorCount: 1, conclusiveCount: 99, total: 100 },
    ]),
    listAcceptances: vi.fn().mockResolvedValue({ data: [], total: 2 }),
  },
}));

vi.mock('@/services/api/defender', () => ({
  defenderApi: {
    getSecureScore: vi.fn(),
    getSecureScoreTrend: vi.fn(),
  },
}));

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

describe('AnalyticsDashboardPage', () => {
  it('renders the sub-nav and core dashboard cards once data loads', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/dashboard']}>
        <AnalyticsDashboardPage />
      </MemoryRouter>
    );

    // Sub-nav tabs
    expect(screen.getByRole('navigation', { name: /analytics/i })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('All Executions')).toBeInTheDocument();
    expect(screen.getByText('Risk Acceptances')).toBeInTheDocument();

    // Dashboard chrome — "Defense Score" appears in hero + by-host card,
    // so use getAllByText to disambiguate.
    expect(screen.getAllByText('Defense Score').length).toBeGreaterThan(0);
    expect(screen.getByText('Trend Overview')).toBeInTheDocument();

    // Wait for data → Defense Score value
    await waitFor(() => {
      expect(screen.getByText('72.4%')).toBeInTheDocument();
    });

    // KPI value strip — endpoints + tests numbers (appear in multiple places)
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
    expect(screen.getAllByText('122').length).toBeGreaterThan(0);

    // Cards rendered
    expect(screen.getByText('Score by Category')).toBeInTheDocument();
    expect(screen.getByText(/ATT.{1,3}CK Technique Distribution/)).toBeInTheDocument();
    expect(screen.getByText('Defense Score by Host')).toBeInTheDocument();
  });

  it('hides the Defender sub-nav tab when Defender is not configured', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/dashboard']}>
        <AnalyticsDashboardPage />
      </MemoryRouter>
    );

    expect(screen.queryByText('Defender')).not.toBeInTheDocument();
  });
});
