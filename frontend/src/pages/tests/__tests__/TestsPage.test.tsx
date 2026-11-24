import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const perms = vi.hoisted(() => ({ granted: new Set<string>() }));

vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn(async () => [
      mk('a'),
      mk('b'),
      mk('c', 'cyber-hygiene'),
    ]),
    getBuiltTestUuids: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => ({
      status: 'synced',
      branch: 'main',
      commitHash: 'abcdef1234567',
      lastSyncTime: new Date(Date.now() - 34 * 60_000).toISOString(),
    })),
    syncTests: vi.fn(async () => ({
      success: true,
      message: 'ok',
      testCount: 3,
      syncStatus: { status: 'synced', branch: 'main', commitHash: '9999999aaaa', lastSyncTime: new Date().toISOString() },
    })),
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
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: (p: string) => perms.granted.has(p) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: analytics.configured }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));
vi.mock('@/components/browser/execution', () => ({ ExecutionDrawer: () => null }));

import { analyticsApi } from '@/services/api/analytics';
import { browserApi } from '@/services/api/browser';
import { BuildQueueProvider } from '@/hooks/useBuildQueue';
import TestsPage from '../TestsPage';

function renderPage(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BuildQueueProvider>
        <TestsPage />
      </BuildQueueProvider>
    </MemoryRouter>,
  );
}

describe('TestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analytics.configured = false;
    perms.granted.clear();
  });

  it('shows the library branch, commit and last sync, with no Sync button for a reader', async () => {
    renderPage();
    expect(await screen.findByText('main')).toBeTruthy();
    expect(screen.getByText('(abcdef1)')).toBeTruthy();
    expect(screen.getByText('· 34m ago')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
  });

  it('Sync pulls the library, then reloads the list and the sync status', async () => {
    perms.granted.add('tests:sync:execute');
    renderPage();
    await screen.findByRole('button', { name: 'test a' });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(browserApi.syncTests).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('(9999999)')).toBeTruthy();
    await waitFor(() => expect(browserApi.getAllTests).toHaveBeenCalledTimes(2));
    expect(screen.getByText('· just now')).toBeTruthy();
  });

  it('says so when the sync fails, and keeps the list', async () => {
    perms.granted.add('tests:sync:execute');
    vi.mocked(browserApi.syncTests).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Sync failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'test a' })).toBeTruthy();
  });

  it('lists the tests when the sync status cannot be read', async () => {
    vi.mocked(browserApi.getSyncStatus).mockRejectedValueOnce(new Error('503'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'test a' })).toBeTruthy();
    expect(screen.queryByText('main')).toBeNull();
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
