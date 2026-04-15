import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetStatus = vi.fn();
const mockSetMode = vi.fn();
const mockGetReceipts = vi.fn();

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAutoResolveStatus: () => mockGetStatus(),
    setAutoResolveMode: (m: string) => mockSetMode(m),
    getAutoResolveReceipts: (limit: number, offset: number) => mockGetReceipts(limit, offset),
  },
}));

const { DefenderAutoResolveSection } = await import('../DefenderAutoResolveSection');

describe('DefenderAutoResolveSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue({
      mode: 'disabled',
      counts: { last24h: 0, last7d: 0, last30d: 0 },
      lastAutoResolve: null,
    });
    mockGetReceipts.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('renders collapsed by default — does not fetch until expanded', async () => {
    render(<DefenderAutoResolveSection />);

    expect(screen.getByText('Alert auto-resolution')).toBeInTheDocument();
    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(mockGetReceipts).not.toHaveBeenCalled();
  });

  it('fetches status + receipts when expanded', async () => {
    render(<DefenderAutoResolveSection />);

    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledTimes(1);
      expect(mockGetReceipts).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the three mode radio options', async () => {
    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(screen.getByLabelText(/Disabled/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Dry-run/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Enabled/)).toBeInTheDocument();
  });

  it('shows the permission banner when mode is non-disabled', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'dry_run',
      counts: { last24h: 2, last7d: 5, last30d: 10 },
      lastAutoResolve: null,
    });

    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(screen.getByText(/SecurityAlert\.ReadWrite\.All/)).toBeInTheDocument();
    });
  });

  it('does NOT show the permission banner when mode is disabled', async () => {
    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => expect(screen.getByLabelText(/Disabled/)).toBeInTheDocument());
    expect(screen.queryByText(/SecurityAlert\.ReadWrite\.All/)).not.toBeInTheDocument();
  });

  it('renders the stats strip with 24h/7d/30d counts', async () => {
    mockGetStatus.mockResolvedValue({
      mode: 'enabled',
      counts: { last24h: 7, last7d: 42, last30d: 128 },
      lastAutoResolve: null,
    });

    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('128')).toBeInTheDocument();
    });
  });

  it('renders the empty-state when no receipts', async () => {
    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(screen.getByText(/No auto-resolve receipts yet/i)).toBeInTheDocument();
    });
  });

  it('renders receipt rows when present', async () => {
    mockGetReceipts.mockResolvedValue({
      items: [
        {
          alert_id: 'a1',
          alert_title: 'Suspicious LSASS read',
          severity: 'high',
          auto_resolved_at: '2026-04-14T12:00:00Z',
          auto_resolve_mode: 'enabled',
          auto_resolve_error: null,
          achilles_test_uuid: '92b0b4f6-a09b-4c7b-b593-31ce461f804c',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });

    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => {
      expect(screen.getByText('Suspicious LSASS read')).toBeInTheDocument();
    });
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('enabled')).toBeInTheDocument();
  });

  it('changing the mode calls setAutoResolveMode and reloads status', async () => {
    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));

    await waitFor(() => expect(screen.getByLabelText(/Dry-run/)).toBeInTheDocument());

    // Simulate upgrading from disabled → dry_run
    mockSetMode.mockResolvedValue({ mode: 'dry_run' });
    await userEvent.click(screen.getByLabelText(/Dry-run/));

    await waitFor(() => {
      expect(mockSetMode).toHaveBeenCalledWith('dry_run');
    });
    // loadData invoked twice: once on expand, once after mode change
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
  });

  it('surfaces backend error when mode change fails (e.g., 400)', async () => {
    mockSetMode.mockRejectedValueOnce(new Error('Defender integration is not configured'));

    render(<DefenderAutoResolveSection />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    await waitFor(() => expect(screen.getByLabelText(/Dry-run/)).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText(/Dry-run/));

    await waitFor(() => {
      expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    });
  });
});
