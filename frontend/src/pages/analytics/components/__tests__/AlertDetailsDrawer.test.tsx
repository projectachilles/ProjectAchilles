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

  it('filters client-side when a technique is provided and matches sub-techniques', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [
        makeAlert({ alert_id: 'a1', alert_title: 'PSH parent', mitre_techniques: ['T1059'] }),
        makeAlert({ alert_id: 'a2', alert_title: 'PSH sub', mitre_techniques: ['T1059.001'] }),
        makeAlert({ alert_id: 'a3', alert_title: 'Cred dump', mitre_techniques: ['T1003'] }),
      ],
      total: 3,
      page: 1,
      pageSize: 100,
    });

    render(<AlertDetailsDrawer open onClose={() => {}} technique="T1059" />);

    await waitFor(() => expect(screen.getByText('PSH parent')).toBeInTheDocument());
    expect(screen.getByText('Alerts for T1059')).toBeInTheDocument();
    expect(screen.getByText('PSH sub')).toBeInTheDocument();
    expect(screen.queryByText('Cred dump')).toBeNull();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
  });

  it('shows the technique-specific empty state when no matches', async () => {
    mockGetAlerts.mockResolvedValue({
      data: [makeAlert({ alert_id: 'a1', mitre_techniques: ['T1003'] })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

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
