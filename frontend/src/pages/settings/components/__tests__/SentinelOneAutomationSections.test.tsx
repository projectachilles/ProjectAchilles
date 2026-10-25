import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = {
  getAutoResolveStatus: vi.fn(),
  setAutoResolveMode: vi.fn(),
  getAutoResolveReceipts: vi.fn(),
  getAutoMitigationStatus: vi.fn(),
  setAutoMitigation: vi.fn(),
  getAutoMitigationReceipts: vi.fn(),
};
vi.mock('@/services/api/sentinelone', () => ({ sentinelOneApi: api }));

const { SentinelOneAutoResolveSection, SentinelOneAutoMitigationSection } = await import('../SentinelOneAutomationSections');
const counts = { last24h: 1, last7d: 2, last30d: 3 };

describe('SentinelOneAutoResolveSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAutoResolveStatus.mockResolvedValue({ mode: 'disabled', permission_mode: 'response', counts, lastAutoResolve: null });
    api.getAutoResolveReceipts.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    api.setAutoResolveMode.mockResolvedValue({ mode: 'dry_run' });
  });

  it('is collapsed and fetches nothing until expanded', () => {
    render(<SentinelOneAutoResolveSection permissionMode="response" />);
    expect(screen.getByText('Alert auto-resolution')).toBeInTheDocument();
    expect(api.getAutoResolveStatus).not.toHaveBeenCalled();
  });

  it('explains it does not set a verdict or mitigate, and changes mode', async () => {
    render(<SentinelOneAutoResolveSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText(/does not set an analyst verdict/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Dry-run/));
    await waitFor(() => expect(api.setAutoResolveMode).toHaveBeenCalledWith('dry_run'));
  });

  it('locks Enabled in read-only mode', async () => {
    api.getAutoResolveStatus.mockResolvedValue({ mode: 'disabled', permission_mode: 'read_only', counts, lastAutoResolve: null });
    render(<SentinelOneAutoResolveSection permissionMode="read_only" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    await waitFor(() => expect(screen.getByLabelText(/^Enabled/)).toBeDisabled());
    expect(screen.getByText(/Enabled requires Response mode/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dry-run/)).not.toBeDisabled();
  });

  it('renders receipts with the alert type', async () => {
    api.getAutoResolveReceipts.mockResolvedValue({
      items: [{ alert_id: '9', alert_title: 'Mimikatz', severity: 'high', source_type: 'cloud_detection_alerts', achilles_test_uuid: 'abcdef1234', auto_resolved_at: '2026-10-22T10:00:00Z', auto_resolve_mode: 'dry_run', auto_resolve_error: null }],
      total: 1, limit: 20, offset: 0,
    });
    render(<SentinelOneAutoResolveSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText('Mimikatz')).toBeInTheDocument();
    expect(screen.getByText('Detection alert')).toBeInTheDocument();
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });
});

describe('SentinelOneAutoMitigationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAutoMitigationStatus.mockResolvedValue({ mode: 'disabled', action: 'kill', permission_mode: 'response', counts, lastAutoMitigation: null });
    api.getAutoMitigationReceipts.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    api.setAutoMitigation.mockResolvedValue({ mode: 'enabled', action: 'kill' });
  });

  it('shows Off and a clear warning', async () => {
    render(<SentinelOneAutoMitigationSection permissionMode="response" />);
    expect(screen.getByText('Off')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Automatic mitigation'));
    expect(await screen.findByText(/This acts on real endpoints/)).toBeInTheDocument();
    expect(screen.getByText(/never automatic/)).toBeInTheDocument();
  });

  it('offers only kill and quarantine', async () => {
    render(<SentinelOneAutoMitigationSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Automatic mitigation'));
    const select = await screen.findByLabelText('Action');
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['kill', 'quarantine']);
    await userEvent.selectOptions(select, 'quarantine');
    await waitFor(() => expect(api.setAutoMitigation).toHaveBeenCalledWith({ action: 'quarantine' }));
  });

  it('enabling requires an explicit acknowledgement', async () => {
    render(<SentinelOneAutoMitigationSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Automatic mitigation'));
    await userEvent.click(await screen.findByLabelText(/^Enabled/));
    expect(api.setAutoMitigation).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: /Enable automatic mitigation/ });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I understand Achilles will kill/));
    await userEvent.click(confirm);
    await waitFor(() => expect(api.setAutoMitigation).toHaveBeenCalledWith({ mode: 'enabled' }));
  });

  it('dry run saves directly; everything is locked in read-only mode', async () => {
    const { unmount } = render(<SentinelOneAutoMitigationSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Automatic mitigation'));
    await userEvent.click(await screen.findByLabelText(/Dry-run/));
    await waitFor(() => expect(api.setAutoMitigation).toHaveBeenCalledWith({ mode: 'dry_run' }));
    unmount();

    api.getAutoMitigationStatus.mockResolvedValue({ mode: 'disabled', action: 'kill', permission_mode: 'read_only', counts, lastAutoMitigation: null });
    render(<SentinelOneAutoMitigationSection permissionMode="read_only" />);
    await userEvent.click(screen.getByText('Automatic mitigation'));
    expect(await screen.findByText(/Available only in Response mode/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dry-run/)).toBeDisabled();
    expect(screen.getByLabelText(/^Enabled/)).toBeDisabled();
  });
});
