import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

// Real settings service against a temp HOME; only Clerk, DNS (SSRF check),
// Elasticsearch and the SentinelOne HTTP API (fetch) are mocked.
const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 's1-routes-'));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => tmpHome };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = { userId: 'user_test' }; next(); },
  getUserId: (auth: any) => auth?.userId,
  getUserOrgId: () => undefined,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/urlValidation.js', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(undefined),
  validateHostForSSRF: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => ({ configured: false }); },
}));
vi.mock('../../services/analytics/client.js', () => ({ createEsClient: () => ({}) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: routes, sentinelOneSyncService } = await import('../sentinelone.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

const TOKEN = 'route-test-token-0123456789abcdefgh';
const BASE = 'https://acme.sentinelone.net';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/integrations/sentinelone', routes);
  a.use(errorHandler);
  return a;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('SentinelOne routes', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
    mockFetch.mockReset();
    vi.spyOn(sentinelOneSyncService, 'syncAll').mockResolvedValue({ timestamp: 'now' });
  });

  it('GET returns not configured initially', async () => {
    const res = await request(app()).get('/api/integrations/sentinelone');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, env_configured: false });
  });

  it('POST requires base_url + api_token on first setup and rejects foreign hosts', async () => {
    expect((await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE })).status).toBe(400);
    const bad = await request(app()).post('/api/integrations/sentinelone').send({ base_url: 'https://evil.example.com', api_token: TOKEN });
    expect(bad.status).toBe(400);
  });

  it('saves settings, never returns the token, and kicks off a sync', async () => {
    const res = await request(app()).post('/api/integrations/sentinelone')
      .send({ base_url: BASE, api_token: TOKEN, scope: { account_ids: ['1111111111111111111'] }, poll_interval_minutes: 10, backfill_days: 365 });
    expect(res.status).toBe(200);
    expect(sentinelOneSyncService.syncAll).toHaveBeenCalled();

    const get = await request(app()).get('/api/integrations/sentinelone');
    expect(get.body).toMatchObject({ configured: true, base_url: BASE, permission_mode: 'read_only', poll_interval_minutes: 10, api_token_set: true });
    expect(JSON.stringify(get.body)).not.toContain(TOKEN);
  });

  it('POST /sync answers 202 at once and runs the sync in the background', async () => {
    await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE, api_token: TOKEN });
    vi.mocked(sentinelOneSyncService.syncAll).mockClear();
    let finish: (v: { timestamp: string }) => void = () => {};
    vi.mocked(sentinelOneSyncService.syncAll).mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const res = await request(app()).post('/api/integrations/sentinelone/sync').send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ success: true, data: { started: true, inProgress: true } });
    expect(sentinelOneSyncService.syncAll).toHaveBeenCalledTimes(1);
    finish({ timestamp: 'done' });
  });

  it('POST /sync while a sync runs starts nothing and does not reset the checkpoints', async () => {
    await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE, api_token: TOKEN });
    vi.mocked(sentinelOneSyncService.syncAll).mockClear();
    const status = vi.spyOn(sentinelOneSyncService, 'getSyncStatus').mockReturnValueOnce({ inProgress: true } as never);
    const reset = vi.spyOn(sentinelOneSyncService, 'resetCheckpoints');
    const res = await request(app()).post('/api/integrations/sentinelone/sync').send({ reset: true });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ started: false, inProgress: true });
    expect(reset).not.toHaveBeenCalled();
    expect(sentinelOneSyncService.syncAll).not.toHaveBeenCalled();
    status.mockRestore();
  });

  it('validates poll interval / backfill bounds', async () => {
    const res = await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE, api_token: TOKEN, backfill_days: 400 });
    expect(res.status).toBe(400);
  });

  it('test connection uses the ApiToken header against the given console', async () => {
    mockFetch.mockResolvedValueOnce(json({ data: [], pagination: { totalItems: 3 } }));
    const res = await request(app()).post('/api/integrations/sentinelone/test').send({ base_url: BASE, api_token: TOKEN });
    expect(res.body.success).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toContain(`${BASE}/web/api/v2.1/threats`);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`ApiToken ${TOKEN}`);
  });

  it('test connection never sends the saved token to a different console', async () => {
    await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE, api_token: TOKEN });
    const other = await request(app()).post('/api/integrations/sentinelone/test').send({ base_url: 'https://other-tenant.sentinelone.net' });
    expect(other.body.success).toBe(false);
    expect(other.body.error).toMatch(/saved token is only used with the saved console URL/);
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(json({ data: [], pagination: { totalItems: 1 } }));
    const same = await request(app()).post('/api/integrations/sentinelone/test').send({});
    expect(same.body.success).toBe(true);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`ApiToken ${TOKEN}`);
  });

  it('exposes no manual response-action routes, even in response mode', async () => {
    await request(app()).post('/api/integrations/sentinelone').send({ base_url: BASE, api_token: TOKEN, permission_mode: 'response' });
    const kill = await request(app()).post('/api/integrations/sentinelone/actions/threats/kill').send({ threat_ids: ['1234567890123456789'] });
    const isolate = await request(app()).post('/api/integrations/sentinelone/actions/agents/disconnect').send({ agent_ids: ['1'] });
    expect(kill.status).toBe(404);
    expect(isolate.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('auto-resolve / automatic mitigation settings', () => {
    const base = '/api/integrations/sentinelone';
    async function setup(permission_mode: 'read_only' | 'response') {
      await request(app()).post(base).send({ base_url: BASE, api_token: TOKEN, permission_mode });
    }

    it('report safe defaults (auto-resolve disabled, mitigation disabled/kill)', async () => {
      await setup('response');
      const ar = await request(app()).get(`${base}/auto-resolve/status`);
      expect(ar.body.data).toMatchObject({ mode: 'disabled', permission_mode: 'response', counts: { last24h: 0 } });
      const am = await request(app()).get(`${base}/auto-mitigation/status`);
      expect(am.body.data).toMatchObject({ mode: 'disabled', action: 'kill' });
      expect(JSON.stringify([ar.body, am.body])).not.toContain(TOKEN);
    });

    it('enabled auto-resolve and any automatic mitigation are refused in read-only mode', async () => {
      await setup('read_only');
      expect((await request(app()).put(`${base}/auto-resolve/mode`).send({ mode: 'dry_run' })).status).toBe(200);
      expect((await request(app()).put(`${base}/auto-resolve/mode`).send({ mode: 'enabled' })).status).toBe(400);
      expect((await request(app()).put(`${base}/auto-mitigation`).send({ mode: 'dry_run' })).status).toBe(400);
      expect((await request(app()).put(`${base}/auto-mitigation`).send({ mode: 'enabled' })).status).toBe(400);
      expect((await request(app()).get(`${base}/auto-mitigation/status`)).body.data.mode).toBe('disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('validates payloads: unknown modes / actions and empty bodies are 400', async () => {
      await setup('response');
      expect((await request(app()).put(`${base}/auto-resolve/mode`).send({ mode: 'yolo' })).status).toBe(400);
      expect((await request(app()).put(`${base}/auto-mitigation`).send({ action: 'remediate' })).status).toBe(400);
      expect((await request(app()).put(`${base}/auto-mitigation`).send({})).status).toBe(400);
    });

    it('in Response mode the toggles persist and nothing calls the S1 API', async () => {
      await setup('response');
      expect((await request(app()).put(`${base}/auto-resolve/mode`).send({ mode: 'enabled' })).body.data).toEqual({ mode: 'enabled' });
      const am = await request(app()).put(`${base}/auto-mitigation`).send({ mode: 'dry_run', action: 'quarantine' });
      expect(am.body.data).toEqual({ mode: 'dry_run', action: 'quarantine' });
      expect((await request(app()).get(base)).body).toMatchObject({ auto_resolve_mode: 'enabled', auto_mitigation: { mode: 'dry_run', action: 'quarantine' } });
      expect((await request(app()).get(`${base}/auto-resolve/receipts`)).body.data).toMatchObject({ total: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
