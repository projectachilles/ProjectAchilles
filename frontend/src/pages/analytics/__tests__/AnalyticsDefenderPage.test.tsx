import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsDefenderPage from '../AnalyticsDefenderPage';

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({ configured: true, loading: false, settingsVersion: 0 }),
}));
vi.mock('@/hooks/useDefenderConfig', () => ({
  useDefenderConfig: () => ({ configured: true, loading: false }),
}));
vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'admin',
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    listAcceptances: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  },
}));

vi.mock('@/services/api/defender', () => ({
  defenderApi: {
    getSecureScore: vi.fn().mockResolvedValue({
      currentScore: 1066.9,
      maxScore: 1226,
      percentage: 87,
      averageComparative: 71.4,
    }),
    getSecureScoreTrend: vi.fn().mockResolvedValue([
      { date: '2026-04-20', score: 1050, maxScore: 1226, percentage: 85.6 },
      { date: '2026-04-25', score: 1066.9, maxScore: 1226, percentage: 87 },
    ]),
    getControls: vi.fn().mockResolvedValue([
      {
        control_name: 'mfa-admin',
        control_category: 'Identity',
        title: 'Ensure multifactor authentication is enabled for admins',
        implementation_cost: 'low', user_impact: 'low', rank: 1,
        threats: [], deprecated: false, remediation_summary: '', action_url: '',
        max_score: 10, tier: 'free',
      },
    ]),
    getDetectionRate: vi.fn().mockResolvedValue({
      overall: { testedTechniques: 9, detectedTechniques: 1, detectionRate: 11.1 },
      byTechnique: [
        { technique: 'T1562.001', testExecutions: 4, correlatedAlerts: 1, detected: true },
        { technique: 'T1071.001', testExecutions: 16, correlatedAlerts: 0, detected: false },
      ],
    }),
    getTechniqueOverlap: vi.fn().mockResolvedValue([
      { technique: 'T1562.001', testResults: 4, defenderAlerts: 1 },
      { technique: 'T1071.001', testResults: 16, defenderAlerts: 0 },
    ]),
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
  // Stub fetch for sync status / sync trigger
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

describe('AnalyticsDefenderPage', () => {
  it('renders the Defender header, Secure Score hero, and the technique overlap grid', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/defender']}>
        <AnalyticsDefenderPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Microsoft Defender')).toBeInTheDocument();
    expect(screen.getByText(/sync now/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('87.0%')).toBeInTheDocument();
      expect(screen.getByText(/Top Remediation Controls/i)).toBeInTheDocument();
    });

    // Detection analysis card + at least one technique row
    expect(screen.getByText(/Detection Analysis/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText(/T1562\.001/).length).toBeGreaterThan(0);
    });

    // Technique overlap card
    expect(screen.getByText(/Technique Overlap/)).toBeInTheDocument();
  });
});
