import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { IntegrationVendor } from '../vendorConfig';

const mockGetDefenseScoreTrend = vi.fn();
const mockGetAlertTrend = vi.fn();

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

const { default: IntegrationTimelineCard } = await import('../IntegrationTimelineCard');

const vendor = {
  id: 'crowdstrike',
  alertsTitle: 'Falcon Alerts',
  api: { getAlertTrend: (...a: unknown[]) => mockGetAlertTrend(...a) },
} as unknown as IntegrationVendor;

const window = { from: '2026-09-21T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' };

describe('IntegrationTimelineCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefenseScoreTrend.mockResolvedValue([{ timestamp: '2026-10-01', total: 5 }]);
    mockGetAlertTrend.mockResolvedValue([
      { date: '2026-10-01', count: 4, linked: 1, interval: 'day' },
    ]);
  });

  it('requests trend with the window and renders the legend labels', async () => {
    render(<IntegrationTimelineCard vendor={vendor} window={window} />);
    await waitFor(() => {
      expect(screen.getByText('Alerts linked to a test')).toBeInTheDocument();
      expect(screen.getByText('Organic alerts')).toBeInTheDocument();
    });
    expect(mockGetAlertTrend).toHaveBeenCalledWith(30, window);
    expect(mockGetDefenseScoreTrend).toHaveBeenCalledWith({
      from: window.from,
      to: window.to,
      interval: 'day',
      excludeCyberHygiene: true,
      scoringMode: 'all-stages',
    });
  });

  it('renders no range selector', async () => {
    render(<IntegrationTimelineCard vendor={vendor} window={window} />);
    await waitFor(() => expect(screen.getByText('Organic alerts')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders the error state when both endpoints fail', async () => {
    mockGetDefenseScoreTrend.mockRejectedValue(new Error('x'));
    mockGetAlertTrend.mockRejectedValue(new Error('x'));
    render(<IntegrationTimelineCard vendor={vendor} window={window} />);
    await waitFor(() =>
      expect(screen.getByText('Unable to load test or alert volume')).toBeInTheDocument(),
    );
  });

  it('flags a failed alert request instead of showing it as zero alerts', async () => {
    mockGetAlertTrend.mockRejectedValue(new Error('x'));
    render(<IntegrationTimelineCard vendor={vendor} window={window} />);
    await waitFor(() => expect(screen.getByText('Alert volume unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Test executions unavailable')).toBeNull();
  });

  it('flags a failed execution request', async () => {
    mockGetDefenseScoreTrend.mockRejectedValue(new Error('x'));
    render(<IntegrationTimelineCard vendor={vendor} window={window} />);
    await waitFor(() => expect(screen.getByText('Test executions unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Alert volume unavailable')).toBeNull();
  });
});
