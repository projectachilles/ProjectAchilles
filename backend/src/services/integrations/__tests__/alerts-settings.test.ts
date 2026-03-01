import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = {
    homedir: () => '/mock-home',
    hostname: () => 'test-host',
    userInfo: () => ({ username: 'testuser', uid: 1000, gid: 1000, shell: '/bin/bash', homedir: '/mock-home' }),
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { IntegrationsSettingsService } = await import('../settings.js');

const SETTINGS_DIR = '/mock-home/.projectachilles';
const SETTINGS_FILE = `${SETTINGS_DIR}/integrations.json`;

// ── Tests ────────────────────────────────────────────────────────────

describe('IntegrationsSettingsService — Alerts', () => {
  let service: InstanceType<typeof IntegrationsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-1234';
    service = new IntegrationsSettingsService();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  // ── getAlertSettings ──────────────────────────────────────────

  describe('getAlertSettings', () => {
    it('returns null when no settings file exists', () => {
      const result = service.getAlertSettings();
      expect(result).toBeNull();
    });

    it('returns null when file exists but has no alerts section', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        azure: { tenant_id: 'tid', client_id: 'cid', client_secret: 'sec', configured: true },
      }));

      const result = service.getAlertSettings();
      expect(result).toBeNull();
    });

    it('returns alert settings when present', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: true, defense_score_min: 70 },
          cooldown_minutes: 30,
        },
      }));

      const result = service.getAlertSettings();
      expect(result).not.toBeNull();
      expect(result!.thresholds.enabled).toBe(true);
      expect(result!.thresholds.defense_score_min).toBe(70);
      expect(result!.cooldown_minutes).toBe(30);
    });
  });

  // ── saveAlertSettings — encryption ────────────────────────────

  describe('saveAlertSettings — encryption', () => {
    it('encrypts slack webhook_url', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAlertSettings({
        thresholds: { enabled: true },
        slack: {
          webhook_url: 'https://hooks.slack.com/services/T00/B00/xxxx',
          configured: true,
          enabled: true,
        },
      });

      const saved = JSON.parse(writtenData);
      expect(saved.alerts.slack.webhook_url).toMatch(/^enc:/);
      // configured/enabled are NOT encrypted
      expect(saved.alerts.slack.configured).toBe(true);
      expect(saved.alerts.slack.enabled).toBe(true);
    });

    it('encrypts email smtp_user and smtp_pass', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAlertSettings({
        thresholds: { enabled: true },
        email: {
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'alerts@example.com',
          smtp_pass: 'super-secret-password',
          from_address: 'ProjectAchilles <alerts@example.com>',
          recipients: ['admin@example.com'],
          configured: true,
          enabled: true,
        },
      });

      const saved = JSON.parse(writtenData);
      expect(saved.alerts.email.smtp_user).toMatch(/^enc:/);
      expect(saved.alerts.email.smtp_pass).toMatch(/^enc:/);
      // Non-sensitive fields are NOT encrypted
      expect(saved.alerts.email.smtp_host).toBe('smtp.example.com');
      expect(saved.alerts.email.smtp_port).toBe(587);
      expect(saved.alerts.email.from_address).toBe('ProjectAchilles <alerts@example.com>');
      expect(saved.alerts.email.recipients).toEqual(['admin@example.com']);
    });

    it('does NOT encrypt thresholds (not sensitive)', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAlertSettings({
        thresholds: { enabled: true, defense_score_min: 70, error_rate_max: 20 },
        cooldown_minutes: 30,
      });

      const saved = JSON.parse(writtenData);
      expect(saved.alerts.thresholds.enabled).toBe(true);
      expect(saved.alerts.thresholds.defense_score_min).toBe(70);
      expect(saved.alerts.thresholds.error_rate_max).toBe(20);
      expect(saved.alerts.cooldown_minutes).toBe(30);
    });

    it('applies defaults when saving with no existing settings', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Save with just last_alert_at — defaults should fill in
      service.saveAlertSettings({ last_alert_at: '2026-02-28T00:00:00Z' });

      const saved = JSON.parse(writtenData);
      expect(saved.alerts.thresholds.enabled).toBe(false);
      expect(saved.alerts.cooldown_minutes).toBe(15);
      expect(saved.alerts.last_alert_at).toBe('2026-02-28T00:00:00Z');
    });
  });

  // ── saveAlertSettings — merge ─────────────────────────────────

  describe('saveAlertSettings — merge', () => {
    it('does not clobber azure/defender sections', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Save Azure first
      service.saveAzureSettings({
        tenant_id: 'azure-tenant',
        client_id: 'azure-client',
        client_secret: 'azure-secret',
      });

      const afterAzure = writtenData;
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(afterAzure);

      // Now save alerts — should preserve Azure
      service.saveAlertSettings({
        thresholds: { enabled: true, defense_score_min: 70 },
      });

      // Read back and verify both exist
      mockReadFileSync.mockReturnValue(writtenData);

      const azure = service.getAzureSettings();
      expect(azure).not.toBeNull();
      expect(azure!.tenant_id).toBe('azure-tenant');

      const alerts = service.getAlertSettings();
      expect(alerts).not.toBeNull();
      expect(alerts!.thresholds.defense_score_min).toBe(70);
    });

    it('merges partial threshold update with existing alert settings', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Initial full save
      service.saveAlertSettings({
        thresholds: { enabled: true, defense_score_min: 70 },
        cooldown_minutes: 30,
        slack: {
          webhook_url: 'https://hooks.slack.com/original',
          configured: true,
          enabled: true,
        },
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // Partial update: only change error_rate_max threshold
      service.saveAlertSettings({
        thresholds: { enabled: true, error_rate_max: 25 },
      });

      // Read back
      mockReadFileSync.mockReturnValue(writtenData);
      const loaded = service.getAlertSettings();

      expect(loaded!.thresholds.enabled).toBe(true);
      expect(loaded!.thresholds.defense_score_min).toBe(70); // preserved
      expect(loaded!.thresholds.error_rate_max).toBe(25);    // updated
      expect(loaded!.cooldown_minutes).toBe(30);             // preserved
      expect(loaded!.slack?.webhook_url).toBe('https://hooks.slack.com/original'); // preserved
    });
  });

  // ── isAlertingConfigured ──────────────────────────────────────

  describe('isAlertingConfigured', () => {
    it('returns false when no settings exist', () => {
      expect(service.isAlertingConfigured()).toBe(false);
    });

    it('returns false when thresholds exist but are not enabled', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: false, defense_score_min: 70 },
          cooldown_minutes: 15,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
        },
      }));

      expect(service.isAlertingConfigured()).toBe(false);
    });

    it('returns false when thresholds enabled but no channel configured', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: true, defense_score_min: 70 },
          cooldown_minutes: 15,
        },
      }));

      expect(service.isAlertingConfigured()).toBe(false);
    });

    it('returns false when thresholds enabled but slack not enabled', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: true },
          cooldown_minutes: 15,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: false },
        },
      }));

      expect(service.isAlertingConfigured()).toBe(false);
    });

    it('returns true when thresholds enabled + slack configured and enabled', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: true, defense_score_min: 70 },
          cooldown_minutes: 15,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
        },
      }));

      expect(service.isAlertingConfigured()).toBe(true);
    });

    it('returns true when thresholds enabled + email configured and enabled', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        alerts: {
          thresholds: { enabled: true },
          cooldown_minutes: 15,
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
        },
      }));

      expect(service.isAlertingConfigured()).toBe(true);
    });
  });

  // ── updateLastAlertTimestamp ───────────────────────────────────

  describe('updateLastAlertTimestamp', () => {
    it('saves the timestamp via saveAlertSettings', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.updateLastAlertTimestamp('2026-02-28T12:00:00Z');

      const saved = JSON.parse(writtenData);
      expect(saved.alerts.last_alert_at).toBe('2026-02-28T12:00:00Z');
    });
  });

  // ── Encryption round-trip ─────────────────────────────────────

  describe('encryption round-trip', () => {
    it('save then get returns decrypted values matching originals', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      const originalSlackUrl = 'https://hooks.slack.com/services/T00/B00/xxxxxxxxxxxx';
      const originalSmtpUser = 'alerts@example.com';
      const originalSmtpPass = 'super-secret-smtp-password';

      service.saveAlertSettings({
        thresholds: { enabled: true, defense_score_min: 75 },
        cooldown_minutes: 20,
        slack: {
          webhook_url: originalSlackUrl,
          configured: true,
          enabled: true,
        },
        email: {
          smtp_host: 'smtp.example.com',
          smtp_port: 465,
          smtp_secure: true,
          smtp_user: originalSmtpUser,
          smtp_pass: originalSmtpPass,
          from_address: 'ProjectAchilles <alerts@example.com>',
          recipients: ['admin@example.com', 'security@example.com'],
          configured: true,
          enabled: true,
        },
      });

      // Verify encrypted on disk
      const saved = JSON.parse(writtenData);
      expect(saved.alerts.slack.webhook_url).toMatch(/^enc:/);
      expect(saved.alerts.email.smtp_user).toMatch(/^enc:/);
      expect(saved.alerts.email.smtp_pass).toMatch(/^enc:/);

      // Let readFileSync return what was written
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // Read back — should be decrypted
      const loaded = service.getAlertSettings();
      expect(loaded).not.toBeNull();

      // Thresholds (not encrypted, direct match)
      expect(loaded!.thresholds.enabled).toBe(true);
      expect(loaded!.thresholds.defense_score_min).toBe(75);
      expect(loaded!.cooldown_minutes).toBe(20);

      // Slack — decrypted back to original
      expect(loaded!.slack!.webhook_url).toBe(originalSlackUrl);
      expect(loaded!.slack!.configured).toBe(true);
      expect(loaded!.slack!.enabled).toBe(true);

      // Email — decrypted back to original
      expect(loaded!.email!.smtp_host).toBe('smtp.example.com');
      expect(loaded!.email!.smtp_port).toBe(465);
      expect(loaded!.email!.smtp_secure).toBe(true);
      expect(loaded!.email!.smtp_user).toBe(originalSmtpUser);
      expect(loaded!.email!.smtp_pass).toBe(originalSmtpPass);
      expect(loaded!.email!.from_address).toBe('ProjectAchilles <alerts@example.com>');
      expect(loaded!.email!.recipients).toEqual(['admin@example.com', 'security@example.com']);
      expect(loaded!.email!.configured).toBe(true);
      expect(loaded!.email!.enabled).toBe(true);
    });
  });
});
