import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DateRangeValue } from '@/lib/timeRange';

const s1 = {
  getAlertSummary: vi.fn(),
  getAlertTrend: vi.fn(),
  getTechniqueCoverage: vi.fn(),
  getAlerts: vi.fn(),
  getAgentHealth: vi.fn(),
  getPosturePolicies: vi.fn(),
  getExclusionGaps: vi.fn(),
};
const mockGetSyncStatus = vi.fn();
const mockTriggerSync = vi.fn();
const mockWaitForSync = vi.fn();
const csSpy = vi.fn();

vi.mock('@/services/api/sentineloneAnalytics', () => ({
  sentineloneAnalyticsApi: {
    getAlertSummary: (...a: unknown[]) => s1.getAlertSummary(...a),
    getAlertTrend: (...a: unknown[]) => s1.getAlertTrend(...a),
    getTechniqueCoverage: (...a: unknown[]) => s1.getTechniqueCoverage(...a),
    getAlerts: (...a: unknown[]) => s1.getAlerts(...a),
    getAgentHealth: (...a: unknown[]) => s1.getAgentHealth(...a),
    getPosturePolicies: (...a: unknown[]) => s1.getPosturePolicies(...a),
    getExclusionGaps: (...a: unknown[]) => s1.getExclusionGaps(...a),
  },
}));
vi.mock('@/services/api/sentinelone', () => ({
  sentinelOneApi: {
    getSyncStatus: () => mockGetSyncStatus(),
    triggerSync: () => mockTriggerSync(),
    waitForSync: (...a: unknown[]) => mockWaitForSync(...a),
  },
}));
// The S1 tab must never hit the CrowdStrike endpoints.
vi.mock('@/services/api/crowdstrike', () => ({
  crowdstrikeApi: new Proxy({}, { get: (_t, p) => (...a: unknown[]) => csSpy(p, ...a) }),
}));
vi.mock('@/services/api/defender', () => ({ defenderApi: {} }));
vi.mock('@/services/api/integrations', () => ({ integrationsApi: {} }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getDefenseScoreTrend: vi.fn().mockResolvedValue([]) } }));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const { default: SentinelOneTab } = await import('../SentinelOneTab');

const RANGE: DateRangeValue = { preset: 'custom', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };
const WINDOW = { from: RANGE.from, to: RANGE.to };
const counts = {
  bySource: { all: 9, test: 0, organic: 9 },
  bySeverity: { high: 9 },
  autoResolved: 0,
  linkedOpen: 0,
  byPrevention: { prevented: 6, detected_only: 3, kill_failed: 0 },
};

function renderTab() {
  return render(
    <MemoryRouter>
      <SentinelOneTab dateRange={RANGE} />
    </MemoryRouter>,
  );
}

describe('SentinelOneTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    s1.getAlertSummary.mockResolvedValue({ total: 9, bySeverity: { high: 9 }, byStatus: {}, recentHigh: [], recentMedium: [], counts });
    s1.getAlertTrend.mockResolvedValue([]);
    s1.getTechniqueCoverage.mockResolvedValue(null);
    s1.getAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10, counts });
    mockGetSyncStatus.mockResolvedValue({ lastThreatSync: '2026-10-11T03:00:00.000Z', lastAlertSync: null, lastError: null });
    mockTriggerSync.mockResolvedValue({ started: true, inProgress: true });
    mockWaitForSync.mockResolvedValue({ inProgress: false });
    s1.getAgentHealth.mockResolvedValue({
      latest: { timestamp: '2026-10-22T00:00:00.000Z', counts: { total: 12, active: 11, infected: 1, outdated: 4, detect_only: 2, disconnected: 0 } },
      trend: [],
    });
    s1.getPosturePolicies.mockResolvedValue([
      { level: 'site', scope_id: '22', scope_name: 'Prod site', mitigation_mode: 'detect', mitigation_mode_suspicious: 'detect', anti_tampering_on: false, snapshots_on: true, engines_on: ['reputation'], engines_off: ['preExecution'] },
      { level: 'account', scope_id: '11', policy_error: 'HTTP 403', engines_on: [], engines_off: [] },
      { level: 'group', scope_id: '33', scope_name: 'Default Group', site_name: 'Prod site', inherits: true, engines_on: [], engines_off: [] },
    ]);
    s1.getExclusionGaps.mockResolvedValue({
      exclusionsTotal: 3, byType: { path: 2, white_hash: 1 }, unmatchable: 1, s1Agents: 12, missedOnS1Hosts: 1, missedOnOtherHosts: 0,
      flagged: [{ test_uuid: 'aaa', test_name: 'LSASS dump', hostname: 'WIN-01', os: 'windows', last_seen: null,
        exclusions: [{ exclusion_id: '1', value: 'C:\\F0\\', path_exclusion_type: 'subfolders', exclusion_mode: 'suppress', scope_name: 'Prod site' }] }],
    });
  });

  it('shows agent health counts, the policy table (no score) and exclusion-covered misses', async () => {
    renderTab();
    expect(await screen.findByText('Agent health')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Agent health counts')).toBeInTheDocument());
    expect(screen.getByText('Detect-only')).toBeInTheDocument();
    expect(await screen.findByText('Prod site', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Inherits the site policy')).toBeInTheDocument();
    expect(screen.getByText('Not readable with this token (HTTP 403)')).toBeInTheDocument();
    expect(screen.getByText('preExecution')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'LSASS dump' })).toHaveAttribute('href', '/analytics?tab=executions&tests=LSASS%20dump');
    expect(screen.getByText('C:\\F0\\')).toBeInTheDocument();
    expect(s1.getExclusionGaps).toHaveBeenCalledWith(WINDOW);
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it('loads summary, trend and coverage from the SentinelOne API with the page window', async () => {
    renderTab();
    expect(screen.getByText('SentinelOne Singularity')).toBeInTheDocument();
    await waitFor(() => expect(s1.getTechniqueCoverage).toHaveBeenCalledWith(WINDOW));
    expect(s1.getAlertSummary).toHaveBeenCalledWith(WINDOW);
    expect(s1.getAlertTrend).toHaveBeenCalledWith(expect.any(Number), WINDOW);
    expect(csSpy).not.toHaveBeenCalled();
  });

  it('shows the agent-response split from real alert facets instead of a posture score', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Agent response')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/3 detected only/)).toBeInTheDocument());
    expect(screen.queryByText(/ZTA/i)).toBeNull();
  });

  it('explains when SentinelOne refused the agent reads', async () => {
    s1.getAgentHealth.mockResolvedValue({
      latest: { timestamp: '2026-10-22T00:00:00.000Z', counts_error: 'HTTP 403', counts: { total: null, active: null, infected: null, outdated: null, detect_only: null, disconnected: null } },
      trend: [],
    });
    renderTab();
    expect(await screen.findByText(/SentinelOne refused the agent reads \(HTTP 403\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent health counts')).toBeNull();
  });

  it('Sync now starts a background sync and reloads the cards only once it has finished', async () => {
    renderTab();
    await waitFor(() => expect(s1.getAlertSummary).toHaveBeenCalled());
    const loadsBefore = s1.getAlertSummary.mock.calls.length;
    let finish: (v: unknown) => void = () => {};
    mockWaitForSync.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    await userEvent.click(await screen.findByRole('button', { name: /sync/i }));
    await waitFor(() => expect(mockTriggerSync).toHaveBeenCalledTimes(1));
    expect(s1.getAlertSummary.mock.calls.length).toBe(loadsBefore);
    finish({ inProgress: false });
    await waitFor(() => expect(s1.getAlertSummary.mock.calls.length).toBeGreaterThan(loadsBefore));
  });
});
