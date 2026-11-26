import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionsActivityResponse, ExtendedFilterParams } from '@/services/api/analytics';

// The activity strip of All Executions: what it asks, how it maps the answer, what it adds under the bars.

const getActivity = vi.fn();
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getExecutionsActivity: (...args: unknown[]) => getActivity(...args) } }));

const { ExecutionsActivity } = await import('../ExecutionsActivity');

const DAY = 86_400_000;
const START = Date.parse('2026-11-10T00:00:00.000Z');
/** Fourteen UTC days; `counts` by day of the month: [protected, unprotected, noVerdict]. */
function answer(counts: Record<number, [number, number, number]>, extra: Partial<ExecutionsActivityResponse> = {}): ExecutionsActivityResponse {
  return {
    interval: 'day',
    timeZone: 'UTC',
    buckets: Array.from({ length: 14 }, (_, i) => {
      const c = counts[10 + i] ?? [0, 0, 0];
      return {
        from: new Date(START + i * DAY).toISOString(),
        to: new Date(START + (i + 1) * DAY - 1).toISOString(),
        protected: c[0],
        unprotected: c[1],
        noVerdict: c[2],
      };
    }),
    ...extra,
  };
}
const BUSY = answer({ 11: [10, 2, 0], 13: [0, 0, 1], 16: [30, 10, 2], 18: [4, 0, 0] });
const PARAMS: ExtendedFilterParams = { from: '2026-11-10T00:00:00.000Z', to: '2026-11-23T23:59:59.999Z', hostnames: 'HOST-01' };

function setup(props: Partial<React.ComponentProps<typeof ExecutionsActivity>> = {}) {
  const onSelect = vi.fn();
  const all = { params: PARAMS, reloadToken: 0, selected: null, onSelect, ...props };
  const view = render(<ExecutionsActivity {...all} />);
  return { onSelect, ...view, rerenderWith: (next: Partial<typeof all>) => view.rerender(<ExecutionsActivity {...all} {...next} />) };
}

beforeEach(() => {
  getActivity.mockReset();
  getActivity.mockResolvedValue(BUSY);
});

describe('what it asks', () => {
  it('asks once, for the filters it was given, in the browser\'s time zone', async () => {
    setup();
    await screen.findByRole('group', { name: 'Runs over time' });

    expect(getActivity).toHaveBeenCalledTimes(1);
    expect(getActivity).toHaveBeenCalledWith(PARAMS, Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('asks again for other filters, and for a new reload token, and not when only the selection changes', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Runs over time' });

    rerenderWith({ selected: { from: BUSY.buckets[6].from, to: BUSY.buckets[6].to } });
    rerenderWith({ params: { ...PARAMS } });
    expect(getActivity).toHaveBeenCalledTimes(1);

    rerenderWith({ params: { ...PARAMS, hostnames: 'HOST-02' } });
    await waitFor(() => expect(getActivity).toHaveBeenCalledTimes(2));
    rerenderWith({ params: { ...PARAMS, hostnames: 'HOST-02' }, reloadToken: 1 });
    await waitFor(() => expect(getActivity).toHaveBeenCalledTimes(3));
  });

  it('asks the same thing whatever the outcome filters: the bars are split by outcome already', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Runs over time' });

    rerenderWith({ params: { ...PARAMS, result: 'unprotected', errorCodes: '101', errorNames: 'Unprotected', scoringMode: 'all-stages' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(getActivity).toHaveBeenCalledTimes(1);
  });
});

describe('what it draws', () => {
  it('draws a bar per bucket with runs: unprotected at the bottom, then no verdict, then protected', async () => {
    setup();
    const bar = await screen.findByRole('button', { name: 'Nov 16: 42 runs, 10 unprotected, 2 no verdict, 30 protected' });

    expect(within(bar).getAllByTestId('activity-segment').map((s) => s.getAttribute('data-segment'))).toEqual(['unprotected', 'noVerdict', 'protected']);
    expect(screen.getAllByTestId('activity-bar')).toHaveLength(4);
  });

  it('names the buckets in the zone the server cut them in', async () => {
    // Midnight in Santo Domingo is 04:00 UTC: these are local days, whatever zone the test runs in.
    getActivity.mockResolvedValue({
      interval: 'day',
      timeZone: 'America/Santo_Domingo',
      buckets: [16, 17, 18].map((d) => ({
        from: `2026-11-${d}T04:00:00.000Z`, to: `2026-11-${d + 1}T03:59:59.999Z`, protected: 1, unprotected: 0, noVerdict: 0,
      })),
    });
    setup();

    expect(await screen.findByRole('button', { name: 'Nov 16: 1 run, 1 protected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nov 18: 1 run, 1 protected' })).toBeInTheDocument();
  });

  it('passes the selection through, both ways', async () => {
    const user = userEvent.setup();
    const selected = { from: BUSY.buckets[6].from, to: BUSY.buckets[6].to };
    const { onSelect } = setup({ selected });
    const bar = await screen.findByRole('button', { name: /^Nov 16/ });
    expect(bar).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /^Nov 11/ }));
    expect(onSelect).toHaveBeenCalledWith({ from: BUSY.buckets[1].from, to: BUSY.buckets[1].to });
  });

  it('holds its place while the first answer is on its way, and shows nothing for a window without runs', async () => {
    let resolve!: (v: ExecutionsActivityResponse) => void;
    getActivity.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = setup();
    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();

    await act(async () => resolve(answer({})));

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the bars it has while it asks again', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Runs over time' });
    getActivity.mockReturnValue(new Promise(() => {}));

    rerenderWith({ reloadToken: 1 });
    await waitFor(() => expect(getActivity).toHaveBeenCalledTimes(2));

    expect(screen.getAllByTestId('activity-bar')).toHaveLength(4);
    expect(screen.queryByTestId('activity-loading')).not.toBeInTheDocument();
  });

  it('draws nothing when the request fails: the page reports its own failures', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    getActivity.mockRejectedValue(new Error('boom'));
    const { container } = setup();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('drops the bars of the scope before when the new scope fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Runs over time' });
    getActivity.mockRejectedValue(new Error('boom'));

    rerenderWith({ params: { ...PARAMS, hostnames: 'HOST-02' } });

    // Bars of other filters would be read as these filters' bars.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    errors.mockRestore();
  });
});

describe('answers that arrive late', () => {
  it('drops the answer of filters that were replaced', async () => {
    let resolveFirst!: (v: ExecutionsActivityResponse) => void;
    getActivity
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(answer({ 20: [7, 0, 0], 21: [1, 0, 0], 22: [1, 0, 0] }));
    const { rerenderWith } = setup();

    rerenderWith({ params: { ...PARAMS, hostnames: 'HOST-02' } });
    await screen.findByRole('button', { name: 'Nov 20: 7 runs, 7 protected' });
    await act(async () => resolveFirst(BUSY));

    expect(screen.queryByRole('button', { name: /^Nov 16/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nov 20: 7 runs, 7 protected' })).toBeInTheDocument();
  });

  it('keeps the bars when the request of replaced filters fails late', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (e: Error) => void;
    getActivity
      .mockReturnValueOnce(new Promise((_r, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(BUSY);
    const { rerenderWith } = setup();

    rerenderWith({ params: { ...PARAMS, hostnames: 'HOST-02' } });
    await screen.findByRole('button', { name: /^Nov 16/ });
    await act(async () => rejectFirst(new Error('late')));

    // Not this scope's failure: nothing is wiped and nothing is logged.
    expect(screen.getAllByTestId('activity-bar')).toHaveLength(4);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('sets nothing after it is gone', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolve!: (v: ExecutionsActivityResponse) => void;
    getActivity.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = setup();

    unmount();
    await act(async () => resolve(BUSY));

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('the lines under the bars', () => {
  it('says the bars ignore the outcome filters, when the page says one narrows the list', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Runs over time' });
    expect(screen.queryByText(/Outcome filters/)).not.toBeInTheDocument();

    rerenderWith({ outcomeFiltered: true });
    expect(screen.getByText('Outcome filters narrow the list, not the bars.')).toBeInTheDocument();
  });

  it('says when the counts are a lower bound', async () => {
    getActivity.mockResolvedValue({ ...BUSY, truncated: true });
    setup();
    expect(await screen.findByText('Too many runs to count them all: the bars are a lower bound.')).toBeInTheDocument();
  });

  it('says when only the last year is drawn', async () => {
    getActivity.mockResolvedValue({ ...BUSY, capped: true });
    setup();
    expect(await screen.findByText('The bars cover the last 365 days of this window.')).toBeInTheDocument();
  });

  it('adds none of them otherwise', async () => {
    setup();
    await screen.findByRole('group', { name: 'Runs over time' });
    expect(screen.queryByText(/lower bound|365 days|Outcome filters/)).not.toBeInTheDocument();
  });
});
