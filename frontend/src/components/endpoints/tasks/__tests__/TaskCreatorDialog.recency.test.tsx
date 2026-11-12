import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getTestRecency: vi.fn(),
  getAllTests: vi.fn(),
  getBuildInfo: vi.fn(),
}));
const caps = vi.hoisted(() => ({ testRunRecency: true }));

vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'admin',
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ randomizedOnce: false, testRunRecency: caps.testRunRecency }),
}));
vi.mock('@/services/api/agent', () => ({
  agentApi: { listAgents: api.listAgents, getTestRecency: api.getTestRecency },
}));
vi.mock('@/services/api/browser', () => ({ browserApi: { getAllTests: api.getAllTests, getBuildInfo: api.getBuildInfo } }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { listIndices: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: { getAzureSettings: vi.fn().mockResolvedValue({ configured: false }) },
}));

import TaskCreatorDialog from '../TaskCreatorDialog';

const agent = (id: string, hostname: string) => ({
  id, org_id: 'org-1', hostname, os: 'windows', arch: 'amd64', agent_version: '0.7.3',
  status: 'active', runtime_status: 'idle', last_heartbeat: null, tags: [], is_online: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  caps.testRunRecency = true;
  api.listAgents.mockResolvedValue({ agents: [agent('a-tested', 'host-tested'), agent('a-fresh', 'host-fresh')], total: 2 });
  api.getAllTests.mockResolvedValue([{ uuid: 'uuid-a', name: 'Test A', techniques: [], isMultiStage: false, stages: [] }]);
  api.getBuildInfo.mockResolvedValue({ exists: true, filename: 'uuid-a.exe' });
  // a-tested ran some other test recently, but never Test A.
  api.getTestRecency.mockImplementation(async (testUuids: string[] = []) => ({
    testUuids,
    runs: [],
    agents: [{ agent_id: 'a-tested', last_run_at: new Date().toISOString(), queued: false }],
  }));
});

describe('TaskCreatorDialog "Not run" filter', () => {
  it('filters by any test before a test is picked', async () => {
    render(<TaskCreatorDialog open onClose={() => {}} />);
    const scope = (await screen.findByLabelText('Not run: which test')) as HTMLSelectElement;
    expect(api.getTestRecency).toHaveBeenCalledWith([]);
    expect(scope.value).toBe('any');

    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: 'never' } });
    expect(screen.queryByText(/host-tested/)).toBeNull();
    expect(screen.getByText(/host-fresh/)).toBeInTheDocument();
  });

  it('re-reads the history for the picked test and switches to "this test"', async () => {
    render(<TaskCreatorDialog open onClose={() => {}} />);
    fireEvent.focus(await screen.findByPlaceholderText('Search tests...'));
    await userEvent.click(await screen.findByText('Test A'));

    await waitFor(() => expect(api.getTestRecency).toHaveBeenLastCalledWith(['uuid-a']));
    const scope = screen.getByLabelText('Not run: which test') as HTMLSelectElement;
    await waitFor(() => expect(scope.value).toBe('test'));

    // Neither host ever ran Test A, so both are due.
    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: 'never' } });
    expect(await screen.findByText(/host-tested/)).toBeInTheDocument();
    expect(screen.getByText(/host-fresh/)).toBeInTheDocument();
  });

  it('shows no filter where the backend has no run history (Vercel)', async () => {
    caps.testRunRecency = false;
    render(<TaskCreatorDialog open onClose={() => {}} />);
    await screen.findByText(/host-fresh/);
    expect(api.getTestRecency).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Not run: which test')).toBeNull();
  });
});
