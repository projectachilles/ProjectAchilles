import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import type { TestMetadata } from '@/types/test';

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn(),
    getSyncStatus: vi.fn().mockResolvedValue({
      lastSyncTime: new Date(Date.now() - 6 * 60_000).toISOString(),
      commitHash: 'abc1234',
      branch: 'main',
      status: 'synced',
      testCount: 2,
    }),
    syncTests: vi.fn(),
  },
}));
vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listAgents: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
  },
}));

import { browserApi } from '@/services/api/browser';

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

const fixtureTests: TestMetadata[] = [
  {
    uuid: 't-1',
    name: 'MDE Process Injection',
    category: 'cyber-hygiene',
    severity: 'critical',
    techniques: ['T1055', 'T1059'],
    isMultiStage: false,
    stages: [],
    score: 9.7,
    lastModifiedDate: new Date().toISOString(),
  },
  {
    uuid: 't-2',
    name: 'Volt Typhoon LotL',
    category: 'intel-driven',
    severity: 'high',
    techniques: ['T1059', 'T1083'],
    isMultiStage: false,
    stages: [],
    score: 8.2,
    lastModifiedDate: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

describe('DashboardPage', () => {
  it('renders KPI labels and aggregates totals from the test catalog', async () => {
    vi.mocked(browserApi.getAllTests).mockResolvedValueOnce(fixtureTests);

    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Total Tests')).toBeInTheDocument();
    expect(screen.getByText('MITRE Techniques')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Avg Score')).toBeInTheDocument();

    await waitFor(() => {
      const kpiValues = container.querySelectorAll('.v1-kpi-value');
      // KPIs render in order: Total Tests · MITRE Techniques · Categories · Avg Score
      expect(kpiValues[0]).toHaveTextContent('2'); // 2 fixture tests
      expect(kpiValues[1]).toHaveTextContent('3'); // T1055, T1059, T1083 — 3 unique techniques
      expect(kpiValues[2]).toHaveTextContent('2'); // cyber-hygiene, intel-driven
    });
  });

  it('renders the MITRE matrix and known card titles', async () => {
    vi.mocked(browserApi.getAllTests).mockResolvedValueOnce(fixtureTests);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/MITRE ATT&CK · COVERAGE/)).toBeInTheDocument();
    expect(screen.getByText('Top Rated')).toBeInTheDocument();
    expect(screen.getByText('Severity Distribution')).toBeInTheDocument();
    expect(screen.getByText('Category Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Recently Modified')).toBeInTheDocument();
    expect(screen.getByText('Run Queue')).toBeInTheDocument();
  });

  it('shows the top-rated test with its score', async () => {
    vi.mocked(browserApi.getAllTests).mockResolvedValueOnce(fixtureTests);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    );

    // The fixture's #1 test renders in both Top Rated and Recently Modified.
    await waitFor(() => {
      expect(screen.getAllByText('MDE Process Injection').length).toBeGreaterThan(0);
      expect(screen.getByText('9.7')).toBeInTheDocument();
    });
  });

  it('handles empty catalog gracefully', async () => {
    vi.mocked(browserApi.getAllTests).mockResolvedValueOnce([]);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No scored tests yet')).toBeInTheDocument();
    });
    expect(screen.getByText('Queue empty')).toBeInTheDocument();
  });
});
