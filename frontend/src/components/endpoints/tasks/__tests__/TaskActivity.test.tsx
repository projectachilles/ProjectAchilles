import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskActivityResponse } from '@/types/agent';

// The activity strip of the Tasks page: what it asks, how it colours the answer, when it asks again.

const getTaskActivity = vi.fn();
vi.mock('@/services/api/agent', () => ({ agentApi: { getTaskActivity: (...args: unknown[]) => getTaskActivity(...args) } }));
const polls = vi.hoisted(() => new Map<number, () => void>());
vi.mock('@/hooks/usePolling', () => ({
  usePolling: (callback: () => void, intervalMs: number) => { polls.set(intervalMs, callback); },
}));

const { TaskActivity } = await import('../TaskActivity');

const DAY = 86_400_000;
const START = Date.parse('2026-11-10T00:00:00.000Z');
type Counts = Partial<Omit<TaskActivityResponse['buckets'][number], 'from' | 'to'>>;
function answer(byDay: Record<number, Counts>): TaskActivityResponse {
  return {
    interval: 'day',
    timeZone: 'UTC',
    buckets: Array.from({ length: 14 }, (_, i) => ({
      from: new Date(START + i * DAY).toISOString(),
      to: new Date(START + (i + 1) * DAY - 1).toISOString(),
      unprotected: 0, failed: 0, noVerdict: 0, inProgress: 0, protected: 0, completed: 0,
      ...byDay[10 + i],
    })),
  };
}
const BUSY = answer({
  11: { protected: 5 },
  13: { completed: 2 },
  16: { unprotected: 2, failed: 1, noVerdict: 1, inProgress: 3, protected: 6, completed: 4 },
  18: { inProgress: 1 },
});

function setup(props: Partial<React.ComponentProps<typeof TaskActivity>> = {}) {
  const onSelect = vi.fn();
  const all = { types: ['execute_test'] as const, search: '', reloadToken: 0, selected: null, onSelect, ...props };
  const view = render(<TaskActivity {...all} types={[...all.types]} />);
  return {
    onSelect,
    ...view,
    rerenderWith: (next: Partial<typeof all>) => {
      const merged = { ...all, ...next };
      view.rerender(<TaskActivity {...merged} types={[...merged.types]} />);
    },
  };
}

beforeEach(() => {
  getTaskActivity.mockReset();
  getTaskActivity.mockResolvedValue(BUSY);
  polls.clear();
});

describe('what it asks', () => {
  it('asks for the type pills and the search, in the browser\'s time zone', async () => {
    setup({ types: ['update_agent', 'uninstall'], search: 'HOST-1' });
    await screen.findByRole('group', { name: 'Tasks over time' });

    expect(getTaskActivity).toHaveBeenCalledTimes(1);
    expect(getTaskActivity).toHaveBeenCalledWith({ types: ['update_agent', 'uninstall'], search: 'HOST-1' }, Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('asks again for other pills or another search, and for a new reload token; not for a new selection', async () => {
    const { rerenderWith } = setup();
    await screen.findByRole('group', { name: 'Tasks over time' });

    rerenderWith({ selected: { from: BUSY.buckets[6].from, to: BUSY.buckets[6].to } });
    rerenderWith({ types: ['execute_test'] });
    expect(getTaskActivity).toHaveBeenCalledTimes(1);

    rerenderWith({ types: ['execute_command'] });
    await waitFor(() => expect(getTaskActivity).toHaveBeenCalledTimes(2));
    rerenderWith({ types: ['execute_command'], search: 'whoami' });
    await waitFor(() => expect(getTaskActivity).toHaveBeenCalledTimes(3));
    rerenderWith({ types: ['execute_command'], search: 'whoami', reloadToken: 1 });
    await waitFor(() => expect(getTaskActivity).toHaveBeenCalledTimes(4));
  });

  it('asks again once a minute, and not faster', async () => {
    setup();
    await screen.findByRole('group', { name: 'Tasks over time' });

    expect([...polls.keys()]).toEqual([60_000]);
    await act(async () => polls.get(60_000)!());

    expect(getTaskActivity).toHaveBeenCalledTimes(2);
  });
});

describe('what it draws', () => {
  it('counts tasks, coloured as the run timeline colours them, worst at the bottom', async () => {
    setup();
    const bar = await screen.findByRole('button', { name: 'Nov 16: 17 tasks, 2 unprotected, 1 failed, 1 no verdict, 3 in progress, 6 protected, 4 completed' });

    const segments = within(bar).getAllByTestId('activity-segment');
    expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual(['unprotected', 'failed', 'no-verdict', 'in-progress', 'protected', 'completed']);
    expect(segments[0]).toHaveClass('bg-danger');
    expect(segments[2]).toHaveClass('bg-warning');
    expect(segments[3]).toHaveClass('bg-info');
    expect(segments[4]).toHaveClass('bg-accent');
  });

  it('passes the selection through, both ways', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ selected: { from: BUSY.buckets[6].from, to: BUSY.buckets[6].to } });
    expect(await screen.findByRole('button', { name: /^Nov 16/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /^Nov 11/ }));

    expect(onSelect).toHaveBeenCalledWith({ from: BUSY.buckets[1].from, to: BUSY.buckets[1].to });
  });

  it('writes the line the page gives it about filters the bars do not follow', async () => {
    setup({ listOnlyNote: 'The status filter narrows the list, not the bars.' });
    expect(await screen.findByText('The status filter narrows the list, not the bars.')).toBeInTheDocument();
  });

  it('holds its place while the first answer is on its way, and shows nothing for 30 days without a task', async () => {
    let resolve!: (v: TaskActivityResponse) => void;
    getTaskActivity.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = setup();
    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();

    await act(async () => resolve(answer({})));

    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing when the request fails, but keeps the way out of a selected day', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    getTaskActivity.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onSelect } = setup({ selected: { from: BUSY.buckets[6].from, to: BUSY.buckets[6].to } });

    // Named in the browser's zone (the day was cut in it): the test machine's may not be UTC.
    await user.click(await screen.findByRole('button', { name: /^Clear the selected Nov 1[56]$/ }));

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('group', { name: 'Tasks over time' })).not.toBeInTheDocument();
    errors.mockRestore();
  });
});

describe('answers that arrive late', () => {
  it('drops the answer of filters that were replaced', async () => {
    let resolveFirst!: (v: TaskActivityResponse) => void;
    getTaskActivity
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(answer({ 20: { completed: 7 }, 21: { completed: 1 }, 22: { completed: 1 } }));
    const { rerenderWith } = setup();

    rerenderWith({ types: ['execute_command'] });
    await screen.findByRole('button', { name: 'Nov 20: 7 tasks, 7 completed' });
    await act(async () => resolveFirst(BUSY));

    expect(screen.queryByRole('button', { name: /^Nov 16/ })).not.toBeInTheDocument();
  });
});
