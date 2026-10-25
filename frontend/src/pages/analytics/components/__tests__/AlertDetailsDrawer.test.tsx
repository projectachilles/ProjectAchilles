import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetAlerts = vi.fn();

vi.mock('@/services/api/defender', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/defender')>();
  return {
    ...actual,
    defenderApi: {
      ...actual.defenderApi,
      getAlerts: (params: unknown) => mockGetAlerts(params),
    },
  };
});

const { default: AlertDetailsDrawer } = await import('../AlertDetailsDrawer');

interface PartialAlert {
  alert_id: string;
  alert_title: string;
  severity: string;
  status: string;
  service_source: string;
  created_at: string;
  mitre_techniques: string[];
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked';
  remediation_status?: string;
  portal_url?: string;
}

function makeAlert(overrides: Partial<PartialAlert> = {}): PartialAlert {
  return {
    alert_id: 'a1',
    alert_title: 'Suspicious PowerShell',
    severity: 'high',
    status: 'new',
    service_source: 'microsoftDefenderForEndpoint',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    mitre_techniques: ['T1059'],
    ...overrides,
  };
}

describe('AlertDetailsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<AlertDetailsDrawer open={false} onClose={() => {}} />);
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

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH abuse')).toBeInTheDocument());
    expect(screen.getByText('Recent Defender Alerts')).toBeInTheDocument();
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

    render(<AlertDetailsDrawer open onClose={() => {}} technique="T1059" />);

    await waitFor(() => expect(screen.getByText('PSH parent')).toBeInTheDocument());
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ techniques: ['T1059'] }),
    );
    expect(screen.getByText('Alerts for T1059')).toBeInTheDocument();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });

  it('passes a multi-technique array straight through to the backend', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} techniques={['T1078', 'T1110']} />);

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

    render(<AlertDetailsDrawer open onClose={() => {}} technique="T1059" window={window} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ techniques: ['T1059'], from: window.from, to: window.to }),
    );
  });

  it('sends no from/to when no window is given (unbounded, as before)', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    const callArgs = mockGetAlerts.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('from');
    expect(callArgs).not.toHaveProperty('to');
  });

  it('does not pass techniques when neither prop is set (recent-all view)', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    const callArgs = mockGetAlerts.mock.calls[0][0] as { techniques?: string[] };
    expect(callArgs.techniques).toBeUndefined();
  });

  it('renders the Auto-resolved badge when an alert has f0rtika.auto_resolved=true', async () => {
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

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH auto-handled')).toBeInTheDocument());
    expect(screen.getByText(/Auto-resolved by Achilles/)).toBeInTheDocument();
  });

  it('a dry-run receipt says "would resolve", never "Auto-resolved by Achilles"', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        {
          ...makeAlert({ alert_id: 'a1', alert_title: 'Some quiet alert' }),
          auto_resolved: true,
          auto_resolved_at: new Date().toISOString(),
          auto_resolve_mode: 'dry_run',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Auto-resolve dry run: would resolve/)).toBeInTheDocument());
    expect(screen.queryByText(/Auto-resolved by Achilles/)).not.toBeInTheDocument();
  });

  it('shows the technique-specific empty state when the backend returns no matches', async () => {
    // Server-side filter returns an empty array for techniques with no alerts.
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} technique="T1486" />);

    await waitFor(() =>
      expect(screen.getByText('No alerts found for T1486')).toBeInTheDocument()
    );
  });

  it('shows the error state when the API rejects', async () => {
    mockGetAlerts.mockRejectedValue(new Error('500 server error'));

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText('500 server error')).toBeInTheDocument()
    );
  });

  it('calls onClose when the close button is clicked', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const onClose = vi.fn();

    render(<AlertDetailsDrawer open onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('No recent alerts')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a Defender portal external link per alert row', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'da123abc',
          alert_title: 'PSH abuse',
          mitre_techniques: ['T1059'],
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('PSH abuse')).toBeInTheDocument());
    const link = screen.getByLabelText('Open in Microsoft Defender');
    // Fallback when the alert carries no portal_url (pre-sync docs)
    expect(link).toHaveAttribute('href', 'https://security.microsoft.com/alerts/da123abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('uses the per-alert portal_url deep link (alertWebUrl) when the alert carries one', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'da999',
          alert_title: 'Killed mid-flight',
          portal_url: 'https://security.microsoft.com/alerts/da999?tid=contoso',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Killed mid-flight')).toBeInTheDocument());
    expect(screen.getByLabelText('Open in Microsoft Defender')).toHaveAttribute(
      'href',
      'https://security.microsoft.com/alerts/da999?tid=contoso',
    );
  });

  it('renders the prevention badge with the raw remediationStatus as tooltip', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({
          alert_id: 'da-prev',
          alert_title: 'Prevented stage',
          prevention_action: 'process_killed',
          remediation_status: 'blocked',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('process killed')).toBeInTheDocument());
    expect(screen.getByText('process killed')).toHaveAttribute('title', 'blocked');
  });

  it('renders no prevention badge for detection-only Defender alerts', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'da-plain', alert_title: 'Detection only' })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Detection only')).toBeInTheDocument());
    expect(screen.queryByText(/process killed|quarantined|kill failed/)).not.toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const onClose = vi.fn();

    const { container } = render(<AlertDetailsDrawer open onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('No recent alerts')).toBeInTheDocument());
    const backdrop = container.querySelector('[aria-hidden]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the dialog with role + aria-modal + aria-label for assistive tech', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} technique="T1059" />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Alerts for T1059');
  });

  it('closes the drawer when Escape is pressed', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });
    const onClose = vi.fn();

    render(<AlertDetailsDrawer open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('No recent alerts')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes the alert count region as an aria-live region', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'a1', alert_title: 'PSH', mitre_techniques: ['T1059'] })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    const { container } = render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('1 alerts')).toBeInTheDocument());
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe('1 alerts');
  });
});
