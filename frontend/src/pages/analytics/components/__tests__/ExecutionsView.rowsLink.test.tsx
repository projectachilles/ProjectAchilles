import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RunDetailPanelProps } from '../executions/detailParts';

const { caps, api } = vi.hoisted(() => ({
  caps: { coverageMatrix: true, testVersions: false, loaded: true as boolean },
  api: { getCoverageMatrix: vi.fn(), getCoverageMatrixHosts: vi.fn(), getGroupedPaginatedExecutions: vi.fn(), lookupAcceptances: vi.fn() },
}));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, ...api } };
});
vi.mock('../matrix/useElementWidth', () => ({ useElementWidth: () => [() => {}, 900] }));
vi.mock('../ExecutionsDataTable', () => ({ default: () => <div data-testid="list">the list</div> }));
vi.mock('../executions/useRunDetail', () => ({ useRunDetail: () => ({ panelProps: { showVersions: false }, prime: vi.fn(), collapseControls: vi.fn() }) }));
vi.mock('../executions/RunDetailPanel', () => ({ RunDetailPanel: (props: RunDetailPanelProps) => <div data-testid="detail">detail of {props.row?.key}</div> }));
const { default: ExecutionsView } = await import('../ExecutionsView');

const T1 = 'a0000000-1234-4abc-8def-000000000001';
const counts = { protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 };
const ratio = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const exec = { test_uuid: T1, test_name: 'Solo test', hostname: 'HOST-01', timestamp: '2026-01-10T09:00:00.000Z', error_code: 101, is_protected: false, techniques: [] };
const group = (key: string) => ({ groupKey: key, type: 'standalone', representative: exec, members: [exec], protectedCount: 0, unprotectedCount: 1, totalCount: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.lookupAcceptances.mockResolvedValue({});
  api.getGroupedPaginatedExecutions.mockResolvedValue({ groups: [group('run-2'), group('run-1')], pagination: { page: 1, pageSize: 25, totalGroups: 2, totalDocuments: 2, totalPages: 1, hasNext: false, hasPrevious: false } });
  api.getCoverageMatrixHosts.mockResolvedValue({
    rows: 'hosts', windowLabel: '30d', testCount: 1, hostCount: 1, page: 1, pageSize: 25, truncated: false,
    tests: [{ key: T1, testUuid: T1, name: 'Solo test', kind: 'test', counts }],
    hosts: [{ key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts, ratio, cells: [{ i: 0, verdict: 'unprotected', at: '2026-01-12T09:00:00.000Z' }] }],
  });
});

describe('a link to a run in rows of hosts (host on the first page)', () => {
  it('opens the pair under the host and the named run in the drawer, under a stored "list" and "tests"', async () => {
    localStorage.setItem('achilles.executions.view', 'list');
    localStorage.setItem('achilles.executions.rows', 'tests');
    render(
      <MemoryRouter initialEntries={[`/analytics?tab=executions&rows=hosts&pairTest=${T1}&pairHost=org-1%7CHOST-01&run=run-1`]}>
        <ExecutionsView data={null} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onSort={vi.fn()} filterParams={{ from: 'now-30d', to: 'now' }} reloadToken={0} forceList={false} onReleaseList={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('group', { name: 'Runs of Solo test on HOST-01' })).toBeInTheDocument();
    expect(await screen.findByTestId('detail')).toHaveTextContent('detail of run-1');
    expect(api.getCoverageMatrix).not.toHaveBeenCalled();
  });
});
