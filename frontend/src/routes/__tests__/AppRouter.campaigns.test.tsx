import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useParams } from 'react-router-dom';

vi.mock('../../hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: true, loading: false }) }));
vi.mock('../../hooks/useAppRole', () => ({ useCanAccessModule: () => true }));
vi.mock('../../components/auth/RequireModule', () => ({ RequireModule: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/auth/RequireCapability', () => ({ RequireCapability: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/shared/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function Where({ name }: { name: string }) {
  const { pathname } = useLocation();
  const { runId } = useParams();
  return <p data-testid="where">{`${name} ${pathname}${runId ? ` run=${runId}` : ''}`}</p>;
}
vi.mock('../../pages/campaigns/CampaignsPage', () => ({ default: () => <Where name="campaigns" /> }));
vi.mock('../../pages/campaigns/CampaignRunPage', () => ({ default: () => <Where name="run" /> }));
vi.mock('../../pages/endpoints/TasksPage', () => ({ default: () => <Where name="tasks" /> }));

const { default: AppRouter } = await import('../AppRouter');

function renderAt(url: string) {
  return render(<MemoryRouter initialEntries={[url]}><AppRouter /></MemoryRouter>);
}

describe('Tasks sections routes', () => {
  it.each([
    ['/tasks', 'tasks /tasks'],
    ['/tasks/schedules', 'tasks /tasks/schedules'],
    ['/tasks/campaigns', 'campaigns /tasks/campaigns'],
    ['/tasks/campaigns/runs/r1', 'run /tasks/campaigns/runs/r1 run=r1'],
    // Campaigns used to be top-level; bookmarks and older emails keep working.
    ['/campaigns', 'campaigns /tasks/campaigns'],
    ['/campaigns/runs/r9', 'run /tasks/campaigns/runs/r9 run=r9'],
  ])('%s renders %s', async (url, expected) => {
    renderAt(url);
    expect(await screen.findByTestId('where')).toHaveTextContent(expected);
  });
});
