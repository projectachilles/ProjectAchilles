import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalyticsExecutionsPage from '../AnalyticsExecutionsPage';

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
    getGroupedPaginatedExecutions: vi.fn().mockResolvedValue({
      groups: [],
      pagination: {
        page: 1, pageSize: 25, totalGroups: 12, totalDocuments: 384,
        totalPages: 1, hasNext: false, hasPrevious: false,
      },
    }),
    listAcceptances: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    lookupAcceptances: vi.fn().mockResolvedValue({}),
    archiveExecutions: vi.fn(),
    archiveExecutionsByDate: vi.fn(),
    acceptRisk: vi.fn(),
    revokeRisk: vi.fn(),
  },
}));

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/api/defender', () => ({
  defenderApi: {
    getControls: vi.fn().mockResolvedValue([]),
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

describe('AnalyticsExecutionsPage', () => {
  it('renders the toolbar with bundle/exec totals and density toggle', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/executions']}>
        <AnalyticsExecutionsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('All Executions')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /comfort/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /compact/i })).toBeInTheDocument();

    await waitFor(() => {
      // toolbar reports total bundles/executions from the mocked API
      expect(screen.getByText(/bundles/)).toBeInTheDocument();
      expect(screen.getAllByText('384').length).toBeGreaterThan(0);
      expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    });
  });

  it('persists the density choice to localStorage when changed', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/analytics/executions']}>
        <AnalyticsExecutionsPage />
      </MemoryRouter>
    );

    const compactBtn = screen.getByRole('tab', { name: /compact/i });
    compactBtn.click();

    await waitFor(() => {
      expect(localStorage.getItem('analytics.executions.density')).toBe('compact');
    });

    expect(container.querySelector('.an-exec-density-compact')).toBeTruthy();
  });
});
