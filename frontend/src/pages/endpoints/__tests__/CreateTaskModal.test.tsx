import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CreateTaskModal } from '../components/CreateTaskModal';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listAgents: vi.fn().mockResolvedValue([]),
    createTasks: vi.fn().mockResolvedValue(['t1']),
    createCommandTasks: vi.fn().mockResolvedValue(['t1']),
  },
}));
vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getAllTests: vi.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateTaskModal', () => {
  it('renders the title and the segmented controls', async () => {
    render(<CreateTaskModal onClose={() => {}} />);
    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Security Test/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Command/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run Now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Schedule/i })).toBeInTheDocument();
  });

  it('shows the timeout / priority / target index fields', async () => {
    render(<CreateTaskModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Timeout (sec)')).toBeInTheDocument();
    });
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Target Index')).toBeInTheDocument();
  });

  it('shows the no-agents-match empty state when listAgents returns empty', async () => {
    render(<CreateTaskModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('No agents match')).toBeInTheDocument();
    });
  });
});
