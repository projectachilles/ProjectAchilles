import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsRiskPage from '../AnalyticsRiskPage';

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

const fixture = {
  active: [{
    acceptance_id: 'ra-1',
    test_name: 'Print Spooler Service',
    control_id: 'WPS.001',
    hostname: 'LAP-01',
    scope: 'host' as const,
    justification: 'Required for shared printers in HQ.',
    accepted_by: 'jim',
    accepted_by_name: 'Jim Hartmann',
    accepted_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    status: 'active' as const,
  }],
  revoked: [{
    acceptance_id: 'ra-2',
    test_name: 'Block executable email',
    control_id: 'XBL.001',
    hostname: 'LAP-02',
    scope: 'host' as const,
    justification: 'Resolved — block now enforced.',
    accepted_by: 'sarah',
    accepted_by_name: 'Sarah Chen',
    accepted_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
    status: 'revoked' as const,
    revoked_at: new Date(Date.now() - 1 * 86400_000).toISOString(),
    revoked_by_name: 'Sarah Chen',
    revocation_reason: 'Policy update completed.',
  }],
};

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    listAcceptances: vi.fn(({ status }: { status?: 'active' | 'revoked' } = {}) => {
      if (status === 'active') return Promise.resolve({ data: fixture.active, total: 1 });
      if (status === 'revoked') return Promise.resolve({ data: fixture.revoked, total: 1 });
      return Promise.resolve({ data: [...fixture.active, ...fixture.revoked], total: 2 });
    }),
    revokeRisk: vi.fn().mockResolvedValue({}),
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

describe('AnalyticsRiskPage', () => {
  it('renders the active filter pill counts and the active acceptance row', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/risk']}>
        <AnalyticsRiskPage />
      </MemoryRouter>
    );

    // Filter pills are buttons
    const activePill = await screen.findByRole('button', { name: /ACTIVE.*1/i });
    expect(activePill).toBeInTheDocument();
    const revokedPill = await screen.findByRole('button', { name: /REVOKED.*1/i });
    expect(revokedPill).toBeInTheDocument();

    // Row data from fixture
    await waitFor(() => {
      expect(screen.getByText('Print Spooler Service')).toBeInTheDocument();
      expect(screen.getByText('WPS.001')).toBeInTheDocument();
      expect(screen.getByText('Jim Hartmann')).toBeInTheDocument();
    });
  });
});
