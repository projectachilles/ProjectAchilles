import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TestMetadata } from '@/types/test';
import type { AgentSummary } from '@/types/agent';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createTasks: vi.fn(),
  createTasksBatch: vi.fn(),
  createSchedule: vi.fn(),
  getBuildInfo: vi.fn(),
  listIndices: vi.fn(),
  getAzureSettings: vi.fn(),
}));

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listAgents: api.listAgents,
    createTasks: api.createTasks,
    createTasksBatch: api.createTasksBatch,
    createSchedule: api.createSchedule,
  },
}));
vi.mock('@/services/api/browser', () => ({ browserApi: { getBuildInfo: api.getBuildInfo } }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { listIndices: api.listIndices } }));
vi.mock('@/services/api/integrations', () => ({ integrationsApi: { getAzureSettings: api.getAzureSettings } }));

const caps = vi.hoisted(() => ({ preExecutionNotices: true, randomizedOnce: false }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ preExecutionNotices: caps.preExecutionNotices, randomizedOnce: caps.randomizedOnce }),
}));

const { default: ExecutionDrawer } = await import('../ExecutionDrawer');

const test = (uuid: string, name: string): TestMetadata => ({
  uuid,
  name,
  techniques: [],
  isMultiStage: false,
  stages: [],
});

const AGENT: AgentSummary = {
  id: 'agent-1',
  org_id: 'org-1',
  hostname: 'host-1',
  os: 'windows',
  arch: 'amd64',
  agent_version: '0.7.0',
  status: 'active',
  runtime_status: 'idle',
  last_heartbeat: null,
  tags: [],
  is_online: true,
} as AgentSummary;

beforeEach(() => {
  vi.clearAllMocks();
  caps.preExecutionNotices = true;
  caps.randomizedOnce = false;
  api.listAgents.mockResolvedValue({ agents: [AGENT], total: 1 });
  api.getBuildInfo.mockImplementation(async (uuid: string) => ({ exists: true, filename: `${uuid}.exe` }));
  api.listIndices.mockResolvedValue([]);
  api.getAzureSettings.mockResolvedValue({ configured: false });
});

async function selectAgentAndExecute() {
  await userEvent.click(await screen.findByRole('checkbox', { name: /host-1/ }));
  const execute = screen.getByRole('button', { name: /Execute \(1\)/ });
  await waitFor(() => expect(execute).toBeEnabled());
  await userEvent.click(execute);
}

describe('ExecutionDrawer Run Now', () => {
  it('runs several selected tests with ONE batch call (one pre-execution notice)', async () => {
    api.createTasksBatch.mockResolvedValue([['t-a'], ['t-b']]);
    render(<ExecutionDrawer open onClose={() => {}} tests={[test('uuid-a', 'Test A'), test('uuid-b', 'Test B')]} />);

    await selectAgentAndExecute();

    await waitFor(() => expect(api.createTasksBatch).toHaveBeenCalledTimes(1));
    expect(api.createTasks).not.toHaveBeenCalled();
    const body = api.createTasksBatch.mock.calls[0][0];
    expect(body.org_id).toBe('org-1');
    expect(body.requests.map((r: { test_uuid: string; binary_name: string; agent_ids: string[] }) => [r.test_uuid, r.binary_name, r.agent_ids])).toEqual([
      ['uuid-a', 'uuid-a.exe', ['agent-1']],
      ['uuid-b', 'uuid-b.exe', ['agent-1']],
    ]);
    expect(await screen.findByText('Created 2 task(s) for 1 agent(s)')).toBeInTheDocument();
  });

  it('splits a selection over the server limit into batches of 50', async () => {
    api.createTasksBatch.mockImplementation(async (d: { requests: unknown[] }) => d.requests.map((_, i) => [`t-${i}`]));
    const many = Array.from({ length: 51 }, (_, i) => test(`uuid-${i}`, `Test ${i}`));
    render(<ExecutionDrawer open onClose={() => {}} tests={many} />);

    await selectAgentAndExecute();

    await waitFor(() => expect(api.createTasksBatch).toHaveBeenCalledTimes(2));
    expect(api.createTasksBatch.mock.calls.map((c) => c[0].requests.length)).toEqual([50, 1]);
    expect(await screen.findByText('Created 51 task(s) for 1 agent(s)')).toBeInTheDocument();
  });

  it('a single test still uses the single-test route', async () => {
    api.createTasks.mockResolvedValue(['t-a']);
    render(<ExecutionDrawer open onClose={() => {}} tests={[test('uuid-a', 'Test A')]} />);

    await selectAgentAndExecute();

    await waitFor(() => expect(api.createTasks).toHaveBeenCalledTimes(1));
    expect(api.createTasksBatch).not.toHaveBeenCalled();
    expect(await screen.findByText('Created 1 task(s) for 1 agent(s)')).toBeInTheDocument();
  });

  it('shows the batch error and creates nothing else', async () => {
    api.createTasksBatch.mockRejectedValue(new Error('No binary was built for OS windows'));
    render(<ExecutionDrawer open onClose={() => {}} tests={[test('uuid-a', 'Test A'), test('uuid-b', 'Test B')]} />);

    await selectAgentAndExecute();

    expect(await screen.findByText('Error: No binary was built for OS windows')).toBeInTheDocument();
    expect(api.createTasks).not.toHaveBeenCalled();
  });

  it('without the notices capability (Vercel) sends one POST per test and never the batch route', async () => {
    caps.preExecutionNotices = false;
    api.createTasks.mockResolvedValue(['t-x']);
    render(<ExecutionDrawer open onClose={() => {}} tests={[test('uuid-a', 'Test A'), test('uuid-b', 'Test B')]} />);

    await selectAgentAndExecute();

    await waitFor(() => expect(api.createTasks).toHaveBeenCalledTimes(2));
    expect(api.createTasksBatch).not.toHaveBeenCalled();
    expect(api.createTasks.mock.calls.map((c) => c[0].test_uuid)).toEqual(['uuid-a', 'uuid-b']);
    expect(await screen.findByText('Created 2 task(s) for 1 agent(s)')).toBeInTheDocument();
  });
});

describe('ExecutionDrawer Schedule Once', () => {
  it('sends a randomized Once with its timing mode', async () => {
    caps.randomizedOnce = true;
    api.createSchedule.mockResolvedValue({});
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
    const { container } = render(<ExecutionDrawer open onClose={() => {}} tests={[test('uuid-a', 'Test A')]} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /host-1/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    await userEvent.click(screen.getByRole('button', { name: 'once' }));
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: tomorrow } });
    await userEvent.selectOptions(screen.getByDisplayValue('Fixed time'), 'per_machine');
    const submit = screen.getByRole('button', { name: /Schedule \(1\)/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(api.createSchedule).toHaveBeenCalledTimes(1));
    expect(api.createSchedule.mock.calls[0][0]).toMatchObject({
      schedule_type: 'once',
      schedule_config: { date: tomorrow, time: '09:00', randomize_mode: 'per_machine' },
    });
  });
});
