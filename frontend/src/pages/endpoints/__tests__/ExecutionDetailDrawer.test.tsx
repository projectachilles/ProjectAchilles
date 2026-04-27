import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionDetailDrawer } from '../components/ExecutionDetailDrawer';
import type { AgentTask } from '@/types/agent';

const fixtureTask: AgentTask = {
  id: 'task-001',
  agent_id: 'agt-001',
  agent_hostname: 'WIN-LAB-01',
  type: 'execute_test',
  priority: 1,
  status: 'completed',
  payload: {
    test_uuid: 't-1',
    test_name: 'Defender Validation',
    binary_name: 't-1',
    execution_timeout: 300,
  },
  result: {
    exit_code: 0,
    stdout: 'Test passed.',
    stderr: '',
    started_at: new Date(Date.now() - 1500).toISOString(),
    completed_at: new Date().toISOString(),
    execution_duration_ms: 1500,
    hostname: 'WIN-LAB-01',
  },
  notes: null,
  notes_history: [],
  created_at: new Date(Date.now() - 5000).toISOString(),
  assigned_at: new Date(Date.now() - 3500).toISOString(),
  completed_at: new Date().toISOString(),
  batch_id: 'b-1',
};

describe('ExecutionDetailDrawer', () => {
  it('renders header, meta grid, and tabs', () => {
    render(<ExecutionDetailDrawer task={fixtureTask} onClose={() => {}} />);
    expect(screen.getByText(/Execution · WIN-LAB-01/)).toBeInTheDocument();
    expect(screen.getByText('Defender Validation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'stdout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'stderr' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raw JSON' })).toBeInTheDocument();
  });

  it('switches to the Raw JSON tab on click', () => {
    render(<ExecutionDetailDrawer task={fixtureTask} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raw JSON' }));
    // Raw JSON tab content includes the task id field
    expect(screen.getByText(/"task-001"/)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<ExecutionDetailDrawer task={fixtureTask} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(onClose).toHaveBeenCalled();
  });
});
