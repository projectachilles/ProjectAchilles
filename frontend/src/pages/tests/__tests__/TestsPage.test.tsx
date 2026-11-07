import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestMetadata } from '@/types/test';

const mk = (uuid: string, category = 'intel-driven'): TestMetadata => ({
  uuid,
  name: `test ${uuid}`,
  techniques: [],
  isMultiStage: false,
  stages: [],
  category,
});

const analytics = vi.hoisted(() => ({ configured: false }));

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn(async () => [
      mk('a'),
      mk('b'),
      mk('c', 'cyber-hygiene'),
    ]),
    getBuiltTestUuids: vi.fn(async () => []),
  },
}));
vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getExecutedTestUuids: vi.fn(async () => []),
    getTestResults: vi.fn(async () => []),
  },
}));
vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({
    favorites: new Set<string>(),
    recentTests: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: () => false }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: analytics.configured }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));
vi.mock('@/components/browser/execution', () => ({ ExecutionDrawer: () => null }));

import { analyticsApi } from '@/services/api/analytics';
import TestsPage from '../TestsPage';

function renderPage(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TestsPage />
    </MemoryRouter>,
  );
}

describe('TestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analytics.configured = false;
  });

  it('ignores a legacy ?severity= link and lists every test', async () => {
    renderPage('/?severity=critical');
    await waitFor(() => expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '3/3 tests')).toBeTruthy());
  });

  it('renders a column header and one row per test in each category group', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'test a' });
    const intel = screen.getByRole('region', { name: 'intel-driven' });
    const hygiene = screen.getByRole('region', { name: 'cyber-hygiene' });
    for (const [section, count] of [[intel, 2], [hygiene, 1]] as const) {
      const header = within(section).getByText('Fleet result');
      expect(header).toBeTruthy();
      for (const label of ['Test', 'Techniques', 'Platform', 'Stages', 'Score']) {
        expect(within(section).getByText(label)).toBeTruthy();
      }
      expect(within(section).getAllByRole('listitem')).toHaveLength(count);
    }
  });

  it('lays the list out without a minimum width or a sideways scroller', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'test a' });
    expect(container.innerHTML).not.toContain('min-w-[');
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });

  it('shows "—" for fleet results when analytics is not configured, without fetching', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'test a' });
    expect(analyticsApi.getTestResults).not.toHaveBeenCalled();
    expect(screen.queryByText('Not run yet', { selector: '[data-fleet-text]' })).toBeNull();
    expect(screen.queryByText('No conclusive result in 90 days')).toBeNull();
  });

  it('shows fleet results from getTestResults when analytics is configured', async () => {
    analytics.configured = true;
    vi.mocked(analyticsApi.getTestResults).mockResolvedValueOnce([
      { testUuid: 'a', pairCount: 12, protectedCount: 9, hostCount: 12, lastRunAt: '2026-10-20T00:00:00.000Z' },
      { testUuid: 'c', pairCount: 40, protectedCount: 34, hostCount: 4, lastRunAt: '2026-10-20T00:00:00.000Z' },
    ]);
    renderPage();
    expect(await screen.findByText('9 / 12 endpoints protected')).toBeTruthy();
    expect(screen.getByText('34 / 40 checks passed')).toBeTruthy();
    expect(screen.getByText('Not run yet', { selector: '[data-fleet-text]' })).toBeTruthy();
    expect(analyticsApi.getTestResults).toHaveBeenCalledTimes(1);
  });

  it('does not call an executed test with no conclusive fleet result "not run"', async () => {
    analytics.configured = true;
    vi.mocked(analyticsApi.getExecutedTestUuids).mockResolvedValueOnce(['b']);
    vi.mocked(analyticsApi.getTestResults).mockResolvedValueOnce([
      { testUuid: 'a', pairCount: 12, protectedCount: 9, hostCount: 12, lastRunAt: '2026-10-20T00:00:00.000Z' },
    ]);
    renderPage();
    expect(await screen.findByText('No conclusive result in 90 days')).toBeTruthy();
    expect(screen.queryByText(/not run in 90 days/i)).toBeNull();
  });

  it('still renders every row with "—" when getTestResults rejects', async () => {
    analytics.configured = true;
    vi.mocked(analyticsApi.getTestResults).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await screen.findByRole('button', { name: 'test a' });
    await waitFor(() => expect(analyticsApi.getTestResults).toHaveBeenCalled());
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    for (const row of screen.getAllByRole('listitem')) {
      expect(within(row).getByText('—', { selector: '[data-fleet-text]' })).toBeTruthy();
    }
    expect(screen.queryByText('Not run yet', { selector: '[data-fleet-text]' })).toBeNull();
    expect(screen.queryByText('No conclusive result in 90 days')).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });
});
