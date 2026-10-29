import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DateRangeValue } from '@/lib/timeRange';

const sx = {
  getAlertSummary: vi.fn(),
  getAlertTrend: vi.fn(),
  getTechniqueCoverage: vi.fn(),
  getAlerts: vi.fn(),
  getHealthCheck: vi.fn(),
  getEndpointHealth: vi.fn(),
  getPolicies: vi.fn(),
  getExclusionGaps: vi.fn(),
};
const mockGetSyncStatus = vi.fn();
const mockGetSettings = vi.fn();
const mockGetAutoResolveStatus = vi.fn();

vi.mock('@/services/api/sophosAnalytics', () => ({
  sophosAnalyticsApi: {
    getAlertSummary: (...a: unknown[]) => sx.getAlertSummary(...a),
    getAlertTrend: (...a: unknown[]) => sx.getAlertTrend(...a),
    getTechniqueCoverage: (...a: unknown[]) => sx.getTechniqueCoverage(...a),
    getAlerts: (...a: unknown[]) => sx.getAlerts(...a),
    getHealthCheck: (...a: unknown[]) => sx.getHealthCheck(...a),
    getEndpointHealth: (...a: unknown[]) => sx.getEndpointHealth(...a),
    getPolicies: (...a: unknown[]) => sx.getPolicies(...a),
    getExclusionGaps: (...a: unknown[]) => sx.getExclusionGaps(...a),
  },
}));
vi.mock('@/services/api/sophos', () => ({
  sophosApi: {
    getSyncStatus: () => mockGetSyncStatus(),
    getSettings: () => mockGetSettings(),
    triggerSync: vi.fn().mockResolvedValue({ started: true, inProgress: true }),
    waitForSync: vi.fn().mockResolvedValue({ inProgress: false }),
    getAutoResolveStatus: () => mockGetAutoResolveStatus(),
    getAutoResolveReceipts: () => Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 }),
  },
}));
vi.mock('@/services/api/crowdstrike', () => ({ crowdstrikeApi: {} }));
vi.mock('@/services/api/sentineloneAnalytics', () => ({ sentineloneAnalyticsApi: {} }));
vi.mock('@/services/api/sentinelone', () => ({ sentinelOneApi: {} }));
vi.mock('@/services/api/defender', () => ({ defenderApi: {} }));
vi.mock('@/services/api/integrations', () => ({ integrationsApi: {} }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getDefenseScoreTrend: vi.fn().mockResolvedValue([]) } }));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const { default: SophosTab } = await import('../SophosTab');

const RANGE: DateRangeValue = { preset: 'custom', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };
const counts = {
  bySource: { all: 9, test: 0, organic: 9 },
  bySeverity: { high: 9 },
  autoResolved: 0,
  linkedOpen: 0,
  byPrevention: { prevented: 6, detected_only: 3, kill_failed: 1 },
};
const AVAILABLE = { siem: 'available', alerts: 'available', xdr_graphql: 'available', xdr_rest: 'available', health_check: 'available' };

function renderTab() {
  return render(
    <MemoryRouter>
      <SophosTab dateRange={RANGE} />
    </MemoryRouter>,
  );
}

describe('SophosTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sx.getAlertSummary.mockResolvedValue({ total: 9, bySeverity: { high: 9 }, byStatus: {}, recentHigh: [], recentMedium: [], counts });
    sx.getAlertTrend.mockResolvedValue([]);
    sx.getTechniqueCoverage.mockResolvedValue(null);
    sx.getAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10, counts });
    sx.getHealthCheck.mockResolvedValue({
      latest: {
        headline: 77,
        categories: [
          { category: 'protection', score: 96, computer: 98, server: 94 },
          { category: 'policy', score: 70, computer: 80, server: 60 },
          { category: 'exclusions', score: 40, global: 40 },
          { category: 'tamper_protection', score: 100, global: 100 },
        ],
        items: {
          notFullyProtected: ['3 of 212 computers'],
          notOnRecommended: [{ policy: 'Servers - Base', settings: ['AMSI off'] }],
          riskyExclusions: [],
          tamperDisabled: [],
        },
      },
      trend: [{ date: '2026-09-01', score: 70 }, { date: '2026-09-30', score: 77 }],
    });
    sx.getEndpointHealth.mockResolvedValue({ total: 212, notSeen7d: 4, outOfDate: 2, tamperOff: 0, isolated: 1, healthBad: 0, healthSuspicious: 0, xdrInstalled: 212 });
    sx.getPolicies.mockResolvedValue([]);
    sx.getExclusionGaps.mockResolvedValue({
      critical: [{ kind: 'folder_exclusion', value: 'C:\\F0', detail: 'Scanning exclusion on the Achilles work folder' }],
      gaps: [{ testUuid: 'aaa', hostname: 'WIN-01', path: 'C:\\F0\\x.exe', exclusion: 'C:\\F0', lastRunAt: '2026-09-20T00:00:00.000Z' }],
      notes: [],
    });
    mockGetSettings.mockResolvedValue({ configured: true, data_region: 'eu01', capabilities: AVAILABLE, sync_gap: null });
    mockGetSyncStatus.mockResolvedValue({ lastSiemSync: '2026-10-11T03:00:00.000Z', lastAlertSync: null, lastDetectionSync: null, inProgress: false, lastError: null, syncGap: null });
    mockGetAutoResolveStatus.mockResolvedValue({ mode: 'dry_run', permission_mode: 'response', counts: { last24h: 0, last7d: 0, last30d: 3 }, lastAutoResolve: null });
  });

  it('shows the Health Check headline with the Achilles-average subtitle and category bars', async () => {
    renderTab();
    expect(await screen.findByText('Achilles average of Sophos Health Check scores')).toBeInTheDocument();
    expect(screen.getByText('Sophos Health Check')).toBeInTheDocument();
    expect(screen.getByText('77')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Protection score' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Tamper score' })).toBeInTheDocument();
  });

  it('shows the empty state when there is no Health Check yet', async () => {
    sx.getHealthCheck.mockResolvedValue({ latest: { headline: null, categories: [], items: { notFullyProtected: [], notOnRecommended: [], riskyExclusions: [], tamperDisabled: [] } }, trend: [] });
    renderTab();
    expect((await screen.findAllByText('No Health Check yet: it appears after the next posture sync (every 6 hours)')).length).toBeGreaterThan(0);
  });

  it('lists critical exclusion gaps before the missed-test gaps', async () => {
    renderTab();
    const critical = await screen.findByText('C:\\F0', { selector: '[data-testid="critical-gap-value"]' });
    const gap = await screen.findByText('WIN-01');
    expect(critical.compareDocumentPosition(gap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the XDR copy when neither XDR capability is available', async () => {
    mockGetSettings.mockResolvedValue({ configured: true, capabilities: { ...AVAILABLE, xdr_graphql: 'not_licensed', xdr_rest: 'not_licensed' } });
    renderTab();
    const matches = await screen.findAllByText(/ATT&CK techniques come from Sophos XDR detections/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('hides the XDR copy when XDR is available', async () => {
    renderTab();
    await screen.findByText('Achilles average of Sophos Health Check scores');
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    expect(screen.queryByText(/ATT&CK techniques come from Sophos XDR detections/)).not.toBeInTheDocument();
  });

  it('shows the sync gap alert', async () => {
    mockGetSyncStatus.mockResolvedValue({ lastSiemSync: null, lastAlertSync: null, lastDetectionSync: null, inProgress: false, syncGap: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z' } });
    renderTab();
    expect(await screen.findByText(/were not collected \(Sophos keeps 24 hours\)/)).toBeInTheDocument();
  });

  it('shows the Sophos response split', async () => {
    renderTab();
    expect((await screen.findAllByText('Sophos response')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/3 detected only/)).toBeInTheDocument();
    expect(screen.getByText(/1 cleanup failed/)).toBeInTheDocument();
  });
});
