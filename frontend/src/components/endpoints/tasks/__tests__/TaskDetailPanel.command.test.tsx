import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentTask } from '@/types/agent';
import TaskDetailPanel from '../TaskDetailPanel';

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 't1',
    agent_id: 'agent-1',
    agent_hostname: 'HOST-1',
    type: 'execute_command',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: '', test_name: '', binary_name: '', execution_timeout: 60, command: 'sc query AchillesAgent' } as AgentTask['payload'],
    result: {
      exit_code: 0, stdout: 'STATE : 4 RUNNING', stderr: '', execution_duration_ms: 300,
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:00:01Z', hostname: 'HOST-1',
    },
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:00:01',
    batch_id: 'batch-1',
    ...overrides,
  };
}

describe('TaskDetailPanel command', () => {
  it('shows the command a command task ran, whole, with a copy button', () => {
    render(<TaskDetailPanel task={task()} />);
    expect(screen.getByText('Command')).toBeInTheDocument();
    expect(screen.getByText('sc query AchillesAgent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'execute command' })).toBeInTheDocument();
  });

  it('has no command block for a security test', () => {
    const payload = { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 } as AgentTask['payload'];
    render(<TaskDetailPanel task={task({ type: 'execute_test', payload })} />);
    expect(screen.queryByText('Command')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy command' })).toBeNull();
  });

  it('has no command block for a command task that carries no command text', () => {
    const payload = { test_uuid: '', test_name: '', binary_name: '', execution_timeout: 60 } as AgentTask['payload'];
    render(<TaskDetailPanel task={task({ payload })} />);
    expect(screen.queryByText('Command')).toBeNull();
  });
});
