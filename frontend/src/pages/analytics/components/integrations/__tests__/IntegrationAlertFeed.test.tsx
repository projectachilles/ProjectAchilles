import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VENDORS } from '../vendorConfig';
import type { IntegrationVendor } from '../vendorConfig';
import type { IntegrationAlertItem, IntegrationAlertPage } from '@/services/api/integrationTypes';

const getAlerts = vi.fn();
const win = { from: '2026-09-21T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' };

const { default: IntegrationAlertFeed } = await import('../IntegrationAlertFeed');

const mk = (v: 'crowdstrike' | 'defender' | 'sentinelone'): IntegrationVendor => ({
  ...VENDORS[v],
  api: { ...VENDORS[v].api, getAlerts: (...a: unknown[]) => getAlerts(...a) } as IntegrationVendor['api'],
});

const item = (o: Partial<IntegrationAlertItem> = {}): IntegrationAlertItem => ({
  alert_id: 'a1',
  alert_title: 'Suspicious thing',
  severity: 'high',
  status: 'new',
  mitre_techniques: ['T1059'],
  created_at: new Date().toISOString(),
  hostname: 'host-1',
  achilles_correlated: false,
  ...o,
});

const page = (data: IntegrationAlertItem[], o: Partial<IntegrationAlertPage> = {}): IntegrationAlertPage => ({
  data,
  total: data.length,
  page: 1,
  pageSize: 10,
  counts: {
    bySource: { all: 30, test: 12, organic: 18 },
    bySeverity: { high: 5, medium: 3, weird: 2 },
    autoResolved: 4,
    linkedOpen: 1,
    byPrevention: { prevented: 7, detected_only: 8, kill_failed: 1 },
    byProduct: { 'Defender for Endpoint': 9, 'Office 365': 5, Identity: 3, Cloud: 2, Other1: 1 },
  },
  ...o,
});

const renderFeed = (v: IntegrationVendor) =>
  render(
    <MemoryRouter>
      <IntegrationAlertFeed vendor={v} window={win} windowLabel="Last 30 days" />
    </MemoryRouter>,
  );

beforeEach(() => {
  getAlerts.mockReset();
  getAlerts.mockResolvedValue(page([item()]));
});
afterEach(() => vi.useRealTimers());

describe('IntegrationAlertFeed', () => {
  it('SentinelOne: threats vs detection alerts filter sends sourceType and resets to page 1', async () => {
    getAlerts.mockResolvedValue(page([item()], { total: 40 }));
    renderFeed(mk('sentinelone'));
    await screen.findByText('Suspicious thing');
    expect(getAlerts.mock.calls[0][0]).not.toHaveProperty('sourceType');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: 'Detection alerts' }));
    await waitFor(() =>
      expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ sourceType: 'cloud_detection_alerts', page: 1 })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Threats' }));
    await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ sourceType: 'threats' })));
    fireEvent.click(screen.getByRole('button', { name: 'All types' }));
    await waitFor(() => expect(getAlerts.mock.calls.at(-1)![0]).not.toHaveProperty('sourceType'));
  });

  it('CrowdStrike and Defender have no alert type filter', async () => {
    renderFeed(mk('defender'));
    await screen.findByText('Suspicious thing');
    expect(screen.queryByRole('group', { name: 'Alert type' })).toBeNull();
  });

  it('sends from/to and the default severity segment on first load', async () => {
    renderFeed(mk('defender'));
    await waitFor(() => expect(getAlerts).toHaveBeenCalled());
    expect(getAlerts).toHaveBeenCalledWith({
      page: 1, pageSize: 10, source: 'all', severities: ['high', 'medium'], search: '', from: win.from, to: win.to,
    });
  });

  it('switching source to Linked to tests requests source=test and resets to page 1', async () => {
    getAlerts.mockResolvedValue(page([item()], { total: 40 }));
    renderFeed(mk('crowdstrike'));
    await screen.findByText('Suspicious thing');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: /Linked to tests/ }));
    await waitFor(() =>
      expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'test', page: 1 })),
    );
    expect(screen.getByRole('button', { name: /Linked to tests/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders segment counts from counts.bySource', async () => {
    renderFeed(mk('crowdstrike'));
    await screen.findByText('Suspicious thing');
    expect(screen.getByRole('button', { name: /All.*30/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Linked to tests.*12/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Organic.*18/ })).toBeInTheDocument();
  });

  it('renders Falcon response labels for CrowdStrike and Product for Defender', async () => {
    getAlerts.mockResolvedValue(
      page([
        item({ alert_id: '1', alert_title: 'q', prevention_action: 'quarantined' }),
        item({ alert_id: '2', alert_title: 'k', prevention_action: 'process_killed' }),
        item({ alert_id: '3', alert_title: 'b', prevention_action: 'blocked' }),
        item({ alert_id: '4', alert_title: 'f', prevention_action: 'kill_failed' }),
        item({ alert_id: '5', alert_title: 'd' }),
      ]),
    );
    const { unmount } = renderFeed(mk('crowdstrike'));
    await screen.findByText('q');
    expect(screen.getByText('Falcon response', { selector: 'th' })).toBeInTheDocument();
    const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;
    const expected: Record<string, string> = {
      q: 'Quarantined', k: 'Process killed', b: 'Blocked', f: 'Kill failed', d: 'Detected only',
    };
    for (const [title, label] of Object.entries(expected)) {
      expect(within(rowOf(title)).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Prevented')).toBeInTheDocument();
    unmount();

    getAlerts.mockResolvedValue(page([item({ service_source: 'microsoftDefenderForEndpoint' })]));
    renderFeed(mk('defender'));
    await screen.findByText('Suspicious thing');
    expect(screen.getByText('Product', { selector: 'th' })).toBeInTheDocument();
    expect(screen.getByText('Device / entity')).toBeInTheDocument();
    expect(screen.getByText('microsoftDefenderForEndpoint')).toBeInTheDocument();
    // byProduct has 5 entries: top 3 shown, remaining (2 + 1 = 3) aggregated into Other.
    const summary = screen.getByText('Auto-resolved').closest('div') as HTMLElement;
    expect(within(summary).getByText('Defender for Endpoint')).toBeInTheDocument();
    expect(within(summary).getByText('Office 365')).toBeInTheDocument();
    expect(within(summary).getByText('Identity')).toBeInTheDocument();
    expect(within(summary).queryByText('Cloud')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Other1')).not.toBeInTheDocument();
    expect(within(within(summary).getByText('Other').parentElement as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('renders an organic, host-less, portal-less alert with dashes and no external link', async () => {
    getAlerts.mockResolvedValue(page([item({ hostname: null, mitre_techniques: [] })]));
    renderFeed(mk('crowdstrike'));
    await screen.findByText('Suspicious thing');
    expect(screen.getAllByText('—').length).toBe(2);
    expect(screen.getAllByText('Organic').length).toBeGreaterThan(1);
    expect(screen.queryByLabelText('Open in Falcon console')).not.toBeInTheDocument();
  });

  it('renders the external link when portal_url is present', async () => {
    getAlerts.mockResolvedValue(page([item({ portal_url: 'https://x.test/a' })]));
    renderFeed(mk('crowdstrike'));
    const link = await screen.findByLabelText('Open in Falcon console');
    expect(link).toHaveAttribute('href', 'https://x.test/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the test name for a linked alert, or the short uuid when the name is missing', async () => {
    getAlerts.mockResolvedValue(
      page([
        item({ alert_id: '1', achilles_correlated: true, achilles_test_name: 'LSASS Dump', achilles_test_kind: 'test', achilles_test_uuid: 'abcdef12-0000' }),
        item({ alert_id: '2', alert_title: 'two', achilles_correlated: true, achilles_test_uuid: 'abcdef12-0000' }),
      ]),
    );
    renderFeed(mk('crowdstrike'));
    const link = await screen.findByRole('link', { name: 'LSASS Dump' });
    expect(link).toHaveAttribute('href', '/analytics?tab=executions&tests=LSASS%20Dump');
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });

  it('links a bundle-linked alert with the bundleNames filter, not the test-name filter', async () => {
    getAlerts.mockResolvedValue(
      page([
        item({
          alert_id: '1',
          achilles_correlated: true,
          achilles_test_name: 'Ransomware Chain',
          achilles_test_kind: 'bundle',
          achilles_test_uuid: 'b0b0b0b0-0000',
        }),
      ]),
    );
    renderFeed(mk('defender'));
    const link = await screen.findByRole('link', { name: 'Ransomware Chain' });
    expect(link).toHaveAttribute('href', '/analytics?tab=executions&bundleNames=Ransomware%20Chain');
  });

  it("shows 'No alerts match these filters' and disables pagination on zero results", async () => {
    getAlerts.mockResolvedValue(page([], { total: 0 }));
    renderFeed(mk('crowdstrike'));
    expect(await screen.findByText('No alerts match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('debounces search before requesting', async () => {
    vi.useFakeTimers();
    renderFeed(mk('crowdstrike'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    getAlerts.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'mimi' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(getAlerts).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(getAlerts).toHaveBeenCalledTimes(1);
    expect(getAlerts).toHaveBeenCalledWith(expect.objectContaining({ search: 'mimi', page: 1 }));
  });

  it('shows an inline error with a Retry button when getAlerts rejects, and Retry re-requests', async () => {
    getAlerts.mockRejectedValueOnce(new Error('boom'));
    renderFeed(mk('crowdstrike'));
    expect(await screen.findByText(/Unable to load alerts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Suspicious thing')).toBeInTheDocument();
    expect(getAlerts).toHaveBeenCalledTimes(2);
  });

  it('resets to page 1 and sends the segment severities when the severity segment changes', async () => {
    getAlerts.mockResolvedValue(page([item()], { total: 40 }));
    renderFeed(mk('crowdstrike'));
    await screen.findByText('Suspicious thing');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: 'High & critical' }));
    await waitFor(() =>
      expect(getAlerts).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, severities: ['critical', 'high'] }),
      ),
    );
    expect(screen.getByRole('button', { name: 'High & critical' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resets to page 1 when the window changes', async () => {
    getAlerts.mockResolvedValue(page([item()], { total: 40 }));
    const v = mk('crowdstrike');
    const { rerender } = renderFeed(v);
    await screen.findByText('Suspicious thing');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    getAlerts.mockClear();
    const win2 = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' };
    rerender(
      <MemoryRouter>
        <IntegrationAlertFeed vendor={v} window={win2} windowLabel="Last 20 days" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getAlerts).toHaveBeenCalled());
    expect(getAlerts).toHaveBeenCalledTimes(1);
    expect(getAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, from: win2.from, to: win2.to }),
    );
  });

  it("hides the Defender strip's Other item when no products fall outside the top three", async () => {
    getAlerts.mockResolvedValue(
      page([item({ service_source: 'microsoftDefenderForEndpoint' })], {
        counts: {
          bySource: { all: 3, test: 1, organic: 2 },
          bySeverity: { high: 3 },
          autoResolved: 0,
          linkedOpen: 0,
          byProduct: { 'Defender for Endpoint': 2, 'Office 365': 1, Identity: 0, Cloud: 0 },
        },
      }),
    );
    renderFeed(mk('defender'));
    await screen.findByText('Suspicious thing');
    const summary = screen.getByText('Auto-resolved').closest('div') as HTMLElement;
    expect(within(summary).getByText('Defender for Endpoint')).toBeInTheDocument();
    expect(within(summary).queryByText('Other')).not.toBeInTheDocument();
  });

  it('clamps to the last page when a refresh shrinks the result below the current page', async () => {
    getAlerts.mockResolvedValue(page([item()], { total: 40 }));
    const v = mk('crowdstrike');
    const { rerender } = renderFeed(v);
    await screen.findByText('Suspicious thing');
    for (const p of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: p })));
      await waitFor(() => expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled());
    }
    // After Sync Now the alerts on page 4 are gone: 15 alerts now fit on 2 pages.
    getAlerts.mockImplementation(async (params: { page: number }) =>
      params.page > 2
        ? page([], { total: 15, page: params.page })
        : page([item({ alert_id: `p${params.page}`, alert_title: `Row on page ${params.page}` })], { total: 15, page: params.page }),
    );
    getAlerts.mockClear();
    rerender(
      <MemoryRouter>
        <IntegrationAlertFeed vendor={v} window={win} windowLabel="Last 30 days" refreshKey={1} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Row on page 2')).toBeInTheDocument();
    expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText(/page 2 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.queryByText('No alerts match these filters')).not.toBeInTheDocument();
  });

  it('keeps the newer response when an older request resolves last', async () => {
    let resolveOld!: (p: IntegrationAlertPage) => void;
    let resolveNew!: (p: IntegrationAlertPage) => void;
    getAlerts
      .mockImplementationOnce(() => new Promise<IntegrationAlertPage>((r) => { resolveOld = r; }))
      .mockImplementationOnce(() => new Promise<IntegrationAlertPage>((r) => { resolveNew = r; }));
    renderFeed(mk('crowdstrike'));
    await waitFor(() => expect(getAlerts).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Organic/ }));
    await waitFor(() => expect(getAlerts).toHaveBeenCalledTimes(2));
    await act(async () => { resolveNew(page([item({ alert_id: 'n', alert_title: 'NEWER' })])); });
    expect(await screen.findByText('NEWER')).toBeInTheDocument();
    await act(async () => { resolveOld(page([item({ alert_id: 'o', alert_title: 'OLDER' })])); });
    expect(screen.getByText('NEWER')).toBeInTheDocument();
    expect(screen.queryByText('OLDER')).not.toBeInTheDocument();
  });
});
