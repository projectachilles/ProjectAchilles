import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetStatus = vi.fn();

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAutoResolveStatus: () => mockGetStatus(),
  },
}));

const { default: AutoResolveStatTile } = await import('../AutoResolveStatTile');

function renderTile() {
  return render(
    <MemoryRouter>
      <AutoResolveStatTile />
    </MemoryRouter>
  );
}

describe('AutoResolveStatTile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows last-30d count and Enabled mode when auto-resolve is on', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'enabled',
      counts: { last24h: 7, last7d: 42, last30d: 184 },
      lastAutoResolve: null,
    });

    renderTile();

    await waitFor(() => expect(screen.getByText('184')).toBeInTheDocument());
    expect(screen.getByText('resolved in last 30d')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/24h:\s*7/)).toBeInTheDocument();
  });

  it('renders Disabled mode with zero counts as the default-quiet state', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'disabled',
      counts: { last24h: 0, last7d: 0, last30d: 0 },
      lastAutoResolve: null,
    });

    renderTile();

    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument());
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/24h:\s*0/)).toBeInTheDocument();
  });

  it('renders Dry Run mode label when in dry_run', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'dry_run',
      counts: { last24h: 2, last7d: 9, last30d: 18 },
      lastAutoResolve: null,
    });

    renderTile();

    await waitFor(() => expect(screen.getByText('Dry Run')).toBeInTheDocument());
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText(/24h:\s*2/)).toBeInTheDocument();
  });

  it('renders the unavailable empty state when the API rejects', async () => {
    mockGetStatus.mockRejectedValue(new Error('500 server error'));

    renderTile();

    await waitFor(() =>
      expect(screen.getByText('Auto-resolve status unavailable')).toBeInTheDocument()
    );
  });
});
