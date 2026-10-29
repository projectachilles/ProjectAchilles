import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  testConnection: vi.fn(),
  deleteSettings: vi.fn(),
  triggerSync: vi.fn(),
  getSyncStatus: vi.fn(),
  waitForSync: vi.fn(),
  getAutoResolveStatus: vi.fn(),
  setAutoResolveMode: vi.fn(),
  getAutoResolveReceipts: vi.fn(),
}));
vi.mock('@/services/api/sophos', () => ({ sophosApi: api }));
vi.mock('@/services/api/sophosAnalytics', () => ({ sophosAnalyticsApi: { getAlerts: vi.fn().mockResolvedValue({ total: 0 }) } }));

const getEsReadiness = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/edrReadiness', () => ({ edrReadinessApi: { get: getEsReadiness } }));

const { SophosConfig } = await import('../SophosConfig');
const { SophosAutoResolveSection } = await import('../SophosAutoResolveSection');
const counts = { last24h: 1, last7d: 2, last30d: 3 };

const configured = {
  configured: true, client_id: 'client-id-1234', client_secret_set: true, permission_mode: 'read_only',
  poll_interval_minutes: 5, detection_backfill_days: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSettings.mockResolvedValue({ configured: false });
  api.getSyncStatus.mockResolvedValue({ inProgress: false });
  getEsReadiness.mockResolvedValue(null);
});

describe('SophosConfig', () => {
  it('Test connection shows region and each capability state', async () => {
    api.testConnection.mockResolvedValue({
      success: true, region: 'eu01', tenantId: 't-1',
      capabilities: { siem: 'available', alerts: 'available', xdr_graphql: 'not_licensed', xdr_rest: 'forbidden', health_check: 'unknown' },
    });
    render(<SophosConfig />);
    await userEvent.type(await screen.findByLabelText('Client ID'), 'client-id-1234');
    await userEvent.type(screen.getByLabelText('Client secret'), 'super-secret-value');
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/eu01/)).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBe(2);
    expect(screen.getByText('Not licensed')).toBeInTheDocument();
    expect(screen.getByText("This credential's role can't read it")).toBeInTheDocument();
    expect(screen.getByText('Unknown (see sync status)')).toBeInTheDocument();
  });

  it('a save whose Elasticsearch key cannot write shows "Saved, but not syncing" instead of success', async () => {
    api.testConnection.mockResolvedValue({ success: true, region: 'eu01', capabilities: {} });
    api.saveSettings.mockResolvedValue({
      success: true,
      elasticsearch: {
        status: 'not_ready', checked_at: '2026-10-29T10:00:00.000Z', privileges_checked: true,
        missing: [{ index: 'achilles-sophos', privileges: ['create_index'] }], recommended: [],
      },
    });
    render(<SophosConfig />);
    await userEvent.type(await screen.findByLabelText('Client ID'), 'client-id-1234');
    await userEvent.type(screen.getByLabelText('Client secret'), 'super-secret-value');
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(getEsReadiness).toHaveBeenCalledWith('sophos', true);
    await userEvent.click(await screen.findByRole('button', { name: /^Save/i }));
    expect(await screen.findByText('Saved, but not syncing')).toBeInTheDocument();
    expect(screen.getByText('create_index')).toBeInTheDocument();
    expect(screen.queryByText(/settings saved/)).not.toBeInTheDocument();
  });

  it('shows the secret as set, never its value, and the env banner disables disconnect', async () => {
    api.getSettings.mockResolvedValue({ ...configured, env_configured: true });
    render(<SophosConfig />);
    expect(await screen.findByText(/Environment variable configuration detected/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Leave blank to keep/)).toHaveValue('');
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeDisabled();
  });

  it('warns about the SIEM sync gap', async () => {
    api.getSettings.mockResolvedValue({ ...configured, sync_gap: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z' } });
    render(<SophosConfig />);
    expect(await screen.findByText(/Sophos events between .* and .* were not collected \(Sophos keeps 24 hours\)\./)).toBeInTheDocument();
  });
});

describe('SophosAutoResolveSection', () => {
  beforeEach(() => {
    api.getAutoResolveStatus.mockResolvedValue({ mode: 'disabled', permission_mode: 'read_only', counts, lastAutoResolve: null });
    api.getAutoResolveReceipts.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('disables the enabled option in read-only mode', async () => {
    render(<SophosAutoResolveSection permissionMode="read_only" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    await waitFor(() => expect(screen.getByLabelText(/^Enabled/)).toBeDisabled());
    expect(screen.getByLabelText(/Dry-run/)).not.toBeDisabled();
  });

  it('a dry-run receipt (dry-run time, no resolved time) renders "Would resolve" and the dry-run count shows', async () => {
    api.getAutoResolveStatus.mockResolvedValue({ mode: 'dry_run', permission_mode: 'read_only', counts, dry_run_counts: { last24h: 7, last7d: 8, last30d: 9 }, lastAutoResolve: null });
    api.getAutoResolveReceipts.mockResolvedValue({
      items: [{ alert_id: '3', alert_title: 'Dry one', severity: 'high', source_type: 'alert', achilles_test_uuid: null, auto_resolved_at: null, auto_resolve_dry_run_at: '2026-10-22T10:00:00Z', auto_resolve_mode: 'dry_run', auto_resolve_error: null }],
      total: 1, limit: 20, offset: 0,
    });
    render(<SophosAutoResolveSection permissionMode="read_only" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText('Would resolve')).toBeInTheDocument();
    expect(screen.getByText('2026-10-22 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('Dry run: would resolve')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('a resolved alert with a leftover dry-run time renders Resolved, not "Would resolve"', async () => {
    api.getAutoResolveReceipts.mockResolvedValue({
      items: [{ alert_id: '4', alert_title: 'Both', severity: 'high', source_type: 'alert', achilles_test_uuid: null, auto_resolved_at: '2026-10-22T10:00:00Z', auto_resolve_dry_run_at: '2026-10-21T10:00:00Z', auto_resolve_mode: 'enabled', auto_resolve_error: null }],
      total: 1, limit: 20, offset: 0,
    });
    render(<SophosAutoResolveSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText('Would resolve')).toBeNull();
  });

  it('shows the error when the receipts request fails', async () => {
    api.getAutoResolveReceipts.mockRejectedValue(new Error('Could not load auto-resolve receipts: boom'));
    render(<SophosAutoResolveSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText(/Could not load auto-resolve receipts: boom/)).toBeInTheDocument();
  });

  it('renders dry-run receipts as "Would resolve" and errors via the receipt helper', async () => {
    api.getAutoResolveReceipts.mockResolvedValue({
      items: [
        { alert_id: '1', alert_title: 'Mimikatz', severity: 'high', source_type: 'alert', achilles_test_uuid: 'abcdef1234', auto_resolved_at: '2026-10-22T10:00:00Z', auto_resolve_mode: 'dry_run', auto_resolve_error: null },
        { alert_id: '2', alert_title: 'Gone', severity: 'low', source_type: 'xdr_detection', achilles_test_uuid: null, auto_resolved_at: '2026-10-22T10:00:00Z', auto_resolve_mode: 'enabled', auto_resolve_error: 'not_found' },
      ],
      total: 2, limit: 20, offset: 0,
    });
    render(<SophosAutoResolveSection permissionMode="response" />);
    await userEvent.click(screen.getByText('Alert auto-resolution'));
    expect(await screen.findByText('Would resolve')).toBeInTheDocument();
    expect(screen.getByText(/alert not found in the console/)).toBeInTheDocument();
  });
});
