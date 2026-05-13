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

  it('passes the technique to the backend filter; renders the response as-is', async () => {
    // Backend is the SUT for the filter; the drawer just renders whatever it gets.
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
      expect.objectContaining({ technique: 'T1059' })
    );
    expect(screen.getByText('Alerts for T1059')).toBeInTheDocument();
    expect(screen.getByText('PSH sub')).toBeInTheDocument();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });

  it('does not pass technique when none is set (recent-all view)', async () => {
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 });

    render(<AlertDetailsDrawer open onClose={() => {}} />);

    await waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    const callArgs = mockGetAlerts.mock.calls[0][0] as { technique?: string };
    expect(callArgs.technique).toBeUndefined();
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

  it('marks the auto-resolve mode when not the default "enabled"', async () => {
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

    await waitFor(() => expect(screen.getByText(/dry-run/)).toBeInTheDocument());
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
    expect(link).toHaveAttribute('href', 'https://security.microsoft.com/alerts/da123abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
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
});
