import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EndpointsAgentDetailPage from '../EndpointsAgentDetailPage';
import type { Agent } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    getAgent: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
    getHeartbeatHistory: vi.fn().mockResolvedValue([]),
    getAgentEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    updateAgent: vi.fn(),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
  useCanAccessModule: () => true,
  useAppRole: () => 'admin',
}));

import { agentApi } from '@/services/api/agent';

const fixtureAgent: Agent = {
  id: 'agt-001',
  org_id: 'default',
  hostname: 'WIN-LAB-01',
  os: 'windows',
  arch: 'amd64',
  agent_version: '0.5.4',
  status: 'active',
  last_heartbeat: new Date(Date.now() - 30_000).toISOString(),
  last_heartbeat_data: null,
  enrolled_at: new Date(Date.now() - 86_400_000).toISOString(),
  enrolled_by: null,
  tags: ['lab'],
  health_score: 88,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentApi.getAgent).mockResolvedValue(fixtureAgent);
});

function renderAt(path = '/endpoints/agents/agt-001') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/endpoints/agents/:agentId" element={<EndpointsAgentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EndpointsAgentDetailPage', () => {
  it('renders the hostname header and tabs', async () => {
    renderAt();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'WIN-LAB-01' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heartbeat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Event Log' })).toBeInTheDocument();
  });

  it('honours ?tab=heartbeat URL param', async () => {
    renderAt('/endpoints/agents/agt-001?tab=heartbeat');
    await waitFor(() => {
      expect(screen.getByText('Period')).toBeInTheDocument();
    });
  });

  it('honours ?tab=events URL param', async () => {
    renderAt('/endpoints/agents/agt-001?tab=events');
    await waitFor(() => {
      // Filter chip strip on the event log tab
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Came Online' })).toBeInTheDocument();
    });
  });
});
