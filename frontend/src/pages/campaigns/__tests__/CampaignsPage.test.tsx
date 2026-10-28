import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const runItem = (id: string, over: Record<string, unknown> = {}) => ({
  id, started_at: '2026-10-21T10:00:00.000Z', started_by: 'user_1', started_by_name: 'Jane Doe',
  task_count: 6, percent_protected: 83, ...over,
});

vi.mock('@/services/api/campaigns', () => ({
  campaignsApi: {
    list: vi.fn(async () => [
      {
        id: 'c1', org_id: 'o', name: 'CIS Baseline', description: null, framework_label: 'CIS v8',
        test_uuids: ['a', 'b', 'c'], agent_ids: ['x', 'y'], created_by: 'u', created_at: '', updated_at: '',
        last_run: { id: 'r1', started_at: '2026-10-20T10:00:00.000Z', percent_protected: 75 },
      },
      {
        id: 'c2', org_id: 'o', name: 'Never Run', description: null, framework_label: null,
        test_uuids: ['a'], agent_ids: ['x'], created_by: 'u', created_at: '', updated_at: '',
        last_run: null,
      },
    ]),
    remove: vi.fn(async () => undefined),
    listRuns: vi.fn(async () => ({
      items: [runItem('r2'), runItem('r1', { started_at: '2026-10-20T10:00:00.000Z', started_by_name: 'user_2', task_count: 4, percent_protected: null })],
      total: 2,
    })),
    listAllRuns: vi.fn(async () => ({
      items: [
        { ...runItem('r-live'), campaign_id: 'c1', campaign_name: 'CIS Baseline', campaign_deleted: false },
        { ...runItem('r-del', { percent_protected: 40 }), campaign_id: 'gone', campaign_name: 'Old Q3 plan', campaign_deleted: true },
      ],
      total: 2,
    })),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: () => true }));
vi.mock('../CampaignEditorDialog', () => ({ CampaignEditorDialog: () => null }));

import CampaignsPage from '../CampaignsPage';
import { campaignsApi } from '@/services/api/campaigns';

function setup() {
  return render(
    <MemoryRouter initialEntries={['/campaigns']}>
      <Routes>
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/runs/:runId" element={<p>Run page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CampaignsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders name, label, size and last run', async () => {
    setup();
    expect(await screen.findByText('CIS Baseline')).toBeInTheDocument();
    expect(screen.getByText('CIS v8')).toBeInTheDocument();
    expect(screen.getByText('3 tests × 2 hosts')).toBeInTheDocument();
    expect(screen.getByText(/75%/)).toBeInTheDocument();
    expect(screen.getByText('1 test × 1 host')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Not run yet')).toBeInTheDocument());
  });
  it('per-campaign run history: lists runs newest first with date, started by, tasks and % protected, each linking', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText('CIS Baseline');
    await user.click(screen.getByRole('button', { name: 'Runs of CIS Baseline' }));
    const list = await screen.findByRole('list', { name: 'Runs of CIS Baseline' });
    expect(campaignsApi.listRuns).toHaveBeenCalledWith('c1', { limit: 25, offset: 0 });
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/campaigns/runs/r2', '/campaigns/runs/r1']);
    const first = links[0].closest('li')!;
    expect(first).toHaveTextContent(new Date('2026-10-21T10:00:00.000Z').toLocaleString());
    expect(first).toHaveTextContent('Jane Doe');
    expect(first).toHaveTextContent('6 tasks');
    expect(first).toHaveTextContent('83% protected');
    expect(links[1].closest('li')!).toHaveTextContent('No conclusive results');
  });

  it('All runs view marks a deleted campaign, and its run is reachable', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText('CIS Baseline');
    await user.click(screen.getByRole('tab', { name: 'All runs' }));
    const list = await screen.findByRole('list', { name: 'All runs' });
    expect(campaignsApi.listAllRuns).toHaveBeenCalledWith({ limit: 25, offset: 0 });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('CIS Baseline');
    expect(within(rows[0]).queryByText('deleted campaign')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Old Q3 plan');
    expect(within(rows[1]).getByText('deleted campaign')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('40% protected');
    await user.click(within(rows[1]).getByRole('link'));
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('All runs: Show more loads the next page', async () => {
    vi.mocked(campaignsApi.listAllRuns)
      .mockResolvedValueOnce({ items: [{ ...runItem('p1'), campaign_id: 'c1', campaign_name: 'CIS Baseline', campaign_deleted: false }], total: 2 })
      .mockResolvedValueOnce({ items: [{ ...runItem('p2'), campaign_id: 'c1', campaign_name: 'CIS Baseline', campaign_deleted: false }], total: 2 });
    const user = userEvent.setup();
    setup();
    await screen.findByText('CIS Baseline');
    await user.click(screen.getByRole('tab', { name: 'All runs' }));
    const list = await screen.findByRole('list', { name: 'All runs' });
    await user.click(screen.getByRole('button', { name: 'Show more runs' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(campaignsApi.listAllRuns).toHaveBeenLastCalledWith({ limit: 25, offset: 1 });
    expect(screen.queryByRole('button', { name: 'Show more runs' })).not.toBeInTheDocument();
  });
});
