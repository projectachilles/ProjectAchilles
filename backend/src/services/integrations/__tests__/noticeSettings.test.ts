import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let store: string | null = null;
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

const { IntegrationsSettingsService, clampNoticeSettings } = await import('../settings.js');

describe('pre-execution notice settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = null;
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    mockExistsSync.mockImplementation((p: string) => (String(p).endsWith('integrations.json') ? store !== null : true));
    mockReadFileSync.mockImplementation(() => store);
    mockWriteFileSync.mockImplementation((_p: string, data: string) => { store = data; });
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  it('returns defaults when the file has no section', () => {
    store = JSON.stringify({ alerts: { thresholds: { enabled: false }, cooldown_minutes: 15 } });
    expect(new IntegrationsSettingsService().getPreExecutionNoticeSettings()).toEqual({
      enabled: false,
      recipients: [],
      lead_minutes: 5,
      max_wait_minutes: 60,
      pickup_window_minutes: 120,
      send_finished: true,
      advance_digest_enabled: false,
      digest_timezone: 'UTC',
    });
  });

  it('stays enabled when an unrelated secret in the file cannot be decrypted (fails closed)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store = JSON.stringify({
      alerts: { email: { smtp_host: 'h', smtp_user: 'enc:not-decryptable', smtp_pass: 'enc:not-decryptable', from_address: 'a@x.io' } },
      pre_execution_notices: { enabled: true, recipients: ['soc@x.io'] },
    });
    const s = new IntegrationsSettingsService().getPreExecutionNoticeSettings();
    expect(s.enabled).toBe(true);
    expect(s.recipients).toEqual(['soc@x.io']);
    errSpy.mockRestore();
  });

  it('keeps the last good notice settings for that org when the file becomes unreadable', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store = JSON.stringify({ orgs: { 'org-k': { pre_execution_notices: { enabled: true, recipients: ['k@x.io'] } } } });
    expect(new IntegrationsSettingsService('org-k').getPreExecutionNoticeSettings().enabled).toBe(true);
    store = '{ this is not json';
    const s = new IntegrationsSettingsService('org-k').getPreExecutionNoticeSettings();
    expect(s).toMatchObject({ enabled: true, recipients: ['k@x.io'] });
    // An org never read successfully has nothing to fall back on: defaults (off).
    expect(new IntegrationsSettingsService('org-never-read').getPreExecutionNoticeSettings().enabled).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns defaults when there is no file at all', () => {
    expect(new IntegrationsSettingsService().getPreExecutionNoticeSettings().lead_minutes).toBe(5);
  });

  it('clamps lead_minutes to an integer in 0..5', () => {
    expect(clampNoticeSettings({ lead_minutes: 9 }).lead_minutes).toBe(5);
    expect(clampNoticeSettings({ lead_minutes: -1 }).lead_minutes).toBe(0);
    expect(clampNoticeSettings({ lead_minutes: 2.7 }).lead_minutes).toBe(2);
    expect(clampNoticeSettings({ lead_minutes: NaN }).lead_minutes).toBe(5);
  });

  it('clamps max_wait_minutes to 15..1440 and pickup_window_minutes to 30..1440', () => {
    expect(clampNoticeSettings({ max_wait_minutes: 5 }).max_wait_minutes).toBe(15);
    expect(clampNoticeSettings({ max_wait_minutes: 99999 }).max_wait_minutes).toBe(1440);
    expect(clampNoticeSettings({ pickup_window_minutes: 5000 }).pickup_window_minutes).toBe(1440);
    expect(clampNoticeSettings({ pickup_window_minutes: 1 }).pickup_window_minutes).toBe(30);
  });

  it('round-trips a save and preserves other sections', () => {
    store = JSON.stringify({ alerts: { thresholds: { enabled: true }, cooldown_minutes: 15 } });
    const svc = new IntegrationsSettingsService();
    const saved = svc.savePreExecutionNoticeSettings({ enabled: true, recipients: ['a@x.io'], lead_minutes: 3 });
    expect(saved).toMatchObject({ enabled: true, recipients: ['a@x.io'], lead_minutes: 3, max_wait_minutes: 60 });
    expect(new IntegrationsSettingsService().getPreExecutionNoticeSettings()).toEqual(saved);
    expect(JSON.parse(store!).alerts.cooldown_minutes).toBe(15);

    // partial patch merges
    const next = svc.savePreExecutionNoticeSettings({ send_finished: false });
    expect(next).toMatchObject({ enabled: true, recipients: ['a@x.io'], send_finished: false });
  });

  it('an org id reads and writes orgs[orgId] (Ruling R20); the legacy level is untouched', () => {
    store = JSON.stringify({ pre_execution_notices: { enabled: false, recipients: ['legacy@x.io'] } });
    const svc = new IntegrationsSettingsService('org_1');
    svc.savePreExecutionNoticeSettings({ enabled: true, recipients: ['a@x.io'] });
    const written = JSON.parse(store!);
    expect(written.orgs.org_1.pre_execution_notices).toMatchObject({ enabled: true, recipients: ['a@x.io'] });
    expect(written.pre_execution_notices).toEqual({ enabled: false, recipients: ['legacy@x.io'] });
    expect(svc.getPreExecutionNoticeSettings()).toMatchObject({ enabled: true, recipients: ['a@x.io'] });
    expect(new IntegrationsSettingsService().getPreExecutionNoticeSettings()).toMatchObject({ enabled: false, recipients: ['legacy@x.io'] });
    expect(new IntegrationsSettingsService('org_2').getPreExecutionNoticeSettings()).toMatchObject({ enabled: false, recipients: ['legacy@x.io'] });
  });

  it("an org without its own section falls back to the legacy settings, and 'default' is just such an org", () => {
    store = JSON.stringify({
      pre_execution_notices: { enabled: true, recipients: ['legacy@x.io'], lead_minutes: 2 },
      orgs: { org_1: { alerts: { thresholds: { enabled: false }, cooldown_minutes: 15 } } },
    });
    for (const org of ['org_1', 'default', 'unknown']) {
      expect(new IntegrationsSettingsService(org).getPreExecutionNoticeSettings()).toMatchObject({
        enabled: true, recipients: ['legacy@x.io'], lead_minutes: 2,
      });
    }
  });

  it("an org's first save starts from the legacy values but not the legacy SMTP check result", () => {
    store = JSON.stringify({
      pre_execution_notices: {
        enabled: true, recipients: ['legacy@x.io'], lead_minutes: 2,
        last_smtp_check_at: '2026-10-23T00:00:00.000Z', last_smtp_check_ok: true, last_smtp_check_message: 'ok',
      },
    });
    const saved = new IntegrationsSettingsService('org_1').savePreExecutionNoticeSettings({ recipients: ['a@x.io'] });
    expect(saved).toMatchObject({ enabled: true, recipients: ['a@x.io'], lead_minutes: 2 });
    expect(saved.last_smtp_check_at).toBeUndefined();
    expect(saved.last_smtp_check_ok).toBeUndefined();
    expect(saved.last_smtp_check_message).toBeUndefined();
  });

  it('listNoticeOrgIds lists orgs with their own notice section only', () => {
    store = JSON.stringify({
      pre_execution_notices: { enabled: true, recipients: [] },
      orgs: { a: { pre_execution_notices: { enabled: false, recipients: [] } }, b: { alerts: { thresholds: { enabled: false }, cooldown_minutes: 15 } } },
    });
    expect(new IntegrationsSettingsService('b').listNoticeOrgIds()).toEqual(['a']);
  });

  it('decrypts the SMTP and Slack credentials of an org alerts section', () => {
    const svc = new IntegrationsSettingsService('org_1');
    svc.saveAlertSettings({
      thresholds: { enabled: false },
      slack: { webhook_url: 'https://hooks.slack.test/abc', enabled: true },
      email: { smtp_host: 'h', smtp_user: 'user-1', smtp_pass: 'pass-1', from_address: 'f@x.io', enabled: true },
    } as any);
    const raw = JSON.parse(store!).orgs.org_1.alerts;
    expect(raw.email.smtp_pass).toMatch(/^enc:/);
    const read = svc.getAlertSettings()!;
    expect(read.email).toMatchObject({ smtp_user: 'user-1', smtp_pass: 'pass-1' });
    expect(read.slack?.webhook_url).toBe('https://hooks.slack.test/abc');
    // #546: `configured` is derived on the org read path too (after decryption).
    expect(read.slack?.configured).toBe(true);
    expect(read.email?.configured).toBe(false); // no alert recipients

    // A later partial save keeps the credentials single-encrypted.
    svc.saveAlertSettings({ cooldown_minutes: 30 });
    expect(svc.getAlertSettings()!.email).toMatchObject({ smtp_user: 'user-1', smtp_pass: 'pass-1' });
  });
});
