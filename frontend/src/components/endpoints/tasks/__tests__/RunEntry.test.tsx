import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTask, TaskGroup } from '@/types/agent';
import { RunEntry, type RunEntryProps } from '../RunEntry';
import { HOST_LIST_PAGE } from '../runMarks';

const baseResult = {
  exit_code: 126, stdout: '', stderr: '', execution_duration_ms: 700,
  started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: 'h',
};

function task(n: number | string, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: `t${n}`,
    agent_id: `agent-${n}`,
    agent_hostname: `HOST-${n}`,
    type: 'execute_test',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: baseResult,
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:01:00',
    batch_id: 'batch-1',
    ...overrides,
  };
}

/** A finished test whose stages exited with these codes. */
const staged = (n: number | string, codes: number[], exit_code = codes[codes.length - 1]) =>
  task(n, {
    result: {
      ...baseResult,
      exit_code,
      bundle_results: { controls: codes.map((c, i) => ({ control_id: `S${i + 1}`, exit_code: c })) },
    },
  });
const unprotected = (n: number | string) => task(n, { result: { ...baseResult, exit_code: 101 } });

function group(tasks: AgentTask[], overrides: Partial<TaskGroup> = {}): TaskGroup {
  return {
    batch_id: 'batch-1',
    type: tasks[0]?.type ?? 'execute_test',
    payload: tasks[0]?.payload ?? ({} as TaskGroup['payload']),
    created_at: '2026-10-28 12:00:00',
    created_by: 'u',
    agent_count: new Set(tasks.map((t) => t.agent_id)).size,
    status_counts: {},
    tasks,
    ...overrides,
  };
}

const many = (count: number, make: (n: number) => AgentTask = (n) => task(n)) =>
  Array.from({ length: count }, (_, i) => make(i + 1));

function setup(g: TaskGroup, props: Partial<RunEntryProps> = {}) {
  const onSelectTask = vi.fn();
  const utils = render(
    <RunEntry group={g} selectedTaskId={null} onSelectTask={onSelectTask} checkedTaskIds={[]} {...props} />,
  );
  return { ...utils, onSelectTask };
}

const marks = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-task-mark]'));

afterEach(() => vi.restoreAllMocks());

describe('RunEntry, named form (up to 8 tasks)', () => {
  it('writes the name once and draws a pill per host with its stage squares', () => {
    const { container } = setup(group(many(4, (n) => staged(n, [101, 126]))));
    expect(screen.getByRole('group', { name: /^LockBit Chain, / })).toBeInTheDocument();
    expect(screen.getAllByText('LockBit Chain')).toHaveLength(1);
    expect(marks(container)).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^HOST-\d: Protected$/ })).toHaveLength(4);
    expect(screen.getAllByRole('img', { name: 'Stage 1 not blocked, stage 2 blocked' })).toHaveLength(4);
    expect(screen.getByText('HOST-3')).toBeInTheDocument();
  });

  it('names a mark by its host and its outcome or status', () => {
    const cmd = { test_uuid: '', test_name: '', binary_name: '', execution_timeout: 60 } as AgentTask['payload'];
    setup(
      group([
        task(1),
        task(2, { status: 'executing', result: null }),
        task(3, { type: 'execute_command', payload: cmd, result: { ...baseResult, exit_code: 0 } }),
        task(4, { type: 'execute_command', payload: cmd, status: 'failed', result: { ...baseResult, exit_code: 1 } }),
      ]),
    );
    expect(screen.getByRole('button', { name: 'HOST-1: Protected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HOST-2: Executing' })).toHaveTextContent('executing…');
    expect(screen.getByRole('button', { name: 'HOST-3: Completed, exit 0' })).toHaveTextContent('✓ exit 0');
    expect(screen.getByRole('button', { name: 'HOST-4: Failed, exit 1' })).toHaveTextContent('✕ exit 1');
  });

  it('draws a command the agent finished with a non-zero exit code as failed, not as a success', () => {
    const cmd = { test_uuid: '', test_name: '', binary_name: '', execution_timeout: 60 } as AgentTask['payload'];
    setup(group([task(1, { type: 'execute_command', payload: cmd, status: 'completed', result: { ...baseResult, exit_code: 1 } })]));
    const mark = screen.getByRole('button', { name: 'HOST-1: Failed, exit 1' });
    expect(mark).toHaveTextContent('✕ exit 1');
    expect(mark).not.toHaveTextContent('✓');
  });

  it('renders one pill and no hosts toggle for a single task', () => {
    const { container } = setup(group([task(1)]));
    expect(marks(container)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /hosts$/ })).toBeNull();
  });

  it('shows the run tag of its notice', () => {
    const notice = { id: 'n1', run_tag: 'PA-RUN-0872f1', state: 'sent' as const, last_error: null, release_at: null, pickup_deadline: null };
    setup(group([task(1, { notice_id: 'n1' }), task(2, { notice_id: 'n1' })], { notices: { n1: notice } }));
    expect(screen.getByText('PA-RUN-0872f1')).toBeInTheDocument();
  });
});

describe('RunEntry, squares form (9 to 80 tasks)', () => {
  it('draws one square per task, no hostnames, and a count line', () => {
    const tasks = many(22, (n) => (n <= 3 ? unprotected(n) : task(n)));
    const { container } = setup(group(tasks));
    expect(marks(container)).toHaveLength(22);
    expect(screen.queryByText('HOST-5')).toBeNull();
    expect(screen.getByRole('button', { name: 'HOST-2: Unprotected' })).toBeInTheDocument();
    expect(screen.getByText('3 unprotected')).toBeInTheDocument();
    expect(screen.getByText('19 protected')).toBeInTheDocument();
    expect(screen.getByText('22 agents')).toBeInTheDocument();
  });
});

describe('RunEntry, bar form (more than 80 tasks)', () => {
  const tasks = many(81, (n) => (n <= 20 ? unprotected(n) : task(n)));

  it('draws a bar and no marks until a segment is opened', async () => {
    const { container } = setup(group(tasks));
    expect(marks(container)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(HOST_LIST_PAGE);
    for (const row of rows) expect(row).toHaveTextContent('Unprotected');
  });

  it('reveals more rows on "Show n more"', async () => {
    setup(group(tasks));
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show 12 more' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('closes the list when its open segment is clicked again', async () => {
    setup(group(tasks));
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('RunEntry host list', () => {
  it('opens from "Show hosts" with every task, worst first, and a checkbox per row', async () => {
    const onToggleTask = vi.fn();
    setup(group([task(1), unprotected(2), task(3)]), { onToggleTask });
    const toggle = screen.getByRole('button', { name: 'Show hosts' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide hosts' })).toHaveAttribute('aria-expanded', 'true');
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByText(/^HOST-/).textContent)).toEqual(['HOST-2', 'HOST-1', 'HOST-3']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select HOST-2' }));
    expect(onToggleTask).toHaveBeenCalledWith('t2');
  });

  it('filters by a chip and says which one is on', async () => {
    setup(group([task(1), unprotected(2), task(3)]));
    await userEvent.click(screen.getByRole('button', { name: 'Show hosts' }));
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '2 protected' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '2 protected' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no row checkboxes when tasks cannot be selected', async () => {
    setup(group([task(1), task(2)]));
    await userEvent.click(screen.getByRole('button', { name: 'Show hosts' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('stays open on the same segment when the run is refreshed with new data', async () => {
    const before = many(81, (n) => (n <= 20 ? unprotected(n) : task(n)));
    const { rerender, onSelectTask } = setup(group(before));
    await userEvent.click(screen.getByRole('button', { name: '20 unprotected' }));
    const after = [...before, unprotected(82)];
    rerender(<RunEntry group={group(after)} selectedTaskId={null} onSelectTask={onSelectTask} checkedTaskIds={[]} />);
    expect(screen.getByRole('button', { name: '21 unprotected' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent('Unprotected');
  });
});

describe('RunEntry host list when its segment empties', () => {
  it('shows every task instead of an empty box once nothing is in progress any more', async () => {
    const running = many(81, (n) => (n <= 3 ? task(n, { status: 'executing', result: null }) : task(n)));
    const { rerender, onSelectTask } = setup(group(running));
    await userEvent.click(screen.getByRole('button', { name: '3 in progress' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);

    rerender(<RunEntry group={group(many(81))} selectedTaskId={null} onSelectTask={onSelectTask} checkedTaskIds={[]} />);
    expect(screen.queryByRole('button', { name: /in progress$/ })).toBeNull();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(HOST_LIST_PAGE);
  });
});

describe('RunEntry selection', () => {
  it('selects a task from a pill, a square and a list row, and marks the selected one', async () => {
    const named = setup(group([task(1), task(2)]), { selectedTaskId: 't2' });
    await userEvent.click(screen.getByRole('button', { name: 'HOST-1: Protected' }));
    expect(named.onSelectTask).toHaveBeenCalledWith('t1');
    expect(screen.getByRole('button', { name: 'HOST-2: Protected' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'HOST-1: Protected' })).not.toHaveAttribute('aria-current');
    named.unmount();

    const squares = setup(group(many(9)));
    await userEvent.click(screen.getByRole('button', { name: 'HOST-9: Protected' }));
    expect(squares.onSelectTask).toHaveBeenCalledWith('t9');
    await userEvent.click(screen.getByRole('button', { name: 'Show hosts' }));
    await userEvent.click(within(screen.getByRole('list')).getAllByRole('listitem')[0]);
    expect(squares.onSelectTask).toHaveBeenLastCalledWith('t1');
  });

  it('checks the run box only when every listed task is checked, and reports a click', async () => {
    const onToggleGroup = vi.fn();
    const g = group([task(1), task(2)]);
    const { rerender, onSelectTask } = setup(g, { onToggleGroup, checkedTaskIds: ['t1'] });
    const box = screen.getByRole('checkbox', { name: 'Select every task of LockBit Chain' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onToggleGroup).toHaveBeenCalledWith('batch-1');
    rerender(<RunEntry group={g} selectedTaskId={null} onSelectTask={onSelectTask} checkedTaskIds={['t1', 't2']} onToggleGroup={onToggleGroup} />);
    expect(screen.getByRole('checkbox', { name: 'Select every task of LockBit Chain' })).toBeChecked();
  });

  it('has no run checkbox when runs cannot be selected', () => {
    setup(group([task(1), task(2)]));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('RunEntry edge cases', () => {
  it('says "1 of 5 agents" for a batch listed in part, and keeps the named form', () => {
    const { container } = setup(group([task(1)], { agent_count: 5 }));
    expect(screen.getByText('1 of 5 agents')).toBeInTheDocument();
    expect(marks(container)).toHaveLength(1);
  });

  it('draws a retry as its own mark and a missing hostname as a dash, with no key warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = setup(
      group([task(1), task('1-retry', { agent_id: 'agent-1', agent_hostname: 'HOST-1' }), task(3, { agent_hostname: null })]),
    );
    expect(marks(container)).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'HOST-1: Protected' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '—: Protected' })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  it('names a command run by its task type when it has no test name', () => {
    const cmd = { test_uuid: '', test_name: '', binary_name: '', execution_timeout: 60 } as AgentTask['payload'];
    setup(group([task(1, { type: 'execute_command', payload: cmd })], { type: 'execute_command', payload: cmd }));
    expect(screen.getByRole('group', { name: /^execute command, / })).toBeInTheDocument();
  });
});
