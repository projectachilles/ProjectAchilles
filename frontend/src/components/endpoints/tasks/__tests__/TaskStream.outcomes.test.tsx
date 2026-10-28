import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TaskStream from '../TaskStream';
import type { AgentTask, TaskGroup } from '@/types/agent';

function testTask(id: string, exit_code: number, status: AgentTask['status'] = 'completed'): AgentTask {
  return {
    id,
    agent_id: `agent-${id}`,
    agent_hostname: `HOST-${id}`,
    type: 'execute_test',
    priority: 5,
    status,
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code, stdout: '', stderr: '', execution_duration_ms: 700,
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: `HOST-${id}`,
      ...(exit_code === -1 ? { error: 'Agent went offline during execution' } : {}),
    },
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:01:00',
    batch_id: 'batch-1',
  };
}

const tasks = [testTask('a', 126), testTask('b', -1, 'failed'), testTask('c', 999), testTask('d', 260)];
const group: TaskGroup = {
  batch_id: 'batch-1', type: 'execute_test', payload: tasks[0].payload, created_at: tasks[0].created_at,
  created_by: 'u', agent_count: 4, status_counts: { completed: 3, failed: 1 }, tasks,
};

describe('TaskStream test outcomes', () => {
  it('labels exit 126 Protected in the pane, never Failed', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.getAllByText('Protected').length).toBeGreaterThan(0);
    expect(screen.getByText(/execution prevented/)).toBeTruthy();
  });

  it('names each row by its outcome', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    for (const word of ['protected', 'run failed', 'test error', 'not run']) {
      expect(screen.getByText(word)).toBeTruthy();
    }
  });

  it('counts the batch by outcome: 1 protected, 3 that produced no verdict', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    const header = screen.getByRole('button', { name: /batch · LockBit Chain/ });
    expect(within(header).getByText('1').className).toContain('text-accent');
    expect(within(header).getByText('3').className).toContain('text-warning');
    expect(header.textContent).not.toMatch(/✕/);
  });
});
