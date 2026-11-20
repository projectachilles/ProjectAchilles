import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InstallReadiness, PlatformReadiness } from '@/types/agent';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getInstallReadiness: vi.fn(),
  getTestRecency: vi.fn(),
  getAllTests: vi.fn(),
  getBuildInfo: vi.fn(),
}));

// Fixed capabilities: without this the hook asks whatever backend happens to
// be listening on localhost, and the dialog takes a different path.
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ randomizedOnce: false, testRunRecency: false }),
}));
vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'operator',
  useHasPermission: () => false,
  useCanAccessModule: () => true,
}));
vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listAgents: api.listAgents,
    getInstallReadiness: api.getInstallReadiness,
    getTestRecency: api.getTestRecency,
  },
}));
vi.mock('@/services/api/browser', () => ({
  browserApi: { getAllTests: api.getAllTests, getBuildInfo: api.getBuildInfo },
}));
vi.mock('@/services/api/analytics', () => ({
  analyticsApi: { listIndices: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: { getAzureSettings: vi.fn().mockResolvedValue({ configured: false }) },
}));

import TaskCreatorDialog from '../TaskCreatorDialog';

const ORDER: Array<[PlatformReadiness['os'], PlatformReadiness['arch']]> = [
  ['windows', 'amd64'], ['linux', 'amd64'], ['linux', 'arm64'], ['darwin', 'arm64'], ['darwin', 'amd64'],
];
function readiness(readyCount: number): InstallReadiness {
  const platforms = ORDER.map(([os, arch], i): PlatformReadiness => (i < readyCount
    ? { os, arch, ready: true, version: '0.7.4', reason: null }
    : { os, arch, ready: false, version: null, reason: 'no version' }));
  return { any_ready: readyCount > 0, platforms };
}

const AGENT = {
  id: 'a-1', org_id: 'org-1', hostname: 'host-1', os: 'windows', arch: 'amd64', agent_version: '0.7.4',
  status: 'active', runtime_status: 'idle', last_heartbeat: null, tags: [], is_online: true,
};

function renderDialog() {
  return render(<MemoryRouter><TaskCreatorDialog open onClose={() => {}} /></MemoryRouter>);
}

const NOTICE = 'This task has nothing to run on yet';

describe('TaskCreatorDialog with nothing to run on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAgents.mockResolvedValue({ agents: [], total: 0 });
    api.getInstallReadiness.mockResolvedValue(readiness(0));
    api.getTestRecency.mockResolvedValue({ testUuids: [], runs: [], agents: [] });
    api.getAllTests.mockResolvedValue([
      { uuid: 't-1', name: 'Test one' }, { uuid: 't-2', name: 'Test two' }, { uuid: 't-3', name: 'Not built' },
    ]);
    api.getBuildInfo.mockImplementation(async (uuid: string) => ({ exists: uuid !== 't-3' }));
  });

  it('shows the checklist instead of the agent picker when no agent is enrolled', async () => {
    renderDialog();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText('A test runs on an enrolled endpoint. Finish the steps below, then come back.')).toBeInTheDocument();
    expect(screen.getByText('Agent binary on this server')).toBeInTheDocument();
    expect(screen.getByText('Enrolled endpoint')).toBeInTheDocument();
    expect(screen.getByText('Built test')).toBeInTheDocument();
  });

  it('hides the rest of the form while the checklist is shown', async () => {
    renderDialog();
    await screen.findByText(NOTICE);
    expect(screen.queryByPlaceholderText(/search tests|loading tests/i)).toBeNull();
    expect(screen.queryByText('Run Now')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('keeps the create button disabled', async () => {
    renderDialog();
    await screen.findByText(NOTICE);
    expect(screen.getByRole('button', { name: /create 0 task/i })).toBeDisabled();
  });

  it('says the agent binary is missing and that enrolling waits on it', async () => {
    renderDialog();
    expect(await screen.findByText('Missing: no platform has one')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Build or upload' })).toHaveAttribute('href', '/settings?tab=agent');
    expect(screen.getByText('0 active agents. Needs step 1 first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enroll an agent' })).toHaveAttribute('href', '/agents');
  });

  it('with a binary ready, points at enrolling only', async () => {
    api.getInstallReadiness.mockResolvedValue(readiness(1));
    renderDialog();
    expect(await screen.findByText('Ready for 1 of 5 platforms')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Build or upload' })).toBeNull();
    expect(screen.getByText('0 active agents.')).toBeInTheDocument();
  });

  it('keeps the plain dialog when the binary check is not available (older or serverless backend)', async () => {
    api.getInstallReadiness.mockRejectedValue(new Error('404'));
    renderDialog();
    await screen.findByText('Create Task');
    await waitFor(() => expect(api.getInstallReadiness).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByText('Agent binary on this server')).toBeNull();
    expect(screen.getByPlaceholderText(/search tests/i)).toBeInTheDocument();
  });

  it('counts the built tests', async () => {
    renderDialog();
    expect(await screen.findByText('2 tests built and ready')).toBeInTheDocument();
  });

  it('says so when no test is built', async () => {
    api.getAllTests.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText('No test is built yet')).toBeInTheDocument();
  });

  it('does not call a failed test list "no test built"', async () => {
    api.getAllTests.mockRejectedValue(new Error('network'));
    renderDialog();
    await screen.findByText(NOTICE);
    expect(await screen.findByText('Could not check')).toBeInTheDocument();
    expect(screen.queryByText('No test is built yet')).toBeNull();
  });

  it('shows no checklist when the agent list could not be loaded', async () => {
    api.listAgents.mockRejectedValue(new Error('network'));
    renderDialog();
    await screen.findByText('Create Task');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(api.getInstallReadiness).not.toHaveBeenCalled();
  });

  it('is unchanged, and asks nothing about binaries, when an agent is enrolled', async () => {
    api.listAgents.mockResolvedValue({ agents: [AGENT], total: 1 });
    renderDialog();
    expect(await screen.findByText(/host-1/)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(api.getInstallReadiness).not.toHaveBeenCalled();
  });
});
