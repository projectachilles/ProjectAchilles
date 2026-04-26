import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AchillesShell } from '../AchillesShell';

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({ configured: true, loading: false }),
}));
vi.mock('@/hooks/useAppRole', () => ({
  useAppRole: () => 'admin' as const,
  useCanAccessModule: (mod: string) => mod !== 'never',
  useHasPermission: () => true,
}));
vi.mock('@/hooks/useOutdatedAgentCount', () => ({
  useOutdatedAgentCount: () => ({ outdatedCount: 0 }),
}));
vi.mock('@/services/api/alerts', () => ({
  alertsApi: {
    getAlertSettings: vi.fn().mockResolvedValue({ configured: false }),
    getAlertHistory: vi.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => {
  // jsdom localStorage shim
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

describe('AchillesShell', () => {
  it('renders the sidebar brand mark', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AchillesShell>
          <div>page</div>
        </AchillesShell>
      </MemoryRouter>
    );
    expect(screen.getByText('ACHILLES')).toBeInTheDocument();
  });

  it('renders the four module groups in the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AchillesShell>
          <div />
        </AchillesShell>
      </MemoryRouter>
    );
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
  });

  it('marks the active sidebar item based on the current route', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/analytics/executions']}>
        <AchillesShell>
          <div />
        </AchillesShell>
      </MemoryRouter>
    );
    const active = container.querySelector('.dash-sidebar li.is-active');
    expect(active?.textContent).toContain('Executions');
  });

  it('renders the page title in the topbar', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/endpoints/agents']}>
        <AchillesShell>
          <div />
        </AchillesShell>
      </MemoryRouter>
    );
    const title = container.querySelector('.dash-topbar-title');
    expect(title).toHaveTextContent('Agents');
  });

  it('renders the children inside the content slot', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AchillesShell>
          <div data-testid="page-slot">hello world</div>
        </AchillesShell>
      </MemoryRouter>
    );
    expect(screen.getByTestId('page-slot')).toHaveTextContent('hello world');
  });
});
