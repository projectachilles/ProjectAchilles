import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';

// The runs of one test on one host, under the matrix row: latest first, each
// with the same verdict the List view gives it.

const { getGrouped } = vi.hoisted(() => ({ getGrouped: vi.fn() }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, getGroupedPaginatedExecutions: getGrouped } };
});

const { PairRuns } = await import('../PairRuns');
const { joinFilterList } = await import('@/lib/filterList');
type Props = Parameters<typeof PairRuns>[0];

const TEST = 'a0000000-1234-4abc-8def-000000000001';
const exec = (over: Partial<EnrichedTestExecution>): EnrichedTestExecution =>
  ({ test_uuid: TEST, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [], ...over }) as EnrichedTestExecution;
const solo = (key: string, over: Partial<EnrichedTestExecution>): ExecutionGroup =>
  ({ groupKey: key, type: 'standalone', representative: exec(over), members: [exec(over)], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }) as ExecutionGroup;
const stage = (n: number, code: number): EnrichedTestExecution =>
  exec({ test_uuid: `${TEST}::T${n}`, bundle_id: TEST, bundle_name: 'Chain A', is_bundle_control: true, control_id: `T${n}`, control_validator: `Stage ${n}`, error_code: code, is_protected: code === 126, category: 'intel-driven' } as Partial<EnrichedTestExecution>);
const chain = (key: string, codes: number[]): ExecutionGroup => {
  const members = codes.map((c, i) => stage(i + 1, c));
  return { groupKey: key, type: 'bundle', representative: members[0], members, protectedCount: codes.filter((c) => c === 126).length, unprotectedCount: codes.filter((c) => c === 101).length, totalCount: codes.length } as ExecutionGroup;
};
const page = (groups: ExecutionGroup[], over: Partial<GroupedPaginatedResponse['pagination']> = {}): GroupedPaginatedResponse => ({
  groups,
  pagination: { page: 1, pageSize: 25, totalGroups: groups.length, totalDocuments: groups.length, totalPages: 1, hasNext: false, hasPrevious: false, ...over },
});

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    scope: { from: 'now-30d', to: 'now', org: 'org-1', tests: 'Solo test', hostnames: 'HOST-01,HOST-02', result: 'unprotected', errorCodes: '101', errorNames: 'Unprotected', techniques: 'T1059', tags: 'x' },
    pair: { testUuid: TEST, hostKey: 'org-1|HOST-01' },
    testName: 'Solo test',
    hostname: 'HOST-01',
    org: 'org-1',
    selectedRunKey: null,
    onSelectRun: vi.fn(),
    onRunsLoaded: vi.fn(),
    onClose: vi.fn(),
    reloadToken: 0,
    ...over,
  };
  const view = render(<PairRuns {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<PairRuns {...props} {...next} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGrouped.mockResolvedValue(page([solo('run-2', { timestamp: '2026-01-12T09:00:00.000Z', error_code: 126, is_protected: true }), solo('run-1', {})]));
});

describe('PairRuns', () => {
  it('asks for that test on that host in the window, and nothing that narrows by outcome or by other filters', async () => {
    setup();
    await screen.findAllByRole('button', { name: /Protected|Unprotected/ });

    expect(getGrouped).toHaveBeenCalledTimes(1);
    expect(getGrouped).toHaveBeenCalledWith({
      from: 'now-30d', to: 'now', org: 'org-1', testUuid: TEST, hostnames: 'HOST-01', page: 1, pageSize: 25, sortField: 'routing.event_time', sortOrder: 'desc',
    });
  });

  it('uses the host\'s organization when the page has none selected', async () => {
    setup({ scope: { from: 'now-30d', to: 'now' }, org: 'org-7' });
    await screen.findAllByRole('button', { name: /Protected/ });

    expect(getGrouped.mock.calls[0][0]).toMatchObject({ org: 'org-7' });
  });

  it('sends no organization for a host without one', async () => {
    setup({ scope: { from: 'now-30d', to: 'now' }, org: null });
    await screen.findAllByRole('button', { name: /Protected/ });

    expect(getGrouped.mock.calls[0][0]).not.toHaveProperty('org');
  });

  it('lists the runs latest first, each with the List view\'s verdict, and reports them', async () => {
    const { props } = setup();

    const runs = await screen.findAllByRole('button', { name: /Protected|Unprotected/ });

    expect(screen.getByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();
    expect(runs.map((r) => r.textContent)).toEqual([expect.stringContaining('Protected'), expect.stringContaining('Unprotected')]);
    expect(runs[0]).toHaveTextContent('2026-01-12 ');
    expect(screen.getByText('2 runs in this window')).toBeInTheDocument();
    await waitFor(() => expect(props.onRunsLoaded).toHaveBeenCalled());
    expect((props.onRunsLoaded as ReturnType<typeof vi.fn>).mock.lastCall![0].map((r: { key: string }) => r.key)).toEqual(['run-2', 'run-1']);
  });

  it('draws a chain run\'s stages in order, with what each did in words', async () => {
    getGrouped.mockResolvedValue(page([chain('run-c', [101, 126, 0])]));
    setup({ testName: 'Chain A' });

    const stages = await screen.findByRole('img', { name: 'Stage 1 unprotected, stage 2 protected, stage 3 skipped' });

    expect(stages).toBeInTheDocument();
  });

  it('marks the selected run and hands a clicked one over', async () => {
    const user = userEvent.setup();
    const { props } = setup({ selectedRunKey: 'run-1' });
    const runs = await screen.findAllByRole('button', { name: /Protected|Unprotected/ });

    expect(runs.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true']);
    await user.click(runs[0]);

    expect(props.onSelectRun).toHaveBeenCalledWith(expect.objectContaining({ key: 'run-2', type: 'standalone' }));
  });

  it('loads the next page on request and appends it', async () => {
    const user = userEvent.setup();
    getGrouped
      .mockResolvedValueOnce(page([solo('run-3', {}), solo('run-2', {})], { totalGroups: 3, hasNext: true, totalPages: 2 }))
      .mockResolvedValueOnce(page([solo('run-1', {})], { page: 2, totalGroups: 3, hasPrevious: true, totalPages: 2 }));
    const { props } = setup();
    await screen.findAllByRole('button', { name: /Unprotected/ });

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    await waitFor(() => expect(screen.getAllByRole('button', { name: /Unprotected/ })).toHaveLength(3));
    expect(getGrouped.mock.calls[1][0]).toMatchObject({ page: 2 });
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
    expect((props.onRunsLoaded as ReturnType<typeof vi.fn>).mock.lastCall![0].map((r: { key: string }) => r.key)).toEqual(['run-3', 'run-2', 'run-1']);
  });

  it('can be closed from its own header', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await screen.findAllByRole('button', { name: /Protected|Unprotected/ });

    await user.click(screen.getByRole('button', { name: 'Close the runs of HOST-01' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('asks for a hostname that holds a comma as one hostname', async () => {
    setup({ hostname: 'odd,name', pair: { testUuid: TEST, hostKey: 'org-1|odd,name' } });
    await screen.findAllByRole('button', { name: /Protected|Unprotected/ });

    // The parameter is a comma-separated list: a bare comma would ask for two hosts.
    expect(getGrouped.mock.calls[0][0].hostnames).toBe(joinFilterList(['odd,name']));
    expect(getGrouped.mock.calls[0][0].hostnames).not.toBe('odd,name');
  });

  it('reports nothing once it is gone: a late answer is nobody\'s', async () => {
    let resolve!: (v: GroupedPaginatedResponse) => void;
    getGrouped.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { props, unmount } = setup();

    unmount();
    await act(async () => {
      resolve(page([solo('run-1', {})]));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(props.onRunsLoaded).not.toHaveBeenCalled();
  });

  it('on a reload reads again every page it has shown, and keeps all the runs', async () => {
    const user = userEvent.setup();
    getGrouped.mockImplementation((p: { page: number }) =>
      Promise.resolve(p.page === 1
        ? page([solo('run-3', {}), solo('run-2', {})], { totalGroups: 3, hasNext: true, totalPages: 2 })
        : page([solo('run-1', {})], { page: 2, totalGroups: 3, hasPrevious: true, totalPages: 2 })));
    const { props, rerenderWith } = setup();
    await screen.findAllByRole('button', { name: /Unprotected/ });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Unprotected/ })).toHaveLength(3));
    getGrouped.mockClear();

    rerenderWith({ reloadToken: 1 });

    await waitFor(() => expect(getGrouped.mock.calls.map((c) => c[0].page)).toEqual([1, 2]));
    expect(screen.getAllByRole('button', { name: /Unprotected/ })).toHaveLength(3);
    await waitFor(() => expect((props.onRunsLoaded as ReturnType<typeof vi.fn>).mock.lastCall![0].map((r: { key: string }) => r.key)).toEqual(['run-3', 'run-2', 'run-1']));
  });

  it('reads only the first page of another pair, however many pages the one before had shown', async () => {
    const user = userEvent.setup();
    getGrouped.mockImplementation((p: { page: number }) =>
      Promise.resolve(p.page === 1
        ? page([solo('run-3', {}), solo('run-2', {})], { totalGroups: 3, hasNext: true, totalPages: 2 })
        : page([solo('run-1', {})], { page: 2, totalGroups: 3, hasPrevious: true, totalPages: 2 })));
    const { rerenderWith } = setup();
    await screen.findAllByRole('button', { name: /Unprotected/ });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Unprotected/ })).toHaveLength(3));
    getGrouped.mockClear();

    rerenderWith({ pair: { testUuid: TEST, hostKey: 'org-1|HOST-02' }, hostname: 'HOST-02' });

    await waitFor(() => expect(getGrouped).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getGrouped.mock.calls.map((c) => [c[0].hostnames, c[0].page])).toEqual([['HOST-02', 1]]);
  });

  it('says when the pair has no run in the window', async () => {
    getGrouped.mockResolvedValue(page([]));
    setup();

    expect(await screen.findByText('No runs in this window')).toBeInTheDocument();
  });

  it('says when the request failed and asks again on request', async () => {
    const user = userEvent.setup();
    getGrouped.mockRejectedValueOnce(new Error('boom'));
    setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('The runs could not be loaded.');
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));

    expect(await screen.findAllByRole('button', { name: /Protected|Unprotected/ })).toHaveLength(2);
  });

  it('asks again for another pair and after a reload, and ignores a late answer for the earlier pair', async () => {
    let resolveFirst!: (v: GroupedPaginatedResponse) => void;
    getGrouped.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { rerenderWith } = setup();

    getGrouped.mockResolvedValue(page([solo('other-run', { hostname: 'HOST-02', error_code: 126, is_protected: true })]));
    rerenderWith({ pair: { testUuid: TEST, hostKey: 'org-1|HOST-02' }, hostname: 'HOST-02' });
    expect(await screen.findAllByRole('button', { name: /Protected/ })).toHaveLength(1);
    // The answer for HOST-01 arrives after HOST-02's: it must not replace HOST-02's run.
    await act(async () => {
      resolveFirst(page([solo('run-1', {}), solo('run-0', {})]));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getAllByRole('button', { name: /Protected|Unprotected/ })).toHaveLength(1);
    expect(getGrouped.mock.calls[1][0]).toMatchObject({ hostnames: 'HOST-02' });

    rerenderWith({ pair: { testUuid: TEST, hostKey: 'org-1|HOST-02' }, hostname: 'HOST-02', reloadToken: 1 });
    await waitFor(() => expect(getGrouped).toHaveBeenCalledTimes(3));
  });
});
