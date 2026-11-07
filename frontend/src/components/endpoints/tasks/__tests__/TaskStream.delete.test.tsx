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

describe('TaskStream delete action', () => {
  it.each(['completed', 'failed', 'expired'] as const)('offers Delete for a %s task', (status) => {
    const onDelete = vi.fn();
    render(<TaskStream groups={[makeGroup(makeTask({ status }))]} loading={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('task-1');
  });

  it.each(['pending', 'assigned', 'downloading', 'executing'] as const)('hides Delete for a %s task (cancel it instead)', (status) => {
    render(<TaskStream groups={[makeGroup(makeTask({ status, result: null }))]} loading={false} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });
});
