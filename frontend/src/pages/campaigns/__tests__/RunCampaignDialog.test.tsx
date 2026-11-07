import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ preflight: vi.fn(), startRun: vi.fn() }));
const notices = vi.hoisted(() => ({ getSettings: vi.fn() }));
const caps = vi.hoisted(() => ({ preExecutionNotices: true }));
const nav = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/campaigns', () => ({ campaignsApi: api }));
vi.mock('@/services/api/notices', () => ({ noticesApi: notices }));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ preExecutionNotices: caps.preExecutionNotices }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => nav }));

import type { Campaign } from '@/services/api/campaigns';
import { RunCampaignDialog } from '../RunCampaignDialog';

const campaign: Campaign = {
  id: 'c1', org_id: 'org-1', name: 'CIS', description: null, framework_label: null,
  test_uuids: ['t1'], agent_ids: ['a1', 'a2'], created_by: 'u', created_at: '', updated_at: '',
};
const preflight = {
  dispatch: [], task_count: 3, tests: [], agents: [],
  skipped: [
    { test_uuid: 't1', agent_id: 'a1', reason: 'agent offline' },
    { test_uuid: 't2', agent_id: 'a2', reason: 'agent offline' },
    { test_uuid: 't2', agent_id: 'a1', reason: 'not built' },
  ],
};

function setup() {
  render(<MemoryRouter><RunCampaignDialog open campaign={campaign} onClose={vi.fn()} /></MemoryRouter>);
}

describe('RunCampaignDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caps.preExecutionNotices = true;
    api.preflight.mockResolvedValue(preflight);
    notices.getSettings.mockResolvedValue({ enabled: true });
  });

  it('shows task count and skipped list grouped by reason', async () => {
    setup();
    expect(await screen.findByText('Will create 3 tasks')).toBeInTheDocument();
    expect(screen.getByText(/agent offline/)).toHaveTextContent('2');
    expect(screen.getByText(/not built/)).toHaveTextContent('1');
  });

  it('shows the notice line only when notices are enabled', async () => {
    setup();
    expect(await screen.findByText('A pre-execution notice will be emailed first')).toBeInTheDocument();
  });

  it('hides the notice line when disabled, and does not call settings without the capability', async () => {
    notices.getSettings.mockResolvedValue({ enabled: false });
    setup();
    await screen.findByText('Will create 3 tasks');
    expect(screen.queryByText(/pre-execution notice/)).not.toBeInTheDocument();
    vi.clearAllMocks();
    caps.preExecutionNotices = false;
    api.preflight.mockResolvedValue(preflight);
    setup();
    await screen.findAllByText('Will create 3 tasks');
    expect(notices.getSettings).not.toHaveBeenCalled();
  });

  it('navigates to the run page on success and disables Run while launching', async () => {
    let resolve!: (v: unknown) => void;
    api.startRun.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    setup();
    await screen.findByText('Will create 3 tasks');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('button', { name: /Run|Starting/ })).toBeDisabled();
    expect(api.startRun).toHaveBeenCalledWith('c1', { org_id: 'org-1' });
    resolve({ run_id: 'r9' });
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/tasks/campaigns/runs/r9'));
  });

  it('on 409 shows the list and Run the rest resends with confirm_partial', async () => {
    api.startRun
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'partial', skipped: preflight.skipped } } })
      .mockResolvedValueOnce({ run_id: 'r2' });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Will create 3 tasks');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(await screen.findByRole('button', { name: 'Run the rest' }));
    expect(api.startRun).toHaveBeenLastCalledWith('c1', { org_id: 'org-1', confirm_partial: true });
    await waitFor(() => expect(nav).toHaveBeenCalledWith('/tasks/campaigns/runs/r2'));
  });

  it('blocks a second launch while one is in flight, including via Cancel', async () => {
    api.startRun.mockReturnValue(new Promise(() => undefined));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MemoryRouter><RunCampaignDialog open campaign={campaign} onClose={onClose} /></MemoryRouter>);
    await screen.findByText('Will create 3 tasks');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Starting/ }));
    expect(api.startRun).toHaveBeenCalledTimes(1);
  });
});
