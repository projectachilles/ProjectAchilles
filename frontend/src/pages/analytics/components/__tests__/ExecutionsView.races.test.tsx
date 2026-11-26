import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CoverageMatrixTestsResponse, EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';
import type { RunDetailPanelProps } from '../executions/detailParts';

// Races between a pair's late answer and what the user did meanwhile (from the branch review).

const { caps, api, prime, collapse } = vi.hoisted(() => ({
  caps: { coverageMatrix: true, testVersions: false, loaded: true as boolean },
  api: { getCoverageMatrix: vi.fn(), getGroupedPaginatedExecutions: vi.fn(), lookupAcceptances: vi.fn() },
  prime: vi.fn(),
  collapse: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, ...api } };
});
vi.mock('../matrix/useElementWidth', () => ({ useElementWidth: () => [() => {}, 900] }));
vi.mock('../ExecutionsDataTable', () => ({ default: () => <div data-testid="list">the list</div> }));
vi.mock('../executions/useRunDetail', () => ({
  useRunDetail: () => ({ panelProps: { showVersions: false }, prime, collapseControls: collapse }),
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
  rows: 'tests', windowLabel: '30d', hostCount: 1, testCount: 2, cellsIncluded: true, truncated: false,
  hosts: [{ key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio }],
  tests: [
    { key: T1, testUuid: T1, name: 'First test', kind: 'test', counts: { ...counts, unprotected: 1 }, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] },
    { key: T2, testUuid: T2, name: 'Second test', kind: 'test', counts: { ...counts, protected: 1 }, cells: [{ i: 0, verdict: 'protected', at: '2026-01-12T09:00:00.000Z' }] },
  ],
};
const exec = (uuid: string, name: string): EnrichedTestExecution =>
  ({ test_uuid: uuid, test_name: name, hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [] }) as unknown as EnrichedTestExecution;
const runs = (key: string, uuid: string, name: string): GroupedPaginatedResponse => ({
  groups: [{ groupKey: key, type: 'standalone', representative: exec(uuid, name), members: [exec(uuid, name)], protectedCount: 0, unprotectedCount: 1, totalCount: 1 } as ExecutionGroup],
  pagination: { page: 1, pageSize: 25, totalGroups: 1, totalDocuments: 1, totalPages: 1, hasNext: false, hasPrevious: false },
});

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(search)}</output>;
}
const url = () => screen.getByTestId('url').textContent ?? '';

function setup(search = '?tab=executions') {
  const props: Props = {
    data: null, onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onSort: vi.fn(),
    onArchive: vi.fn().mockResolvedValue(undefined), onAcceptRisk: vi.fn().mockResolvedValue(undefined), onRevokeRisk: vi.fn().mockResolvedValue(undefined),
    filterParams: { from: 'now-30d', to: 'now' }, reloadToken: 0, forceList: false, onReleaseList: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={[`/analytics${search}`]}>
      <ExecutionsView {...props} />
      <Probe />
    </MemoryRouter>,
  );
}

/** One deferred answer per test uuid. */
function deferredRuns() {
  const resolvers: Record<string, () => void> = {};
  api.getGroupedPaginatedExecutions.mockImplementation((params: { testUuid: string }) =>
    new Promise<GroupedPaginatedResponse>((resolve) => {
      resolvers[params.testUuid] = () =>
        resolve(params.testUuid === T1 ? runs('first-run', T1, 'First test') : runs('second-run', T2, 'Second test'));
    }));
  return resolvers;
}
const markOf = async (testName: string) => {
  const heading = await screen.findByRole('heading', { name: testName });
  const row = heading.closest('[data-matrix-row]') as HTMLElement;
  return within(row).getByRole('button', { name: /^HOST-01:/ });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getCoverageMatrix.mockResolvedValue(MATRIX);
  api.lookupAcceptances.mockResolvedValue({});
});

describe('a late answer of a pair that is no longer open', () => {
  it('second pair answers last: the drawer never shows a run of the first pair', async () => {
    const user = userEvent.setup();
    const answer = deferredRuns();
    setup();

    await user.click(await markOf('First test'));
    await user.click(await markOf('Second test'));
    expect(url()).toContain(`pairTest=${T2}`);

    await act(async () => { answer[T1](); });

    // The first pair's answer arrives while the second pair is the open one.
    expect(screen.queryByRole('dialog', { name: 'First test on HOST-01' })).not.toBeInTheDocument();
    expect(url()).not.toContain('run=first-run');

    await act(async () => { answer[T2](); });
    expect(await screen.findByRole('dialog', { name: 'Second test on HOST-01' })).toBeInTheDocument();
  });

  it('first pair answers last: the second pair keeps its drawer and its runs stay selectable', async () => {
    const user = userEvent.setup();
    const answer = deferredRuns();
    setup();

    await user.click(await markOf('First test'));
    await user.click(await markOf('Second test'));
    await act(async () => { answer[T2](); });
    expect(await screen.findByRole('dialog', { name: 'Second test on HOST-01' })).toBeInTheDocument();

    await act(async () => { answer[T1](); });

    expect(screen.getByRole('dialog', { name: 'Second test on HOST-01' })).toBeInTheDocument();
  });

  it('a pair closed while loading asks for no acceptances afterwards', async () => {
    const user = userEvent.setup();
    const answer = deferredRuns();
    setup();

    await user.click(await markOf('First test'));
    await user.click(await markOf('First test')); // close it
    await act(async () => { answer[T1](); });

    await waitFor(() => expect(url()).not.toContain('pairTest'));
    expect(api.lookupAcceptances).not.toHaveBeenCalled();
  });

  it('switching to the list while a pair loads leaves no pair or run in the address', async () => {
    const user = userEvent.setup();
    const answer = deferredRuns();
    setup();

    await user.click(await markOf('First test'));
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(url()).toContain('view=list');
    expect(url()).not.toContain('pairTest');

    await act(async () => { answer[T1](); });

    expect(url()).toContain('view=list');
    expect(url()).not.toContain('pairTest');
    expect(url()).not.toContain('run=');
  });
});

describe('the open stage', () => {
  it('is closed when another pair is opened by a click', async () => {
    const user = userEvent.setup();
    api.getGroupedPaginatedExecutions.mockImplementation((params: { testUuid: string }) =>
      Promise.resolve(params.testUuid === T1 ? runs('first-run', T1, 'First test') : runs('second-run', T2, 'Second test')));
    setup();

    await user.click(await markOf('First test'));
    await screen.findByRole('dialog', { name: 'First test on HOST-01' });
    await user.keyboard('{Escape}');
    collapse.mockClear();

    await user.click(await markOf('Second test'));
    await screen.findByRole('dialog', { name: 'Second test on HOST-01' });

    expect(collapse).toHaveBeenCalled();
  });
});
