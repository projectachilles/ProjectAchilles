import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTask, TaskGroup } from '@/types/agent';
import TaskStream from '../TaskStream';

function task(n: number, batch: string, created: string, exit_code = 126): AgentTask {
  return {
    id: `t${n}`,
    agent_id: `agent-${n}`,
    agent_hostname: `HOST-${n}`,
    type: 'execute_test',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: 'u', test_name: `Test ${batch}`, binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code, stdout: '', stderr: '', execution_duration_ms: 700,
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: `HOST-${n}`,
    },
    notes: null,
    notes_history: [],
    created_at: created,
    assigned_at: null,
    completed_at: created,
    batch_id: batch,
  };
}

function group(batch: string, tasks: AgentTask[]): TaskGroup {
  return {
    batch_id: batch, type: 'execute_test', payload: tasks[0].payload, created_at: tasks[0].created_at,
    created_by: 'u', agent_count: tasks.length, status_counts: {}, tasks,
  };
}

/** Two runs on two days: A has HOST-1 and HOST-2, B has HOST-3. */
const twoRuns = () => [
  group('A', [task(1, 'A', '2026-10-28 12:00:00'), task(2, 'A', '2026-10-28 12:00:00')]),
  group('B', [task(3, 'B', '2026-10-27 09:00:00')]),
];
const big = () => group('BIG', Array.from({ length: 81 }, (_, i) => task(i + 1, 'BIG', '2026-10-28 12:00:00', i < 20 ? 101 : 126)));

const mark = (host: string) => screen.getByRole('button', { name: new RegExp(`^${host}: `) });

describe('TaskStream run timeline', () => {
  it('shows one entry per run under a separator for each day', () => {
    render(<TaskStream groups={twoRuns()} loading={false} />);
    expect(screen.getAllByRole('separator').map((s) => s.textContent)).toEqual(['Oct 28', 'Oct 27']);
    expect(screen.getByRole('group', { name: /^Test A, / })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Test B, / })).toBeInTheDocument();
  });

  it('selects the first task by default and shows its detail', () => {
    render(<TaskStream groups={twoRuns()} loading={false} />);
    expect(mark('HOST-1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByText('HOST-1')).toHaveLength(2); // its pill and the detail's Agent field
    expect(screen.getAllByText('HOST-2')).toHaveLength(1);
  });

  it('moves the selection and the detail to a clicked mark, across runs', async () => {
    render(<TaskStream groups={twoRuns()} loading={false} />);
    await userEvent.click(mark('HOST-3'));
    expect(mark('HOST-3')).toHaveAttribute('aria-current', 'true');
    expect(mark('HOST-1')).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText('HOST-3')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Test B' })).toBeInTheDocument();
  });

  it('moves focus between marks with the arrow keys, across runs, and stops at the ends', async () => {
    const user = userEvent.setup();
    render(<TaskStream groups={twoRuns()} loading={false} />);
    mark('HOST-1').focus();
    await user.keyboard('{ArrowLeft}');
    expect(mark('HOST-1')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(mark('HOST-2')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(mark('HOST-3')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(mark('HOST-3')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(mark('HOST-2')).toHaveFocus();
  });

  it('keeps the selected task when the list is refreshed with new objects', async () => {
    const { rerender } = render(<TaskStream groups={twoRuns()} loading={false} />);
    await userEvent.click(mark('HOST-2'));
    rerender(<TaskStream groups={twoRuns()} loading={false} />);
    expect(mark('HOST-2')).toHaveAttribute('aria-current', 'true');
  });

  it('checks "select all on page" only when every task is selected, and reports a click', async () => {
    const onToggleSelectAll = vi.fn();
    const props = { groups: twoRuns(), loading: false, onToggleSelect: () => {}, onToggleSelectAll };
    const { rerender } = render(<TaskStream {...props} selectedTasks={['t1', 't2']} />);
    const all = () => screen.getByRole('checkbox', { name: 'Select all on page' });
    expect(all()).not.toBeChecked();
    await userEvent.click(all());
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);
    rerender(<TaskStream {...props} selectedTasks={['t1', 't2', 't3']} />);
    expect(all()).toBeChecked();
  });

  it('passes task and run selection through to the entries', async () => {
    const onToggleSelect = vi.fn();
    const onToggleGroupSelect = vi.fn();
    render(<TaskStream groups={twoRuns()} loading={false} onToggleSelect={onToggleSelect} onToggleGroupSelect={onToggleGroupSelect} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every task of Test A' }));
    expect(onToggleGroupSelect).toHaveBeenCalledWith('A');
    await userEvent.click(within(screen.getByRole('group', { name: /^Test A, / })).getByRole('button', { name: 'Show hosts' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select HOST-2' }));
    expect(onToggleSelect).toHaveBeenCalledWith('t2');
  });

  it('renders no checkbox when tasks cannot be selected', async () => {
    render(<TaskStream groups={twoRuns()} loading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show hosts' }));
    expect(within(screen.getByTestId('task-list-pane')).queryByRole('checkbox')).toBeNull();
  });
});

describe('TaskStream during a reload', () => {
  it('keeps the entries, an open host list and the selection on screen, and marks the list busy', async () => {
    const { rerender } = render(<TaskStream groups={[big()]} loading={false} />);
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    await userEvent.click(within(screen.getByRole('list')).getAllByRole('listitem')[2]);
    const selected = () => within(screen.getByRole('list')).getAllByRole('listitem')[2].querySelector('[aria-current="true"]');
    expect(selected()).not.toBeNull();

    rerender(<TaskStream groups={[big()]} loading />);
    expect(screen.getByTestId('task-list-pane')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '20 unprotected' })).toHaveAttribute('aria-pressed', 'true');
    expect(selected()).not.toBeNull();
    expect(screen.queryByText('Loading tasks...')).toBeNull();

    rerender(<TaskStream groups={[big()]} loading={false} />);
    expect(screen.getByTestId('task-list-pane')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('shows the loading message when there is nothing to show yet', () => {
    render(<TaskStream groups={[]} loading />);
    expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
  });
});
