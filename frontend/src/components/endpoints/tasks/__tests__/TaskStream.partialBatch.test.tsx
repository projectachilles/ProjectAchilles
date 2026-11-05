import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskStream from '../TaskStream';
import type { AgentTask, TaskGroup } from '@/types/agent';

// With a breakdown filter the backend lists only a batch's matching tasks while
// agent_count still describes the whole batch, so the header says how many of
// the batch's agents are shown.

function task(id: string, agent: string): AgentTask {
  return {
    id,
    agent_id: agent,
    agent_hostname: `HOST-${agent}`,
    type: 'execute_test',
    priority: 5,
    status: 'failed',
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code: -1, stdout: '', stderr: '', execution_duration_ms: 0, error: 'Agent went offline during execution',
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: `HOST-${agent}`,
    },
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:01:00',
    batch_id: 'batch-1',
  };
}

function group(tasks: AgentTask[], agentCount: number): TaskGroup {
  return {
    batch_id: 'batch-1', type: 'execute_test', payload: tasks[0].payload, created_at: tasks[0].created_at,
    created_by: 'u', agent_count: agentCount, status_counts: { failed: agentCount }, tasks,
  };
}

describe('TaskStream batch header agent count', () => {
  it('says "1 of 5 agents" when only part of the batch is listed', () => {
    render(<TaskStream groups={[group([task('t1', 'a1')], 5)]} loading={false} />);
    const header = screen.getByRole('button', { name: /batch · LockBit Chain/ });
    expect(header.textContent).toContain('1 of 5 agents');
  });

  it('keeps "N agents" when the whole batch is listed', () => {
    render(<TaskStream groups={[group([task('t1', 'a1'), task('t2', 'a2')], 2)]} loading={false} />);
    const header = screen.getByRole('button', { name: /batch · LockBit Chain/ });
    expect(header.textContent).toContain('2 agents');
    expect(header.textContent).not.toContain(' of ');
  });
});
