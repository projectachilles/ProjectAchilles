import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'alerts-thresholds-'));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { IntegrationsSettingsService } = await import('../settings.js');
const { AlertSettingsSchema } = await import('../../../schemas/integrations.schemas.js');

describe('alert thresholds can be cleared', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
  });
  afterAll(() => realFs.rmSync(tmpHome, { recursive: true, force: true }));

  it('the schema keeps metric thresholds and accepts null to clear them', () => {
    const parsed = AlertSettingsSchema.parse({ thresholds: { enabled: true, defense_score_min: 70, s1_outdated_agents_max: null } });
    expect(parsed.thresholds).toEqual({ enabled: true, defense_score_min: 70, s1_outdated_agents_max: null });
  });

  it('null removes a saved threshold; an omitted key keeps it', () => {
    const svc = new IntegrationsSettingsService();
    svc.saveAlertSettings({ thresholds: { enabled: true, defense_score_min: 70, error_rate_max: 20 } });
    svc.saveAlertSettings({ thresholds: { enabled: true, defense_score_min: null } as never });
    const t = svc.getAlertSettings()?.thresholds;
    expect(t).not.toHaveProperty('defense_score_min');
    expect(t?.error_rate_max).toBe(20);
  });
});
