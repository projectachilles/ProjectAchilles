import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetAlerts = vi.fn();
const mockGetSettings = vi.fn();

vi.mock('@/services/api/crowdstrike', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/crowdstrike')>();
  return {
    ...actual,
    crowdstrikeApi: {
      ...actual.crowdstrikeApi,
      getAlerts: (params: unknown) => mockGetAlerts(params),
    },
  };
});

const mockS1GetAlerts = vi.fn();
vi.mock('@/services/api/sentineloneAnalytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/sentineloneAnalytics')>();
  return {
    ...actual,
    sentineloneAnalyticsApi: { ...actual.sentineloneAnalyticsApi, getAlerts: (params: unknown) => mockS1GetAlerts(params) },
  };
});

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getCrowdStrikeSettings: () => mockGetSettings(),
  },
}));

const { default: EndpointAlertDetailsDrawer } = await import('../EndpointAlertDetailsDrawer');

interface PartialAlert {
  alert_id: string;
  alert_title: string;
  severity: string;
  status: string;
  product: string;
  created_at: string;
  mitre_techniques: string[];
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked' | 'kill_failed';
  pattern_disposition_description?: string;
  portal_url?: string;
}

function makeAlert(overrides: Partial<PartialAlert> = {}): PartialAlert {
  return {
    alert_id: 'a1',
    alert_title: 'Suspicious PowerShell',
    severity: 'high',
    status: 'new',
    product: 'epp',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    mitre_techniques: ['T1059'],
    ...overrides,
  };
}

describe('EndpointAlertDetailsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ configured: true, region: 'us-1' });
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockGetAlerts).not.toHaveBeenCalled();
  });

  it('shows recent alerts list when open with no technique filter', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({ alert_id: 'a1', alert_title: 'PSH abuse', mitre_techniques: ['T1059'] }),
        makeAlert({ alert_id: 'a2', alert_title: 'Cred dump', mitre_techniques: ['T1003'] }),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH abuse')).toBeInTheDocument());
    expect(screen.getByText('Recent CrowdStrike Alerts')).toBeInTheDocument();
    expect(screen.getByText('Cred dump')).toBeInTheDocument();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });

  it('wraps the single technique prop into the techniques array for the API call', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({ alert_id: 'a1', alert_title: 'PSH parent', mitre_techniques: ['T1059'] }),
        makeAlert({ alert_id: 'a2', alert_title: 'PSH sub', mitre_techniques: ['T1059.001'] }),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} technique="T1059" />);

    await waitFor(() => expect(screen.getByText('PSH parent')).toBeInTheDocument());
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ techniques: ['T1059'] }),
    );
    expect(screen.getByText('Alerts for T1059')).toBeInTheDocument();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });

  it('passes a multi-technique array straight through to the backend', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} techniques={['T1078', 'T1110']} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ techniques: ['T1078', 'T1110'] }),
    );
    // Default header lists both techniques
    expect(screen.getByText(/Alerts for T1078, T1110/)).toBeInTheDocument();
  });

  it('passes window as from/to to getAlerts', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const window = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} technique="T1059" window={window} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ techniques: ['T1059'], from: window.from, to: window.to }),
    );
  });

  it('sends no from/to when no window is given (unbounded, as before)', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    const callArgs = mockGetAlerts.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('from');
    expect(callArgs).not.toHaveProperty('to');
  });

  it('does not pass techniques when neither prop is set (recent-all view)', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    const callArgs = mockGetAlerts.mock.calls[0][0] as { techniques?: string[] };
    expect(callArgs.techniques).toBeUndefined();
  });

  it('renders the Auto-resolved badge when an alert has auto_resolved=true', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        {
          ...makeAlert({ alert_id: 'a1', alert_title: 'PSH auto-handled' }),
          auto_resolved: true,
          auto_resolved_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          auto_resolve_mode: 'enabled',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH auto-handled')).toBeInTheDocument());
    expect(screen.getByText(/Auto-resolved by Achilles/)).toBeInTheDocument();
  });

  it('renders the critical severity tier distinctly from high', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({ alert_id: 'a1', alert_title: 'Critical one', severity: 'critical' }),
        makeAlert({ alert_id: 'a2', alert_title: 'High one', severity: 'high' }),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Critical one')).toBeInTheDocument());
    const criticalLabel = screen.getByText('critical');
    const highLabel = screen.getByText('high');
    // Distinct token classes (critical = red-600, high = red-500), not the
    // unknown fallback.
    expect(criticalLabel.className).toContain('text-red-600');
    expect(highLabel.className).toContain('text-red-500');
    expect(highLabel.className).not.toContain('text-red-600');
  });

  it('shows the technique-specific empty state when the backend returns no matches', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} technique="T1486" />);

    await waitFor(() =>
      expect(screen.getByText('No alerts found for T1486')).toBeInTheDocument()
    );
  });

  it('shows the error state when the API rejects', async () => {
    mockGetAlerts.mockRejectedValue(new Error('500 server error'));

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText('500 server error')).toBeInTheDocument()
    );
  });

  it('calls onClose when the close button is clicked', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const onClose = vi.fn();

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('No recent alerts')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('links to the us-1 Falcon console by default', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'cs123', alert_title: 'PSH abuse' })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH abuse')).toBeInTheDocument());
    const link = screen.getByLabelText('Open in Falcon console');
    expect(link).toHaveAttribute('href', 'https://falcon.crowdstrike.com/alerts');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('resolves the Falcon console base from the configured region', async () => {
    mockGetSettings.mockResolvedValue({ configured: true, region: 'eu-1' });
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'cs123', alert_title: 'PSH abuse' })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH abuse')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByLabelText('Open in Falcon console')).toHaveAttribute(
        'href',
        'https://falcon.eu-1.crowdstrike.com/alerts',
      )
    );
  });

  it('marks the dialog with role + aria-modal + aria-label for assistive tech', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} technique="T1059" />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Alerts for T1059');
  });

  it('closes the drawer when Escape is pressed', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const onClose = vi.fn();

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('No recent alerts')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the per-alert portal_url deep link when the alert carries one', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'cs-deep',
          alert_title: 'Killed stage',
          portal_url: 'https://falcon.us-2.crowdstrike.com/activity-v2/detections/abc123?_cid=deadbeef',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Killed stage')).toBeInTheDocument());
    expect(screen.getByLabelText('Open in Falcon console')).toHaveAttribute(
      'href',
      'https://falcon.us-2.crowdstrike.com/activity-v2/detections/abc123?_cid=deadbeef',
    );
  });

  it('falls back to the region-base /alerts link when portal_url is absent', async () => {
    mockGetSettings.mockResolvedValue({ configured: true, region: 'us-gov-1' });
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'cs-gov', alert_title: 'Gov alert' })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Gov alert')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByLabelText('Open in Falcon console')).toHaveAttribute(
        'href',
        'https://falcon.laggar.gcw.crowdstrike.com/alerts',
      )
    );
  });

  it('renders the prevention badge with the raw disposition as tooltip', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'cs-prev',
          alert_title: 'Prevented stage',
          prevention_action: 'process_killed',
          pattern_disposition_description: 'Prevention, process killed.',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('process killed')).toBeInTheDocument());
    expect(screen.getByText('process killed')).toHaveAttribute(
      'title',
      'Prevention, process killed.',
    );
  });

  it('styles kill_failed as a warning badge — attempted prevention, not prevention', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'cs-killfail',
          alert_title: 'Kill failed alert',
          prevention_action: 'kill_failed',
          pattern_disposition_description: 'Prevention, kill process failed.',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('kill failed')).toBeInTheDocument());
    const badge = screen.getByText('kill failed');
    expect(badge.className).toContain('text-warning');
    expect(badge.className).not.toContain('text-accent');
  });

  it('renders no prevention badge for detection-only alerts', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'cs-plain', alert_title: 'Detection only' })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<EndpointAlertDetailsDrawer vendor="crowdstrike" open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Detection only')).toBeInTheDocument());
    expect(screen.queryByText(/process killed|quarantined|kill failed/)).not.toBeInTheDocument();
  });

  it('SentinelOne: lists from the SentinelOne analytics API, links the stored console URL, never resolves a Falcon region', async () => {
    mockS1GetAlerts.mockResolvedValue({
      data: [
        makeAlert({ alert_id: 's1', alert_title: 'LSASS access', portal_url: 'https://acme.sentinelone.net/incidents/threats/1/overview' }),
        makeAlert({ alert_id: 's2', alert_title: 'No link' }),
      ],
      total: 2, page: 1, pageSize: 100,
    });
    render(<EndpointAlertDetailsDrawer vendor="sentinelone" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('LSASS access')).toBeInTheDocument());
    expect(screen.getByText('Recent SentinelOne Alerts')).toBeInTheDocument();
    expect(mockGetAlerts).not.toHaveBeenCalled();
    expect(mockGetSettings).not.toHaveBeenCalled();
    const links = screen.getAllByRole('link', { name: 'Open in SentinelOne console' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://acme.sentinelone.net/incidents/threats/1/overview');
  });
});
