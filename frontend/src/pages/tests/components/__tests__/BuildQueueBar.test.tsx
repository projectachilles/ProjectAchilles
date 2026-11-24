import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BuildQueueOutcome, BuildQueueResult } from '@/lib/buildQueue';
import type { BuildQueueState } from '@/hooks/useBuildQueue';

const q = vi.hoisted(() => ({
  state: { status: 'idle', total: 0, current: null, results: [], end: null } as unknown,
  stop: vi.fn(),
  dismiss: vi.fn(),
  start: vi.fn(() => true),
}));

vi.mock('@/hooks/useBuildQueue', () => ({
  useBuildQueue: () => ({ state: q.state, start: q.start, stop: q.stop, dismiss: q.dismiss }),
}));

import { BuildQueueBar } from '../BuildQueueBar';

const item = (i: number) => ({ uuid: `u${i}`, name: `Test ${i}` });

/** `counts` outcomes in order, numbered from 1. */
function results(counts: Partial<Record<BuildQueueOutcome, number>>): BuildQueueResult[] {
  const out: BuildQueueResult[] = [];
  for (const outcome of ['built', 'failed', 'skipped'] as const) {
    for (let k = 0; k < (counts[outcome] ?? 0); k++) {
      const i = out.length + 1;
      out.push({
        ...item(i),
        outcome,
        ...(outcome === 'failed' ? { reason: `compile error in ${i}` } : {}),
        ...(outcome === 'skipped' ? { reason: 'Uploaded binary, left as it is' } : {}),
      });
    }
  }
  return out;
}

function setState(over: Partial<BuildQueueState>) {
  q.state = { status: 'idle', total: 0, current: null, results: [], end: null, ...over };
}

function renderBar(onResult = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <BuildQueueBar onResult={onResult} />
    </MemoryRouter>,
  );
  return { ...view, onResult };
}

describe('BuildQueueBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setState({});
  });

  it('renders nothing when idle', () => {
    const { container } = renderBar();
    expect(container.innerHTML).toBe('');
  });

  it('while running: which test, a progress bar, the counts and Stop', () => {
    setState({ status: 'running', total: 64, current: item(13), results: results({ built: 11, failed: 1 }) });
    renderBar();
    expect(screen.getByText('Building 13 of 64 · Test 13')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Build progress' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuenow')).toBe('12');
    expect(bar.getAttribute('aria-valuemax')).toBe('64');
    expect(screen.getByText('11 built · 1 failed · 0 skipped')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(q.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Stopping after this build')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('before the first test is picked up it counts from 1', () => {
    setState({ status: 'running', total: 3, current: null, results: [] });
    renderBar();
    expect(screen.getByText('Building 1 of 3')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('after Stop: says it stops after this build, with Stop disabled', () => {
    setState({ status: 'stopping', total: 64, current: item(13), results: results({ built: 12 }) });
    renderBar();
    expect(screen.getByText('Stopping after this build')).toBeTruthy();
    expect(screen.getByText('Building 13 of 64 · Test 13')).toBeTruthy();
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    fireEvent.click(stop);
    expect(q.stop).not.toHaveBeenCalled();
  });

  it('when done: the summary, failed and skipped tests in Details, and Dismiss', () => {
    setState({ status: 'done', total: 64, results: results({ built: 61, failed: 2, skipped: 1 }), end: 'completed' });
    renderBar();
    expect(screen.getByText('Built 61 of 64 · 2 failed · 1 skipped')).toBeTruthy();
    expect(screen.queryByText(/^Stopped/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole('link', { name: 'Test 62' }).getAttribute('href')).toBe('/tests/u62');
    expect(rows[0].textContent).toContain('Failed');
    expect(rows[0].textContent).toContain('compile error in 62');
    expect(within(rows[1]).getByRole('link', { name: 'Test 63' }).getAttribute('href')).toBe('/tests/u63');
    expect(within(rows[2]).getByRole('link', { name: 'Test 64' }).getAttribute('href')).toBe('/tests/u64');
    expect(rows[2].textContent).toContain('Skipped');
    expect(rows[2].textContent).toContain('Uploaded binary, left as it is');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(q.dismiss).toHaveBeenCalledTimes(1);
  });

  it('when everything built: no Details', () => {
    setState({ status: 'done', total: 2, results: results({ built: 2 }), end: 'completed' });
    renderBar();
    expect(screen.getByText('Built 2 of 2 · 0 failed · 0 skipped')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('after a stop: the total is the number reached, and how many were not started', () => {
    setState({ status: 'done', total: 64, results: results({ built: 22, failed: 1, skipped: 1 }), end: 'stopped' });
    renderBar();
    expect(screen.getByText('Built 22 of 24 · 1 failed · 1 skipped')).toBeTruthy();
    expect(screen.getByText('Stopped: 40 not started')).toBeTruthy();
  });

  it('a run that could not reach the server says so, with how many were not started', () => {
    setState({ status: 'done', total: 64, results: results({ built: 24 }), end: 'unreachable' });
    renderBar();
    expect(screen.getByText('Built 24 of 24 · 0 failed · 0 skipped')).toBeTruthy();
    expect(screen.getByText('Stopped: the server could not be reached. 40 not started')).toBeTruthy();
    expect(screen.queryByText('Stopped: 40 not started')).toBeNull();
  });

  it('calls onResult once for each new result, not on other renders', () => {
    setState({ status: 'running', total: 3, current: item(1), results: [] });
    const { rerender, onResult } = renderBar();
    expect(onResult).not.toHaveBeenCalled();
    const again = () =>
      rerender(
        <MemoryRouter>
          <BuildQueueBar onResult={onResult} />
        </MemoryRouter>,
      );
    setState({ status: 'running', total: 3, current: item(2), results: results({ built: 1 }) });
    again();
    expect(onResult).toHaveBeenCalledTimes(1);
    setState({ status: 'running', total: 3, current: item(2), results: results({ built: 1 }) });
    again();
    expect(onResult).toHaveBeenCalledTimes(1);
    setState({ status: 'running', total: 3, current: item(3), results: results({ built: 1, failed: 1 }) });
    again();
    expect(onResult).toHaveBeenCalledTimes(2);
    setState({ status: 'done', total: 3, results: results({ built: 1, failed: 1 }), end: 'completed' });
    again();
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it('does not reload for results that were already there when it mounted', () => {
    setState({ status: 'done', total: 3, results: results({ built: 3 }), end: 'completed' });
    const { onResult } = renderBar();
    expect(onResult).not.toHaveBeenCalled();
  });
});
