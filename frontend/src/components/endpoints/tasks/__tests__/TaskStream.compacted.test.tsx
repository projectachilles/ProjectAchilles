import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import TaskStream from '../TaskStream';

function groupWith(compactedAt?: string): TaskGroup {
  const task: AgentTask = {
    id: 'task-1',
    agent_id: 'agent-1',
    agent_hostname: 'host-1',
    type: 'execute_test',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: 'uuid-1', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code: 126,
      stdout: '',
      stderr: 'tail',
      execution_duration_ms: 1200,
      started_at: '2026-07-28T12:00:30Z',
      completed_at: '2026-07-28T12:01:00Z',
      hostname: 'host-1',
      ...(compactedAt ? { compacted_at: compactedAt } : {}),
    },
    notes: null,
    notes_history: [],
    created_at: '2026-07-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-07-28 12:01:00',
    batch_id: 'batch-0001',
  };
  return {
    batch_id: task.batch_id,
    type: task.type,
    payload: task.payload,
    created_at: task.created_at,
    created_by: 'user-1',
    agent_count: 1,
    status_counts: { completed: 1 },
    tasks: [task],
  };
}

describe('TaskStream compacted output notice', () => {
  it('explains that the output was removed by the retention policy', () => {
    const iso = '2026-11-01T12:00:00.000Z';
    render(<TaskStream groups={[groupWith(iso)]} loading={false} />);
    const notice = screen.getByTestId('output-compacted-notice');
    expect(notice.textContent).toContain(
      `Full output removed by the retention policy on ${new Date(iso).toLocaleString()}. Exit code and stage results are kept.`,
    );
  });

  it('shows no notice for a result that was never compacted', () => {
    render(<TaskStream groups={[groupWith()]} loading={false} />);
    expect(screen.queryByTestId('output-compacted-notice')).toBeNull();
  });
});
