import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EndpointsAgentsPage from '../EndpointsAgentsPage';
import type { AgentSummary } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listAgents: vi.fn(),
    listVersions: vi.fn().mockResolvedValue([]),
    getAutoRotationSettings: vi.fn().mockResolvedValue({ enabled: true, intervalDays: 90 }),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
  useCanAccessModule: () => true,
  useAppRole: () => 'admin',
}));

import { agentApi } from '@/services/api/agent';

const fixtureAgents: AgentSummary[] = [
  {
    id: 'a1',
    org_id: 'default',
    hostname: 'WIN-LAB-01',
    os: 'windows',
    arch: 'amd64',
    agent_version: '0.5.4',
    status: 'active',
    runtime_status: 'idle',
    last_heartbeat: new Date(Date.now() - 30_000).toISOString(),
    tags: ['lab', 'windows'],
    is_online: true,
    health_score: 92,
  },
  {
    id: 'a2',
    org_id: 'default',
    hostname: 'LX-PROD-02',
    os: 'linux',
    arch: 'arm64',
    agent_version: '0.5.4',
    status: 'active',
    runtime_status: 'idle',
    last_heartbeat: null,
    tags: [],
    is_online: false,
    health_score: 30,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentApi.listAgents).mockResolvedValue(fixtureAgents);
});

describe('EndpointsAgentsPage', () => {
  it('renders the page header and agent rows', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/agents']}>
        <EndpointsAgentsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    });
    expect(screen.getByText('WIN-LAB-01')).toBeInTheDocument();
    expect(screen.getByText('LX-PROD-02')).toBeInTheDocument();
  });

  it('shows the Enroll Agent button when permitted', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/agents']}>
        <EndpointsAgentsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enroll Agent/i })).toBeInTheDocument();
    });
  });

  it('renders OS pills and health badges', async () => {
    render(
      <MemoryRouter initialEntries={['/endpoints/agents']}>
        <EndpointsAgentsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Health 92 (good) and 30 (poor) badges should render numeric
      expect(screen.getByText('92')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
    });
  });
});
