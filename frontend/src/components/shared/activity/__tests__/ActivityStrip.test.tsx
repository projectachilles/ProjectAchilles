import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityStrip } from '../ActivityStrip';
import { barHeights, type BucketRef, type StripBucket } from '../activityModel';

const DAY = 86_400_000;
const START = Date.parse('2026-11-10T00:00:00.000Z');
/** Fourteen UTC days from 10 November; `counts` by day of the month: [unprotected, no verdict, protected]. */
function days(counts: Record<number, [number, number, number]>, length = 14): StripBucket[] {
  return Array.from({ length }, (_, i) => {
    const c = counts[10 + i] ?? [0, 0, 0];
    return {
      from: new Date(START + i * DAY).toISOString(),
      to: new Date(START + (i + 1) * DAY - 1).toISOString(),
      segments: [
        { key: 'unprotected', tone: 'danger' as const, label: 'unprotected', count: c[0] },
        { key: 'noVerdict', tone: 'muted' as const, label: 'no verdict', count: c[1] },
        { key: 'protected', tone: 'accent' as const, label: 'protected', count: c[2] },
      ],
    };
  });
}
const ref = (bucket: StripBucket): BucketRef => ({ from: bucket.from, to: bucket.to });

const BUSY = days({ 11: [2, 0, 10], 13: [0, 1, 0], 16: [10, 2, 30], 18: [0, 0, 4], 22: [1, 0, 0] });

function setup(props: Partial<React.ComponentProps<typeof ActivityStrip>> = {}) {
  const onSelect = vi.fn();
  const all = { buckets: BUSY, interval: 'day' as const, selected: null, onSelect, timeZone: 'UTC', ...props };
  const view = render(<ActivityStrip {...all} />);
  return { onSelect, ...view, rerenderWith: (next: Partial<typeof all>) => view.rerender(<ActivityStrip {...all} {...next} />) };
}
const bars = () => screen.getAllByTestId('activity-bar');
const bar = (name: RegExp | string) => screen.getByRole('button', { name });

describe('ActivityStrip with enough activity', () => {
  it('has a slot for every bucket and a bar for each one that had runs', () => {
    setup();

    expect(screen.getAllByTestId('activity-slot')).toHaveLength(14);
    expect(bars()).toHaveLength(5);
    expect(bars().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Nov 11: 12 runs, 2 unprotected, 10 protected',
      'Nov 13: 1 run, 1 no verdict',
      'Nov 16: 42 runs, 10 unprotected, 2 no verdict, 30 protected',
      'Nov 18: 4 runs, 4 protected',
      'Nov 22: 1 run, 1 unprotected',
    ]);
  });

  it('gives each bucket one column of equal width, whatever the count: no sideways scroll', () => {
    setup();
    expect(screen.getByTestId('activity-bars').style.gridTemplateColumns).toBe('repeat(14, minmax(0, 1fr))');
  });

  it('draws each bar and its outcomes at the heights of the model', () => {
    setup();
    const heights = barHeights(BUSY).filter((h) => h.bar > 0);

    bars().forEach((b, i) => {
      expect(b.style.height).toBe(`${heights[i].bar}px`);
      const segments = within(b).getAllByTestId('activity-segment');
      expect(segments.map((s) => s.style.height)).toEqual(heights[i].segments.filter((s) => s > 0).map((s) => `${s}px`));
    });
  });

  it('colours an outcome by its tone, the worst at the bottom', () => {
    setup();
    const segments = within(bar(/^Nov 16/)).getAllByTestId('activity-segment');

    expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual(['unprotected', 'noVerdict', 'protected']);
    expect(segments[0]).toHaveClass('bg-danger');
    expect(segments[2]).toHaveClass('bg-accent');
    // The bar stacks upwards from its first segment.
    expect(bar(/^Nov 16/)).toHaveClass('flex-col-reverse');
  });

  it('writes the first and the last bucket under the ends', () => {
    setup();
    const ends = screen.getByTestId('activity-ends');
    expect(ends).toHaveTextContent('Nov 10');
    expect(ends).toHaveTextContent('Nov 23');
  });

  it('names the group by what it counts', () => {
    setup({ unit: 'task' });
    expect(screen.getByRole('group', { name: 'Tasks over time' })).toBeInTheDocument();
    expect(bar(/^Nov 18/)).toHaveAccessibleName('Nov 18: 4 tasks, 4 protected');
  });

  it('draws what the page adds under it', () => {
    setup({ note: <span>Counts are a lower bound.</span> });
    expect(screen.getByText('Counts are a lower bound.')).toBeInTheDocument();
  });
});

describe('selecting a bucket', () => {
  it('reports the bucket of the bar clicked', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();

    await user.click(bar(/^Nov 16/));

    expect(onSelect).toHaveBeenCalledWith(ref(BUSY[6]));
  });

  it('marks the selected bar, dims the others, and shows what is selected', () => {
    setup({ selected: ref(BUSY[6]) });

    expect(bar(/^Nov 16/)).toHaveAttribute('aria-pressed', 'true');
    expect(bar(/^Nov 11/)).toHaveAttribute('aria-pressed', 'false');
    expect(bar(/^Nov 11/)).toHaveClass('opacity-40');
    expect(bar(/^Nov 16/)).not.toHaveClass('opacity-40');
    expect(screen.getByRole('button', { name: 'Clear the selected Nov 16' })).toHaveTextContent('Nov 16');
  });

  it('dims nothing while nothing is selected', () => {
    setup();
    for (const b of bars()) expect(b).not.toHaveClass('opacity-40');
    expect(screen.queryByRole('button', { name: /^Clear the selected/ })).not.toBeInTheDocument();
  });

  it('clears on a second click of the selected bar', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ selected: ref(BUSY[6]) });

    await user.click(bar(/^Nov 16/));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clears from the chip', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ selected: ref(BUSY[6]) });

    await user.click(screen.getByRole('button', { name: 'Clear the selected Nov 16' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('still shows, and clears, a selection that is none of its buckets', async () => {
    // A link from another time zone, or a bucket outside the window now shown.
    const user = userEvent.setup();
    const stray = { from: '2026-10-01T04:00:00.000Z', to: '2026-10-02T03:59:59.999Z' };
    const { onSelect } = setup({ selected: stray });

    expect(bars().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear the selected Oct 1' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('matches a selection written another way', () => {
    setup({ selected: { from: '2026-11-16T00:00:00Z', to: '2026-11-16T23:59:59.999Z' } });
    expect(bar(/^Nov 16/)).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the keyboard', () => {
  it('is one stop for the Tab key: the last bucket with runs, or the selected one', () => {
    const { rerenderWith } = setup();
    expect(bars().filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label'))).toEqual(['Nov 22: 1 run, 1 unprotected']);

    rerenderWith({ selected: ref(BUSY[6]) });
    expect(bars().filter((b) => b.tabIndex === 0)).toEqual([bar(/^Nov 16/)]);
  });

  it('moves between the buckets that have runs with the arrows, Home and End', async () => {
    const user = userEvent.setup();
    setup();
    bar(/^Nov 16/).focus();

    await user.keyboard('{ArrowRight}');
    expect(bar(/^Nov 18/)).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(bar(/^Nov 13/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(bar(/^Nov 11/)).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(bar(/^Nov 11/)).toHaveFocus();
    await user.keyboard('{End}');
    expect(bar(/^Nov 22/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(bar(/^Nov 22/)).toHaveFocus();
    // The stop follows the focus, so Tab comes back to where the user was.
    expect(bars().filter((b) => b.tabIndex === 0)).toEqual([bar(/^Nov 22/)]);
  });

  it('selects with Enter', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    bar(/^Nov 13/).focus();

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(ref(BUSY[3]));
  });
});

describe('the line under the strip', () => {
  it('writes out the bucket under the focus, and under the pointer', async () => {
    const user = userEvent.setup();
    setup();
    const hint = screen.getByTestId('activity-hint');
    expect(hint).toHaveTextContent('');

    act(() => bar(/^Nov 16/).focus());
    expect(hint).toHaveTextContent('Nov 16: 42 runs, 10 unprotected, 2 no verdict, 30 protected');

    await user.hover(bar(/^Nov 11/));
    expect(hint).toHaveTextContent('Nov 11: 12 runs, 2 unprotected, 10 protected');
  });

  it('says so for a quiet bucket too', async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(screen.getAllByTestId('activity-slot')[0]);

    expect(screen.getByTestId('activity-hint')).toHaveTextContent('Nov 10: no runs');
  });
});

describe('a quiet window', () => {
  const QUIET = days({ 16: [2, 0, 10], 23: [0, 0, 4] });

  it('lists the buckets that had runs instead of drawing a blank track', () => {
    setup({ buckets: QUIET });

    expect(screen.queryByTestId('activity-slot')).not.toBeInTheDocument();
    expect(screen.getByText('Runs on 2 days in this window:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nov 16: 12 runs, 2 unprotected, 10 protected' })).toHaveTextContent('Nov 16 · 12 runs');
    expect(screen.getByRole('button', { name: 'Nov 23: 4 runs, 4 protected' })).toHaveTextContent('Nov 23 · 4 runs');
  });

  it('counts one day in the singular', () => {
    setup({ buckets: days({ 16: [0, 0, 1] }) });
    expect(screen.getByText('Runs on 1 day in this window:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Nov 16/ })).toHaveTextContent('Nov 16 · 1 run');
  });

  it('speaks of hours and weeks where the buckets are', () => {
    const { rerenderWith } = setup({ buckets: QUIET, interval: 'hour' });
    expect(screen.getByText('Runs in 2 hours of this window:')).toBeInTheDocument();
    rerenderWith({ buckets: QUIET, interval: 'week' });
    expect(screen.getByText('Runs in 2 weeks of this window:')).toBeInTheDocument();
  });

  it('narrows from a listed bucket as from a bar, and marks the selected one', async () => {
    const user = userEvent.setup();
    const { onSelect, rerenderWith } = setup({ buckets: QUIET });

    await user.click(screen.getByRole('button', { name: /^Nov 23/ }));
    expect(onSelect).toHaveBeenCalledWith(ref(QUIET[13]));

    rerenderWith({ buckets: QUIET, selected: ref(QUIET[13]) });
    expect(screen.getByRole('button', { name: /^Nov 23/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^Nov 23/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('draws bars from three buckets with runs', () => {
    setup({ buckets: days({ 16: [0, 0, 1], 17: [0, 0, 1], 18: [0, 0, 1] }) });
    expect(bars()).toHaveLength(3);
    expect(screen.queryByText(/in this window:/)).not.toBeInTheDocument();
  });
});

describe('no activity', () => {
  it('draws nothing: the page says the window is empty', () => {
    const { container } = setup({ buckets: days({}) });
    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing without buckets', () => {
    const { container } = setup({ buckets: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('still lets a selection be cleared', async () => {
    // Narrowed to a bucket, then the window emptied (an archive): the chip is the way out.
    const user = userEvent.setup();
    const { onSelect } = setup({ buckets: days({}), selected: { from: '2026-11-16T00:00:00.000Z', to: '2026-11-16T23:59:59.999Z' } });

    await user.click(screen.getByRole('button', { name: 'Clear the selected Nov 16' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
