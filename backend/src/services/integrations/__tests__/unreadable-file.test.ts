import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'integrations-unreadable-'));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { IntegrationsSettingsService } = await import('../settings.js');
const FILE = realPath.join(tmpHome, '.projectachilles', 'integrations.json');
const BROKEN = '{ "defender": { "configured": true, "client_secret": "enc:';

describe('IntegrationsSettingsService — unreadable integrations.json', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
    realFs.mkdirSync(realPath.dirname(FILE), { recursive: true });
    realFs.writeFileSync(FILE, BROKEN);
  });
  afterAll(() => realFs.rmSync(tmpHome, { recursive: true, force: true }));

  it('every writer refuses to replace the file with its own section', () => {
    const svc = new IntegrationsSettingsService();
    const writes: Array<[string, () => unknown]> = [
      ['azure', () => svc.saveAzureSettings({ tenant_id: 't', client_id: 'c', client_secret: 's' })],
      ['defender', () => svc.saveDefenderSettings({ tenant_id: 't', client_id: 'c', client_secret: 's' })],
      ['defender sync', () => svc.saveDefenderSyncTimestamps({ last_alert_sync: '2026-01-01T00:00:00.000Z' })],
      ['crowdstrike', () => svc.saveCrowdStrikeSettings({ client_id: 'c', client_secret: 's' })],
      ['crowdstrike sync', () => svc.saveCrowdStrikeSyncTimestamps({ last_alert_sync: '2026-01-01T00:00:00.000Z' })],
      ['alerts', () => svc.saveAlertSettings({ thresholds: { enabled: true } } as never)],
      ['notices', () => svc.savePreExecutionNoticeSettings({ enabled: true })],
    ];
    for (const [name, write] of writes) {
      expect(write, name).toThrow(/not valid JSON/);
    }
    expect(realFs.readFileSync(FILE, 'utf8')).toBe(BROKEN);
  });

  it('a missing file is still created on first save', () => {
    realFs.rmSync(FILE);
    new IntegrationsSettingsService().saveCrowdStrikeSettings({ client_id: 'c', client_secret: 's' });
    expect(JSON.parse(realFs.readFileSync(FILE, 'utf8')).crowdstrike.configured).toBe(true);
  });
});
