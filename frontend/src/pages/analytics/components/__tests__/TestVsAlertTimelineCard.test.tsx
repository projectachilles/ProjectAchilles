import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetDefenseScoreTrend = vi.fn();
const mockGetAlertTrend = vi.fn();

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getDefenseScoreTrend: (params: unknown) => mockGetDefenseScoreTrend(params),
  },
}));

vi.mock('@/services/api/defender', () => ({
  defenderApi: {
    getAlertTrend: (days: number) => mockGetAlertTrend(days),
  },
}));

// Recharts uses ResizeObserver under the hood
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const { default: TestVsAlertTimelineCard } = await import('../TestVsAlertTimelineCard');

describe('TestVsAlertTimelineCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when both endpoints return empty arrays', async () => {
    mockGetDefenseScoreTrend.mockResolvedValue([]);
    mockGetAlertTrend.mockResolvedValue([]);

    render(<TestVsAlertTimelineCard />);

    await waitFor(() => {
      expect(
        screen.getByText('No test or alert activity in the selected window')
      ).toBeInTheDocument();
    });
  });

  it('passes the time-range selection to both APIs (default 30d on mount)', async () => {
    mockGetDefenseScoreTrend.mockResolvedValue([]);
    mockGetAlertTrend.mockResolvedValue([]);

    render(<TestVsAlertTimelineCard />);

    await waitFor(() => {
      expect(mockGetAlertTrend).toHaveBeenCalledWith(30);
      expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(1);
    });

    const params = mockGetDefenseScoreTrend.mock.calls[0][0];
    expect(params).toHaveProperty('interval', 'day');
    expect(typeof params.from).toBe('string');
  });

  it('renders the chart container when at least one endpoint returns data', async () => {
    mockGetDefenseScoreTrend.mockResolvedValue([
      { timestamp: '2026-05-01', score: 0.75, total: 12, protected: 9 },
      { timestamp: '2026-05-02', score: 0.8, total: 14, protected: 11 },
    ]);
    mockGetAlertTrend.mockResolvedValue([
      { date: '2026-05-01', count: 3, high: 1, medium: 1, low: 1 },
      { date: '2026-05-02', count: 5, high: 2, medium: 2, low: 1 },
    ]);

    const { container } = render(<TestVsAlertTimelineCard />);

    await waitFor(() => {
      expect(
        screen.queryByText('No test or alert activity in the selected window')
      ).toBeNull();
    });

    // ResponsiveContainer renders an outer wrapper div even before the inner chart paints
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('renders the error message when both endpoints fail', async () => {
    mockGetDefenseScoreTrend.mockRejectedValue(new Error('500'));
    mockGetAlertTrend.mockRejectedValue(new Error('500'));

    render(<TestVsAlertTimelineCard />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load test or alert volume')).toBeInTheDocument()
    );
  });
});
