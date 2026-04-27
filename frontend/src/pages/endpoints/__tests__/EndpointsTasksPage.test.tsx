import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EndpointsTasksPage from '../EndpointsTasksPage';
import type { TaskGroup } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listTasksGrouped: vi.fn(),
    listSchedules: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
  useCanAccessModule: () => true,
  useAppRole: () => 'admin',
}));

import { agentApi } from '@/services/api/agent';

const fixtureGroups: TaskGroup[] = [
  {
    batch_id: 'b-1',
    type: 'execute_test',
    payload: {
      test_uuid: 't-1',
      test_name: 'Cyber-Hygiene Bundle',
      binary_name: 't-1',
      execution_timeout: 300,
    },
    created_at: new Date(Date.now() - 60_000).toISOString(),
    created_by: 'admin',
    agent_count: 3,
    status_counts: { completed: 2, failed: 1 },
    tasks: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentApi.listTasksGrouped).mockResolvedValue({ groups: fixtureGroups, total: 1 });
});

describe('EndpointsTasksPage', () => {
  it('renders the page header, sections, and a task group row', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/tasks']}>
        <EndpointsTasksPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    });
    expect(screen.getByText('Scheduled Tasks')).toBeInTheDocument();
    expect(screen.getByText('Executions')).toBeInTheDocument();
    expect(screen.getByText('Cyber-Hygiene Bundle')).toBeInTheDocument();
  });

  it('shows the Create Task button', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/tasks']}>
        <EndpointsTasksPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Task/i })).toBeInTheDocument();
    });
  });

  it('shows the empty schedules state when no schedules exist', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/tasks']}>
        <EndpointsTasksPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No scheduled tasks')).toBeInTheDocument();
    });
  });
});
