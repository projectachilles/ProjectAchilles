import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DateRangeValue } from '@/lib/timeRange';

const cs = {
  getZtaScore: vi.fn(),
  getZtaScoreTrend: vi.fn(),
  getAlertSummary: vi.fn(),
  getAlertTrend: vi.fn(),
  getTechniqueCoverage: vi.fn(),
  getAlerts: vi.fn(),
};
const mockGetSyncStatus = vi.fn();
const mockTriggerSync = vi.fn();
const mockGetAutoResolveStatus = vi.fn();
const mockGetAutoResolveReceipts = vi.fn();
const mockGetDefenseScoreTrend = vi.fn();

vi.mock('@/services/api/crowdstrike', () => ({
  crowdstrikeApi: {
    getZtaScore: (...a: unknown[]) => cs.getZtaScore(...a),
    getZtaScoreTrend: (...a: unknown[]) => cs.getZtaScoreTrend(...a),
    getAlertSummary: (...a: unknown[]) => cs.getAlertSummary(...a),
    getAlertTrend: (...a: unknown[]) => cs.getAlertTrend(...a),
    getTechniqueCoverage: (...a: unknown[]) => cs.getTechniqueCoverage(...a),
    getAlerts: (...a: unknown[]) => cs.getAlerts(...a),
  },
}));

vi.mock('@/services/api/defender', () => ({ defenderApi: {} }));

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getCrowdStrikeSyncStatus: () => mockGetSyncStatus(),
    triggerCrowdStrikeSync: () => mockTriggerSync(),
    getCrowdStrikeAutoResolveStatus: () => mockGetAutoResolveStatus(),
    getCrowdStrikeAutoResolveReceipts: () => mockGetAutoResolveReceipts(),
    getCrowdStrikeSettings: () => Promise.resolve({ configured: true, region: 'us-1' }),
  },
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getDefenseScoreTrend: (params: unknown) => mockGetDefenseScoreTrend(params),
  },
}));

// Recharts uses ResizeObserver under the hood
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const { default: CrowdStrikeTab } = await import('../CrowdStrikeTab');

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
  byPrevention: { prevented: 0, detected_only: 0, kill_failed: 0 },
};

const coverage = {
  overall: {
    executions: 98,
    prevented: 5,
    detectedOnly: 3,
    missed: 90,
    detectionRate: 8.2,
    preventionRate: 5.1,
    testedTechniques: 2,
    detectedTechniques: 1,
  },
  byTechnique: [
    { technique: 'T1059', name: 'Command and Scripting Interpreter', executions: 10, prevented: 5, detectedOnly: 3, missed: 2, alerts: 8 },
    { technique: 'T1003', name: null, executions: 5, prevented: 0, detectedOnly: 0, missed: 5, alerts: 0 },
  ],
  scope: { source: 'alerts', hosts: 4 },
};

function mockHappyPath() {
  cs.getZtaScore.mockResolvedValue({
    overallScore: 82.5,
    osScore: 90,
    sensorConfigScore: 75,
    deviceCount: 12,
    minScore: 61,
  });
  cs.getZtaScoreTrend.mockResolvedValue([
    { date: '2026-09-12', overallScore: 80, score: 80, osScore: 88, sensorConfigScore: 70, deviceCount: 12 },
    { date: '2026-09-30', overallScore: 82.5, score: 82.5, osScore: 90, sensorConfigScore: 75, deviceCount: 12 },
  ]);
  cs.getAlertSummary.mockResolvedValue({
    total: 42,
    bySeverity: { high: 20, weird: 6 },
    byStatus: { new: 30, closed: 12 },
    recentHigh: [],
    recentMedium: [],
    counts: {
      ...emptyCounts,
      bySource: { all: 26, test: 11, organic: 15 },
      bySeverity: { high: 20, weird: 6 },
      autoResolved: 4,
      linkedOpen: 7,
    },
  });
  cs.getAlertTrend.mockResolvedValue([]);
  cs.getTechniqueCoverage.mockResolvedValue(coverage);
  cs.getAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10, counts: emptyCounts });
  mockGetDefenseScoreTrend.mockResolvedValue([]);
  mockGetSyncStatus.mockResolvedValue({
    lastAlertSync: '2026-10-11T03:00:00.000Z',
    lastZtaSync: '2026-10-11T03:00:00.000Z',
    ztaStatus: 'ok',
    lastError: null,
  });
  mockGetAutoResolveStatus.mockResolvedValue({
    mode: 'enabled',
    counts: { last24h: 0, last7d: 1, last30d: 4 },
    lastAutoResolve: null,
  });
  mockGetAutoResolveReceipts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
}

function renderTab(range: DateRangeValue = RANGE) {
  return render(
    <MemoryRouter>
      <CrowdStrikeTab dateRange={range} />
    </MemoryRouter>,
  );
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

describe('CrowdStrikeTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHappyPath();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('requests summary, trend and coverage with the window resolved from the dateRange prop', async () => {
    renderTab();
    await waitFor(() => expect(cs.getTechniqueCoverage).toHaveBeenCalled());
    expect(cs.getAlertSummary).toHaveBeenCalledWith(WINDOW);
    expect(cs.getAlertTrend).toHaveBeenCalledWith(expect.any(Number), WINDOW);
    expect(cs.getTechniqueCoverage).toHaveBeenCalledWith(WINDOW);
    // ZTA trend days = ceil((to - from) / 1 day), capped at 365
    expect(cs.getZtaScoreTrend).toHaveBeenCalledWith(30);
  });

  it('re-requests when the dateRange prop changes', async () => {
    const { rerender } = renderTab();
    await waitFor(() => expect(cs.getTechniqueCoverage).toHaveBeenCalledWith(WINDOW));

    const next: DateRangeValue = {
      preset: 'custom',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    };
    rerender(
      <MemoryRouter>
        <CrowdStrikeTab dateRange={next} />
      </MemoryRouter>,
    );
    const nextWindow = { from: next.from, to: next.to };
    await waitFor(() => expect(cs.getTechniqueCoverage).toHaveBeenCalledWith(nextWindow));
    expect(cs.getAlertSummary).toHaveBeenCalledWith(nextWindow);
    expect(cs.getAlertTrend).toHaveBeenCalledWith(expect.any(Number), nextWindow);
    expect(cs.getZtaScoreTrend).toHaveBeenLastCalledWith(122);
  });

  it('ZTA tile shows no NaN with a one-point trend', async () => {
    cs.getZtaScoreTrend.mockResolvedValue([
      { date: '2026-09-30', overallScore: 82.5, score: 82.5, osScore: 90, sensorConfigScore: 75, deviceCount: 12 },
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText('82.5')).toBeInTheDocument());
    expect(screen.getByText('12 hosts · lowest 61')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
    // OS / Sensor mini-bars
    expect(screen.getByRole('meter', { name: 'OS score' })).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getByRole('meter', { name: 'Sensor score' })).toHaveAttribute('aria-valuenow', '75');
  });

  it('ZTA tile shows the trend delta when the trend has two points', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('+2.50')).toBeInTheDocument());
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('alerts tile shows linked and organic counts', async () => {
    renderTab();
    const tile = await screen.findByRole('button', { name: /Falcon Alerts/ });
    await waitFor(() => expect(within(tile).getByText('26')).toBeInTheDocument());
    expect(within(tile).getByText('11 linked to tests')).toBeInTheDocument();
    expect(within(tile).getByText(/15 organic/)).toBeInTheDocument();
    // Severity micro-bar line: known severities plus "Unclassified"
    expect(within(tile).getByText('20 high · 6 unclassified')).toBeInTheDocument();
  });

  it('clicking the alerts tile scrolls to the feed instead of opening the drawer', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderTab();
    const tile = await screen.findByRole('button', { name: /Falcon Alerts/ });
    await userEvent.click(tile);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('alert-feed'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('detection tile shows detection and prevention rates from coverage', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Detected / Prevented')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('8.2')).toBeInTheDocument());
    expect(screen.getByText('5.1')).toBeInTheDocument();
    expect(screen.getByText('% prevented')).toBeInTheDocument();
    expect(
      screen.getByText('8 / 98 test results raised an alert · 5 were stopped'),
    ).toBeInTheDocument();
    expect(screen.getByText('on 4 hosts with a CrowdStrike alert in 90 days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 of 2 techniques detected' })).toBeInTheDocument();
  });

  it('auto-resolve tile shows how many test alerts are still open', async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('7 of 11 test alerts still open')).toBeInTheDocument(),
    );
  });

  it('opens the drawer with the tab window from a technique coverage row', async () => {
    renderTab();
    const btn = await screen.findByRole('button', { name: 'T1059' });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(cs.getAlerts).toHaveBeenCalledWith(
        expect.objectContaining({ techniques: ['T1059'], from: WINDOW.from, to: WINDOW.to }),
      ),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders without crashing when every endpoint returns empty data', async () => {
    cs.getZtaScore.mockRejectedValue(new Error('404'));
    cs.getZtaScoreTrend.mockResolvedValue([]);
    cs.getAlertSummary.mockResolvedValue({
      total: 0,
      bySeverity: {},
      byStatus: {},
      recentHigh: [],
      recentMedium: [],
      counts: emptyCounts,
    });
    cs.getAlertTrend.mockResolvedValue([]);
    cs.getTechniqueCoverage.mockResolvedValue({
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
    mockGetSyncStatus.mockResolvedValue({
      lastAlertSync: null,
      lastZtaSync: null,
      ztaStatus: null,
      lastError: null,
    });

    renderTab();
    await waitFor(() => expect(screen.getByText(/No posture score data yet/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/No technique runs in/)).toBeInTheDocument());
    expect(screen.getByText('Detected / Prevented')).toBeInTheDocument();
    expect(screen.getByText('Technique coverage')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('shows the not-licensed empty state when sync status reports zta_status not_licensed', async () => {
    mockGetSyncStatus.mockResolvedValue({
      lastAlertSync: '2026-10-11T03:00:00.000Z',
      lastZtaSync: null,
      ztaStatus: 'not_licensed',
      lastError: null,
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('Posture score requires Falcon Insight licensing')).toBeInTheDocument(),
    );
    // The rest of the tab still renders — licensing must not break alerts/detection
    const tile = await screen.findByRole('button', { name: /Falcon Alerts/ });
    await waitFor(() => expect(within(tile).getByText('26')).toBeInTheDocument());
    expect(screen.getByText('Detected / Prevented')).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'OS score' })).toBeNull();
  });

  it('shows the no-data empty state when the ZTA endpoint fails but sync is licensed', async () => {
    cs.getZtaScore.mockRejectedValue(new Error('404'));
    cs.getZtaScoreTrend.mockResolvedValue([]);

    renderTab();

    await waitFor(() => expect(screen.getByText(/No posture score data yet/)).toBeInTheDocument());
  });

  it('renders the sync error banner from the sync status', async () => {
    mockGetSyncStatus.mockResolvedValue({
      lastAlertSync: '2026-10-11T03:00:00.000Z',
      lastZtaSync: null,
      ztaStatus: 'ok',
      lastError: { stage: 'alerts', message: 'crowdstrike API 429: rate limited', at: '2026-10-11T03:00:00.000Z' },
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('CrowdStrike sync failed')).toBeInTheDocument());
    expect(screen.getByText(/rate limited/)).toBeInTheDocument();
  });

  it('reloads tab data after Sync Now', async () => {
    mockTriggerSync.mockResolvedValue({
      alerts: { errors: [] },
      zta: { errors: [] },
    });
    renderTab();
    await waitFor(() => expect(cs.getTechniqueCoverage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cs.getAlerts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(1));
    // Two trend calls per load: the tab's tile and the timeline card
    await waitFor(() => expect(cs.getAlertTrend).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(cs.getTechniqueCoverage).toHaveBeenCalledTimes(2));
    expect(cs.getAlertSummary).toHaveBeenCalledTimes(2);
    // A custom range resolves to the same from/to, yet the feed and the
    // timeline must re-request too, or they disagree with the refreshed tiles.
    await waitFor(() => expect(cs.getAlerts).toHaveBeenCalledTimes(2));
    expect(cs.getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ from: WINDOW.from, to: WINDOW.to, page: 1 }));
    await waitFor(() => expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cs.getAlertTrend).toHaveBeenCalledTimes(4));
  });

  it('labels the ZTA delta with the trend span it actually covers (all time = last 365d)', async () => {
    renderTab({ preset: 'all' });
    await waitFor(() => expect(screen.getByText('+2.50')).toBeInTheDocument());
    expect(cs.getZtaScoreTrend).toHaveBeenCalledWith(365);
    expect(screen.getByText('pts over last 365d')).toBeInTheDocument();
    expect(screen.queryByText(/pts over all time/)).toBeNull();
  });

  it('alerts and detection tiles state the window', async () => {
    renderTab();
    const tile = await screen.findByRole('button', { name: /Falcon Alerts/ });
    await waitFor(() => expect(within(tile).getByText('in selected range')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('in selected range')).toHaveLength(2));
  });
});
