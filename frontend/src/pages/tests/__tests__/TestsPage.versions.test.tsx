import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BuildInfo, TestMetadata } from '@/types/test';
import type { TestVersionRow, TestVersionsResponse } from '@/types/testVersion';
import type { BuildQueueDeps } from '@/lib/buildQueue';

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
  build: true,
  granted: new Set<string>(),
  data: null as unknown,
  checkError: null as string | null,
  desktop: true,
  checkNow: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ testVersions: state.testVersions, build: state.build }),
}));
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

import { BuildQueueProvider } from '@/hooks/useBuildQueue';
import TestsPage from '../TestsPage';

/** Each build waits for its gate; an abort (unmount) rejects it. */
const gates: Array<() => void> = [];
const deps: BuildQueueDeps = {
  getBuildInfo: vi.fn(async () => ({ exists: false }) as BuildInfo),
  getEmbedDependencies: vi.fn(async () => []),
  buildTest: vi.fn(
    (_uuid: string, opts: { signal?: AbortSignal }) =>
      new Promise<BuildInfo>((resolve, reject) => {
        gates.push(() => resolve({ exists: true, source: 'built' } as BuildInfo));
        opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  ),
};

function Page() {
  return (
    <MemoryRouter>
      <BuildQueueProvider deps={deps}>
        <TestsPage />
      </BuildQueueProvider>
    </MemoryRouter>
  );
}

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
  render(<Page />);
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
    state.build = true;
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
      const { unmount } = render(<Page />);
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

describe('TestsPage bulk build', () => {
  const BUILD = 'tests:builds:create';
  const RUN = 'endpoints:tasks:create';
  const checkbox = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });
  const checked = (name: string) => checkbox(name).getAttribute('aria-checked') === 'true';
  const button = (name: string | RegExp) => screen.getByRole('button', { name });
  const noButton = (name: string | RegExp) => expect(screen.queryByRole('button', { name })).toBeNull();
  const filterBy = (value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Version status' }), { target: { value } });

  async function startRun(names: string[]) {
    fireEvent.click(button('Select'));
    for (const name of names) fireEvent.click(checkbox(name));
    fireEvent.click(button(`Build ${names.length}`));
    fireEvent.click(button('Build and sign'));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    gates.length = 0;
    state.testVersions = true;
    state.build = true;
    state.granted = new Set([BUILD, RUN]);
    state.data = response();
    state.checkError = null;
    state.desktop = true;
  });

  it('shows Select with either the build or the run permission, and not without', async () => {
    for (const granted of [[BUILD], [RUN], []]) {
      state.granted = new Set(granted);
      const { unmount } = render(<Page />);
      await screen.findByRole('button', { name: 'test a' });
      if (granted.length) button('Select');
      else noButton('Select');
      unmount();
    }
  });

  it('Build N needs the build permission and the build capability; Run N needs the run permission', async () => {
    const cases = [
      { granted: [BUILD, RUN], build: true, buildBtn: true, runBtn: true },
      { granted: [BUILD], build: true, buildBtn: true, runBtn: false },
      { granted: [RUN], build: true, buildBtn: false, runBtn: true },
      { granted: [BUILD, RUN], build: false, buildBtn: false, runBtn: true },
    ];
    for (const c of cases) {
      state.granted = new Set(c.granted);
      state.build = c.build;
      const { unmount } = render(<Page />);
      await screen.findByRole('button', { name: 'test a' });
      fireEvent.click(button('Select'));
      noButton('Build 1');
      noButton('Run 1');
      fireEvent.click(checkbox('test a'));
      if (c.buildBtn) button('Build 1');
      else noButton('Build 1');
      if (c.runBtn) button('Run 1');
      else noButton('Run 1');
      unmount();
    }
  });

  it('Select all (N) selects every test shown, then becomes Clear selection', async () => {
    await renderPage();
    noButton(/^Select all/);
    fireEvent.click(button('Select'));
    fireEvent.click(button('Select all (3)'));
    expect(['test a', 'test b', 'test c'].every(checked)).toBe(true);
    button('Build 3');
    fireEvent.click(button('Clear selection'));
    expect(['test a', 'test b', 'test c'].some(checked)).toBe(false);
    noButton(/^Build \d/);
    button('Select all (3)');
  });

  it('Select all follows the search and the version filter', async () => {
    state.data = response({}, { c: row({ status: 'rebuild_needed', reason: 'test_source_changed' }) });
    await renderPage();
    fireEvent.click(button('Select'));
    filterBy('rebuild_needed');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'test a' })).toBeNull());
    fireEvent.click(checkbox('test b'));
    fireEvent.click(button('Select all (2)'));
    expect(checked('test b') && checked('test c')).toBe(true);
    button('Build 2');

    fireEvent.change(screen.getByPlaceholderText(/^Search by name/), { target: { value: 'test c' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'test b' })).toBeNull());
    button('Clear selection');
    button('Build 1');

    filterBy('');
    fireEvent.change(screen.getByPlaceholderText(/^Search by name/), { target: { value: '' } });
    await screen.findByRole('button', { name: 'test a' });
    button('Select all (3)');
    button('Build 2');
    fireEvent.click(button('Select all (3)'));
    expect(checked('test a')).toBe(true);
    button('Build 3');
  });

  it('confirming builds the selected tests in list order, leaves select mode and clears the selection', async () => {
    await renderPage();
    fireEvent.click(button('Select'));
    fireEvent.click(checkbox('test c'));
    fireEvent.click(checkbox('test a'));
    fireEvent.click(button('Build 2'));
    expect(screen.getByRole('heading', { name: 'Build and sign 2 tests' })).toBeTruthy();
    fireEvent.click(button('Build and sign'));

    expect(screen.queryByRole('heading', { name: /^Build and sign/ })).toBeNull();
    noButton('Cancel');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(await screen.findByText('Building 1 of 2 · test a')).toBeTruthy();
    await waitFor(() => expect(deps.buildTest).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deps.buildTest).mock.calls[0][0]).toBe('a');

    fireEvent.click(button('Select'));
    expect(screen.queryAllByRole('checkbox').some((c) => c.getAttribute('aria-checked') === 'true')).toBe(false);

    act(() => gates[0]());
    expect(await screen.findByText('Building 2 of 2 · test c')).toBeTruthy();
    await waitFor(() => expect(deps.buildTest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(deps.buildTest).mock.calls[1][0]).toBe('c');
  });

  it('Build N is disabled while a run is going', async () => {
    await renderPage();
    await startRun(['test a']);
    await screen.findByText('Building 1 of 1 · test a');
    fireEvent.click(button('Select'));
    fireEvent.click(checkbox('test b'));
    expect((button('Build 1') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Run 1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a test the version filter hides during the run is still named, and the run goes on with its own list', async () => {
    state.data = response({}, { c: row({ status: 'rebuild_needed', reason: 'test_source_changed' }) });
    await renderPage();
    filterBy('rebuild_needed');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'test a' })).toBeNull());
    fireEvent.click(button('Select'));
    fireEvent.click(button('Select all (2)'));
    fireEvent.click(button('Build 2'));
    fireEvent.click(button('Build and sign'));
    await screen.findByText('Building 1 of 2 · test b');
    await waitFor(() => expect(gates).toHaveLength(1));

    filterBy('up_to_date');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'test b' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'test c' })).toBeNull();
    expect(screen.getByText('Building 1 of 2 · test b')).toBeTruthy();

    act(() => gates[0]());
    expect(await screen.findByText('Building 2 of 2 · test c')).toBeTruthy();
    await waitFor(() => expect(gates).toHaveLength(2));
    expect(vi.mocked(deps.buildTest).mock.calls.map((c) => c[0])).toEqual(['b', 'c']);
    act(() => gates[1]());
    expect(await screen.findByText('Built 2 of 2 · 0 failed · 0 skipped')).toBeTruthy();
  });

  it('reloads the version rows once for each result', async () => {
    await renderPage();
    await startRun(['test a', 'test b']);
    await waitFor(() => expect(gates).toHaveLength(1));
    expect(state.reload).not.toHaveBeenCalled();
    act(() => gates[0]());
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(gates).toHaveLength(2));
    act(() => gates[1]());
    await screen.findByText('Built 2 of 2 · 0 failed · 0 skipped');
    // The reload runs in an effect after the render that shows the result.
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.reload).toHaveBeenCalledTimes(2);
  });
});
