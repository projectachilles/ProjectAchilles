import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import TaskStream from '../TaskStream';

function group(): TaskGroup {
  const task: AgentTask = {
    id: 'task-1', agent_id: 'agent-1', agent_hostname: 'HOST-01', type: 'execute_test', priority: 5,
    status: 'completed',
    payload: { test_uuid: 'uuid-1', test_name: 'Test One', binary_name: 't.exe', execution_timeout: 300 },
    result: { exit_code: 126, stdout: '', stderr: '', execution_duration_ms: 1000,
      started_at: '2026-07-28T12:00:30Z', completed_at: '2026-07-28T12:01:00Z', hostname: 'HOST-01' },
    notes: null, notes_history: [], created_at: '2026-07-28 12:00:00', assigned_at: null,
    completed_at: '2026-07-28 12:01:00', batch_id: 'batch-0001',
  };
  return { batch_id: task.batch_id, type: task.type, payload: task.payload, created_at: task.created_at,
    created_by: 'user-1', agent_count: 1, status_counts: { completed: 1 }, tasks: [task] };
}

describe('TaskStream footer and fill', () => {
  it('renders the footer inside the list pane', () => {
    render(<TaskStream groups={[group()]} loading={false} footer={<div data-testid="foot">pager</div>} />);
    const pane = screen.getByTestId('task-list-pane');
    expect(pane.contains(screen.getByTestId('foot'))).toBe(true);
  });

  it('scrolls the list body on its own with fill', () => {
    render(<TaskStream groups={[group()]} loading={false} fill footer={<div>pager</div>} />);
    expect(screen.getByTestId('task-list-scroll').className).toContain('overflow-auto');
    expect(screen.getByTestId('task-list-pane').className).toContain('flex-col');
  });

  it('does not make the list body scroll without fill', () => {
    render(<TaskStream groups={[group()]} loading={false} />);
    expect(screen.getByTestId('task-list-scroll').className).not.toContain('overflow-auto');
  });

  it('keeps the footer when the page is empty', () => {
    render(<TaskStream groups={[]} loading={false} footer={<div data-testid="foot">pager</div>} />);
    expect(screen.getByText('No tasks found')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-pane').contains(screen.getByTestId('foot'))).toBe(true);
  });
});
