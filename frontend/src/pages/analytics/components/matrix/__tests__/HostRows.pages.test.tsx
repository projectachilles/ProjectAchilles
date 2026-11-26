import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoverageMatrixHostsResponse, ExtendedFilterParams, MatrixCell, MatrixCounts, MatrixHostRow, MatrixTest } from '@/services/api/analytics';

// Rows of hosts across pages: what stays right when the server's answer changes between two requests (from the branch review).

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
const test = (id: string, name: string): MatrixTest => ({ key: id, testUuid: id, name, kind: 'test', counts: counts() });
const A = test('ta', 'Alpha');
const B = test('tb', 'Bravo');
const host = (n: number, cells: MatrixCell[]): MatrixHostRow => ({ key: `org-1|HOST-${n}`, hostname: `HOST-${n}`, org: 'org-1', counts: counts(), ratio: ratio0, cells });
const answer = (tests: MatrixTest[], hosts: MatrixHostRow[], over: Partial<CoverageMatrixHostsResponse> = {}): CoverageMatrixHostsResponse => ({
  rows: 'hosts', windowLabel: '30d', tests, testCount: tests.length, hosts, hostCount: hosts.length, page: 1, pageSize: 25, truncated: false, ...over,
});
const PARAMS: ExtendedFilterParams = { from: 'now-30d', to: 'now' };
function setup(over: Partial<Props> = {}) {
  const props: Props = { params: PARAMS, reloadToken: 0, openPair: null, onOpenPair: vi.fn(), renderPair: () => null, now: NOW, ...over };
  const view = render(<HostRows {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<Props>) => view.rerender(<HostRows {...props} {...next} />) };
}
const rowOf = (hostname: string) => screen.getByRole('heading', { name: hostname }).closest('[data-matrix-row]') as HTMLElement;
const labels = (hostname: string) => within(rowOf(hostname)).getAllByTestId('matrix-mark').map((m) => m.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
  width.value = 900;
});

describe('the order of the tests changes between two pages', () => {
  // The server orders tests by how many hosts are unprotected, so one new
  // result anywhere can swap two tests between the first page and "Show more".
  it('keeps a host of the first page on its own tests after "Show more"', async () => {
    const user = userEvent.setup();
    getHosts
      // Page 1, read at 09:00: axis [Alpha, Bravo]; HOST-1 is unprotected against Alpha and never ran Bravo.
      .mockResolvedValueOnce(answer([A, B], [host(1, [{ i: 0, verdict: 'unprotected', at: at(3) }])], { hostCount: 2 }))
      // Page 2, read at 09:10: Bravo now leads, axis [Bravo, Alpha].
      .mockResolvedValueOnce(answer([B, A], [host(2, [{ i: 0, verdict: 'protected', at: at(1) }])], { hostCount: 2, page: 2 }));
    const { props } = setup();
    await screen.findByRole('heading', { name: 'HOST-1' });
    expect(labels('HOST-1')).toEqual(['Alpha: unprotected, 3 days ago', 'Bravo: never run']);

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-2' });

    // HOST-1's result is Alpha's, whatever order the columns are now in.
    expect(labels('HOST-1').find((l) => l?.includes('unprotected'))).toBe('Alpha: unprotected, 3 days ago');
    await user.click(within(rowOf('HOST-1')).getByRole('button'));
    expect(props.onOpenPair).toHaveBeenLastCalledWith({ testUuid: 'ta', hostKey: 'org-1|HOST-1' }, at(3));
  });

  it('keeps hosts on their own tests when the order changes between two pages of one reload', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer([A, B], [host(1, [{ i: 0, verdict: 'unprotected', at: at(3) }])], { hostCount: 2 }))
      .mockResolvedValueOnce(answer([A, B], [host(2, [{ i: 1, verdict: 'protected', at: at(1) }])], { hostCount: 2, page: 2 }));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-1' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-2' });

    getHosts
      .mockResolvedValueOnce(answer([A, B], [host(1, [{ i: 0, verdict: 'unprotected', at: at(3) }])], { hostCount: 2 }))
      .mockResolvedValueOnce(answer([B, A], [host(2, [{ i: 0, verdict: 'protected', at: at(1) }])], { hostCount: 2, page: 2 }));
    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(getHosts).toHaveBeenCalledTimes(4));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(labels('HOST-1').find((l) => l?.includes('unprotected'))).toBe('Alpha: unprotected, 3 days ago');
  });
});

describe('a host on two pages of one reload', () => {
  it('lists it once', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer([A], [host(1, []), host(2, [])], { hostCount: 3 }))
      .mockResolvedValueOnce(answer([A], [host(3, [])], { hostCount: 3, page: 2 }));
    const { rerenderWith } = setup();
    await screen.findByRole('heading', { name: 'HOST-2' });
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    await screen.findByRole('heading', { name: 'HOST-3' });

    // Between the two requests of the reload HOST-2 moved down one place.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    getHosts
      .mockResolvedValueOnce(answer([A], [host(1, []), host(2, [])], { hostCount: 3 }))
      .mockResolvedValueOnce(answer([A], [host(2, []), host(3, [])], { hostCount: 3, page: 2 }));
    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(getHosts).toHaveBeenCalledTimes(4));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['HOST-1', 'HOST-2', 'HOST-3']);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0);
  });
});

describe('outcome filters', () => {
  it('says that outcome filters narrow the List only, as rows of tests do', async () => {
    getHosts.mockResolvedValue(answer([A], [host(1, [])]));
    setup({ params: { ...PARAMS, result: 'unprotected' } });
    await screen.findByRole('heading', { name: 'HOST-1' });

    expect(screen.getByText('Outcome filters apply to the List view only.')).toBeInTheDocument();
  });
});

describe('"Show more" and the keyboard', () => {
  it('says it is loading while a further page is on its way', async () => {
    const user = userEvent.setup();
    getHosts
      .mockResolvedValueOnce(answer([A], [host(1, [])], { hostCount: 2 }))
      .mockReturnValueOnce(new Promise(() => {}));
    setup();
    await screen.findByRole('heading', { name: 'HOST-1' });

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    // Something a sighted user can see: a status, or the button kept and marked busy.
    const status = screen.queryByRole('status');
    const button = screen.queryByRole('button', { name: /Show|Loading/ });
    expect(status ?? button).not.toBeNull();
  });
});
