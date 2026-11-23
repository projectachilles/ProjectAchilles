import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestMetadata } from '@/types/test';
import type { TestVersionRow, TestVersionsResponse } from '@/types/testVersion';

const mk = (uuid: string): TestMetadata => ({
  uuid,
  name: `test ${uuid}`,
  techniques: [],
  isMultiStage: false,
  stages: [],
  category: 'intel-driven',
});

const state = vi.hoisted(() => ({
  testVersions: true,
  granted: new Set<string>(),
  data: null as unknown,
  checkNow: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ testVersions: state.testVersions }) }));
vi.mock('@/hooks/useTestVersions', () => ({
  useTestVersions: () => ({
    data: state.testVersions ? state.data : null,
    loading: false,
    checking: false,
    checkNow: state.checkNow,
    reload: state.reload,
  }),
}));
vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn(async () => [mk('a'), mk('b'), mk('c')]),
    getBuiltTestUuids: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => ({
      status: 'synced',
      branch: 'main',
      commitHash: 'abcdef1234567',
      lastSyncTime: new Date().toISOString(),
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
  analyticsApi: { getExecutedTestUuids: vi.fn(async () => []), getTestResults: vi.fn(async () => []) },
}));
vi.mock('@/hooks/useTestPreferences', () => ({
  useTestPreferences: () => ({
    favorites: new Set<string>(),
    recentTests: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: (p: string) => state.granted.has(p) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: false }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));
vi.mock('@/components/browser/execution', () => ({ ExecutionDrawer: () => null }));

import TestsPage from '../TestsPage';

const ref = (commit: string | null) => ({ commit, commitDate: null, fingerprint: null });
const row = (over: Partial<TestVersionRow>): TestVersionRow => ({
  status: 'up_to_date',
  custom: false,
  published: null,
  synced: ref('1111111aaaa'),
  built: { ...ref('2222222bbbb'), builtAt: '2026-11-20T00:00:00Z', signed: true },
  ...over,
});

function response(
  library: Partial<TestVersionsResponse['library']> = {},
  tests: Record<string, TestVersionRow> = {},
): TestVersionsResponse {
  return {
    library: {
      gitEnabled: true,
      checkEnabled: true,
      repoWebUrl: null,
      syncedCommit: null,
      syncedCommitDate: null,
      publishedCommit: null,
      publishedCommitDate: null,
      checkedAt: null,
      checkError: null,
      updatesAvailable: 0,
      rebuildsNeeded: 0,
      newTests: 0,
      ...library,
    },
    tests: {
      a: row({ status: 'up_to_date' }),
      b: row({ status: 'rebuild_needed', reason: 'test_source_changed' }),
      c: row({ status: 'not_built', built: null }),
      ...tests,
    },
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <TestsPage />
    </MemoryRouter>,
  );
  return screen.findByRole('button', { name: 'test a' });
}

describe('TestsPage version status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.testVersions = true;
    state.granted = new Set(['tests:sync:execute']);
    state.data = response();
  });

  it('shows the Version column and a chip per row when the capability is on', async () => {
    await renderPage();
    const list = within(screen.getByRole('region', { name: 'intel-driven' }));
    expect(list.getByText('Version')).toBeTruthy();
    expect(list.getByText('Up to date')).toBeTruthy();
    expect(list.getByText('Rebuild needed')).toBeTruthy();
    expect(list.getByText('Not built')).toBeTruthy();
  });

  it('renders nothing new when the capability is off', async () => {
    state.testVersions = false;
    await renderPage();
    expect(screen.queryByText('Version')).toBeNull();
    expect(screen.queryByText('Up to date')).toBeNull();
    expect(screen.queryByText('All versions')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Version status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('banners newer published versions with Sync and Check now', async () => {
    state.data = response({ updatesAvailable: 3 });
    await renderPage();
    expect(screen.getByText('3 tests have a newer published version')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sync' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(state.checkNow).toHaveBeenCalledTimes(1);
  });

  it('banners rebuilds and new tests', async () => {
    state.data = response({ rebuildsNeeded: 5, newTests: 2 });
    await renderPage();
    expect(screen.getByText('5 tests need a rebuild')).toBeTruthy();
    expect(screen.getByText('2 new tests available')).toBeTruthy();
  });

  it('uses the singular for one test', async () => {
    state.data = response({ updatesAvailable: 1, rebuildsNeeded: 1 });
    await renderPage();
    expect(screen.getByText('1 test has a newer published version')).toBeTruthy();
    expect(screen.getByText('1 test needs a rebuild')).toBeTruthy();
  });

  it('shows no banner when nothing is pending, and keeps Check now in the header', async () => {
    await renderPage();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Check now' })).toHaveLength(1);
  });

  it('says when the check failed, with the error in the title', async () => {
    state.data = response({ checkError: 'network down' });
    await renderPage();
    const note = screen.getByText('Could not check for updates');
    expect(note.getAttribute('title')).toBe('network down');
    expect(screen.queryByText(/network down/)).toBeNull();
  });

  it('says git sync is off and offers no Check now', async () => {
    state.data = response({ gitEnabled: false });
    await renderPage();
    expect(screen.getByText('Git sync is off: published versions are not checked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('hides Check now without the sync permission', async () => {
    state.granted = new Set();
    state.data = response({ updatesAvailable: 2 });
    await renderPage();
    expect(screen.getByText('2 tests have a newer published version')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
  });

  it('shows when the versions were last checked', async () => {
    state.data = response({ checkedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    await renderPage();
    expect(screen.getByText('· checked 5m ago')).toBeTruthy();
  });

  it('filters the list by version status', async () => {
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Version status' }), {
      target: { value: 'rebuild_needed' },
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'test a' })).toBeNull());
    expect(screen.getByRole('button', { name: 'test b' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'intel-driven' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('reloads the versions after a Sync', async () => {
    state.data = response({ newTests: 1 });
    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Sync' })[0]);
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
  });
});
