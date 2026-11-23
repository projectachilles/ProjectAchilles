import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { TestVersionRow, TestVersionsResponse } from '@/types/testVersion';
import type { BuildInfo } from '@/types/test';
import type { UseTestVersions } from '@/hooks/useTestVersions';

const { hook, perms } = vi.hoisted(() => ({
  hook: { value: null as unknown },
  perms: { granted: new Set<string>() },
}));

vi.mock('@/hooks/useTestVersions', () => ({ useTestVersions: () => hook.value }));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: (...p: string[]) => p.every((x) => perms.granted.has(x)),
}));

const { default: VersionCard } = await import('../VersionCard');

const UUID = '7659eeba-f315-440e-9882-4aa015d68b27';
const PUB = 'aaaaaaa1111111';
const SYN = 'bbbbbbb2222222';
const BLT = 'ccccccc3333333';
const REPO = 'https://github.com/example/library';

const ref = (commit: string | null, fingerprint: string | null = null, commitDate: string | null = '2026-11-10T12:00:00Z') => ({
  commit, commitDate, fingerprint,
});

function row(over: Partial<TestVersionRow> = {}): TestVersionRow {
  return {
    status: 'up_to_date',
    custom: false,
    published: ref(PUB, 'fp-1'),
    synced: ref(SYN, 'fp-2'),
    built: { ...ref(BLT, 'fp-3'), builtAt: '2026-11-12T12:00:00Z', signed: true },
    ...over,
  };
}

const checkNow = vi.fn();
const reload = vi.fn();

function setHook(r: TestVersionRow | undefined, extra: Partial<UseTestVersions> = {}, library: Partial<TestVersionsResponse['library']> = {}) {
  const data: TestVersionsResponse | null = r === undefined && extra.data === null ? null : {
    library: {
      gitEnabled: true, checkEnabled: true, repoWebUrl: REPO, syncedCommit: SYN, syncedCommitDate: null,
      publishedCommit: PUB, publishedCommitDate: null, checkedAt: null, checkError: null,
      updatesAvailable: 0, rebuildsNeeded: 0, newTests: 0, ...library,
    },
    tests: r ? { [UUID]: r } : {},
  };
  hook.value = { data, loading: false, checking: false, checkError: null, checkNow, reload, ...extra };
}

function renderCard(props: Partial<{ onBuild: () => void; canBuild: boolean; buildInfo: BuildInfo | null }> = {}) {
  const ui = (p: typeof props) => (
    <MemoryRouter>
      <VersionCard uuid={UUID} canBuild={p.canBuild ?? true} onBuild={p.onBuild} buildInfo={p.buildInfo} />
    </MemoryRouter>
  );
  const result = render(ui(props));
  return { ...result, update: (p: typeof props) => result.rerender(ui(p)) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-23T12:00:00Z') });
  vi.clearAllMocks();
  perms.granted = new Set(['tests:sync:execute']);
});

afterEach(() => vi.useRealTimers());

describe('VersionCard rows', () => {
  it('shows Published, Synced and Built with 7-char commits and dates', () => {
    setHook(row());
    renderCard();
    const pub = screen.getByText('Published').closest('div')!;
    expect(within(pub).getByText('aaaaaaa')).toBeInTheDocument();
    const syn = screen.getByText('Synced').closest('div')!;
    expect(within(syn).getByText('bbbbbbb')).toBeInTheDocument();
    expect(within(syn).getByText('1w ago')).toBeInTheDocument();
    const built = screen.getByText('Built').closest('div')!;
    expect(within(built).getByText('ccccccc')).toBeInTheDocument();
    expect(within(built).getByText('built 1w ago, signed')).toBeInTheDocument();
  });

  it('shows unsigned for an unsigned build', () => {
    setHook(row({ built: { ...ref(BLT), builtAt: '2026-11-12T12:00:00Z', signed: false } }));
    renderCard();
    expect(screen.getByText('built 1w ago, unsigned')).toBeInTheDocument();
  });

  it('says same as published when the fingerprints match', () => {
    setHook(row({ published: ref(PUB, 'same'), synced: ref(SYN, 'same') }));
    renderCard();
    expect(screen.getByText('same as published')).toBeInTheDocument();
  });

  it('does not say same as published when a fingerprint is missing', () => {
    setHook(row({ published: ref(PUB, null), synced: ref(SYN, null) }));
    renderCard();
    expect(screen.queryByText('same as published')).not.toBeInTheDocument();
  });

  it('shows not built when there is no build', () => {
    setHook(row({ status: 'not_built', built: null }));
    renderCard();
    expect(screen.getByText('not built')).toBeInTheDocument();
  });

  it('shows version not recorded for a build without a version', () => {
    setHook(row({ status: 'unknown_build', built: { ...ref(null), builtAt: '2026-11-12T12:00:00Z', signed: true } }));
    renderCard();
    expect(screen.getByText('version not recorded')).toBeInTheDocument();
  });

  it('shows not checked yet when published is unknown', () => {
    setHook(row({ status: 'not_checked', published: null }));
    renderCard();
    expect(screen.getByText('not checked yet')).toBeInTheDocument();
  });

  it('hides Published when git sync is off', () => {
    setHook(row(), {}, { gitEnabled: false });
    renderCard();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });

  it('marks a custom test, with local source and no Published row', () => {
    setHook(row({ status: 'uploaded', custom: true, published: null, synced: ref(null), built: null }));
    renderCard();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('local source')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });
});

describe('VersionCard status', () => {
  it('shows the status with its reason', () => {
    setHook(row({ status: 'rebuild_needed', reason: 'shared_changed' }));
    renderCard();
    expect(screen.getByText('Rebuild needed: shared libraries changed')).toBeInTheDocument();
  });

  it('notes a newer published version on a not built test', () => {
    setHook(row({ status: 'not_built', built: null, updateNote: true }));
    renderCard();
    expect(screen.getByText('A newer version is published. Sync first, then build.')).toBeInTheDocument();
  });
});

describe('VersionCard actions', () => {
  it.each(['not_built', 'rebuild_needed', 'unknown_build'] as const)('offers Build & Sign for %s and calls onBuild', async (status) => {
    setHook(row({ status }));
    const onBuild = vi.fn();
    renderCard({ onBuild });
    await userEvent.click(screen.getByRole('button', { name: 'Build & Sign' }));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  it('hides Build & Sign without permission or handler', () => {
    setHook(row({ status: 'not_built' }));
    const { unmount } = renderCard({ onBuild: vi.fn(), canBuild: false });
    expect(screen.queryByRole('button', { name: 'Build & Sign' })).not.toBeInTheDocument();
    unmount();
    renderCard({ canBuild: true });
    expect(screen.queryByRole('button', { name: 'Build & Sign' })).not.toBeInTheDocument();
  });

  it('links to the Test Library for update_available, with no sync button', () => {
    setHook(row({ status: 'update_available' }));
    renderCard({ onBuild: vi.fn() });
    expect(screen.getByRole('link', { name: 'Sync in Test Library' })).toHaveAttribute('href', '/tests');
    expect(screen.queryByRole('button', { name: /Sync/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build & Sign' })).not.toBeInTheDocument();
  });

  it('Check now runs the check and is disabled while checking', async () => {
    setHook(row({ status: 'not_checked', published: null }));
    const { unmount } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(checkNow).toHaveBeenCalledTimes(1);
    unmount();
    setHook(row({ status: 'not_checked', published: null }), { checking: true });
    renderCard();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  });

  it('hides Check now without the sync permission', () => {
    perms.granted = new Set();
    setHook(row({ status: 'not_checked', published: null }));
    renderCard();
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
  });

  it('shows a failed check as an alert', () => {
    setHook(row({ status: 'not_checked', published: null }), { checkError: 'Could not check for updates: request failed' });
    renderCard();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check for updates: request failed');
  });

  it.each(['up_to_date', 'uploaded'] as const)('has no primary action for %s', (status) => {
    setHook(row({ status }));
    renderCard({ onBuild: vi.fn() });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sync in Test Library' })).not.toBeInTheDocument();
  });
});

describe('VersionCard changes link', () => {
  it('compares synced to published for update_available', () => {
    setHook(row({ status: 'update_available' }));
    renderCard();
    const link = screen.getByRole('link', { name: 'View changes on GitHub' });
    expect(link).toHaveAttribute('href', `${REPO}/compare/${SYN}...${PUB}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('compares built to synced for rebuild_needed', () => {
    setHook(row({ status: 'rebuild_needed', reason: 'test_source_changed' }));
    renderCard();
    expect(screen.getByRole('link', { name: 'View changes on GitHub' })).toHaveAttribute('href', `${REPO}/compare/${BLT}...${SYN}`);
  });

  it('is absent without a repo URL or when the commits are the same', () => {
    setHook(row({ status: 'update_available' }), {}, { repoWebUrl: null });
    const { unmount } = renderCard();
    expect(screen.queryByRole('link', { name: 'View changes on GitHub' })).not.toBeInTheDocument();
    unmount();
    setHook(row({ status: 'update_available', published: ref(SYN), synced: ref(SYN) }));
    renderCard();
    expect(screen.queryByRole('link', { name: 'View changes on GitHub' })).not.toBeInTheDocument();
  });
});

describe('VersionCard visibility', () => {
  it('renders nothing without data, while loading, or for an unknown test', () => {
    setHook(undefined, { data: null });
    const a = renderCard();
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    setHook(undefined);
    const b = renderCard();
    expect(b.container).toBeEmptyDOMElement();
  });
});

describe('VersionCard after a build', () => {
  it('reloads the versions when the page build state changes, not on first load', () => {
    setHook(row({ status: 'not_built', built: null }));
    const { update } = renderCard({ buildInfo: null });
    update({ buildInfo: { exists: false } });
    expect(reload).not.toHaveBeenCalled();
    update({ buildInfo: { exists: true } });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
