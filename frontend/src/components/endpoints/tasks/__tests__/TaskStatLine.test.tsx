import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskStatLine } from '../TaskStatLine';
import { taskTiles } from '@/pages/endpoints/utils/taskTiles';
import type { AgentMetrics, TaskOutcomes7d } from '@/types/agent';

const breakdown = [
  { key: 'p1', outcome: 'protected' as const, code: 126, name: 'Quarantined', count: 38 },
  { key: 'n1', outcome: 'not-run' as const, code: null, name: 'Agent offline', count: 6 },
  { key: 'r1', outcome: 'run-failed' as const, code: 1, name: 'Run failed', count: 10 },
  { key: 'i1', outcome: 'inconclusive' as const, code: null, name: 'Unclear', count: 2 },
];
const outcomes: TaskOutcomes7d = {
  tests: { protected: 38, edr_stopped: 0, unprotected: 36, not_run: 6, run_failed: 10, test_error: 0, inconclusive: 2 },
  other: { total: 0, failed: 0 },
  breakdown,
};
const metrics = (o?: TaskOutcomes7d): AgentMetrics => ({
  total: 0, online: 0, offline: 0, by_os: {}, by_status: {}, pending_tasks: 0,
  task_activity_24h: { completed: 3, failed: 1, total: 4, success_rate: 75, in_progress: 0 },
  by_version: {}, task_outcomes_7d: o,
} as AgentMetrics);

describe('TaskStatLine', () => {
  it('shows the four values', () => {
    render(<TaskStatLine tiles={taskTiles(metrics(outcomes))} outcomes={outcomes} />);
    expect(screen.getByText('last 7 days')).toBeInTheDocument();
    for (const [v, l] of [['38', 'protected'], ['36', 'unprotected'], ['18', 'no verdict'], ['0', 'in progress']]) {
      expect(screen.getByText(v)).toBeInTheDocument();
      expect(screen.getByText(l)).toBeInTheDocument();
    }
  });

  it('opens the no-verdict menu and reports the chosen row', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TaskStatLine tiles={taskTiles(metrics(outcomes))} outcomes={outcomes} onSelectBreakdown={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Show breakdown of 18 no verdict' }));
    expect(screen.getByText('Click a row to filter the list · Esc to close')).toBeInTheDocument();
    await user.click(await screen.findByText('Agent offline'));
    expect(onSelect).toHaveBeenCalledWith(breakdown[1], 'no-verdict');
  });

  it('groups the menu and colours inconclusive bars faint, others warning', async () => {
    const user = userEvent.setup();
    render(<TaskStatLine tiles={taskTiles(metrics(outcomes))} outcomes={outcomes} />);
    await user.click(screen.getByRole('button', { name: 'Show breakdown of 18 no verdict' }));
    const menu = await screen.findByRole('menu');
    expect(menu.querySelectorAll('[data-slot="dropdown-menu-group"]').length).toBeGreaterThan(1);
    const bar = (name: string) =>
      screen.getByText(name).closest('[role="menuitem"]')!.querySelector('span[aria-hidden] > span')!;
    expect(bar('Unclear').className).toContain('bg-faint');
    expect(bar('Agent offline').className).toContain('bg-warning');
  });

  it('only Protected and No verdict are triggers', () => {
    render(<TaskStatLine tiles={taskTiles(metrics(outcomes))} outcomes={outcomes} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /unprotected/ })).toBeNull();
  });

  it('has no triggers without a breakdown', () => {
    const o = { ...outcomes, breakdown: undefined };
    render(<TaskStatLine tiles={taskTiles(metrics(o))} outcomes={o} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('24-hour fallback renders four values, no triggers', () => {
    render(<TaskStatLine tiles={taskTiles(metrics())} />);
    expect(screen.getByText('last 24 hours')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
