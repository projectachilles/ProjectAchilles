import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DateRangeValue } from '@/lib/timeRange';

const df = {
  getSecureScore: vi.fn(),
  getSecureScoreTrend: vi.fn(),
  getAlertSummary: vi.fn(),
  getAlertTrend: vi.fn(),
  getTechniqueCoverage: vi.fn(),
  getAlerts: vi.fn(),
  getControls: vi.fn(),
  getControlCorrelation: vi.fn(),
};
const mockGetSyncStatus = vi.fn();
const mockTriggerSync = vi.fn();
const mockGetAutoResolveStatus = vi.fn();
const mockGetAutoResolveReceipts = vi.fn();
const mockGetDefenseScoreTrend = vi.fn();

vi.mock('@/services/api/defender', () => ({
  defenderApi: {
    getSecureScore: (...a: unknown[]) => df.getSecureScore(...a),
    getSecureScoreTrend: (...a: unknown[]) => df.getSecureScoreTrend(...a),
    getAlertSummary: (...a: unknown[]) => df.getAlertSummary(...a),
    getAlertTrend: (...a: unknown[]) => df.getAlertTrend(...a),
    getTechniqueCoverage: (...a: unknown[]) => df.getTechniqueCoverage(...a),
    getAlerts: (...a: unknown[]) => df.getAlerts(...a),
    getControls: (...a: unknown[]) => df.getControls(...a),
    getControlCorrelations: async (titles: string[], days?: number) =>
      Promise.all(titles.map(async (title) => ({ title, ...(await df.getControlCorrelation(title, days)) }))),
  },
}));

vi.mock('@/services/api/crowdstrike', () => ({ crowdstrikeApi: {} }));

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getDefenderSyncStatus: () => mockGetSyncStatus(),
    triggerDefenderSync: () => mockTriggerSync(),
    getAutoResolveStatus: () => mockGetAutoResolveStatus(),
    getAutoResolveReceipts: () => mockGetAutoResolveReceipts(),
  },
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getDefenseScoreTrend: (params: unknown) => mockGetDefenseScoreTrend(params),
  },
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const { default: DefenderTab } = await import('../DefenderTab');

const RANGE: DateRangeValue = {
  preset: 'custom',
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};
const WINDOW = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

const emptyCounts = {
  bySource: { all: 0, test: 0, organic: 0 },
  bySeverity: {},
  autoResolved: 0,
  linkedOpen: 0,
  byProduct: {},
};

const coverage = {
  overall: {
    executions: 40,
    prevented: 6,
    detectedOnly: 4,
    missed: 30,
    detectionRate: 25,
    preventionRate: 15,
    testedTechniques: 3,
    detectedTechniques: 2,
  },
  byTechnique: [
    { technique: 'T1059', name: 'Command and Scripting Interpreter', executions: 20, prevented: 6, detectedOnly: 2, missed: 12, alerts: 9 },
    { technique: 'T1003', name: 'OS Credential Dumping', executions: 10, prevented: 0, detectedOnly: 2, missed: 8, alerts: 2 },
    { technique: 'T1027', name: null, executions: 10, prevented: 0, detectedOnly: 0, missed: 10, alerts: 0 },
  ],
};

function mockHappyPath() {
  df.getSecureScore.mockResolvedValue({ currentScore: 50, maxScore: 100, percentage: 50, averageComparative: null });
  df.getSecureScoreTrend.mockResolvedValue([
    { date: '2026-09-01', percentage: 48 },
    { date: '2026-09-30', percentage: 50 },
  ]);
  df.getAlertSummary.mockResolvedValue({
    total: 42,
    bySeverity: { high: 12, medium: 8 },
    byStatus: { new: 20 },
    recentHigh: [],
    recentMedium: [],
    counts: {
      ...emptyCounts,
      bySource: { all: 20, test: 9, organic: 11 },
      bySeverity: { high: 12, medium: 8 },
      autoResolved: 3,
      linkedOpen: 2,
    },
  });
  df.getAlertTrend.mockResolvedValue([]);
  df.getTechniqueCoverage.mockResolvedValue(coverage);
  df.getAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10, counts: emptyCounts });
  df.getControls.mockResolvedValue([
    {
      control_name: 'BlockExe',
      title: 'Block executable content from email',
      control_category: 'Device',
      max_score: 9,
      current_score: 0,
      implementation_cost: 'Low',
      user_impact: 'Low',
      tier: 'Core',
      threats: [],
      remediation_summary: '',
      action_url: '',
      deprecated: false,
    },
  ]);
  df.getControlCorrelation.mockResolvedValue({ alertCount: 0, coveredTechniques: [] });
  mockGetDefenseScoreTrend.mockResolvedValue([]);
  mockGetSyncStatus.mockResolvedValue({
    lastScoreSync: '2026-10-11T03:00:00.000Z',
    lastControlSync: null,
    lastAlertSync: null,
    lastError: null,
  });
  mockGetAutoResolveStatus.mockResolvedValue({
    mode: 'enabled',
    counts: { last24h: 0, last7d: 1, last30d: 3 },
    lastAutoResolve: null,
  });
  mockGetAutoResolveReceipts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
}

function renderTab(range: DateRangeValue = RANGE) {
  return render(
    <MemoryRouter>
      <DefenderTab dateRange={range} />
    </MemoryRouter>,
  );
}

describe('DefenderTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHappyPath();
  });

  it('requests summary, trend and coverage with the window resolved from the dateRange prop', async () => {
    renderTab();
    await waitFor(() => expect(df.getTechniqueCoverage).toHaveBeenCalled());
    expect(df.getAlertSummary).toHaveBeenCalledWith(WINDOW);
    expect(df.getAlertTrend).toHaveBeenCalledWith(expect.any(Number), WINDOW);
    expect(df.getTechniqueCoverage).toHaveBeenCalledWith(WINDOW);
  });

  it('re-requests when the dateRange prop changes', async () => {
    const { rerender } = renderTab();
    await waitFor(() => expect(df.getTechniqueCoverage).toHaveBeenCalledWith(WINDOW));

    const next: DateRangeValue = {
      preset: 'custom',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    };
    rerender(
      <MemoryRouter>
        <DefenderTab dateRange={next} />
      </MemoryRouter>,
    );
    const nextWindow = { from: next.from, to: next.to };
    await waitFor(() => expect(df.getTechniqueCoverage).toHaveBeenCalledWith(nextWindow));
    expect(df.getAlertSummary).toHaveBeenCalledWith(nextWindow);
    expect(df.getAlertTrend).toHaveBeenCalledWith(expect.any(Number), nextWindow);
  });

  it('keeps the Secure Score tile', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Secure Score')).toBeInTheDocument());
    expect(screen.getByText('50 / 100 pts')).toBeInTheDocument();
  });

  it('alerts tile shows linked and organic counts', async () => {
    renderTab();
    const tile = await screen.findByRole('button', { name: /Defender Alerts/ });
    await waitFor(() => expect(within(tile).getByText('20')).toBeInTheDocument());
    expect(within(tile).getByText('9 linked to tests')).toBeInTheDocument();
    expect(within(tile).getByText(/11 organic/)).toBeInTheDocument();
    expect(within(tile).getByText('12 high · 8 medium')).toBeInTheDocument();
  });

  it('detection tile shows detection and prevention rates from coverage', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Detected / Prevented')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('25.0')).toBeInTheDocument());
    expect(screen.getByText('15.0')).toBeInTheDocument();
    expect(screen.getByText('% prevented')).toBeInTheDocument();
    expect(
      screen.getByText('10 / 40 executions raised an alert · 6 were stopped'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 of 3 techniques detected' })).toBeInTheDocument();
  });

  it('auto-resolve tile shows how many test alerts are still open', async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('2 of 9 test alerts still open')).toBeInTheDocument(),
    );
  });

  it('Defender tab renders Top Remediation Controls after Technique Coverage', async () => {
    renderTab();
    const controls = await screen.findByText('Top Remediation Controls');
    const coverageCard = screen.getByRole('region', { name: 'Technique coverage' });
    expect(
      coverageCard.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The old summary / detection-analysis / overlap cards are gone
    expect(screen.queryByText('Detection Analysis')).toBeNull();
    expect(screen.queryByText(/within ±60 min/)).toBeNull();
  });

  it('opens the drawer with the tab window from a technique coverage row', async () => {
    renderTab();
    const btn = await screen.findByRole('button', { name: 'T1003' });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(df.getAlerts).toHaveBeenCalledWith(
        expect.objectContaining({ techniques: ['T1003'], from: WINDOW.from, to: WINDOW.to }),
      ),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders without crashing when every endpoint returns empty data', async () => {
    df.getSecureScore.mockRejectedValue(new Error('404'));
    df.getSecureScoreTrend.mockResolvedValue([]);
    df.getAlertSummary.mockResolvedValue({
      total: 0,
      bySeverity: {},
      byStatus: {},
      recentHigh: [],
      recentMedium: [],
      counts: emptyCounts,
    });
    df.getAlertTrend.mockResolvedValue([]);
    df.getTechniqueCoverage.mockResolvedValue({
      overall: {
        executions: 0,
        prevented: 0,
        detectedOnly: 0,
        missed: 0,
        detectionRate: 0,
        preventionRate: 0,
        testedTechniques: 0,
        detectedTechniques: 0,
      },
      byTechnique: [],
    });
    df.getControls.mockResolvedValue([]);

    renderTab();
    await waitFor(() => expect(screen.getByText(/No technique runs in/)).toBeInTheDocument());
    expect(screen.getByText('Detected / Prevented')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No controls data/)).toBeInTheDocument());
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('reloads tab data after Sync Now', async () => {
    mockTriggerSync.mockResolvedValue({
      scores: { errors: [] },
      controls: { errors: [] },
      alerts: { errors: [] },
    });
    renderTab();
    await waitFor(() => expect(df.getTechniqueCoverage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(df.getAlerts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(df.getAlertTrend).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(df.getTechniqueCoverage).toHaveBeenCalledTimes(2));
    expect(df.getAlertSummary).toHaveBeenCalledTimes(2);
    // Custom range: same from/to, but the feed and timeline still re-request.
    await waitFor(() => expect(df.getAlerts).toHaveBeenCalledTimes(2));
    expect(df.getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ from: WINDOW.from, to: WINDOW.to, page: 1 }));
    await waitFor(() => expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(df.getAlertTrend).toHaveBeenCalledTimes(4));
  });

  it('alerts and detection tiles state the window', async () => {
    renderTab({ preset: '7d' });
    const tile = await screen.findByRole('button', { name: /Defender Alerts/ });
    await waitFor(() => expect(within(tile).getByText('in last 7 days')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('in last 7 days')).toHaveLength(2));
  });

  it('opens the control-badge drawer with NO from/to (badge counts its own 30 days)', async () => {
    df.getControlCorrelation.mockResolvedValue({ alertCount: 3, coveredTechniques: ['T1566', 'T1204'] });
    renderTab();
    const badge = await screen.findByRole('button', { name: 'View 3 Defender alerts addressed by this control' });
    await userEvent.click(badge);
    await waitFor(() =>
      expect(df.getAlerts).toHaveBeenCalledWith(expect.objectContaining({ techniques: ['T1566', 'T1204'] })),
    );
    const drawerCall = df.getAlerts.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((a) => Array.isArray(a.techniques));
    expect(drawerCall).not.toHaveProperty('from');
    expect(drawerCall).not.toHaveProperty('to');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
