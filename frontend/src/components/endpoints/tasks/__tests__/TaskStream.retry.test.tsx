import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskStream from '../TaskStream';
import type { AgentTask, TaskGroup } from '@/types/agent';

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    agent_id: 'agent-1',
    agent_hostname: 'host-1',
    type: 'execute_test',
    priority: 5,
    status: 'failed',
    payload: {
      test_uuid: 'uuid-1',
      test_name: 'BitLocker Check',
      binary_name: 'test.exe',
      execution_timeout: 300,
    },
    result: {
      exit_code: 1,
      stdout: '',
      stderr: '',
      execution_duration_ms: 1200,
      started_at: '2026-08-31T12:00:30Z',
      completed_at: '2026-08-31T12:01:00Z',
      hostname: 'host-1',
    },
    notes: null,
    notes_history: [],
    created_at: '2026-08-31 12:00:00',
    assigned_at: null,
    completed_at: '2026-08-31 12:01:00',
    batch_id: 'batch-0001',
    ...overrides,
  };
}

function makeGroup(task: AgentTask): TaskGroup {
  return {
    batch_id: task.batch_id,
    type: task.type,
    payload: task.payload,
    created_at: task.created_at,
    created_by: 'user-1',
    agent_count: 1,
    status_counts: { [task.status]: 1 },
    tasks: [task],
  };
}

describe('TaskStream retry action', () => {
  it('shows Retry for a failed execute_test task and calls onRetry', () => {
    const onRetry = vi.fn();
    render(
      <TaskStream groups={[makeGroup(makeTask())]} loading={false} onRetry={onRetry} />
    );

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledWith('task-1');
  });

  it('hides Retry while the task is still active', () => {
    render(
      <TaskStream
        groups={[makeGroup(makeTask({ status: 'executing', result: null }))]}
        loading={false}
        onRetry={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('hides Retry for command tasks (stricter permission applies)', () => {
    const cmdTask = makeTask({
      type: 'execute_command',
      payload: {
        test_uuid: '',
        test_name: '',
        binary_name: '',
        execution_timeout: 60,
        command: 'whoami',
      },
    });
    render(<TaskStream groups={[makeGroup(cmdTask)]} loading={false} onRetry={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('hides Retry when no onRetry handler is provided (no permission)', () => {
    render(<TaskStream groups={[makeGroup(makeTask())]} loading={false} />);

    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows the retry lineage in the detail header for retry clones', () => {
    render(
      <TaskStream
        groups={[makeGroup(makeTask({ retry_count: 1, max_retries: 2, original_task_id: 'task-0' }))]}
        loading={false}
      />
    );

    expect(screen.getByText(/retry 1\/2/)).toBeInTheDocument();
  });
});
