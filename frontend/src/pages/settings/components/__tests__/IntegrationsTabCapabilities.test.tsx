import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const caps = vi.hoisted(() => ({ sentinelone: false }));
const getS1Settings = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ preExecutionNotices: false, sentinelone: caps.sentinelone }) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: false }) }));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAzureSettings: () => Promise.resolve({ configured: false }),
    getDefenderSettings: () => Promise.resolve({ configured: false }),
    getCrowdStrikeSettings: () => Promise.resolve({ configured: false }),
  },
}));
vi.mock('@/services/api/alerts', () => ({ alertsApi: { getAlertSettings: () => Promise.resolve({ configured: false }) } }));
vi.mock('@/services/api/sentinelone', () => ({ sentinelOneApi: { getSettings: getS1Settings } }));
// The config forms render only when a card is opened; stub them to keep this test about the grid.
vi.mock('../AnalyticsConfig', () => ({ AnalyticsConfig: () => null }));
vi.mock('../AzureConfig', () => ({ AzureConfig: () => null }));
vi.mock('../DefenderConfig', () => ({ DefenderConfig: () => null }));
vi.mock('../CrowdStrikeConfig', () => ({ CrowdStrikeConfig: () => null }));
vi.mock('../SentinelOneConfig', () => ({ SentinelOneConfig: () => null }));
vi.mock('../AlertsConfig', () => ({ AlertsConfig: () => null }));
vi.mock('../PreExecutionNoticesConfig', () => ({ PreExecutionNoticesConfig: () => null }));

import { IntegrationsTab } from '../IntegrationsTab';

describe('IntegrationsTab SentinelOne card', () => {
  beforeEach(() => {
    getS1Settings.mockReset().mockResolvedValue({ configured: false });
  });

  it('is hidden, and its settings never requested, when the backend lacks the capability (Vercel)', () => {
    caps.sentinelone = false;
    render(<IntegrationsTab />);
    expect(screen.queryByText('SentinelOne')).toBeNull();
    expect(screen.getByText('CrowdStrike Falcon')).toBeTruthy();
    expect(getS1Settings).not.toHaveBeenCalled();
  });

  it('is shown when the capability is true', () => {
    caps.sentinelone = true;
    render(<IntegrationsTab />);
    expect(screen.getByText('SentinelOne')).toBeTruthy();
    expect(getS1Settings).toHaveBeenCalled();
  });
});
