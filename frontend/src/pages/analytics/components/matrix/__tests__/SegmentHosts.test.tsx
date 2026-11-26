import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoverageMatrixHostsResponse, MatrixHostRow, MatrixTest } from '@/services/api/analytics';

// The hosts behind one segment of a test's bar: where the fleet is too large
// to draw a mark per host, this is how one host is reached.

const { getHosts } = vi.hoisted(() => ({ getHosts: vi.fn() }));
vi.mock('@/services/api/analytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/analytics')>('@/services/api/analytics');
  return { ...actual, analyticsApi: { ...actual.analyticsApi, getCoverageMatrixHosts: getHosts } };
});

const { SegmentHosts } = await import('../SegmentHosts');

const NOW = Date.parse('2026-01-20T12:00:00Z');
const counts = { protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 };
const TEST: MatrixTest = { key: 't1', testUuid: 't1', name: 'Solo test', kind: 'test', counts: { ...counts, unprotected: 27 } };
const host = (n: number, daysAgo = 2, earlier?: MatrixHostRow['cells'][0]['earlier']): MatrixHostRow => ({
  key: `org-1|HOST-${n}`, hostname: `HOST-${n}`, org: 'org-1', counts, ratio: { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 },
  cells: [{ i: 0, verdict: 'unprotected', at: new Date(NOW - daysAgo * 86_400_000).toISOString(), ...(earlier ? { earlier } : {}) }],
});
const answer = (hosts: MatrixHostRow[], hostCount: number, page = 1): CoverageMatrixHostsResponse => ({
  rows: 'hosts', windowLabel: '30d', tests: [TEST], testCount: 1, hosts, hostCount, page, pageSize: 25, truncated: false,
});

const PARAMS = { from: 'now-30d', to: 'now', result: 'protected' as const };
const setup = (onOpenPair = vi.fn()) => {
  render(<SegmentHosts params={PARAMS} test={TEST} state="unprotected" onOpenPair={onOpenPair} now={NOW} reloadToken={0} />);
  return { onOpenPair };
};

beforeEach(() => {
  vi.clearAllMocks();
  getHosts.mockResolvedValue(answer([host(3, 2, ['protected', 'unprotected']), host(1, 9)], 2));
});

describe('SegmentHosts', () => {
  it('asks for the first page of that test\'s hosts in that state, with the scope only', async () => {
    setup();
    await screen.findByRole('button', { name: /HOST-3/ });

    expect(getHosts).toHaveBeenCalledTimes(1);
    expect(getHosts).toHaveBeenCalledWith({ from: 'now-30d', to: 'now' }, { page: 1, pageSize: 25, test: 't1', state: 'unprotected' });
  });

  it('lists the hosts in the server\'s order with age, earlier results and the state in words', async () => {
    setup();

    const rows = await screen.findAllByRole('button', { name: /HOST-/ });

    expect(screen.getByRole('group', { name: '2 hosts unprotected on Solo test' })).toBeInTheDocument();
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'HOST-3: unprotected, 2 days ago; earlier: protected, unprotected',
      'HOST-1: unprotected, 9 days ago',
    ]);
    expect(rows[0]).toHaveTextContent('HOST-3');
    expect(rows[0]).toHaveTextContent('unprotected');
    expect(rows[0]).toHaveTextContent('2 days ago');
  });

  it('opens the pair of a clicked host', async () => {
    const user = userEvent.setup();
    const { onOpenPair } = setup();

    await user.click(await screen.findByRole('button', { name: /HOST-1/ }));

    // With the time of the result listed, so that run is the one opened.
    expect(onOpenPair).toHaveBeenCalledWith({ testUuid: 't1', hostKey: 'org-1|HOST-1' }, new Date(NOW - 9 * 86_400_000).toISOString());
  });

  it('loads more hosts on request until all are listed', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer(Array.from({ length: 25 }, (_, i) => host(i + 1)), 27))
      .mockResolvedValueOnce(answer([host(26), host(27)], 27, 2));
    setup();
    await screen.findByRole('button', { name: /HOST-25:/ });

    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));

    await waitFor(() => expect(screen.getAllByRole('button', { name: /HOST-\d+:/ })).toHaveLength(27));
    expect(getHosts.mock.calls[1][1]).toEqual({ page: 2, pageSize: 25, test: 't1', state: 'unprotected' });
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it('lists every host of a bundle, with its controls, when no state is given', async () => {
    const BUNDLE: MatrixTest = { key: 'b1', testUuid: 'b1', name: 'Baseline', kind: 'controls', counts, ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 } };
    const bundleHost: MatrixHostRow = {
      key: 'org-1|HOST-7', hostname: 'HOST-7', org: 'org-1', counts, ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 },
      cells: [{ i: 0, ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 }, at: new Date(NOW - 86_400_000).toISOString() }],
    };
    getHosts.mockResolvedValue({ ...answer([], 1), tests: [BUNDLE], hosts: [bundleHost] });
    const onOpenPair = vi.fn();
    const user = userEvent.setup();
    render(<SegmentHosts params={PARAMS} test={BUNDLE} onOpenPair={onOpenPair} now={NOW} reloadToken={0} />);

    const row = await screen.findByRole('button', { name: 'HOST-7: 31 of 48 controls compliant, 2 not assessed, 1 day ago' });

    expect(getHosts).toHaveBeenCalledWith({ from: 'now-30d', to: 'now' }, { page: 1, pageSize: 25, test: 'b1' });
    expect(screen.getByRole('group', { name: '1 host with results for Baseline' })).toBeInTheDocument();
    expect(row).toHaveTextContent('31/48');
    await user.click(row);
    expect(onOpenPair).toHaveBeenCalledWith({ testUuid: 'b1', hostKey: 'org-1|HOST-7' }, bundleHost.cells[0].at);
  });

  it('reads the hosts again on a reload, from the first page', async () => {
    const view = render(<SegmentHosts params={PARAMS} test={TEST} state="unprotected" onOpenPair={vi.fn()} now={NOW} reloadToken={0} />);
    await screen.findByRole('button', { name: /HOST-3/ });

    view.rerender(<SegmentHosts params={PARAMS} test={TEST} state="unprotected" onOpenPair={vi.fn()} now={NOW} reloadToken={1} />);

    await waitFor(() => expect(getHosts).toHaveBeenCalledTimes(2));
    expect(getHosts.mock.calls[1][1]).toMatchObject({ page: 1 });
  });

  it('says when it is loading, when there is none, and when it failed', async () => {
    const user = userEvent.setup();
    getHosts.mockReturnValueOnce(new Promise(() => {}));
    const first = render(<SegmentHosts params={PARAMS} test={TEST} state="unprotected" onOpenPair={vi.fn()} now={NOW} reloadToken={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading hosts…');
    first.unmount();

    getHosts.mockResolvedValueOnce(answer([], 0));
    const second = render(<SegmentHosts params={PARAMS} test={TEST} state="unprotected" onOpenPair={vi.fn()} now={NOW} reloadToken={0} />);
    expect(await screen.findByText('No host in this state now')).toBeInTheDocument();
    second.unmount();

    getHosts.mockRejectedValueOnce(new Error('boom'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('The hosts could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /HOST-3/ })).toBeInTheDocument();
  });
});
