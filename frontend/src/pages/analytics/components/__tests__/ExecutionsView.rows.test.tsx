import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CoverageMatrixTestsResponse, EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';
import type { RunDetailPanelProps } from '../executions/detailParts';

// The whole view with rows of hosts: the Rows choice, archive by date, links, late answers (from the branch review).

const { caps, api, prime } = vi.hoisted(() => ({
  caps: { coverageMatrix: true, testVersions: false, loaded: true as boolean },
  api: { getCoverageMatrix: vi.fn(), getCoverageMatrixHosts: vi.fn(), getGroupedPaginatedExecutions: vi.fn(), lookupAcceptances: vi.fn() },
  prime: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, ...api } };
});
vi.mock('../matrix/useElementWidth', () => ({ useElementWidth: () => [() => {}, 900] }));
vi.mock('../ExecutionsDataTable', () => ({ default: () => <div data-testid="list">the list</div> }));
vi.mock('../executions/useRunDetail', () => ({
  useRunDetail: () => ({ panelProps: { showVersions: false }, prime, collapseControls: vi.fn() }),
}));
vi.mock('../executions/RunDetailPanel', () => ({
  RunDetailPanel: (props: RunDetailPanelProps) => <div data-testid="detail">detail of {props.row?.key}</div>,
}));

const { default: ExecutionsView } = await import('../ExecutionsView');
type Props = Parameters<typeof ExecutionsView>[0];

const T1 = 'a0000000-1234-4abc-8def-000000000001';
const T2 = 'a0000000-1234-4abc-8def-000000000002';
const counts = { protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 };
const ratio = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const MATRIX: CoverageMatrixTestsResponse = {
  rows: 'tests', windowLabel: '30d', hostCount: 2, testCount: 2, cellsIncluded: true, truncated: false,
  hosts: [
    { key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio },
    { key: 'org-1|HOST-02', hostname: 'HOST-02', org: 'org-1', counts, ratio },
  ],
  tests: [
    { key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] },
    { key: T2, testUuid: T2, name: 'Other test', kind: 'test', counts, cells: [{ i: 1, verdict: 'unprotected', at: '2026-01-13T09:00:00.000Z' }] },
  ],
};
const exec = (over: Partial<EnrichedTestExecution>): EnrichedTestExecution =>
  ({ test_uuid: T1, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [], ...over }) as EnrichedTestExecution;
const group = (key: string, over: Partial<EnrichedTestExecution> = {}): ExecutionGroup =>
  ({ groupKey: key, type: 'standalone', representative: exec(over), members: [exec(over)], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }) as ExecutionGroup;
const runs = (keys: string[], over: Partial<EnrichedTestExecution> = {}, pagination: Partial<GroupedPaginatedResponse['pagination']> = {}): GroupedPaginatedResponse => ({
  groups: keys.map((k) => group(k, over)),
  pagination: { page: 1, pageSize: 25, totalGroups: keys.length, totalDocuments: keys.length, totalPages: 1, hasNext: false, hasPrevious: false, ...pagination },
});
const HOSTS = (names: string[], hostCount = names.length) => ({
  rows: 'hosts', windowLabel: '30d', testCount: 1, hostCount, page: 1, pageSize: 25, truncated: false,
  tests: [{ key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts }],
  hosts: names.map((hostname) => ({ key: `org-1|${hostname}`, hostname, org: 'org-1', counts, ratio, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] })),
});

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(search)}</output>;
}
const url = () => screen.getByTestId('url').textContent ?? '';

function setup(over: Partial<Props> = {}, search = '?tab=executions') {
  const props: Props = {
    data: null, onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onSort: vi.fn(),
    onArchive: vi.fn().mockResolvedValue(undefined), onAcceptRisk: vi.fn().mockResolvedValue(undefined), onRevokeRisk: vi.fn().mockResolvedValue(undefined),
    onSelectedKeyChange: vi.fn(), filterParams: { from: 'now-30d', to: 'now' }, reloadToken: 0, forceList: false, onReleaseList: vi.fn(), ...over,
  };
  const ui = (p: Props) => (
    <MemoryRouter initialEntries={[`/analytics${search}`]}>
      <ExecutionsView {...p} />
      <Probe />
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(ui({ ...props, ...next })) };
}
const rowsSwitch = () => within(screen.getByRole('group', { name: 'Rows' }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getCoverageMatrix.mockResolvedValue(MATRIX);
  api.getGroupedPaginatedExecutions.mockResolvedValue(runs(['run-2', 'run-1']));
  api.lookupAcceptances.mockResolvedValue({});
  api.getCoverageMatrixHosts.mockResolvedValue(HOSTS(['HOST-01', 'HOST-02']));
});

describe('the Rows choice', () => {
  it('survives a visit to the List and back, in one visit to the tab', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });
    await user.click(rowsSwitch().getByRole('button', { name: 'Hosts' }));
    await screen.findByRole('heading', { name: 'HOST-01' });

    await user.click(screen.getByRole('button', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: 'Matrix' }));

    // The browser remembers "hosts" (a reload of the page would show hosts).
    expect(localStorage.getItem('achilles.executions.rows')).toBe('hosts');
    expect(rowsSwitch().getByRole('button', { name: 'Hosts' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Archive by date above the matrix', () => {
  it('reads the matrix again after the archive', async () => {
    const user = userEvent.setup();
    const onArchiveByDate = vi.fn().mockResolvedValue(undefined);
    setup({ onArchiveByDate });
    await screen.findByRole('heading', { name: 'Solo test' });
    expect(api.getCoverageMatrix).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Archive by date/ }));
    await user.type(screen.getByLabelText('Archive all executions before:'), '2026-01-15');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(onArchiveByDate).toHaveBeenCalledWith('2026-01-15'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2);
  });
});

describe('a link to a pair in rows of hosts', () => {
  it('shows the pair when its host is not among the first 25', async () => {
    const first = Array.from({ length: 25 }, (_, i) => `HOST-${String(i + 1).padStart(2, '0')}`);
    api.getCoverageMatrixHosts.mockResolvedValue(HOSTS(first, 40));
    setup({}, `?tab=executions&view=matrix&rows=hosts&pairTest=${T1}&pairHost=org-1%7CHOST-33&run=run-2`);
    await screen.findByRole('heading', { name: 'HOST-01' });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // The host is on a later page: its runs are shown above the rows.
    expect(url()).toContain('pairHost=org-1|HOST-33');
    expect(screen.queryByRole('group', { name: /Runs of/ })).not.toBeNull();
  });
});

describe('a late "Show more" of a closed pair', () => {
  it('does not replace the runs of the pair opened after it', async () => {
    const user = userEvent.setup();
    let resolveMore!: (v: GroupedPaginatedResponse) => void;
    // Pair 1 (Solo test on HOST-01): 26 runs, the second page is slow.
    api.getGroupedPaginatedExecutions.mockImplementation((p: { testUuid: string; page: number }) => {
      if (p.testUuid === T1 && p.page === 1) return Promise.resolve(runs(['a-2', 'a-1'], {}, { totalGroups: 3 }));
      if (p.testUuid === T1) return new Promise((r) => { resolveMore = r; });
      return Promise.resolve(runs(['b-2', 'b-1'], { test_uuid: T2, test_name: 'Other test', hostname: 'HOST-02', timestamp: '2026-01-13T09:00:00.000Z' }));
    });
    setup();
    await user.click(await screen.findByRole('button', { name: /^HOST-01: unprotected/ }));
    await screen.findByRole('dialog', { name: 'Solo test on HOST-01' });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    // Another pair, in another row, is opened while that page is on its way.
    await user.click(screen.getByRole('button', { name: /^HOST-02: unprotected/ }));
    await screen.findByRole('dialog', { name: 'Other test on HOST-02' });
    await act(async () => {
      resolveMore(runs(['a-0'], {}, { page: 2, totalGroups: 3 }));
      await new Promise((r) => setTimeout(r, 30));
    });

    // The drawer still shows the run of the open pair, and its neighbours are that pair's.
    expect(screen.queryByRole('dialog', { name: 'Other test on HOST-02' })).not.toBeNull();
  });

  it('and a click on a run of the open pair still opens it', async () => {
    const user = userEvent.setup();
    let resolveMore!: (v: GroupedPaginatedResponse) => void;
    api.getGroupedPaginatedExecutions.mockImplementation((p: { testUuid: string; page: number }) => {
      if (p.testUuid === T1 && p.page === 1) return Promise.resolve(runs(['a-2', 'a-1'], {}, { totalGroups: 3 }));
      if (p.testUuid === T1) return new Promise((r) => { resolveMore = r; });
      return Promise.resolve(runs(['b-2', 'b-1'], { test_uuid: T2, test_name: 'Other test', hostname: 'HOST-02', timestamp: '2026-01-13T09:00:00.000Z' }));
    });
    setup();
    await user.click(await screen.findByRole('button', { name: /^HOST-01: unprotected/ }));
    await screen.findByRole('dialog', { name: 'Solo test on HOST-01' });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await user.click(screen.getByRole('button', { name: /^HOST-02: unprotected/ }));
    await screen.findByRole('dialog', { name: 'Other test on HOST-02' });
    await act(async () => {
      resolveMore(runs(['a-0'], {}, { page: 2, totalGroups: 3 }));
      await new Promise((r) => setTimeout(r, 30));
    });
    const list = screen.getByRole('group', { name: 'Runs of Other test on HOST-02' });
    const runButtons = [...list.querySelectorAll<HTMLElement>('[data-pair-run]')];
    expect(runButtons).toHaveLength(2);

    await user.click(runButtons[1]);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole('dialog', { name: 'Other test on HOST-02' })).not.toBeNull();
  });
});
