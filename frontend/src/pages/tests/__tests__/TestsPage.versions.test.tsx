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
  checkError: null as string | null,
  desktop: true,
  checkNow: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ testVersions: state.testVersions }) }));
vi.mock('@/hooks/useTestVersions', () => ({
  useTestVersions: () => ({
    data: state.testVersions ? state.data : null,
    loading: false,
    checking: false,
    checkError: state.checkError,
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
vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => state.desktop }));
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
    state.checkError = null;
    state.desktop = true;
  });

  it('shows a version chip under each test name when the capability is on', async () => {
    await renderPage();
    const list = within(screen.getByRole('region', { name: 'intel-driven' }));
    expect(list.queryByText('Version')).toBeNull();
    expect(list.getByText('Up to date')).toBeTruthy();
    expect(list.getByText('Rebuild needed')).toBeTruthy();
    expect(list.getByText('Not built')).toBeTruthy();
  });

  it('keeps the list when the versions could not be loaded', async () => {
    state.data = null;
    await renderPage();
    expect(screen.getByRole('button', { name: 'test b' })).toBeTruthy();
    expect(screen.queryByText('Rebuild needed')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a failed update check as an alert in the header, not the banner', async () => {
    state.data = response({ updatesAvailable: 1 });
    state.checkError = 'Could not check for updates: boom';
    await renderPage();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Could not check for updates: boom');
    expect(within(screen.getByRole('status')).queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check now' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows a failed update check in the header when there is no banner', async () => {
    state.checkError = "You don't have permission to check for updates";
    await renderPage();
    expect(screen.getByRole('alert').textContent).toBe("You don't have permission to check for updates");
  });

  it('shows a removable chip for the version filter on mobile', async () => {
    state.desktop = false;
    await renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Version status' }), {
      target: { value: 'rebuild_needed' },
    });
    const chip = await screen.findByRole('button', { name: /^Rebuild needed/ , hidden: false });
    expect(screen.queryByRole('button', { name: 'test a' })).toBeNull();
    fireEvent.click(chip);
    expect(await screen.findByRole('button', { name: 'test a' })).toBeTruthy();
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

  it('shows exactly one Sync button when the banner is visible', async () => {
    state.data = response({ updatesAvailable: 3, newTests: 2 });
    await renderPage();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sync' })).toHaveLength(1);
  });

  it('banners newer published versions, with Check now in the header', async () => {
    state.data = response({ updatesAvailable: 3 });
    await renderPage();
    expect(screen.getByText('3 tests have a newer published version')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Check now' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(state.checkNow).toHaveBeenCalledTimes(1);
  });

  it('puts Check now in the header, left of Sync, with or without the banner', async () => {
    for (const library of [{ updatesAvailable: 1 }, {}]) {
      state.data = response(library);
      const { unmount } = render(
        <MemoryRouter>
          <TestsPage />
        </MemoryRouter>,
      );
      await screen.findByRole('button', { name: 'test a' });
      const check = screen.getAllByRole('button', { name: 'Check now' });
      expect(check).toHaveLength(1);
      const sync = screen.getByRole('button', { name: 'Sync' });
      expect(check[0].parentElement).toBe(sync.parentElement);
      expect(check[0].compareDocumentPosition(sync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const banner = screen.queryByRole('status');
      if (banner) expect(within(banner).queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it('renders no buttons in the banner', async () => {
    state.data = response({ updatesAvailable: 1, rebuildsNeeded: 1, newTests: 1, checkError: 'x' });
    await renderPage();
    expect(within(screen.getByRole('status')).queryAllByRole('button')).toHaveLength(0);
  });

  it('hides Check now when git sync is off', async () => {
    state.data = response({ gitEnabled: false, checkEnabled: false, updatesAvailable: 1 });
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
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

  it('says git sync is off in the library line, shows no banner for it and offers no Check now', async () => {
    state.data = response({ gitEnabled: false, checkEnabled: false });
    await renderPage();
    const note = screen.getByText('Git sync is off: published versions are not checked');
    expect(note.className).toContain('text-muted');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('with git sync off, a banner still shows rebuilds, without the git sync note in it', async () => {
    state.data = response({ gitEnabled: false, checkEnabled: false, rebuildsNeeded: 2 });
    await renderPage();
    const banner = screen.getByRole('status');
    expect(within(banner).getByText('2 tests need a rebuild')).toBeTruthy();
    expect(within(banner).queryByText(/Git sync is off/)).toBeNull();
    expect(screen.getAllByText('Git sync is off: published versions are not checked')).toHaveLength(1);
  });

  it('shows no git sync note when git sync is on', async () => {
    await renderPage();
    expect(screen.queryByText(/Git sync is off/)).toBeNull();
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
