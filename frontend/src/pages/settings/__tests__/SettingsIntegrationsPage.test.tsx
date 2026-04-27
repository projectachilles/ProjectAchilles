import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));

vi.mock('@/hooks/useAnalyticsAuth', () => ({
  useAnalyticsAuth: () => ({
    configured: true,
    loading: false,
    updateSettings: vi.fn(),
  }),
}));

vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAzureSettings: vi.fn().mockResolvedValue({ configured: false }),
    getDefenderSettings: vi.fn().mockResolvedValue({ configured: false }),
    getAutoResolveStatus: vi.fn().mockResolvedValue({
      mode: 'disabled',
      counts: { last24h: 0, last7d: 0, last30d: 0 },
      lastAutoResolve: null,
    }),
    getAutoResolveReceipts: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
  },
}));

vi.mock('@/services/api/alerts', () => ({
  alertsApi: {
    getAlertSettings: vi.fn().mockResolvedValue({ configured: false }),
  },
}));

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    getSettings: vi.fn().mockResolvedValue({ configured: true, connectionType: 'cloud', indexPattern: 'achilles-results-*' }),
    listIndices: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn(),
    saveSettings: vi.fn(),
    createIndex: vi.fn(),
  },
}));

import SettingsIntegrationsPage from '../SettingsIntegrationsPage';

describe('SettingsIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Tactical Green page header and all four integration cards', () => {
    render(
      <MemoryRouter>
        <SettingsIntegrationsPage />
      </MemoryRouter>
    );

    // Page header
    expect(screen.getByRole('heading', { name: /Integrations/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Connect external services/i)).toBeInTheDocument();

    // Four integration card titles
    expect(screen.getByText(/Analytics \(Elasticsearch\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Azure \/ Entra ID/i)).toBeInTheDocument();
    expect(screen.getByText(/Microsoft Defender/i)).toBeInTheDocument();
    expect(screen.getByText(/Alerts & Notifications/i)).toBeInTheDocument();
  });

  it('uses the Tactical Green dash-card chrome', () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsIntegrationsPage />
      </MemoryRouter>
    );

    // SettingsCard renders <section class="dash-card">
    const cards = container.querySelectorAll('.dash-card');
    // 4 integrations -> 4 dash-cards
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });
});
