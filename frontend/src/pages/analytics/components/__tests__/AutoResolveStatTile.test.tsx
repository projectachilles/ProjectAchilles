import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetStatus = vi.fn();
const mockGetReceipts = vi.fn();

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAutoResolveStatus: () => mockGetStatus(),
    getAutoResolveReceipts: (limit: number, offset: number) =>
      mockGetReceipts(limit, offset),
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

// Default receipt response — keeps existing tests free of receipt concerns
const emptyReceipts = { items: [], total: 0, limit: 100, offset: 0 };

describe('AutoResolveStatTile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReceipts.mockResolvedValue(emptyReceipts);
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

  it('fetches receipts with limit=100 and offset=0', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'enabled',
      counts: { last24h: 0, last7d: 0, last30d: 0 },
      lastAutoResolve: null,
    });

    renderTile();

    await waitFor(() => expect(mockGetReceipts).toHaveBeenCalledWith(100, 0));
  });

  it('renders a sparkline when receipts return at least one resolved alert', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'enabled',
      counts: { last24h: 1, last7d: 3, last30d: 8 },
      lastAutoResolve: null,
    });

    // Three receipts on three different days — that's enough to build a non-flat
    // 30-bucket series (the sparkline always returns 30 buckets regardless).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = (offsetDays: number) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offsetDays);
      return d.toISOString();
    };

    mockGetReceipts.mockResolvedValue({
      items: [
        {
          alert_id: 'a',
          alert_title: 't',
          severity: 'high',
          auto_resolved_at: day(0),
          auto_resolve_mode: 'enabled',
          auto_resolve_error: null,
          achilles_test_uuid: null,
        },
        {
          alert_id: 'b',
          alert_title: 't',
          severity: 'high',
          auto_resolved_at: day(3),
          auto_resolve_mode: 'enabled',
          auto_resolve_error: null,
          achilles_test_uuid: null,
        },
        {
          alert_id: 'c',
          alert_title: 't',
          severity: 'high',
          auto_resolved_at: day(7),
          auto_resolve_mode: 'enabled',
          auto_resolve_error: null,
          achilles_test_uuid: null,
        },
      ],
      total: 3,
      limit: 100,
      offset: 0,
    });

    renderTile();

    // Sparkline is rendered by HeroStatTile with ariaLabel="Auto-Resolve trend"
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Auto-Resolve trend' })).toBeInTheDocument()
    );
  });

  it('still renders the headline number when receipts fail (non-fatal)', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'enabled',
      counts: { last24h: 1, last7d: 3, last30d: 8 },
      lastAutoResolve: null,
    });
    mockGetReceipts.mockRejectedValue(new Error('receipts unavailable'));

    renderTile();

    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
    // Sparkline absent because we have no data, but the tile is still useful
    expect(screen.queryByRole('img', { name: 'Auto-Resolve trend' })).toBeNull();
  });
});
