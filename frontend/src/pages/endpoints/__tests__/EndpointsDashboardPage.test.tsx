import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EndpointsDashboardPage from '../EndpointsDashboardPage';
import type { AgentMetrics, FleetHealthMetrics } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    getMetrics: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
    getFleetHealthMetrics: vi.fn(),
  },
}));

import { agentApi } from '@/services/api/agent';

const baseMetrics: AgentMetrics = {
  total: 6,
  online: 4,
  offline: 2,
  by_os: { windows: 3, linux: 2, darwin: 1 },
  by_status: { active: 5, decommissioned: 1 },
  pending_tasks: 3,
  task_activity_24h: { completed: 10, failed: 2, total: 14, success_rate: 71, in_progress: 2 },
  by_version: { '0.5.4': 6 },
};

const baseFleet: FleetHealthMetrics = {
  fleet_uptime_percent_30d: 98.4,
  task_success_rate_7d: 92.1,
  mtbf_hours: 12.5,
  stale_agent_count: 2,
  stale_agent_ids: ['a1', 'a2'],
  avg_health_score: 84,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentApi.getMetrics).mockResolvedValue(baseMetrics);
  vi.mocked(agentApi.getFleetHealthMetrics).mockResolvedValue(baseFleet);
});

describe('EndpointsDashboardPage', () => {
  it('renders the KPI labels and fleet aggregates', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/dashboard']}>
        <EndpointsDashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Agent Dashboard')).toBeInTheDocument();
    });
    expect(screen.getByText('Total Agents')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Pending Tasks')).toBeInTheDocument();
    expect(screen.getByText('Fleet Uptime (30d)')).toBeInTheDocument();
    expect(screen.getByText('Avg Health')).toBeInTheDocument();
  });

  it('renders the stale-agents callout when stale agents exist', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/dashboard']}>
        <EndpointsDashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/2 stale agents detected/)).toBeInTheDocument();
    });
  });

  it('renders OS distribution rows', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/dashboard']}>
        <EndpointsDashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('OS Distribution')).toBeInTheDocument();
    });
    expect(screen.getByText('windows')).toBeInTheDocument();
    expect(screen.getByText('linux')).toBeInTheDocument();
    expect(screen.getByText('darwin')).toBeInTheDocument();
  });
});
