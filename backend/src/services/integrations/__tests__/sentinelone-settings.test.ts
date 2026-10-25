import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 's1-settings-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { IntegrationsSettingsService } = await import('../settings.js');
const FILE = realPath.join(tmpHome, '.projectachilles', 'integrations.json');
const TOKEN = 'super-secret-token-value-0123456789';

describe('IntegrationsSettingsService — SentinelOne', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    delete process.env.SENTINELONE_BASE_URL;
    delete process.env.SENTINELONE_API_TOKEN;
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
  });
  afterAll(() => realFs.rmSync(tmpHome, { recursive: true, force: true }));

  it('encrypts the token at rest, preserves other integrations, and applies defaults', () => {
    realFs.mkdirSync(realPath.dirname(FILE), { recursive: true });
    const notices = { enabled: true, recipients: ['soc@example.com'] };
    realFs.writeFileSync(FILE, JSON.stringify({ pre_execution_notices: notices }));

    const svc = new IntegrationsSettingsService();
    svc.saveSentinelOneSettings({ base_url: 'https://acme.sentinelone.net/', api_token: TOKEN });

    const raw = realFs.readFileSync(FILE, 'utf8');
    expect(raw).not.toContain(TOKEN);
    const parsed = JSON.parse(raw);
    expect(parsed.pre_execution_notices).toEqual(notices);
    expect(parsed.sentinelone.api_token.startsWith('enc:')).toBe(true);

    expect(svc.getSentinelOneCredentials()).toEqual({ base_url: 'https://acme.sentinelone.net', api_token: TOKEN, permission_mode: 'read_only' });
    const masked = svc.getSentinelOneSettingsMasked();
    expect(masked).toMatchObject({ configured: true, permission_mode: 'read_only', poll_interval_minutes: 5, backfill_days: 365, api_token_set: true });
    expect(JSON.stringify(masked)).not.toContain(TOKEN);
  });

  it('partial update keeps the token and resets checkpoints when scope changes', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSentinelOneSettings({ base_url: 'https://acme.sentinelone.net', api_token: TOKEN });
    svc.saveSentinelOneSyncTimestamps({ last_threat_sync: '2026-01-01T00:00:00.000Z', sync_version: 1 });

    svc.saveSentinelOneSettings({ permission_mode: 'response' });
    expect(svc.getSentinelOneCredentials()?.api_token).toBe(TOKEN);
    expect(svc.getSentinelOnePermissionMode()).toBe('response');
    expect(svc.getSentinelOneSyncTimestamps().last_threat_sync).toBe('2026-01-01T00:00:00.000Z');

    svc.saveSentinelOneSettings({ scope: { account_ids: ['123'] } });
    expect(svc.getSentinelOneSyncTimestamps().last_threat_sync).toBeUndefined();
  });

  it('rejects non-SentinelOne hosts', () => {
    const svc = new IntegrationsSettingsService();
    expect(() => svc.saveSentinelOneSettings({ base_url: 'https://evil.example.com', api_token: TOKEN })).toThrow();
  });

  it('isolates per-org settings', () => {
    new IntegrationsSettingsService('org_a').saveSentinelOneSettings({ base_url: 'https://a.sentinelone.net', api_token: TOKEN });
    expect(new IntegrationsSettingsService('org_a').isSentinelOneConfigured()).toBe(true);
    expect(new IntegrationsSettingsService('org_b').isSentinelOneConfigured()).toBe(false);
  });

  it('falls back to env vars and refuses deletion of env config', () => {
    process.env.SENTINELONE_BASE_URL = 'https://env.sentinelone.net';
    process.env.SENTINELONE_API_TOKEN = TOKEN;
    const svc = new IntegrationsSettingsService();
    expect(svc.getSentinelOneCredentials()).toMatchObject({ base_url: 'https://env.sentinelone.net', permission_mode: 'read_only' });
    expect(() => svc.deleteSentinelOneSettings()).toThrow(/environment variables/);
  });

  it('an undecryptable token reads as not configured instead of throwing', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSentinelOneSettings({ base_url: 'https://acme.sentinelone.net', api_token: TOKEN });
    process.env.ENCRYPTION_SECRET = 'a-different-secret-that-is-also-at-least-32-chars';
    expect(() => svc.isSentinelOneConfigured()).not.toThrow();
    expect(svc.isSentinelOneConfigured()).toBe(false);
    expect(svc.getSentinelOneCredentials()).toBeNull();
  });

  it('refuses to overwrite an integrations.json it cannot parse', () => {
    realFs.mkdirSync(realPath.dirname(FILE), { recursive: true });
    realFs.writeFileSync(FILE, '{ "defender": { "configured": true, ');
    const svc = new IntegrationsSettingsService();
    expect(() => svc.saveSentinelOneSettings({ base_url: 'https://acme.sentinelone.net', api_token: TOKEN })).toThrow(/not valid JSON/);
    expect(() => svc.saveSentinelOneSyncTimestamps({ last_threat_sync: '2026-01-01T00:00:00.000Z' })).toThrow(/not valid JSON/);
    expect(realFs.readFileSync(FILE, 'utf8')).toBe('{ "defender": { "configured": true, ');
  });

  it('an org never writes to, or copies, the legacy section', () => {
    const legacy = new IntegrationsSettingsService();
    legacy.saveSentinelOneSettings({ base_url: 'https://legacy.sentinelone.net', api_token: TOKEN, permission_mode: 'response' });

    const org = new IntegrationsSettingsService('org_a');
    // Reads fall back to legacy like the other integrations…
    expect(org.isSentinelOneConfigured()).toBe(true);
    // …but writes stay in the org's own section.
    expect(() => org.setSentinelOneAutoResolveMode('dry_run')).toThrow(/whole deployment/);
    expect(() => org.saveSentinelOneSettings({ label: 'mine' })).toThrow(/whole deployment/);
    // Disconnecting must not answer "done" while the deployment-wide integration keeps running.
    expect(() => org.deleteSentinelOneSettings()).toThrow(/whole deployment/);
    expect(legacy.isSentinelOneConfigured()).toBe(true);
    expect(legacy.getSentinelOneAutoResolveMode()).toBe('disabled');
    expect(JSON.parse(realFs.readFileSync(FILE, 'utf8')).orgs).toBeUndefined();
  });
});
