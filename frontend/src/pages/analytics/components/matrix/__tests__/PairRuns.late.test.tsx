import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';

// A pair's runs: late answers and reloads after "Show more" (from the branch review).

const { getGrouped } = vi.hoisted(() => ({ getGrouped: vi.fn() }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, getGroupedPaginatedExecutions: getGrouped } };
});

const { PairRuns } = await import('../PairRuns');
type Props = Parameters<typeof PairRuns>[0];

const TEST = 'a0000000-1234-4abc-8def-000000000001';
const exec = (over: Partial<EnrichedTestExecution>): EnrichedTestExecution =>
  ({ test_uuid: TEST, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [], ...over }) as EnrichedTestExecution;
const solo = (key: string): ExecutionGroup =>
  ({ groupKey: key, type: 'standalone', representative: exec({}), members: [exec({})], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }) as ExecutionGroup;
const page = (groups: ExecutionGroup[], over: Partial<GroupedPaginatedResponse['pagination']> = {}): GroupedPaginatedResponse => ({
  groups,
  pagination: { page: 1, pageSize: 25, totalGroups: groups.length, totalDocuments: groups.length, totalPages: 1, hasNext: false, hasPrevious: false, ...over },
});

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    scope: { from: 'now-30d', to: 'now', org: 'org-1' },
    pair: { testUuid: TEST, hostKey: 'org-1|HOST-01' },
    testName: 'Solo test', hostname: 'HOST-01', org: 'org-1', selectedRunKey: null,
    onSelectRun: vi.fn(), onRunsLoaded: vi.fn(), onClose: vi.fn(), reloadToken: 0, ...over,
  };
  const view = render(<PairRuns {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<PairRuns {...props} {...next} />) };
}

beforeEach(() => vi.clearAllMocks());

describe('a late "Show more"', () => {
  it('reports nothing after the pair was closed (the list is gone)', async () => {
    const user = userEvent.setup();
    let resolveMore!: (v: GroupedPaginatedResponse) => void;
    getGrouped
      .mockResolvedValueOnce(page([solo('run-3'), solo('run-2')], { totalGroups: 3 }))
      .mockReturnValueOnce(new Promise((r) => { resolveMore = r; }));
    const { props, unmount } = setup();
    await screen.findAllByRole('button', { name: /Unprotected/ });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    const before = (props.onRunsLoaded as ReturnType<typeof vi.fn>).mock.calls.length;

    unmount(); // the pair was closed, or another pair in another row was opened
    await act(async () => {
      resolveMore(page([solo('run-1')], { page: 2, totalGroups: 3 }));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect((props.onRunsLoaded as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('for comparison: a late first page is dropped after the pair was closed', async () => {
    let resolveFirst!: (v: GroupedPaginatedResponse) => void;
    getGrouped.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { props, unmount } = setup();

    unmount();
    await act(async () => {
      resolveFirst(page([solo('run-1')]));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(props.onRunsLoaded).not.toHaveBeenCalled();
  });
});

describe('reload request counts', () => {
  it('stops asking for a page that no longer exists', async () => {
    const user = userEvent.setup();
    getGrouped.mockImplementation((p: { page: number }) =>
      Promise.resolve(p.page === 1 ? page([solo('run-3'), solo('run-2')], { totalGroups: 3 }) : page([solo('run-1')], { page: 2, totalGroups: 3 })));
    const { rerenderWith } = setup();
    await screen.findAllByRole('button', { name: /Unprotected/ });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Unprotected/ })).toHaveLength(3));

    // One run was archived: one page is left.
    getGrouped.mockImplementation((p: { page: number }) => Promise.resolve(p.page === 1 ? page([solo('run-3'), solo('run-2')]) : page([], { page: 2, totalGroups: 2 })));
    getGrouped.mockClear();
    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(getGrouped).toHaveBeenCalledTimes(2));
    getGrouped.mockClear();
    rerenderWith({ reloadToken: 2 });
    await waitFor(() => expect(getGrouped).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    // The page that no longer exists is not asked for again.
    expect(getGrouped.mock.calls.map((c) => c[0].page)).toEqual([1]);
  });
});
