import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CoverageMatrixTestsResponse, EnrichedTestExecution, ExecutionGroup, GroupedPaginatedResponse } from '@/services/api/analytics';
import type { RunDetailPanelProps } from '../executions/detailParts';

// Links to a pair, and a bar segment's host list across reloads and an opened host (from the branch review).

const { caps, api, width } = vi.hoisted(() => ({
  caps: { coverageMatrix: true, testVersions: false, loaded: true as boolean },
  api: { getCoverageMatrix: vi.fn(), getCoverageMatrixHosts: vi.fn(), getGroupedPaginatedExecutions: vi.fn(), lookupAcceptances: vi.fn() },
  width: { value: 900 },
}));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, ...api } };
});
vi.mock('../matrix/useElementWidth', () => ({ useElementWidth: () => [() => {}, width.value] }));
vi.mock('../ExecutionsDataTable', () => ({ default: () => <div data-testid="list">the list</div> }));
vi.mock('../executions/useRunDetail', () => ({
  useRunDetail: () => ({ panelProps: { showVersions: false }, prime: vi.fn(), collapseControls: vi.fn() }),
}));
vi.mock('../executions/RunDetailPanel', () => ({
  RunDetailPanel: (props: RunDetailPanelProps) => (
    <div data-testid="detail">
      detail of {props.row?.key}
      <button onClick={() => props.onRequestAcceptRisk([{ test_name: 'Solo test', hostname: 'HOST-01' }])}>accept</button>
    </div>
  ),
}));

const { default: ExecutionsView } = await import('../ExecutionsView');
type Props = Parameters<typeof ExecutionsView>[0];

const T1 = 'a0000000-1234-4abc-8def-000000000001';
const counts = { protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 };
const ratio = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const MATRIX: CoverageMatrixTestsResponse = {
  rows: 'tests', windowLabel: '30d', hostCount: 1, testCount: 1, cellsIncluded: true, truncated: false,
  hosts: [{ key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio }],
  tests: [{ key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts: { ...counts, unprotected: 1 }, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] }],
};
const exec = (): EnrichedTestExecution =>
  ({ test_uuid: T1, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [] }) as unknown as EnrichedTestExecution;
const page = (keys: string[], total: number, n: number): GroupedPaginatedResponse => ({
  groups: keys.map((k) => ({ groupKey: k, type: 'standalone', representative: exec(), members: [exec()], protectedCount: 0, unprotectedCount: 1, totalCount: 1 }) as ExecutionGroup),
  pagination: { page: n, pageSize: 25, totalGroups: total, totalDocuments: total, totalPages: Math.ceil(total / 25), hasNext: n * 25 < total, hasPrevious: n > 1 },
});

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(search)}</output>;
}
const url = () => screen.getByTestId('url').textContent ?? '';

function setup(search = '?tab=executions', over: Partial<Props> = {}) {
  const props: Props = {
    data: null, onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onSort: vi.fn(),
    onArchive: vi.fn().mockResolvedValue(undefined), onAcceptRisk: vi.fn().mockResolvedValue(undefined), onRevokeRisk: vi.fn().mockResolvedValue(undefined),
    filterParams: { from: 'now-30d', to: 'now' }, reloadToken: 0, forceList: false, onReleaseList: vi.fn(), ...over,
  };
  const ui = (p: Props) => (
    <MemoryRouter initialEntries={[`/analytics${search}`]}>
      <ExecutionsView {...p} />
      <Probe />
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { ...view, rerenderWith: (next: Partial<Props>) => view.rerender(ui({ ...props, ...next })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  width.value = 900;
  api.getCoverageMatrix.mockResolvedValue(MATRIX);
  api.lookupAcceptances.mockResolvedValue({});
});

describe('a link to a pair and a run', () => {
  it('reopens them for someone whose last choice was the list', async () => {
    localStorage.setItem('achilles.executions.view', 'list');
    api.getGroupedPaginatedExecutions.mockResolvedValue(page(['run-2', 'run-1'], 2, 1));
    // The address a default-view user gets after clicking a mark: no view= in it.
    setup(`?tab=executions&pairTest=${T1}&pairHost=${encodeURIComponent('org-1|HOST-01')}&run=run-1`);

    expect(await screen.findByRole('dialog', { name: 'Solo test on HOST-01' })).toBeInTheDocument();
  });

  it('a click on a mark writes the view in the address, so the link is the matrix for everyone', async () => {
    const user = userEvent.setup();
    api.getGroupedPaginatedExecutions.mockResolvedValue(page(['run-2', 'run-1'], 2, 1));
    setup();
    await user.click(await screen.findByRole('button', { name: /^HOST-01:/ }));
    await screen.findByRole('dialog', { name: 'Solo test on HOST-01' });

    expect(url()).toContain('view=matrix');
  });
});

describe('a segment\'s host list', () => {
  it('is read again when the page reloads (Refresh)', async () => {
    const user = userEvent.setup();
    api.getCoverageMatrix.mockResolvedValue({ ...MATRIX, hosts: [], hostCount: 400, cellsIncluded: false, tests: [{ ...MATRIX.tests[0], cells: null }] });
    api.getCoverageMatrixHosts.mockResolvedValue({
      rows: 'hosts', windowLabel: '30d', tests: [], testCount: 1, hostCount: 1, page: 1, pageSize: 25, truncated: false,
      hosts: [{ key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] }],
    });
    const { rerenderWith } = setup();
    await user.click(await screen.findByRole('button', { name: '1 unprotected' }));
    await waitFor(() => expect(api.getCoverageMatrixHosts).toHaveBeenCalledTimes(1));

    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(api.getCoverageMatrix).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));

    expect(api.getCoverageMatrixHosts).toHaveBeenCalledTimes(2);
  });

  it('can be returned to after a host was opened from it', async () => {
    const user = userEvent.setup();
    api.getCoverageMatrix.mockResolvedValue({ ...MATRIX, hosts: [], hostCount: 400, cellsIncluded: false, tests: [{ ...MATRIX.tests[0], cells: null }] });
    api.getCoverageMatrixHosts.mockResolvedValue({
      rows: 'hosts', windowLabel: '30d', tests: [], testCount: 1, hostCount: 1, page: 1, pageSize: 25, truncated: false,
      hosts: [{ key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] }],
    });
    api.getGroupedPaginatedExecutions.mockResolvedValue(page(['run-1'], 1, 1));
    setup();
    await user.click(await screen.findByRole('button', { name: '1 unprotected' }));
    await user.click(await screen.findByRole('button', { name: /^HOST-01:/ }));
    await screen.findByRole('dialog', { name: 'Solo test on HOST-01' });
    await user.keyboard('{Escape}');

    // The runs opened under the host list, not in its place: the list is still there to pick another host.
    const row = screen.getByRole('heading', { name: 'Solo test' }).closest('[data-matrix-row]') as HTMLElement;
    expect(within(row).getByRole('group', { name: /host unprotected on Solo test/ })).toBeInTheDocument();
    expect(within(row).getByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Close the runs of HOST-01' }));

    expect(within(row).queryByRole('group', { name: /Runs of/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('group', { name: /host unprotected on Solo test/ })).toBeInTheDocument();
    expect(url()).not.toContain('pairTest');
  });
});
