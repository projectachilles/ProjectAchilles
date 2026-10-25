import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { get: getMock } }));

const { VENDORS } = await import('../vendorConfig');
const { crowdstrikeApi } = await import('@/services/api/crowdstrike');
const { defenderApi } = await import('@/services/api/defender');
const { sentineloneAnalyticsApi } = await import('@/services/api/sentineloneAnalytics');

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ data: {} });
});

describe('VENDORS', () => {
  it('Defender vendor defaults to the High & medium segment', () => {
    const v = VENDORS.defender;
    expect(v.defaultSeverityKey).toBe('hm');
    expect(v.severitySegments.find((s) => s.key === v.defaultSeverityKey)).toEqual({
      key: 'hm',
      label: 'High & medium',
      severities: ['high', 'medium'],
    });
  });

  it('CrowdStrike vendor defaults to all severities', () => {
    expect(VENDORS.crowdstrike.defaultSeverityKey).toBe('all');
    expect(VENDORS.crowdstrike.api.getAlerts).toBe(crowdstrikeApi.getAlerts);
    expect(VENDORS.defender.api.getTechniqueCoverage).toBe(defenderApi.getTechniqueCoverage);
  });

  it('SentinelOne vendor defaults to all severities and uses its own analytics API', () => {
    const v = VENDORS.sentinelone;
    expect(v.id).toBe('sentinelone');
    expect(v.alertsTitle).toBe('SentinelOne Alerts');
    expect(v.defaultSeverityKey).toBe('all');
    expect(v.severitySegments.some((s) => s.key === v.defaultSeverityKey)).toBe(true);
    expect(v.api.getAlerts).toBe(sentineloneAnalyticsApi.getAlerts);
    expect(v.api.getTechniqueCoverage).toBe(sentineloneAnalyticsApi.getTechniqueCoverage);
  });
});

describe.each([
  ['crowdstrikeApi', 'crowdstrike', crowdstrikeApi],
  ['defenderApi', 'defender', defenderApi],
  ['sentineloneAnalyticsApi', 'sentinelone', sentineloneAnalyticsApi],
] as const)('%s', (_n, slug, api) => {
  const from = '2026-10-01T00:00:00.000Z';
  const to = '2026-10-20T00:00:00.000Z';

  it('getAlerts serialises severities as a comma severity param and passes source/from/to', async () => {
    await api.getAlerts({ severities: ['high', 'critical'], source: 'test', from, to, page: 2 });
    expect(getMock).toHaveBeenCalledWith(`/analytics/${slug}/alerts`, {
      params: expect.objectContaining({ severity: 'high,critical', source: 'test', from, to, page: 2 }),
    });
    expect(getMock.mock.calls[0][1].params).not.toHaveProperty('severities');
  });

  it('passes the window to summary, trend and technique coverage', async () => {
    await api.getAlertSummary({ from, to });
    expect(getMock).toHaveBeenLastCalledWith(`/analytics/${slug}/alerts/summary`, { params: { from, to } });
    await api.getAlertTrend(30, { from, to });
    expect(getMock).toHaveBeenLastCalledWith(`/analytics/${slug}/alerts/trend`, {
      params: { days: 30, from, to },
    });
    await api.getTechniqueCoverage({ from, to });
    expect(getMock).toHaveBeenLastCalledWith(`/analytics/${slug}/correlation/technique-coverage`, {
      params: { from, to },
    });
  });
});
