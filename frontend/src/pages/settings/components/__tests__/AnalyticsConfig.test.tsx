import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useAnalyticsAuth so AnalyticsConfig can render without a real provider
const mockUpdateSettings = vi.fn();
vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({
    updateSettings: mockUpdateSettings,
    configured: false,
    loading: false,
    settings: null,
    settingsVersion: 0,
    checkConfiguration: vi.fn(),
  }),
}));

// Mock analyticsApi so no real HTTP calls fire
const mockGetSettings = vi.fn();
vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getSettings: () => mockGetSettings(),
    saveSettings: vi.fn(),
    testConnection: vi.fn(),
  },
}));

// Dynamic import AFTER mocks are set up
const { AnalyticsConfig } = await import('../AnalyticsConfig');

describe('AnalyticsConfig write-index controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Return a not-configured response so the component renders in setup mode
    mockGetSettings.mockResolvedValue({ configured: false });
  });

  it('renders the Write Index Prefix input and the rollover select', async () => {
    render(<AnalyticsConfig />);
    expect(await screen.findByLabelText(/Write Index Prefix/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Write index rollover/i)).toBeInTheDocument();
  });

  it('Write Index Prefix defaults to achilles-results-', async () => {
    render(<AnalyticsConfig />);
    const prefixInput = await screen.findByLabelText(/Write Index Prefix/i);
    expect(prefixInput).toHaveValue('achilles-results-');
  });

  it('rollover select defaults to none', async () => {
    render(<AnalyticsConfig />);
    await screen.findByLabelText(/Write Index Prefix/i);
    const rolloverSelect = screen.getByLabelText(/Write index rollover/i);
    expect(rolloverSelect).toHaveValue('none');
  });

  it('loads writeIndexPrefix and writeIndexRollover from saved settings', async () => {
    mockGetSettings.mockResolvedValue({
      configured: true,
      connectionType: 'cloud',
      indexPattern: 'achilles-results-*',
      writeIndexPrefix: 'my-prefix-',
      writeIndexRollover: 'daily',
    });

    render(<AnalyticsConfig />);
    const prefixInput = await screen.findByLabelText(/Write Index Prefix/i);
    expect(prefixInput).toHaveValue('my-prefix-');
    expect(screen.getByLabelText(/Write index rollover/i)).toHaveValue('daily');
  });

  it('rollover select has all three options', async () => {
    render(<AnalyticsConfig />);
    await screen.findByLabelText(/Write Index Prefix/i);
    const select = screen.getByLabelText(/Write index rollover/i);
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain('none');
    expect(options).toContain('daily');
    expect(options).toContain('monthly');
  });
});
