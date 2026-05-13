import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetControls = vi.fn();
const mockGetControlCorrelation = vi.fn();

vi.mock('@/services/api/defender', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/defender')>();
  return {
    ...actual,
    defenderApi: {
      ...actual.defenderApi,
      getControls: (params: unknown) => mockGetControls(params),
      getControlCorrelation: (title: string, days?: number) =>
        mockGetControlCorrelation(title, days),
    },
  };
});

const { default: TopControlsCard } = await import('../TopControlsCard');

function makeControl(overrides: Partial<{
  control_name: string;
  title: string;
  max_score: number;
  control_category: string;
}> = {}) {
  return {
    control_name: 'ctrl-1',
    control_category: 'Identity',
    title: 'Some control title',
    implementation_cost: 'Low',
    user_impact: 'Low',
    rank: 1,
    threats: [],
    deprecated: false,
    remediation_summary: '',
    action_url: '',
    max_score: 9.0,
    tier: 'Tier1',
    ...overrides,
  };
}

describe('TopControlsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders controls sorted by max_score and shows correlation alert counts', async () => {
    mockGetControls.mockResolvedValue([
      makeControl({ control_name: 'mfa', title: 'Ensure multifactor authentication is enabled for admins', max_score: 10 }),
      makeControl({ control_name: 'mail', title: 'Block executable content from email client', max_score: 9 }),
    ]);
    mockGetControlCorrelation.mockImplementation(async (title: string) => {
      if (title.includes('multifactor')) return { coveredTechniques: ['T1078'], alertCount: 12 };
      if (title.includes('email')) return { coveredTechniques: ['T1566'], alertCount: 3 };
      return { coveredTechniques: [], alertCount: 0 };
    });

    render(<TopControlsCard onSelectControlAlerts={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/Ensure multifactor authentication/)).toBeInTheDocument()
    );
    await waitFor(() => expect(mockGetControlCorrelation).toHaveBeenCalledTimes(2));

    expect(screen.getByText(/12 alerts addressed in last 30d/)).toBeInTheDocument();
    expect(screen.getByText(/3 alerts addressed in last 30d/)).toBeInTheDocument();
  });

  it('does not render the correlation badge when alertCount is zero', async () => {
    mockGetControls.mockResolvedValue([
      makeControl({ control_name: 'mfa', title: 'Ensure multifactor authentication is enabled' }),
    ]);
    mockGetControlCorrelation.mockResolvedValue({ coveredTechniques: ['T1078'], alertCount: 0 });

    render(<TopControlsCard onSelectControlAlerts={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/Ensure multifactor authentication/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/alerts addressed in last/)).toBeNull();
  });

  it('does not render the correlation badge when no onSelectControlAlerts callback is provided', async () => {
    mockGetControls.mockResolvedValue([
      makeControl({ control_name: 'mfa', title: 'Ensure multifactor authentication is enabled' }),
    ]);
    mockGetControlCorrelation.mockResolvedValue({ coveredTechniques: ['T1078'], alertCount: 12 });

    render(<TopControlsCard />);

    await waitFor(() =>
      expect(screen.getByText(/Ensure multifactor authentication/)).toBeInTheDocument()
    );
    // Wait for correlation fetch to resolve before asserting absence
    await waitFor(() => expect(mockGetControlCorrelation).toHaveBeenCalled());
    expect(screen.queryByText(/alerts addressed in last/)).toBeNull();
  });

  it('fires onSelectControlAlerts with techniques + title when badge is clicked', async () => {
    mockGetControls.mockResolvedValue([
      makeControl({ control_name: 'mfa', title: 'Ensure multifactor authentication is enabled for admins' }),
    ]);
    mockGetControlCorrelation.mockResolvedValue({
      coveredTechniques: ['T1078', 'T1110'],
      alertCount: 12,
    });
    const onSelectControlAlerts = vi.fn();

    render(<TopControlsCard onSelectControlAlerts={onSelectControlAlerts} />);

    const badge = await screen.findByText(/12 alerts addressed in last 30d/);
    await userEvent.click(badge);

    expect(onSelectControlAlerts).toHaveBeenCalledTimes(1);
    expect(onSelectControlAlerts).toHaveBeenCalledWith(
      ['T1078', 'T1110'],
      'Ensure multifactor authentication is enabled for admins',
    );
  });

  it('renders the empty state when controls API returns nothing', async () => {
    mockGetControls.mockResolvedValue([]);

    render(<TopControlsCard onSelectControlAlerts={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/No controls data — sync Defender first/)).toBeInTheDocument()
    );
    expect(mockGetControlCorrelation).not.toHaveBeenCalled();
  });
});
