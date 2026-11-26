import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoverageMatrixHostsResponse, ExtendedFilterParams, MatrixCell, MatrixCounts, MatrixHostRow, MatrixTest } from '@/services/api/analytics';

// The matrix turned: one row per host, most exposed first, one mark per test.

const { getHosts, width } = vi.hoisted(() => ({ getHosts: vi.fn(), width: { value: 900 } }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, getCoverageMatrixHosts: getHosts } };
});
vi.mock('../useElementWidth', () => ({ useElementWidth: () => [() => {}, width.value] }));

const { HostRows } = await import('../HostRows');
type Props = Parameters<typeof HostRows>[0];

const NOW = Date.parse('2026-01-20T12:00:00Z');
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const counts = (c: Partial<MatrixCounts> = {}): MatrixCounts => ({ protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0, ...c });
const ratio0 = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const TESTS: MatrixTest[] = [
  { key: 'c1', testUuid: 'c1', name: 'Chain A', kind: 'chain', counts: counts() },
  { key: 't2', testUuid: 't2', name: 'Solo test', kind: 'test', counts: counts() },
  { key: 'b1', testUuid: 'b1', name: 'Baseline', kind: 'controls', counts: counts(), ratio: ratio0 },
];
const host = (n: number, cells: MatrixCell[], c: Partial<MatrixCounts> = {}): MatrixHostRow => ({
  key: `org-1|HOST-${n}`, hostname: `HOST-${n}`, org: 'org-1', counts: counts(c), ratio: ratio0, cells,
});
const answer = (hosts: MatrixHostRow[], over: Partial<CoverageMatrixHostsResponse> = {}): CoverageMatrixHostsResponse => ({
  rows: 'hosts', windowLabel: '30d', tests: TESTS, testCount: TESTS.length, hosts, hostCount: hosts.length, page: 1, pageSize: 25, truncated: false, ...over,
});
const FIRST = answer([
  host(1, [{ i: 0, verdict: 'unprotected', at: at(3) }, { i: 2, ratio: { compliant: 31, evaluated: 48, notAssessed: 0, accepted: 0 }, at: at(1) }], { unprotected: 1, neverRun: 1 }),
  host(2, [{ i: 0, verdict: 'protected', at: at(5), earlier: ['unprotected'] }, { i: 1, verdict: 'detected', at: at(2) }], { protected: 1, detected: 1, neverRun: 1 }),
]);

const PARAMS: ExtendedFilterParams = { from: 'now-30d', to: 'now' };
function setup(over: Partial<Props> = {}) {
  const props: Props = { params: PARAMS, reloadToken: 0, openPair: null, onOpenPair: vi.fn(), renderPair: () => null, now: NOW, ...over };
  const view = render(<HostRows {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<HostRows {...props} {...next} />) };
}
const rowOf = (hostname: string) => screen.getByRole('heading', { name: hostname }).closest('[data-matrix-row]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  width.value = 900;
  getHosts.mockResolvedValue(FIRST);
});

describe('rows of hosts', () => {
  it('asks for the first page of hosts with the scope only', async () => {
    setup({ params: { ...PARAMS, result: 'unprotected' } });
    await screen.findByRole('heading', { name: 'HOST-1' });

    expect(getHosts).toHaveBeenCalledTimes(1);
    expect(getHosts).toHaveBeenCalledWith(PARAMS, { page: 1, pageSize: 25 });
  });

  it('writes each host once, in the server\'s order, with what was caught on it', async () => {
    setup();

    const names = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);

    expect(names).toEqual(['HOST-1', 'HOST-2']);
    expect(screen.getByRole('heading', { name: 'HOST-1' })).toHaveAttribute('title', 'HOST-1');
    expect(within(rowOf('HOST-1')).getByText('caught on 0 of 1 test')).toBeInTheDocument();
    expect(within(rowOf('HOST-2')).getByText('caught on 2 of 2 tests')).toBeInTheDocument();
    expect(screen.getByText('2 hosts · 3 tests · latest result in 30d')).toBeInTheDocument();
  });

  it('draws a mark per test in the tests\' order, named by the test, empty where the host never ran it', async () => {
    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });

    const marks = within(rowOf('HOST-1')).getAllByTestId('matrix-mark');

    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Chain A: unprotected, 3 days ago',
      'Solo test: never run',
      'Baseline: 31 of 48 controls compliant, 1 day ago',
    ]);
    expect(marks.map((m) => m.tagName)).toEqual(['BUTTON', 'SPAN', 'BUTTON']);
    expect(within(rowOf('HOST-1')).getByRole('group', { name: 'HOST-1' })).toContainElement(marks[0]);
    expect(within(marks[2]).getByTestId('gauge-fill').style.width).toBe(`${(31 / 48) * 100}%`);
  });

  it('names the columns by the tests', async () => {
    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });

    expect(screen.getAllByTestId('matrix-column').map((c) => [c.textContent, c.getAttribute('title')])).toEqual([
      ['Chain A', 'Chain A'], ['Solo test', 'Solo test'], ['Baseline', 'Baseline'],
    ]);
  });

  it('takes the form the width per test gives, and never a bar', async () => {
    const tests = (n: number) => Array.from({ length: n }, (_, i): MatrixTest => ({ key: `t${i}`, testUuid: `t${i}`, name: `Test ${i}`, kind: 'test', counts: counts() }));
    const form = () => screen.getByTestId('matrix').getAttribute('data-form');

    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });
    expect(form()).toBe('tile'); // 3 tests in 900 px

    getHosts.mockResolvedValue(answer([host(1, [])], { tests: tests(30), testCount: 30 }));
    const thirty = setup({ params: { from: 'now-7d', to: 'now' } });
    await waitFor(() => expect(screen.getAllByTestId('matrix').at(-1)).toHaveAttribute('data-form', 'small'));
    thirty.unmount();

    getHosts.mockResolvedValue(answer([host(1, [])], { tests: tests(300), testCount: 300 }));
    setup({ params: { from: 'now-1d', to: 'now' } });
    // 3 px a test would be a bar in rows of tests; a host's tests stay squares and the strip scrolls.
    await waitFor(() => expect(screen.getAllByTestId('matrix').at(-1)).toHaveAttribute('data-form', 'squares'));
  });

  it('opens the pair of a clicked mark with the time of its result, and closes the open one', async () => {
    const user = userEvent.setup();
    const { props, rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    const second = () => within(rowOf('HOST-2')).getAllByTestId('matrix-mark')[1];

    await user.click(second());
    expect(props.onOpenPair).toHaveBeenLastCalledWith({ testUuid: 't2', hostKey: 'org-1|HOST-2' }, at(2));

    rerenderWith({ openPair: { testUuid: 't2', hostKey: 'org-1|HOST-2' } });
    expect(second()).toHaveAttribute('aria-expanded', 'true');
    // Only that test's mark, not the host's other marks.
    expect(within(rowOf('HOST-2')).getAllByTestId('matrix-mark')[0]).toHaveAttribute('aria-expanded', 'false');
    await user.click(second());
    expect(props.onOpenPair).toHaveBeenLastCalledWith(null);
  });

  it('shows the open pair\'s runs under its host\'s row only', async () => {
    const renderPair: Props['renderPair'] = (_pair, test, h) => <p>runs of {test.name} on {h.hostname}</p>;
    setup({ openPair: { testUuid: 'c1', hostKey: 'org-1|HOST-2' }, renderPair });
    await screen.findByRole('heading', { name: 'HOST-2' });

    expect(within(rowOf('HOST-2')).getByText('runs of Chain A on HOST-2')).toBeInTheDocument();
    expect(within(rowOf('HOST-1')).queryByText(/runs of/)).not.toBeInTheDocument();
    // Once: under its row, and not above the rows as for a host that is not loaded.
    expect(screen.getAllByText(/runs of/)).toHaveLength(1);
  });

  it('hands the open pair\'s own test to the runs, not the first test of the row', async () => {
    const renderPair = vi.fn<Props['renderPair']>((_pair, test, h) => <p>runs of {test.name} on {h.hostname}</p>);
    setup({ openPair: { testUuid: 't2', hostKey: 'org-1|HOST-2' }, renderPair });
    await screen.findByRole('heading', { name: 'HOST-2' });

    expect(within(rowOf('HOST-2')).getByText('runs of Solo test on HOST-2')).toBeInTheDocument();
  });

  it('shows the runs above the rows when the open pair\'s host is not on a loaded page', async () => {
    const renderPair = vi.fn<Props['renderPair']>((_pair, test, h) => <p>runs of {test.name} on {h.hostname} ({h.org})</p>);
    setup({ openPair: { testUuid: 'c1', hostKey: 'org-1|HOST-77' }, renderPair });
    await screen.findByRole('heading', { name: 'HOST-1' });

    const stray = screen.getByText('runs of Chain A on HOST-77 (org-1)');
    expect(stray.compareDocumentPosition(screen.getByRole('heading', { name: 'HOST-1' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stray.closest('[data-matrix-row]')).toBeNull();
  });

  it('keeps "Show more" in place while its page loads, and takes no second click', async () => {
    const user = userEvent.setup();
    let resolveMore!: (v: CoverageMatrixHostsResponse) => void;
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockReturnValueOnce(new Promise((r) => { resolveMore = r; }));
    setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    const more = screen.getByRole('button', { name: 'Show 1 more' });

    await user.click(more);
    await user.click(more);

    expect(more).toBeInTheDocument();
    expect(more).toHaveAttribute('aria-disabled', 'true');
    expect(more).toHaveFocus();
    expect(getHosts).toHaveBeenCalledTimes(2);
    await act(async () => resolveMore(answer([host(3, [])], { hostCount: 3, page: 2 })));
    expect(screen.getByRole('heading', { name: 'HOST-3' })).toBeInTheDocument();
  });

  it('says when a further page could not be loaded, keeps the rows, and tries that page again', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2 }));
    setup();
    await screen.findByRole('heading', { name: 'HOST-2' });

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('More hosts could not be loaded.');
    expect(screen.getByRole('heading', { name: 'HOST-1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'HOST-3' })).toBeInTheDocument();
    expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 2]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the mark under the focus in every form: a tile shows only the start of a test\'s name', async () => {
    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });
    expect(screen.getByTestId('matrix')).toHaveAttribute('data-form', 'tile');

    within(rowOf('HOST-1')).getAllByRole('button')[0].focus();

    expect(screen.getByTestId('matrix-hint')).toHaveTextContent('HOST-1 · Chain A: unprotected, 3 days ago');
  });

  it('reads every page again when a further page has other tests than the rows on screen', async () => {
    const user = userEvent.setup();
    const extra: MatrixTest = { key: 'new', testUuid: 'new', name: 'New test', kind: 'test', counts: counts() };
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      // A test was added since: these columns are not the ones the first rows were drawn for.
      .mockResolvedValueOnce(answer([host(3, [{ i: 3, verdict: 'unprotected', at: at(1) }])], { hostCount: 3, page: 2, tests: [...TESTS, extra], testCount: 4 }))
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3, tests: [...TESTS, extra], testCount: 4 }))
      .mockResolvedValueOnce(answer([host(3, [{ i: 3, verdict: 'unprotected', at: at(1) }])], { hostCount: 3, page: 2, tests: [...TESTS, extra], testCount: 4 }));
    setup();
    await screen.findByRole('heading', { name: 'HOST-2' });

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    await waitFor(() => expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 1, 2]));
    await screen.findByRole('heading', { name: 'HOST-3' });
    expect(within(rowOf('HOST-1')).getAllByTestId('matrix-mark')).toHaveLength(4);
    expect(within(rowOf('HOST-3')).getByRole('button')).toHaveAccessibleName('New test: unprotected, 1 day ago');
  });

  it('on a reload, reads once more when its pages disagree on the tests', async () => {
    const user = userEvent.setup();
    const extra: MatrixTest = { key: 'new', testUuid: 'new', name: 'New test', kind: 'test', counts: counts() };
    const wide = { tests: [...TESTS, extra], testCount: 4 };
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2 }));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-3' });
    getHosts.mockClear();
    getHosts
      // The server's snapshot changed between the two pages of the reload.
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2, ...wide }))
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3, ...wide }))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2, ...wide }));

    rerenderWith({ reloadToken: 1 });

    await waitFor(() => expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 1, 2]));
    await waitFor(() => expect(within(rowOf('HOST-1')).getAllByTestId('matrix-mark')).toHaveLength(4));
  });

  it('stops asking for a page of hosts that no longer exists', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2 }));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-3' });
    // HOST-3's results were archived: one page is left.
    getHosts.mockImplementation((_scope: unknown, view: { page: number }) =>
      Promise.resolve(view.page === 1 ? answer(FIRST.hosts) : answer([], { page: 2, hostCount: 2 })));
    getHosts.mockClear();

    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1, 2]));
    getHosts.mockClear();
    rerenderWith({ reloadToken: 2 });

    await waitFor(() => expect(getHosts).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1]);
  });

  it('loads the next page on request and keeps the hosts it has', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockResolvedValueOnce(answer([host(3, [])], { hostCount: 3, page: 2 }));
    setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    // The count is the fleet's, not the number of rows loaded so far.
    expect(screen.getByText('3 hosts · 3 tests · latest result in 30d')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    expect(await screen.findByRole('heading', { name: 'HOST-3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'HOST-1' })).toBeInTheDocument();
    expect(getHosts.mock.calls[1][1]).toEqual({ page: 2, pageSize: 25 });
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
    expect(screen.getByText('3 hosts · 3 tests · latest result in 30d')).toBeInTheDocument();
  });

  it('starts over from the first page for another scope, and drops a late page of the old one', async () => {
    const user = userEvent.setup();
    let resolveSecond!: (v: CoverageMatrixHostsResponse) => void;
    getHosts
      .mockResolvedValueOnce(answer(FIRST.hosts, { hostCount: 3 }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    getHosts.mockResolvedValue(answer([host(9, [])]));
    rerenderWith({ params: { from: 'now-7d', to: 'now' } });
    expect(await screen.findByRole('heading', { name: 'HOST-9' })).toBeInTheDocument();
    await act(async () => {
      resolveSecond(answer([host(3, [])], { hostCount: 3, page: 2 }));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.queryByRole('heading', { name: 'HOST-3' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'HOST-1' })).not.toBeInTheDocument();
    expect(getHosts.mock.lastCall![1]).toEqual({ page: 1, pageSize: 25 });
  });

  it('never shows another scope\'s hosts as this one\'s, and reads only the first page of the new one', async () => {
    const user = userEvent.setup();
    getHosts.mockImplementation((_scope: unknown, view: { page: number }) =>
      Promise.resolve(view.page === 1 ? answer(FIRST.hosts, { hostCount: 3 }) : answer([host(3, [])], { hostCount: 3, page: 2 })));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-3' });
    getHosts.mockClear();
    let resolveNew!: (v: CoverageMatrixHostsResponse) => void;
    getHosts.mockReturnValue(new Promise((r) => { resolveNew = r; }));

    rerenderWith({ params: { from: 'now-7d', to: 'now' } });

    // At once: the old rows are gone, and it says it is loading.
    expect(screen.queryByRole('heading', { name: 'HOST-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the matrix…');
    await act(async () => resolveNew(answer([host(9, [])])));
    expect(screen.getByRole('heading', { name: 'HOST-9' })).toBeInTheDocument();
    expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1]);
  });

  it('drops the first page of an old scope when it answers after the new one', async () => {
    let resolveOld!: (v: CoverageMatrixHostsResponse) => void;
    getHosts.mockReturnValueOnce(new Promise((r) => { resolveOld = r; }));
    const { rerenderWith } = setup();
    getHosts.mockResolvedValue(answer([host(9, [])]));

    rerenderWith({ params: { from: 'now-7d', to: 'now' } });
    await screen.findByRole('heading', { name: 'HOST-9' });
    await act(async () => {
      resolveOld(FIRST);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['HOST-9']);
  });

  it('on a reload reads again every page it has, and keeps the rows meanwhile', async () => {
    const user = userEvent.setup();
    getHosts.mockImplementation((_scope: unknown, view: { page: number }) =>
      Promise.resolve(view.page === 1 ? answer(FIRST.hosts, { hostCount: 3 }) : answer([host(3, [])], { hostCount: 3, page: 2 })));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-3' });
    getHosts.mockClear();

    rerenderWith({ reloadToken: 1 });

    expect(screen.getByRole('heading', { name: 'HOST-3' })).toBeInTheDocument();
    await waitFor(() => expect(getHosts.mock.calls.map((c) => c[1].page)).toEqual([1, 2]));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('says it is loading, when the window holds nothing, when it failed, and when tests are left out', async () => {
    const user = userEvent.setup();
    getHosts.mockReturnValueOnce(new Promise(() => {}));
    const loading = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the matrix…');
    loading.unmount();

    getHosts.mockResolvedValueOnce(answer([], { tests: [], testCount: 0 }));
    const empty = setup();
    expect(await screen.findByText('No results in this window')).toBeInTheDocument();
    empty.unmount();

    getHosts.mockResolvedValueOnce(answer(FIRST.hosts, { testCount: 512, truncated: true }));
    const cut = setup();
    expect(await screen.findByText('Showing 3 of 512 tests')).toBeInTheDocument();
    cut.unmount();

    getHosts.mockRejectedValueOnce(new Error('boom'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('The matrix could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'HOST-1' })).toBeInTheDocument();
  });

  it('is one stop for the Tab key, with arrows along a host\'s tests and between hosts in the same test\'s column', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    const [h1chain, h1baseline] = within(rowOf('HOST-1')).getAllByRole('button');
    const [h2chain, h2solo] = within(rowOf('HOST-2')).getAllByRole('button');

    expect([h1chain, h1baseline, h2chain, h2solo].map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    h1chain.focus();
    await user.keyboard('{ArrowDown}');
    expect(h2chain).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(h2solo).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // HOST-1 never ran the solo test: stays
    expect(h2solo).toHaveFocus();
    h1baseline.focus();
    await user.keyboard('{ArrowRight}'); // the end of HOST-1's row: it does not run on into HOST-2's
    expect(h1baseline).toHaveFocus();
  });

  it('writes out the mark under the focus where marks are too small to carry text', async () => {
    const tests = Array.from({ length: 80 }, (_, i): MatrixTest => ({ key: `t${i}`, testUuid: `t${i}`, name: `Test ${i}`, kind: 'test', counts: counts() }));
    getHosts.mockResolvedValue(answer([host(1, [{ i: 7, verdict: 'unprotected', at: at(2) }])], { tests, testCount: 80 }));
    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });

    within(rowOf('HOST-1')).getByRole('button').focus();

    expect(screen.getByTestId('matrix-hint')).toHaveTextContent('HOST-1 · Test 7: unprotected, 2 days ago');
  });
});
