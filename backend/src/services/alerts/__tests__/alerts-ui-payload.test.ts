import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Real IntegrationsSettingsService on a temp HOME; everything else mocked.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});
tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-alerts-svc-'));

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: function () {
    return {
      isConfigured: vi.fn().mockReturnValue(true),
      getSettings: vi.fn().mockReturnValue({ node: 'http://localhost:9200', indexPattern: 'achilles-results-*', configured: true }),
    };
  },
}));
vi.mock('../../analytics/elasticsearch.js', () => ({
  ElasticsearchService: function () {
    return {
      getLatestScoreSummary: vi.fn().mockResolvedValue({ score: 50, pairCount: 10, windowLabel: '30d' }),
      getErrorRate: vi.fn().mockResolvedValue({ errorRate: 0, errorCount: 0, conclusiveCount: 10, totalTestActivity: 10 }),
    };
  },
}));
vi.mock('../../defender/analytics.service.js', () => ({
  DefenderAnalyticsService: function () {
    return { getCurrentSecureScore: vi.fn() };
  },
}));
const mockSendSlackAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../slack.service.js', () => ({ sendSlackAlert: mockSendSlackAlert }));
const mockSendEmailAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../email.service.js', () => ({
  sendEmailAlert: mockSendEmailAlert,
  buildAlertEmailHtml: vi.fn().mockReturnValue('<p>alert</p>'),
}));

const { AlertsService } = await import('../alerts.service.js');
const { IntegrationsSettingsService } = await import('../../integrations/settings.js');

describe('AlertsService with settings saved via the UI payload shape', () => {
  beforeEach(() => {
    fs.rmSync(path.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
    fs.rmSync(path.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
  });

  it('dispatches both email and Slack when thresholds are breached', async () => {
    new IntegrationsSettingsService().saveAlertSettings({
      thresholds: { enabled: true, defense_score_min: 90 },
      cooldown_minutes: 15,
      // AlertsConfig.tsx payload: no `configured`
      email: {
        enabled: true, smtp_host: 'smtp.example.com', smtp_port: 587, smtp_secure: false,
        smtp_user: 'u', smtp_pass: 'p', from_address: 'a@example.com', recipients: ['ops@example.com'],
      },
      slack: { enabled: true, webhook_url: 'https://hooks.slack.com/services/T/B/x' },
    } as never);

    await new AlertsService().evaluateAndNotify('test-1', 'agent-1');

    expect(mockSendSlackAlert).toHaveBeenCalledOnce();
    expect(mockSendEmailAlert).toHaveBeenCalledOnce();
  });
});
