import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createSchedule: vi.fn(),
  getAllTests: vi.fn(),
  getBuildInfo: vi.fn(),
}));
const caps = vi.hoisted(() => ({ randomizedOnce: true }));

vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'admin',
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ randomizedOnce: caps.randomizedOnce }) }));
vi.mock('@/services/api/agent', () => ({ agentApi: { listAgents: api.listAgents, createSchedule: api.createSchedule } }));
vi.mock('@/services/api/browser', () => ({ browserApi: { getAllTests: api.getAllTests, getBuildInfo: api.getBuildInfo } }));
vi.mock('@/services/api/analytics', () => ({ analyticsApi: { listIndices: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: { getAzureSettings: vi.fn().mockResolvedValue({ configured: false }) },
}));

import TaskCreatorDialog from '../TaskCreatorDialog';

const AGENT = {
  id: 'agent-1', org_id: 'org-1', hostname: 'host-1', os: 'windows', arch: 'amd64', agent_version: '0.7.1',
  status: 'active', runtime_status: 'idle', last_heartbeat: null, tags: [], is_online: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  caps.randomizedOnce = true;
  api.listAgents.mockResolvedValue({ agents: [AGENT], total: 1 });
  api.getAllTests.mockResolvedValue([{ uuid: 'uuid-a', name: 'Test A', techniques: [], isMultiStage: false, stages: [] }]);
  api.getBuildInfo.mockResolvedValue({ exists: true, filename: 'uuid-a.exe' });
  api.createSchedule.mockResolvedValue({ name: null, test_name: 'Test A', schedule_type: 'once' });
});

async function openOnceSchedule() {
  const view = render(<TaskCreatorDialog open onClose={() => {}} selectedAgents={['agent-1']} />);
  const search = await screen.findByPlaceholderText('Search tests...');
  fireEvent.focus(search);
  await userEvent.click(await screen.findByText('Test A'));
  await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
  await userEvent.click(screen.getByRole('button', { name: 'once' }));
  return view;
}

describe('TaskCreatorDialog Once timing', () => {
  it('sends a randomized Once with its timing mode and no time picker', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
    const { container } = await openOnceSchedule();
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: tomorrow } });
    await userEvent.selectOptions(screen.getByDisplayValue('Fixed time'), 'per_machine');
    expect(container.querySelector('input[type="time"]')).toBeNull();

    const submit = screen.getByRole('button', { name: 'Create Schedule' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(api.createSchedule).toHaveBeenCalledTimes(1));
    expect(api.createSchedule.mock.calls[0][0]).toMatchObject({
      schedule_type: 'once',
      schedule_config: { date: tomorrow, time: '09:00', randomize_mode: 'per_machine' },
    });
  });

  it('hides the Timing choice for Once when the backend does not support it (Vercel)', async () => {
    caps.randomizedOnce = false;
    await openOnceSchedule();
    expect(screen.queryByText('Timing')).not.toBeInTheDocument();
  });
});
