import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'sophos-settings-'));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { IntegrationsSettingsService } = await import('../settings.js');
const FILE = realPath.join(tmpHome, '.projectachilles', 'integrations.json');
const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const SECRET = 'super-secret-sophos-client-secret-0123456789';

const CAPS = { siem: 'available', alerts: 'available', xdr_graphql: 'not_licensed', xdr_rest: 'unknown', health_check: 'available' } as const;

describe('IntegrationsSettingsService — Sophos', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    delete process.env.SOPHOS_CLIENT_ID;
    delete process.env.SOPHOS_CLIENT_SECRET;
    delete process.env.SOPHOS_PERMISSION_MODE;
    delete process.env.SOPHOS_LABEL;
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
  });
  afterAll(() => realFs.rmSync(tmpHome, { recursive: true, force: true }));

  it('saveSophosSettings refuses a new client_id without a new secret and leaves the file unchanged', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    const before = realFs.readFileSync(FILE, 'utf8');
    expect(() => svc.saveSophosSettings({ client_id: '99999999-2222-3333-4444-555555555555' })).toThrow(/client secret for the new client ID/i);
    expect(realFs.readFileSync(FILE, 'utf8')).toBe(before);
    // Same id without a secret (label edit) and a new id with a secret are fine.
    expect(() => svc.saveSophosSettings({ client_id: CLIENT_ID, label: 'x' })).not.toThrow();
    expect(() => svc.saveSophosSettings({ client_id: '99999999-2222-3333-4444-555555555555', client_secret: 'another-secret-0123456789' })).not.toThrow();
  });

  it('stores the client secret encrypted at rest', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });

    const raw = realFs.readFileSync(FILE, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw).sophos.client_secret.startsWith('enc:')).toBe(true);
    expect(svc.getSophosCredentials()).toEqual({ client_id: CLIENT_ID, client_secret: SECRET, permission_mode: 'read_only' });
    expect(svc.isSophosConfigured()).toBe(true);
  });

  it('env credentials win when no file section exists and toggles go to sophos_sync', () => {
    process.env.SOPHOS_CLIENT_ID = CLIENT_ID;
    process.env.SOPHOS_CLIENT_SECRET = SECRET;
    process.env.SOPHOS_PERMISSION_MODE = 'response';
    const svc = new IntegrationsSettingsService();
    expect(svc.isEnvSophosConfigured()).toBe(true);
    expect(svc.getSophosCredentials()).toEqual({ client_id: CLIENT_ID, client_secret: SECRET, permission_mode: 'response' });

    svc.setSophosAutoResolveMode('dry_run');
    svc.saveSophosSyncTimestamps({ last_alert_sync: '2026-01-01T00:00:00.000Z', sync_version: 2 });
    svc.saveSophosDiscovery({ tenant_id: 't-1', data_region: 'eu01', api_host: 'https://api-eu01.central.sophos.com', capabilities: CAPS, last_auth_ok_at: '2026-01-01T00:00:00.000Z' });

    const parsed = JSON.parse(realFs.readFileSync(FILE, 'utf8'));
    expect(parsed.sophos).toBeUndefined();
    expect(parsed.sophos_sync).toMatchObject({ auto_resolve_mode: 'dry_run', last_alert_sync: '2026-01-01T00:00:00.000Z', sync_version: 2, tenant_id: 't-1' });
    expect(svc.getSophosAutoResolveMode()).toBe('dry_run');
    expect(svc.getSophosSettings()).toMatchObject({ client_id: CLIENT_ID, tenant_id: 't-1', auto_resolve_mode: 'dry_run' });
  });

  it('deleteSophosSettings refuses when credentials come from env', () => {
    process.env.SOPHOS_CLIENT_ID = CLIENT_ID;
    process.env.SOPHOS_CLIENT_SECRET = SECRET;
    const svc = new IntegrationsSettingsService();
    expect(() => svc.deleteSophosSettings()).toThrow(/environment variables/);
  });

  it('deleteSophosSettings removes the section and sophos_sync', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    svc.deleteSophosSettings();
    expect(svc.isSophosConfigured()).toBe(false);
    expect(JSON.parse(realFs.readFileSync(FILE, 'utf8')).sophos).toBeUndefined();
  });

  it('downgrading to read_only turns enabled auto-resolve into disabled; dry_run survives', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET, permission_mode: 'response' });
    svc.setSophosAutoResolveMode('enabled');
    expect(svc.getSophosAutoResolveMode()).toBe('enabled');
    svc.saveSophosSettings({ permission_mode: 'read_only' });
    expect(svc.getSophosAutoResolveMode()).toBe('disabled');

    svc.saveSophosSettings({ permission_mode: 'response' });
    svc.setSophosAutoResolveMode('dry_run');
    svc.saveSophosSettings({ permission_mode: 'read_only' });
    expect(svc.getSophosAutoResolveMode()).toBe('dry_run');
  });

  it("setSophosAutoResolveMode('enabled') throws outside response mode", () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    expect(() => svc.setSophosAutoResolveMode('enabled')).toThrow(/Response mode/);
    expect(() => svc.setSophosAutoResolveMode('bogus' as never)).toThrow(/Invalid/);
    svc.setSophosAutoResolveMode('dry_run');
    expect(svc.getSophosAutoResolveMode()).toBe('dry_run');
  });

  it('changing client_id clears checkpoints, discovery and sync_version', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    svc.saveSophosSyncTimestamps({
      siem_cursor: 'cur', last_siem_sync: '2026-01-01T00:00:00.000Z', last_alert_sync: '2026-01-01T00:00:00.000Z',
      last_detection_sync: '2026-01-01T00:00:00.000Z', last_posture_sync: '2026-01-01T00:00:00.000Z', sync_version: 3,
      sync_gap: { from: 'a', to: 'b' },
    });
    svc.saveSophosDiscovery({ tenant_id: 't-1', data_region: 'eu01', api_host: 'https://api-eu01.central.sophos.com', capabilities: CAPS, last_auth_ok_at: '2026-01-01T00:00:00.000Z' });

    // Same client_id: nothing cleared.
    svc.saveSophosSettings({ client_id: CLIENT_ID, label: 'x' });
    expect(svc.getSophosSyncTimestamps().sync_version).toBe(3);
    expect(svc.getSophosSettings()?.tenant_id).toBe('t-1');

    svc.saveSophosSettings({ client_id: '99999999-2222-3333-4444-555555555555', client_secret: 'another-secret-0123456789' });
    expect(svc.getSophosSyncTimestamps()).toEqual({
      siem_cursor: undefined, last_siem_sync: undefined, last_alert_sync: undefined, last_detection_sync: undefined,
      last_posture_sync: undefined, sync_version: undefined, sync_gap: undefined,
    });
    const s = svc.getSophosSettings();
    expect(s?.tenant_id).toBeUndefined();
    expect(s?.data_region).toBeUndefined();
    expect(s?.api_host).toBeUndefined();
    expect(s?.capabilities).toBeUndefined();
    expect(s?.last_auth_ok_at).toBeUndefined();
    expect(svc.getSophosCredentials()).toMatchObject({ client_id: '99999999-2222-3333-4444-555555555555', client_secret: 'another-secret-0123456789' });
  });

  it('saveSophosSyncTimestamps persists sync_version in the sophos section', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    svc.saveSophosSyncTimestamps({ sync_version: 4, siem_cursor: 'abc', sync_gap: null });
    const parsed = JSON.parse(realFs.readFileSync(FILE, 'utf8'));
    expect(parsed.sophos.sync_version).toBe(4);
    expect(parsed.sophos.siem_cursor).toBe('abc');
    expect(parsed.sophos_sync).toBeUndefined();
    expect(svc.getSophosSyncTimestamps()).toMatchObject({ sync_version: 4, siem_cursor: 'abc', sync_gap: null });

    svc.resetSophosSyncTimestamps();
    expect(svc.getSophosSyncTimestamps().sync_version).toBeUndefined();
    expect(svc.getSophosSyncTimestamps().siem_cursor).toBeUndefined();
    expect(svc.getSophosCredentials()?.client_secret).toBe(SECRET);
  });

  it('masked settings never include client_secret', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    const masked = svc.getSophosSettingsMasked();
    expect(masked).toMatchObject({ configured: true, env_configured: false, client_id: CLIENT_ID, client_secret_set: true, permission_mode: 'read_only', poll_interval_minutes: 5, detection_backfill_days: 30, auto_resolve_mode: 'disabled' });
    expect(JSON.stringify(masked)).not.toContain(SECRET);
    expect(masked).not.toHaveProperty('client_secret');
    expect(new IntegrationsSettingsService('org_x').getSophosSettingsMasked()).toMatchObject({ configured: true });
  });

  it('refuses to overwrite an integrations.json it cannot parse', () => {
    realFs.mkdirSync(realPath.dirname(FILE), { recursive: true });
    realFs.writeFileSync(FILE, '{ "defender": { "configured": true, ');
    const svc = new IntegrationsSettingsService();
    expect(() => svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET })).toThrow(/not valid JSON/);
    expect(() => svc.saveSophosSyncTimestamps({ sync_version: 1 })).toThrow(/not valid JSON/);
    expect(realFs.readFileSync(FILE, 'utf8')).toBe('{ "defender": { "configured": true, ');
  });

  it('an undecryptable secret reads as not configured instead of throwing', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET });
    process.env.ENCRYPTION_SECRET = 'a-different-secret-that-is-also-at-least-32-chars';
    expect(svc.isSophosConfigured()).toBe(false);
    expect(svc.getSophosCredentials()).toBeNull();
  });

  it('an org never writes to, or copies, the legacy section', () => {
    const legacy = new IntegrationsSettingsService();
    legacy.saveSophosSettings({ client_id: CLIENT_ID, client_secret: SECRET, permission_mode: 'response' });
    const org = new IntegrationsSettingsService('org_a');
    expect(org.isSophosConfigured()).toBe(true);
    expect(() => org.setSophosAutoResolveMode('dry_run')).toThrow(/whole deployment/);
    expect(() => org.saveSophosSettings({ label: 'mine' })).toThrow(/whole deployment/);
    expect(() => org.deleteSophosSettings()).toThrow(/whole deployment/);
    expect(legacy.isSophosConfigured()).toBe(true);
    expect(JSON.parse(realFs.readFileSync(FILE, 'utf8')).orgs).toBeUndefined();
  });

  it('lists a Sophos section saved under an org as dormant (EDR integrations are deployment-wide)', () => {
    realFs.mkdirSync(realPath.dirname(FILE), { recursive: true });
    realFs.writeFileSync(FILE, JSON.stringify({
      orgs: { org_a: { sophos: { configured: true }, alerts: { thresholds: { enabled: true } } } },
    }));
    expect(new IntegrationsSettingsService().listDormantOrgEdrSections()).toEqual([
      { orgId: 'org_a', integrations: ['sophos'] },
    ]);
  });

  it('requires both credentials for initial setup', () => {
    const svc = new IntegrationsSettingsService();
    expect(() => svc.saveSophosSettings({ client_id: CLIENT_ID })).toThrow(/required/);
  });
});
