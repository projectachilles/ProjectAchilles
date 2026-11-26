import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CoverageMatrixTestsResponse, EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';
import type { RunDetailPanelProps } from '../executions/detailParts';

// All Executions as a whole: the Matrix | List switch, a pair's runs, and the
// run detail in a drawer. The list and the detail panel are stand-ins here
// (they have their own tests); the matrix, the run list, the drawer and the
// dialogs are the real ones.

const { caps, api, prime, store } = vi.hoisted(() => ({
  caps: { coverageMatrix: true, testVersions: false, loaded: true as boolean },
  api: { getCoverageMatrix: vi.fn(), getCoverageMatrixHosts: vi.fn(), getGroupedPaginatedExecutions: vi.fn(), lookupAcceptances: vi.fn() },
  prime: vi.fn(),
  store: { fail: false },
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, ...api } };
});
vi.mock('../matrix/useElementWidth', () => ({ useElementWidth: () => [() => {}, 900] }));
vi.mock('../ExecutionsDataTable', () => ({
  default: (props: { selectedKey?: string | null }) => <div data-testid="list">the list{props.selectedKey ? `, selected ${props.selectedKey}` : ''}</div>,
}));
vi.mock('../executions/useRunDetail', () => ({
  useRunDetail: () => ({ panelProps: { showVersions: false }, prime, collapseControls: vi.fn() }),
}));
vi.mock('../executions/RunDetailPanel', () => ({
  RunDetailPanel: (props: RunDetailPanelProps) => (
    <div data-testid="detail">
      detail of {props.row?.key}
      <button onClick={() => props.onRequestAcceptRisk([{ test_name: 'Solo test', hostname: 'HOST-01' }])}>accept</button>
      <button onClick={() => props.row && props.onRequestArchive([props.row.key])}>archive</button>
      <span>{props.row && props.row.type === 'standalone' && props.getAcceptanceForExec(props.row.execution) ? 'accepted' : 'not accepted'}</span>
    </div>
  ),
}));

const { default: ExecutionsView } = await import('../ExecutionsView');
type Props = Parameters<typeof ExecutionsView>[0];

const T1 = 'a0000000-1234-4abc-8def-000000000001';
const counts = { protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 };
const ratio = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const MATRIX: CoverageMatrixTestsResponse = {
  rows: 'tests', windowLabel: '30d', hostCount: 2, testCount: 1, cellsIncluded: true, truncated: false,
  hosts: [
    { key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio },
    { key: 'org-1|HOST-02', hostname: 'HOST-02', org: 'org-1', counts, ratio },
  ],
  tests: [{
    key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts: { ...counts, unprotected: 1, protected: 1 },
    cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }, { i: 1, verdict: 'protected', at: '2026-01-11T09:00:00.000Z' }],
  }],
};
const exec = (over: Partial<EnrichedTestExecution>): EnrichedTestExecution =>
  ({ test_uuid: T1, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [], ...over }) as EnrichedTestExecution;
const group = (key: string, over: Partial<EnrichedTestExecution> = {}): ExecutionGroup =>
  ({ groupKey: key, type: 'standalone', representative: exec(over), members: [exec(over)], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }) as ExecutionGroup;
const runs = (keys: string[], over: Partial<EnrichedTestExecution> = {}): GroupedPaginatedResponse => ({
  groups: keys.map((k) => group(k, over)),
  pagination: { page: 1, pageSize: 25, totalGroups: keys.length, totalDocuments: keys.length, totalPages: 1, hasNext: false, hasPrevious: false },
});

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(search)}</output>;
}
const url = () => screen.getByTestId('url').textContent ?? '';

function setup(over: Partial<Props> = {}, search = '?tab=executions') {
  const props: Props = {
    data: null,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onSort: vi.fn(),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onAcceptRisk: vi.fn().mockResolvedValue(undefined),
    onRevokeRisk: vi.fn().mockResolvedValue(undefined),
    onSelectedKeyChange: vi.fn(),
    filterParams: { from: 'now-30d', to: 'now' },
    reloadToken: 0,
    forceList: false,
    onReleaseList: vi.fn(),
    ...over,
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
const mark = (host: string) => screen.findByRole('button', { name: new RegExp(`^${host}:`) });
const drawer = () => screen.findByRole('dialog', { name: 'Solo test on HOST-01' });

beforeEach(() => {
  vi.clearAllMocks();
  caps.coverageMatrix = true;
  caps.loaded = true;
  store.fail = false;
  localStorage.clear();
  api.getCoverageMatrix.mockResolvedValue(MATRIX);
  api.getGroupedPaginatedExecutions.mockResolvedValue(runs(['run-2', 'run-1']));
  api.lookupAcceptances.mockResolvedValue({});
  api.getCoverageMatrixHosts.mockResolvedValue({
    rows: 'hosts', windowLabel: '30d', testCount: 1, hostCount: 2, page: 1, pageSize: 25, truncated: false,
    tests: [{ key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts }],
    hosts: [
      { ...MATRIX.hosts[0], cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] },
      { ...MATRIX.hosts[1], cells: [{ i: 0, verdict: 'protected', at: '2026-01-11T09:00:00.000Z' }] },
    ],
  });
});

describe('which view', () => {
  it('shows the list alone, with no switch, on a server without the matrix', () => {
    caps.coverageMatrix = false;
    setup();

    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    expect(api.getCoverageMatrix).not.toHaveBeenCalled();
  });
  it('tells the page the list is on screen where the server has no matrix', () => {
    caps.coverageMatrix = false;
    const { props } = setup({ onViewChange: vi.fn() });

    expect(props.onViewChange).toHaveBeenLastCalledWith('list');
  });

  it('shows neither view until the server has said what it supports', () => {
    caps.loaded = false;
    const { props } = setup({ onViewChange: vi.fn() });

    expect(props.onViewChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId('list')).not.toBeInTheDocument();
    expect(api.getCoverageMatrix).not.toHaveBeenCalled();
  });

  it('opens on the matrix, with the scope the page gives', async () => {
    setup();

    expect(await screen.findByRole('heading', { name: 'Solo test' })).toBeInTheDocument();
    expect(screen.queryByTestId('list')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Matrix' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.getCoverageMatrix).toHaveBeenCalledWith({ from: 'now-30d', to: 'now' });
  });

  it('switches to the list, remembers it in this browser and writes it in the address', async () => {
    const user = userEvent.setup();
    const first = setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Solo test' })).not.toBeInTheDocument();
    expect(url()).toContain('view=list');
    expect(localStorage.getItem('achilles.executions.view')).toBe('list');

    first.unmount();
    setup();
    expect(screen.getByTestId('list')).toBeInTheDocument();
  });

  it('follows the address over the remembered choice', async () => {
    localStorage.setItem('achilles.executions.view', 'list');
    setup({}, '?tab=executions&view=matrix');

    expect(await screen.findByRole('heading', { name: 'Solo test' })).toBeInTheDocument();
  });

  it('shows the list when the page requires it, without forgetting the choice, and releases it on Matrix', async () => {
    const user = userEvent.setup();
    localStorage.setItem('achilles.executions.view', 'matrix');
    const { props, rerenderWith } = setup({ forceList: true, selectedKey: 'some-run' });

    expect(screen.getByTestId('list')).toHaveTextContent('selected some-run');
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('achilles.executions.view')).toBe('matrix');
    expect(api.getCoverageMatrix).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Matrix' }));
    expect(props.onReleaseList).toHaveBeenCalledTimes(1);

    rerenderWith({ forceList: false });
    expect(await screen.findByRole('heading', { name: 'Solo test' })).toBeInTheDocument();
  });

  it('works where the browser refuses storage', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(screen.getByTestId('list')).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('rows of tests or rows of hosts', () => {
  const rowsSwitch = () => within(screen.getByRole('group', { name: 'Rows' }));

  it('starts as rows of tests and turns to rows of hosts, in the address and for next time', async () => {
    const user = userEvent.setup();
    const first = setup();
    await screen.findByRole('heading', { name: 'Solo test' });
    expect(rowsSwitch().getByRole('button', { name: 'Tests' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.getCoverageMatrixHosts).not.toHaveBeenCalled();

    await user.click(rowsSwitch().getByRole('button', { name: 'Hosts' }));

    expect(await screen.findByRole('heading', { name: 'HOST-01' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Solo test' })).not.toBeInTheDocument();
    expect(api.getCoverageMatrixHosts).toHaveBeenCalledWith({ from: 'now-30d', to: 'now' }, { page: 1, pageSize: 25 });
    expect(url()).toContain('rows=hosts');
    expect(localStorage.getItem('achilles.executions.rows')).toBe('hosts');

    first.unmount();
    setup();
    expect(await screen.findByRole('heading', { name: 'HOST-01' })).toBeInTheDocument();
  });

  it('follows the address over the remembered choice', async () => {
    localStorage.setItem('achilles.executions.rows', 'hosts');
    setup({}, '?tab=executions&rows=tests');

    expect(await screen.findByRole('heading', { name: 'Solo test' })).toBeInTheDocument();
  });

  it('has no Rows switch in the list view', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(screen.queryByRole('group', { name: 'Rows' })).not.toBeInTheDocument();
  });

  it('opens a pair from a host\'s row: its runs under the row, the run in the drawer', async () => {
    const user = userEvent.setup();
    setup({}, '?tab=executions&rows=hosts');

    await user.click(await screen.findByRole('button', { name: /^Solo test: unprotected/ }));

    const row = screen.getByRole('heading', { name: 'HOST-01' }).closest('[data-matrix-row]') as HTMLElement;
    expect(await within(row).findByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();
    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-2');
    expect(api.getGroupedPaginatedExecutions).toHaveBeenCalledWith(expect.objectContaining({ testUuid: T1, hostnames: 'HOST-01', org: 'org-1' }));
  });

  it('closes the open pair when the matrix is turned', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    await drawer();
    await user.keyboard('{Escape}');

    await user.click(rowsSwitch().getByRole('button', { name: 'Hosts' }));

    await screen.findByRole('heading', { name: 'HOST-01' });
    expect(screen.queryByRole('group', { name: /Runs of/ })).not.toBeInTheDocument();
    expect(url()).not.toContain('pairTest');
  });

  it('reads the hosts again after a risk is accepted from the drawer', async () => {
    const user = userEvent.setup();
    setup({}, '?tab=executions&rows=hosts');
    await user.click(await screen.findByRole('button', { name: /^Solo test: unprotected/ }));
    const panel = await drawer();
    expect(api.getCoverageMatrixHosts).toHaveBeenCalledTimes(1);

    await user.click(within(panel).getByRole('button', { name: 'accept' }));
    await user.type(screen.getByPlaceholderText(/why this risk is being accepted/), 'not applicable on this host');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));

    await waitFor(() => expect(api.getCoverageMatrixHosts).toHaveBeenCalledTimes(2));
  });
});

describe('export and archive by date', () => {
  it('are above the matrix too: they act on the filters, not on a view', async () => {
    const user = userEvent.setup();
    const onFetchAllExecutions = vi.fn().mockResolvedValue({ executions: [], total: 0 });
    const onArchiveByDate = vi.fn().mockResolvedValue(undefined);
    setup({ onFetchAllExecutions, onArchiveByDate, reportHref: '/analytics/report?x=1' });
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(onFetchAllExecutions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Report (PDF)' })).toHaveAttribute('href', '/analytics/report?x=1');
    expect(screen.getByRole('button', { name: /Archive by date/ })).toBeInTheDocument();
  });

  it('reads the matrix again after an archive by date, and not when it failed', async () => {
    const user = userEvent.setup();
    const onArchiveByDate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(undefined);
    setup({ onArchiveByDate });
    await screen.findByRole('heading', { name: 'Solo test' });
    const archive = async () => {
      if (!screen.queryByLabelText('Archive all executions before:')) await user.click(screen.getByRole('button', { name: /Archive by date/ }));
      const date = screen.getByLabelText('Archive all executions before:');
      await user.clear(date);
      await user.type(date, '2026-01-15');
      await user.click(screen.getByRole('button', { name: 'Archive' }));
    };

    await archive();
    await waitFor(() => expect(onArchiveByDate).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(api.getCoverageMatrix).toHaveBeenCalledTimes(1);

    await archive();
    await waitFor(() => expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2));
  });

  it('passes the SB export, with its busy state, to the toolbar above the matrix', async () => {
    const user = userEvent.setup();
    const onExportSbReport = vi.fn().mockResolvedValue(undefined);
    const { rerenderWith } = setup({ onExportSbReport });
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'SB Export' }));
    expect(onExportSbReport).toHaveBeenCalledTimes(1);

    rerenderWith({ onExportSbReport, sbReportExporting: true });
    expect(screen.getByRole('button', { name: 'Exporting SB Export…' })).toBeDisabled();
  });

  it('are the list\'s own in the list view: one toolbar, never two', async () => {
    const user = userEvent.setup();
    setup({ onFetchAllExecutions: vi.fn(), onArchiveByDate: vi.fn() });
    await screen.findByRole('heading', { name: 'Solo test' });

    await user.click(screen.getByRole('button', { name: 'List' }));

    // The list here is a stand-in without a toolbar: nothing else may draw one.
    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive by date/ })).not.toBeInTheDocument();
  });
});

describe('a pair and its runs', () => {
  it('opens the pair of a clicked mark and its latest run in the drawer, and says so in the address', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await mark('HOST-01'));

    expect(await screen.findByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();
    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-2');
    expect(api.getGroupedPaginatedExecutions).toHaveBeenCalledWith(expect.objectContaining({ testUuid: T1, hostnames: 'HOST-01', org: 'org-1' }));
    expect(url()).toContain(`pairTest=${T1}`);
    expect(url()).toContain('pairHost=org-1|HOST-01');
    expect(url()).toContain('run=run-2');
    expect(prime).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'run-2' }));
  });

  it('opens the run the mark shows, not a newer run without a verdict above it', async () => {
    const user = userEvent.setup();
    // The mark is the latest conclusive result (12 Jan); a newer run that only errored sits above it.
    api.getGroupedPaginatedExecutions.mockResolvedValue({
      ...runs(['run-newer', 'run-shown']),
      groups: [group('run-newer', { timestamp: '2026-01-14T09:00:00.000Z', error_code: 999 }), group('run-shown', { timestamp: '2026-01-12T09:00:00.000Z' })],
    });
    setup();

    await user.click(await mark('HOST-01'));

    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-shown');
    expect(url()).toContain('run=run-shown');
  });

  it('opens the newest run when the one the mark shows is not among those loaded', async () => {
    const user = userEvent.setup();
    api.getGroupedPaginatedExecutions.mockResolvedValue(runs(['run-2', 'run-1'], { timestamp: '2026-01-01T09:00:00.000Z' }));
    setup();

    await user.click(await mark('HOST-01'));

    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-2');
  });

  it('names the drawer by the bundle for a chain run, and looks up acceptances for each of its stages', async () => {
    const user = userEvent.setup();
    const stage = (n: number) => exec({ test_uuid: `${T1}::T${n}`, test_name: `Chain A - Stage ${n}`, bundle_id: T1, bundle_name: 'Chain A', is_bundle_control: true, control_id: `T${n}`, timestamp: '2026-01-12T09:00:00.000Z' } as Partial<EnrichedTestExecution>);
    api.getGroupedPaginatedExecutions.mockResolvedValue({
      ...runs(['chain-run']),
      groups: [{ groupKey: 'chain-run', type: 'bundle', representative: stage(1), members: [stage(1), stage(2)], protectedCount: 0, unprotectedCount: 2, totalCount: 2 } as ExecutionGroup],
    });
    setup();

    await user.click(await mark('HOST-01'));

    expect(await screen.findByRole('dialog', { name: 'Chain A on HOST-01' })).toBeInTheDocument();
    await waitFor(() => expect(api.lookupAcceptances).toHaveBeenCalledWith(['Chain A - Stage 1', 'Chain A - Stage 2']));
  });

  it('tells the page which view is on screen', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    setup({ onViewChange });
    await screen.findByRole('heading', { name: 'Solo test' });
    expect(onViewChange).toHaveBeenLastCalledWith('matrix');

    await user.click(screen.getByRole('button', { name: 'List' }));

    expect(onViewChange).toHaveBeenLastCalledWith('list');
  });

  it('opens the same pair and run from an address', async () => {
    setup({}, `?tab=executions&pairTest=${T1}&pairHost=${encodeURIComponent('org-1|HOST-01')}&run=run-1`);

    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-1');
    expect(await mark('HOST-01')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closing the drawer keeps the pair open and does not reopen the run', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    await drawer();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();
    expect(url()).toContain(`pairTest=${T1}`);
    expect(url()).not.toContain('run=');
  });

  it('opens a run chosen in the list of runs', async () => {
    const user = userEvent.setup();
    setup({}, `?tab=executions&pairTest=${T1}&pairHost=${encodeURIComponent('org-1|HOST-01')}`);
    const list = await screen.findByRole('group', { name: 'Runs of Solo test on HOST-01' });
    const runButtons = () => within(list).getAllByRole('button', { name: /Protected|Unprotected/ });
    await waitFor(() => expect(runButtons()).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(runButtons()[1]);

    expect(within(await drawer()).getByTestId('detail')).toHaveTextContent('detail of run-1');
    expect(url()).toContain('run=run-1');
  });

  it('moves through the pair\'s runs with the arrows and stops at the ends', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    const panel = await drawer();
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus());
    expect(within(panel).getByRole('button', { name: 'Previous run' })).toBeDisabled();

    await user.keyboard('{ArrowDown}');
    expect(within(panel).getByTestId('detail')).toHaveTextContent('detail of run-1');
    expect(within(panel).getByRole('button', { name: 'Next run' })).toBeDisabled();
    await user.keyboard('{ArrowDown}');
    expect(within(panel).getByTestId('detail')).toHaveTextContent('detail of run-1');

    await user.keyboard('{ArrowUp}');
    expect(within(panel).getByTestId('detail')).toHaveTextContent('detail of run-2');
    expect(url()).toContain('run=run-2');
  });

  it('closing the pair closes its run too', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    await drawer();
    await user.keyboard('{Escape}');

    await user.click(await mark('HOST-01'));

    expect(screen.queryByRole('group', { name: /Runs of/ })).not.toBeInTheDocument();
    expect(url()).not.toContain('pairTest');
    expect(url()).not.toContain('pairHost');
  });

  it('opens another pair with its own latest run', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    await drawer();
    await user.keyboard('{Escape}');
    api.getGroupedPaginatedExecutions.mockResolvedValue(runs(['other-run'], { hostname: 'HOST-02' }));

    await user.click(await mark('HOST-02'));

    const panel = await screen.findByRole('dialog', { name: 'Solo test on HOST-02' });
    expect(within(panel).getByTestId('detail')).toHaveTextContent('detail of other-run');
    expect(url()).toContain('pairHost=org-1|HOST-02');
  });
});

describe('acting on a run from the drawer', () => {
  it('looks up the risk acceptances of the pair\'s tests', async () => {
    const user = userEvent.setup();
    api.lookupAcceptances.mockResolvedValue({ 'Solo test': [{ id: 'acc-1', test_name: 'Solo test', scope: 'global' }] });
    setup();

    await user.click(await mark('HOST-01'));

    expect(await within(await drawer()).findByText('accepted')).toBeInTheDocument();
    expect(api.lookupAcceptances).toHaveBeenCalledWith(['Solo test']);
  });

  it('accepts a risk, then reads the matrix, the runs and the acceptances again', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(await mark('HOST-01'));
    const panel = await drawer();
    expect(api.getCoverageMatrix).toHaveBeenCalledTimes(1);

    await user.click(within(panel).getByRole('button', { name: 'accept' }));
    await user.type(screen.getByPlaceholderText(/why this risk is being accepted/), 'not applicable on this host');
    await user.click(screen.getByRole('button', { name: 'Accept Risk' }));

    await waitFor(() => expect(props.onAcceptRisk).toHaveBeenCalledWith([{ test_name: 'Solo test', hostname: undefined, scope: 'global' }], 'not applicable on this host'));
    await waitFor(() => expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getGroupedPaginatedExecutions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.lookupAcceptances).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog', { name: 'Solo test on HOST-01' })).toBeInTheDocument();
  });

  it('leaves the drawer open, and its keys alone, while a dialog is over it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await mark('HOST-01'));
    const panel = await drawer();

    await user.click(within(panel).getByRole('button', { name: 'accept' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Solo test on HOST-01' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/why this risk is being accepted/)).toBeInTheDocument();
  });

  it('archives the open run, closes the drawer and reads the matrix again', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(await mark('HOST-01'));
    const panel = await drawer();

    await user.click(within(panel).getByRole('button', { name: 'archive' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(props.onArchive).toHaveBeenCalledWith(['run-2']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2));
    expect(url()).not.toContain('run=');
  });

  it('keeps the drawer open and reads nothing again when the archive failed', async () => {
    const user = userEvent.setup();
    const { props } = setup({ onArchive: vi.fn().mockResolvedValue(false) });
    await user.click(await mark('HOST-01'));
    const panel = await drawer();

    await user.click(within(panel).getByRole('button', { name: 'archive' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(props.onArchive).toHaveBeenCalledWith(['run-2']));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole('dialog', { name: 'Solo test on HOST-01', hidden: true })).toBeInTheDocument();
    expect(api.getCoverageMatrix).toHaveBeenCalledTimes(1);
    expect(url()).toContain('run=run-2');
  });

  it('reads the matrix again when the page asks (Refresh)', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'Solo test' });

    rerenderWith({ reloadToken: 1 });

    await waitFor(() => expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2));
  });
});
