import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskStatusBadge } from '../TaskStatusBadge';
import type { AgentTask, TaskResult } from '@/types/agent';

const res = (exit_code: number): TaskResult => ({
  exit_code,
  stdout: '',
  stderr: '',
  started_at: '',
  completed_at: '',
  execution_duration_ms: 0,
  hostname: '',
} as TaskResult);

const task = (status: AgentTask['status'], result: TaskResult | null = null) =>
  ({ status, result } as Pick<AgentTask, 'status' | 'result'>);

describe('TaskStatusBadge', () => {
  it('renders "Failed" for a completed task with non-zero exit code', () => {
    const { container } = render(<TaskStatusBadge task={task('completed', res(1))} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(container.firstElementChild?.className ?? '').not.toMatch(/green-500/);
  });

  it('renders "Completed" for a clean exit', () => {
    render(<TaskStatusBadge task={task('completed', res(0))} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders the label as text (color never alone)', () => {
    render(<TaskStatusBadge task={task('executing')} />);
    expect(screen.getByText('Executing')).toBeInTheDocument();
  });
});
