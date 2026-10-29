import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const caps = vi.hoisted(() => ({ sentinelone: false, sophos: false, alerting: true, preExecutionNotices: false }));
const getS1Settings = vi.hoisted(() => vi.fn());
const getSophosSettings = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ preExecutionNotices: caps.preExecutionNotices, sentinelone: caps.sentinelone, sophos: caps.sophos, alerting: caps.alerting }) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: false }) }));
vi.mock('@/services/api/integrations', () => ({
  integrationsApi: {
    getAzureSettings: () => Promise.resolve({ configured: false }),
    getDefenderSettings: () => Promise.resolve({ configured: false }),
    getCrowdStrikeSettings: () => Promise.resolve({ configured: false }),
  },
}));
const getAlertSettings = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/alerts', () => ({ alertsApi: { getAlertSettings } }));
vi.mock('@/services/api/sentinelone', () => ({ sentinelOneApi: { getSettings: getS1Settings } }));
vi.mock('@/services/api/sophos', () => ({ sophosApi: { getSettings: getSophosSettings } }));
const getNoticeSettings = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/notices', () => ({ noticesApi: { getSettings: getNoticeSettings } }));
// The config forms render only when a card is opened; stub them to keep this test about the grid.
vi.mock('../AnalyticsConfig', () => ({ AnalyticsConfig: () => null }));
vi.mock('../AzureConfig', () => ({ AzureConfig: () => null }));
vi.mock('../DefenderConfig', () => ({ DefenderConfig: () => null }));
vi.mock('../CrowdStrikeConfig', () => ({ CrowdStrikeConfig: () => null }));
vi.mock('../SentinelOneConfig', () => ({ SentinelOneConfig: () => null }));
vi.mock('../SophosConfig', () => ({ SophosConfig: () => null }));
vi.mock('../AlertsConfig', () => ({ AlertsConfig: () => null }));
vi.mock('../PreExecutionNoticesConfig', () => ({ PreExecutionNoticesConfig: () => null }));

import { IntegrationsTab } from '../IntegrationsTab';

describe('IntegrationsTab SentinelOne card', () => {
  beforeEach(() => {
    getS1Settings.mockReset().mockResolvedValue({ configured: false });
    getSophosSettings.mockReset().mockResolvedValue({ configured: false });
    getAlertSettings.mockReset().mockResolvedValue({ configured: false });
    getNoticeSettings.mockReset().mockResolvedValue({ enabled: false });
    caps.alerting = true;
    caps.preExecutionNotices = false;
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

  it('Sophos card is hidden, and its settings never requested, without the capability', () => {
    caps.sophos = false;
    render(<IntegrationsTab />);
    expect(screen.queryByText('Sophos Intercept X')).toBeNull();
    expect(getSophosSettings).not.toHaveBeenCalled();
  });

  it('Sophos card is shown when the capability is true', () => {
    caps.sophos = true;
    render(<IntegrationsTab />);
    expect(screen.getByText('Sophos Intercept X')).toBeTruthy();
    expect(getSophosSettings).toHaveBeenCalled();
    caps.sophos = false;
  });

  it('the Alerts & Notifications card is hidden, and its settings never requested, without alerting (Vercel)', () => {
    caps.alerting = false;
    render(<IntegrationsTab />);
    expect(screen.queryByText('Alerts & Notifications')).toBeNull();
    expect(getAlertSettings).not.toHaveBeenCalled();
  });

  it('the Alerts & Notifications card is shown when the backend has alerting', () => {
    render(<IntegrationsTab />);
    expect(screen.getByText('Alerts & Notifications')).toBeTruthy();
    expect(getAlertSettings).toHaveBeenCalled();
  });

  it('the Pre-execution notices badge reflects saved settings before its dialog is opened', async () => {
    caps.preExecutionNotices = true;
    getNoticeSettings.mockResolvedValue({ enabled: true });
    render(<IntegrationsTab />);
    const card = screen.getByText('Pre-execution notices').closest('div.rounded-lg') as HTMLElement;
    expect(await within(card).findByText('connected')).toBeTruthy();
  });

  it('never requests notice settings when the backend lacks the capability (Vercel)', () => {
    render(<IntegrationsTab />);
    expect(screen.queryByText('Pre-execution notices')).toBeNull();
    expect(getNoticeSettings).not.toHaveBeenCalled();
  });
});
