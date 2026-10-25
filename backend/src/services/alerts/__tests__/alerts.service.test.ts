import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: IntegrationsSettingsService
// ---------------------------------------------------------------------------
const mockGetAlertSettings = vi.fn().mockReturnValue(null);
const mockIsAlertingConfigured = vi.fn().mockReturnValue(false);
const mockIsDefenderConfigured = vi.fn().mockReturnValue(false);
const mockS1Configured = vi.fn().mockReturnValue(false);
const mockSaveAlertSettings = vi.fn();

vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: function () {
    return {
      getAlertSettings: mockGetAlertSettings,
      isAlertingConfigured: mockIsAlertingConfigured,
      isDefenderConfigured: mockIsDefenderConfigured,
      isSentinelOneConfigured: mockS1Configured,
      saveAlertSettings: mockSaveAlertSettings,
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock: SettingsService (analytics)
// ---------------------------------------------------------------------------
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: function () {
    return {
      isConfigured: vi.fn().mockReturnValue(true),
      getSettings: vi.fn().mockReturnValue({
        node: 'http://localhost:9200',
        indexPattern: 'achilles-results-*',
        configured: true,
      }),
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock: ElasticsearchService
// ---------------------------------------------------------------------------
const mockGetDefenseScore = vi.fn().mockResolvedValue({
  score: 80,
  protectedCount: 80,
  unprotectedCount: 20,
  totalExecutions: 100,
});
const mockGetErrorRate = vi.fn().mockResolvedValue({
  errorRate: 10,
  errorCount: 10,
  conclusiveCount: 90,
  totalTestActivity: 100,
});

vi.mock('../../analytics/elasticsearch.js', () => ({
  ElasticsearchService: function () {
    return {
      getDefenseScore: mockGetDefenseScore,
      getErrorRate: mockGetErrorRate,
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock: DefenderAnalyticsService
// ---------------------------------------------------------------------------
const mockGetCurrentSecureScore = vi.fn().mockResolvedValue({
  currentScore: 65,
  maxScore: 100,
  percentage: 65,
  averageComparative: null,
});

vi.mock('../../defender/analytics.service.js', () => ({
  DefenderAnalyticsService: function () {
    return {
      getCurrentSecureScore: mockGetCurrentSecureScore,
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock: Channel services
// ---------------------------------------------------------------------------
const mockSendSlackAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../slack.service.js', () => ({
  sendSlackAlert: mockSendSlackAlert,
}));

const mockSendEmailAlert = vi.fn().mockResolvedValue(undefined);
const mockBuildAlertEmailHtml = vi.fn().mockReturnValue('<p>alert</p>');
vi.mock('../email.service.js', () => ({
  sendEmailAlert: mockSendEmailAlert,
  buildAlertEmailHtml: mockBuildAlertEmailHtml,
}));

// ---------------------------------------------------------------------------
// Mock: SentinelOne settings + posture snapshot (agent health counts)
// ---------------------------------------------------------------------------
const mockGetLatestAgentHealth = vi.fn().mockResolvedValue(null);
vi.mock('../../sentinelone/posture.service.js', () => ({
  SentinelOnePostureService: function () {
    return { getLatestAgentHealth: mockGetLatestAgentHealth };
  },
}));
vi.mock('../../analytics/client.js', () => ({ createEsClient: () => ({}) }));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { AlertsService } = await import('../alerts.service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default alert settings where defense score breaches (threshold 90, actual 80). */
function defaultAlertSettings(overrides: Record<string, unknown> = {}) {
  return {
    thresholds: { enabled: true, defense_score_min: 90 },
    cooldown_minutes: 15,
    slack: {
      webhook_url: 'https://hooks.slack.com/test',
      configured: true,
      enabled: true,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertsService', () => {
  let service: InstanceType<typeof AlertsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AlertsService();

    // Sensible defaults — overridden per test as needed
    mockIsAlertingConfigured.mockReturnValue(false);
    mockGetAlertSettings.mockReturnValue(null);
    mockIsDefenderConfigured.mockReturnValue(false);
    mockGetDefenseScore.mockResolvedValue({
      score: 80,
      protectedCount: 80,
      unprotectedCount: 20,
      totalExecutions: 100,
    });
    mockGetErrorRate.mockResolvedValue({
      errorRate: 10,
      errorCount: 10,
      conclusiveCount: 90,
      totalTestActivity: 100,
    });
    mockGetCurrentSecureScore.mockResolvedValue({
      currentScore: 65,
      maxScore: 100,
      percentage: 65,
      averageComparative: null,
    });
  });

  // 1.
  it('does nothing when alerting is not configured', async () => {
    mockIsAlertingConfigured.mockReturnValue(false);

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).not.toHaveBeenCalled();
    expect(mockSendEmailAlert).not.toHaveBeenCalled();
  });

  // 2.
  it('does nothing when thresholds are disabled', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue({
      thresholds: { enabled: false },
      cooldown_minutes: 15,
    });

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).not.toHaveBeenCalled();
    expect(mockSendEmailAlert).not.toHaveBeenCalled();
  });

  // 3.
  it('sends Slack alert when defense score breaches', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(defaultAlertSettings());

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    const [url, data] = mockSendSlackAlert.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(data.breaches).toHaveLength(1);
    expect(data.breaches[0].metric).toBe('Defense Score');
  });

  // 4.
  it('sends email alert when defense score breaches', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        slack: undefined,
        email: {
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'user',
          smtp_pass: 'pass',
          from_address: 'alerts@example.com',
          recipients: ['admin@example.com'],
          configured: true,
          enabled: true,
        },
      }),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendEmailAlert).toHaveBeenCalledOnce();
    expect(mockBuildAlertEmailHtml).toHaveBeenCalledOnce();
    expect(mockSendSlackAlert).not.toHaveBeenCalled();
  });

  // 5.
  it('sends to both channels when both configured', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        email: {
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'user',
          smtp_pass: 'pass',
          from_address: 'alerts@example.com',
          recipients: ['admin@example.com'],
          configured: true,
          enabled: true,
        },
      }),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    expect(mockSendEmailAlert).toHaveBeenCalledOnce();
  });

  // 6.
  it('does NOT alert when all metrics pass', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        thresholds: { enabled: true, defense_score_min: 70 },
      }),
    );
    // score is 80, threshold is 70 — passes

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).not.toHaveBeenCalled();
    expect(mockSendEmailAlert).not.toHaveBeenCalled();
  });

  // 7.
  it('respects cooldown — does NOT alert within cooldown period', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({ last_alert_at: fiveMinutesAgo }),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).not.toHaveBeenCalled();
    expect(mockSendEmailAlert).not.toHaveBeenCalled();
  });

  // 8.
  it('alerts when cooldown has expired', async () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({ last_alert_at: twentyMinutesAgo }),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
  });

  // 9.
  it('detects error rate breach', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        thresholds: { enabled: true, error_rate_max: 5 },
      }),
    );
    // errorRate is 10, threshold is 5 — breaches

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    const data = mockSendSlackAlert.mock.calls[0][1];
    expect(data.breaches[0].metric).toBe('Error Rate');
    expect(data.breaches[0].direction).toBe('above');
  });

  // 10.
  it('detects Secure Score breach when Defender configured', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockIsDefenderConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        thresholds: { enabled: true, secure_score_min: 70 },
      }),
    );
    // percentage is 65, threshold is 70 — breaches

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockGetCurrentSecureScore).toHaveBeenCalledOnce();
    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    const data = mockSendSlackAlert.mock.calls[0][1];
    expect(data.breaches[0].metric).toBe('Secure Score');
  });

  // 11.
  it('skips Secure Score when Defender not configured', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockIsDefenderConfigured.mockReturnValue(false);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        thresholds: { enabled: true, secure_score_min: 70 },
      }),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockGetCurrentSecureScore).not.toHaveBeenCalled();
    // No breaches from defense_score (not set) → no alerts
    expect(mockSendSlackAlert).not.toHaveBeenCalled();
  });

  // 12.
  it('updates last_alert_at after sending', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(defaultAlertSettings());

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSaveAlertSettings).toHaveBeenCalledOnce();
    const saved = mockSaveAlertSettings.mock.calls[0][0];
    expect(saved.last_alert_at).toBeDefined();
    // Should be a valid ISO timestamp
    expect(new Date(saved.last_alert_at).getTime()).toBeGreaterThan(0);
  });

  // 13.
  it('adds to history after alert', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(defaultAlertSettings());

    await service.evaluateAndNotify('test-1', 'agent-1');

    const history = service.getAlertHistory();
    expect(history).toHaveLength(1);
    expect(history[0].triggerTest).toBe('test-1');
    expect(history[0].triggerAgent).toBe('agent-1');
    expect(history[0].breaches).toHaveLength(1);
    expect(history[0].channels.slack).toBe(true);
  });

  // 14.
  it('getAlertHistory returns empty initially', () => {
    expect(service.getAlertHistory()).toEqual([]);
  });

  // 15.
  it('channel failure does not block other channel', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        email: {
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'user',
          smtp_pass: 'pass',
          from_address: 'alerts@example.com',
          recipients: ['admin@example.com'],
          configured: true,
          enabled: true,
        },
      }),
    );
    mockSendSlackAlert.mockRejectedValueOnce(new Error('Slack down'));

    await service.evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    expect(mockSendEmailAlert).toHaveBeenCalledOnce();
  });

  // 16.
  it('Secure Score query failure does not block alerting', async () => {
    mockIsAlertingConfigured.mockReturnValue(true);
    mockIsDefenderConfigured.mockReturnValue(true);
    mockGetAlertSettings.mockReturnValue(
      defaultAlertSettings({
        thresholds: {
          enabled: true,
          defense_score_min: 90,
          secure_score_min: 70,
        },
      }),
    );
    mockGetCurrentSecureScore.mockRejectedValueOnce(
      new Error('Defender API down'),
    );

    await service.evaluateAndNotify('test-1', 'agent-1');

    // Defense score still breaches (80 < 90), so Slack should fire
    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    const data = mockSendSlackAlert.mock.calls[0][1];
    expect(data.breaches[0].metric).toBe('Defense Score');
    // Secure Score breach is not included because query failed
    expect(
      data.breaches.find((b: { metric: string }) => b.metric === 'Secure Score'),
    ).toBeUndefined();
  });
});

describe('AlertsService — SentinelOne agent health thresholds', () => {
  const service = () => new AlertsService();
  const settings = (thresholds: Record<string, unknown>) => ({
    thresholds: { enabled: true, ...thresholds },
    cooldown_minutes: 15,
    slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAlertingConfigured.mockReturnValue(true);
    mockIsDefenderConfigured.mockReturnValue(false);
    mockS1Configured.mockReturnValue(true);
    mockGetLatestAgentHealth.mockResolvedValue({ total: 50, active: 48, infected: 2, outdated: 10, detect_only: 0, disconnected: 2 });
  });

  it('breaches when a count exceeds its max (counts only, no score)', async () => {
    mockGetAlertSettings.mockReturnValue(settings({ s1_infected_agents_max: 0, s1_outdated_agents_max: 20, s1_detect_only_agents_max: 0 }));
    await service().evaluateAndNotify('test-1', 'agent-1');
    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    const data = mockSendSlackAlert.mock.calls[0][1];
    expect(data.breaches).toEqual([
      { metric: 'SentinelOne infected agents', current: 2, threshold: 0, unit: ' agents', direction: 'above' },
    ]);
    expect(data.passing.map((p: { metric: string }) => p.metric)).toEqual(
      expect.arrayContaining(['SentinelOne outdated agents', 'SentinelOne detect-only agents']),
    );
  });

  it('is skipped when no S1 threshold is set or S1 is not configured', async () => {
    mockGetAlertSettings.mockReturnValue(settings({}));
    await service().evaluateAndNotify('test-1', 'agent-1');
    expect(mockGetLatestAgentHealth).not.toHaveBeenCalled();

    mockS1Configured.mockReturnValue(false);
    mockGetAlertSettings.mockReturnValue(settings({ s1_infected_agents_max: 0 }));
    await service().evaluateAndNotify('test-1', 'agent-1');
    expect(mockGetLatestAgentHealth).not.toHaveBeenCalled();
    expect(mockSendSlackAlert).not.toHaveBeenCalled();
  });

  it('no snapshot yet, or a query failure, does not alert or block', async () => {
    mockGetAlertSettings.mockReturnValue(settings({ s1_infected_agents_max: 0 }));
    mockGetLatestAgentHealth.mockResolvedValueOnce(null);
    await service().evaluateAndNotify('test-1', 'agent-1');
    mockGetLatestAgentHealth.mockRejectedValueOnce(new Error('es down'));
    await service().evaluateAndNotify('test-1', 'agent-1');
    expect(mockSendSlackAlert).not.toHaveBeenCalled();
  });
});
