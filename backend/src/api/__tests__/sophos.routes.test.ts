import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as realFs from 'fs';
import * as realPath from 'path';
import * as realOs from 'os';

// Real settings service against a temp HOME; only Clerk, Elasticsearch and the
// Sophos HTTP APIs (fetch) are mocked.
const tmpHome = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'sophos-routes-'));
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

// In-memory ES for the receipt routes: null = analytics not configured.
const es = vi.hoisted(() => {
  const state: { docs: Array<Record<string, any>> | null } = { docs: null };
  const cur = Date.now();
  const get = (d: any, path: string) => path.split('.').reduce((o, k) => o?.[k], d);
  const matches = (d: any, q: any): boolean => {
    if (q.term) { const [f, v] = Object.entries(q.term)[0]; return get(d, f) === v; }
    if (q.exists) return get(d, q.exists.field) != null;
    if (q.range) {
      const [f, r] = Object.entries(q.range)[0] as [string, { gte: string }];
      const v = get(d, f); const hours = { 'now-24h': 24, 'now-7d': 168, 'now-30d': 720 }[r.gte]!;
      return v != null && new Date(v).getTime() >= cur - hours * 3600_000;
    }
    if (q.bool) {
      const b = q.bool;
      return (b.filter ?? []).every((x: any) => matches(d, x))
        && (b.must_not ?? []).every((x: any) => !matches(d, x))
        && (!b.should || b.should.some((x: any) => matches(d, x)));
    }
    return false;
  };
  const time = (d: any) => Math.max(new Date(d.f0rtika?.auto_resolved_at ?? 0).getTime(), new Date(d.f0rtika?.auto_resolve_dry_run_at ?? 0).getTime());
  const client = {
    count: async ({ query }: any) => ({ count: state.docs!.filter((d) => matches(d, query)).length }),
    search: async ({ query, size }: any) => {
      const hits = state.docs!.filter((d) => matches(d, query)).sort((a, b) => time(b) - time(a)).slice(0, size).map((_source) => ({ _source }));
      return { hits: { total: { value: hits.length }, hits } };
    },
  };
  return { state, client };
});
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => (es.state.docs ? { configured: true } : { configured: false }); },
}));
vi.mock('../../services/analytics/client.js', () => ({ createEsClient: () => es.client }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: routes, sophosSyncService } = await import('../sophos.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');
const { __resetSophosRateLimitersForTests } = await import('../../services/sophos/sophos-client.js');

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const SECRET = 'route-test-secret-0123456789abcdefghijkl';
const TENANT = '9f9f9f9f-0000-4000-8000-123456789abc';
const BASE = '/api/integrations/sophos';

function app() {
  const a = express();
  a.use(express.json());
  a.use(BASE, routes);
  a.use(errorHandler);
  return a;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Plan {
  idType?: string;
  alerts?: () => Response;
  siem?: () => Response;
  health?: () => Response;
  graphql?: () => Response;
  v1?: () => Response;
}

/** URL-routed fake of id.sophos.com + api.central + regional host + taegis. */
function fakeSophos(plan: Plan = {}) {
  mockFetch.mockImplementation(async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (url.hostname === 'id.sophos.com') return json({ access_token: 'tok-abc', expires_in: 3600 });
    if (path === '/whoami/v1') {
      return json({ id: TENANT, idType: plan.idType ?? 'tenant', apiHosts: { global: 'https://api.central.sophos.com', dataRegion: 'https://api-eu01.central.sophos.com' } });
    }
    if (path === '/common/v1/alerts') return (plan.alerts ?? (() => json({ items: [], pages: {} })))();
    if (path === '/siem/v1/events') return (plan.siem ?? (() => json({ items: [], next_cursor: '', has_more: false })))();
    if (path === '/account-health-check/v1/health-check') return (plan.health ?? (() => json({})))();
    if (path === '/graphql') return (plan.graphql ?? (() => json({ data: { detectionSearch: { status: 'OK', detections: [] } } })))();
    if (path.startsWith('/detections/v1/queries/detections')) return (plan.v1 ?? (() => json({ id: 'x' })))();
    return json({}, 404);
  });
}

describe('Sophos routes', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    delete process.env.SOPHOS_CLIENT_ID;
    delete process.env.SOPHOS_CLIENT_SECRET;
    realFs.rmSync(realPath.join(tmpHome, '.projectachilles'), { recursive: true, force: true });
    mockFetch.mockReset();
    __resetSophosRateLimitersForTests();
    vi.spyOn(sophosSyncService, 'syncAll').mockResolvedValue({ timestamp: 'now' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REQUIRE_ORG_ISOLATION;
    delete process.env.SOPHOS_CLIENT_ID;
    delete process.env.SOPHOS_CLIENT_SECRET;
  });

  const save = (extra: Record<string, unknown> = {}) =>
    request(app()).post(BASE).send({ client_id: CLIENT_ID, client_secret: SECRET, ...extra });

  it('GET / never returns the secret', async () => {
    expect((await request(app()).get(BASE)).body).toEqual({ configured: false, env_configured: false });
    await save();
    const res = await request(app()).get(BASE);
    expect(res.body).toMatchObject({ configured: true, client_id: CLIENT_ID, client_secret_set: true, permission_mode: 'read_only' });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('POST / requires client_id and client_secret on first save and triggers a sync', async () => {
    expect((await request(app()).post(BASE).send({ client_id: CLIENT_ID })).status).toBe(400);
    expect((await request(app()).post(BASE).send({ label: 'x' })).status).toBe(400);
    expect(sophosSyncService.syncAll).not.toHaveBeenCalled();
    const ok = await save({ poll_interval_minutes: 10 });
    expect(ok.status).toBe(200);
    expect(sophosSyncService.syncAll).toHaveBeenCalledTimes(1);
    // A partial edit afterwards needs no credentials.
    expect((await request(app()).post(BASE).send({ label: 'Prod' })).status).toBe(200);
  });

  it('POST / never pairs the stored secret with a different client_id', async () => {
    await save();
    vi.mocked(sophosSyncService.syncAll).mockClear();
    const file = realPath.join(tmpHome, '.projectachilles', 'integrations.json');
    const before = realFs.readFileSync(file, 'utf8');
    const other = '99999999-2222-3333-4444-555555555555';

    const res = await request(app()).post(BASE).send({ client_id: other });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/client secret for the new client ID/i);
    expect(sophosSyncService.syncAll).not.toHaveBeenCalled();
    expect(realFs.readFileSync(file, 'utf8')).toBe(before);

    // New id + new secret, and the same id without a secret (label edit), are fine.
    expect((await request(app()).post(BASE).send({ client_id: other, client_secret: 'another-secret-0123456789' })).status).toBe(200);
    expect((await request(app()).post(BASE).send({ client_id: other, label: 'Prod' })).status).toBe(200);
  });

  it('POST / refuses to save a file section while SOPHOS_* env credentials are configured', async () => {
    process.env.SOPHOS_CLIENT_ID = CLIENT_ID;
    process.env.SOPHOS_CLIENT_SECRET = SECRET;
    const res = await save();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/environment variables/i);
    expect(sophosSyncService.syncAll).not.toHaveBeenCalled();
    // Still masked and env-configured.
    expect((await request(app()).get(BASE)).body).toMatchObject({ configured: true, env_configured: true });
  });

  it('DELETE / removes the stored settings', async () => {
    await save();
    expect((await request(app()).delete(BASE)).status).toBe(200);
    expect((await request(app()).get(BASE)).body.configured).toBe(false);
  });

  it('every write route is 403 under REQUIRE_ORG_ISOLATION', async () => {
    await save();
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    expect((await request(app()).post(BASE).send({ label: 'x' })).status).toBe(403);
    expect((await request(app()).delete(BASE)).status).toBe(403);
    expect((await request(app()).put(`${BASE}/auto-resolve/mode`).send({ mode: 'dry_run' })).status).toBe(403);
    expect((await request(app()).post(`${BASE}/sync`).send({ reset: true })).status).toBe(403);
    expect((await request(app()).post(`${BASE}/test`).send({})).status).toBe(403);
    expect((await request(app()).get(BASE)).status).toBe(200);
    delete process.env.REQUIRE_ORG_ISOLATION;
    expect((await request(app()).put(`${BASE}/auto-resolve/mode`).send({ mode: 'dry_run' })).status).toBe(200);
  });

  describe('POST /test', () => {
    it('rejects a partner credential with HTTP 200 success:false', async () => {
      fakeSophos({ idType: 'partner' });
      const res = await request(app()).post(`${BASE}/test`).send({ client_id: CLIENT_ID, client_secret: SECRET });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/tenant API credential/i);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it('never sends the stored secret with a new client_id', async () => {
      await save();
      const res = await request(app()).post(`${BASE}/test`).send({ client_id: '99999999-2222-3333-4444-555555555555' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/saved secret is only used with the saved client ID/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('with no credentials at all answers success:false', async () => {
      const res = await request(app()).post(`${BASE}/test`).send({});
      expect(res.body).toMatchObject({ success: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses the stored secret with the stored client id, read-only, and maps capabilities', async () => {
      await save({ permission_mode: 'response' });
      fakeSophos({
        siem: () => json({ message: 'forbidden' }, 403),
        // A plain 404 is NOT a licence signal.
        health: () => json({ error: 'nope' }, 404),
        graphql: () => json({ errors: [{ message: 'XDR is not licensed for this tenant' }] }),
        v1: () => json({ id: '77777777-0000-4000-8000-123456789abc', status: 'finished', result: 'succeeded' }),
      });
      const res = await request(app()).post(`${BASE}/test`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, region: 'eu01', tenantId: TENANT });
      expect(res.body.capabilities).toEqual({
        alerts: 'available',
        siem: 'forbidden',
        health_check: 'unknown',
        xdr_graphql: 'not_licensed',
        xdr_rest: expect.any(String),
      });
      // Read-only client: no non-GET except the token POST and read-only POSTs (graphql / detection query).
      const posts = mockFetch.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => new URL(String(c[0])).pathname);
      expect(posts.every((p) => ['/api/v2/oauth2/token', '/graphql', '/detections/v1/queries/detections'].includes(p))).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });
  });

  describe('POST /sync', () => {
    it('answers 202 at once and runs the sync in the background', async () => {
      await save();
      vi.mocked(sophosSyncService.syncAll).mockClear();
      const res = await request(app()).post(`${BASE}/sync`).send({});
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ success: true, data: { started: true, inProgress: true } });
      expect(sophosSyncService.syncAll).toHaveBeenCalledTimes(1);
    });

    it('400s when not configured', async () => {
      expect((await request(app()).post(`${BASE}/sync`).send({})).status).toBe(400);
    });

    it('with reset:true while a sync runs starts nothing and does not reset', async () => {
      await save();
      vi.mocked(sophosSyncService.syncAll).mockClear();
      vi.spyOn(sophosSyncService, 'getSyncStatus').mockReturnValue({ inProgress: true } as never);
      const reset = vi.spyOn(sophosSyncService, 'resetCheckpoints');
      const res = await request(app()).post(`${BASE}/sync`).send({ reset: true });
      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({ started: false, inProgress: true });
      expect(reset).not.toHaveBeenCalled();
      expect(sophosSyncService.syncAll).not.toHaveBeenCalled();
    });

    it('reset:true clears the checkpoints then syncs', async () => {
      await save();
      const reset = vi.spyOn(sophosSyncService, 'resetCheckpoints').mockImplementation(() => undefined);
      const res = await request(app()).post(`${BASE}/sync`).send({ reset: true });
      expect(res.status).toBe(202);
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /sync/status', () => {
    it('merges the persisted checkpoints and gap when the in-memory status has none (after a restart)', async () => {
      await save();
      const { IntegrationsSettingsService } = await import('../../services/integrations/settings.js');
      new IntegrationsSettingsService().saveSophosSyncTimestamps({
        last_alert_sync: '2026-10-28T10:00:00.000Z',
        last_siem_sync: '2026-10-28T10:01:00.000Z',
        last_detection_sync: '2026-10-28T10:02:00.000Z',
        sync_gap: { from: '2026-10-26T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z' },
      });
      const res = await request(app()).get(`${BASE}/sync/status`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        lastAlertSync: '2026-10-28T10:00:00.000Z',
        lastSiemSync: '2026-10-28T10:01:00.000Z',
        lastDetectionSync: '2026-10-28T10:02:00.000Z',
        syncGap: { from: '2026-10-26T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z' },
        inProgress: false,
      });
    });

    it('prefers the in-memory values when present', async () => {
      await save();
      vi.spyOn(sophosSyncService, 'getSyncStatus').mockReturnValue({
        lastSiemSync: 'mem', lastAlertSync: 'mem', lastDetectionSync: 'mem', syncGap: null,
        lastSyncResult: null, lastAttemptAt: null, lastError: null, inProgress: false,
      });
      const res = await request(app()).get(`${BASE}/sync/status`);
      expect(res.body.lastAlertSync).toBe('mem');
    });
  });

  describe('auto-resolve', () => {
    it('reports safe defaults and persists dry_run; enabled needs Response mode', async () => {
      await save();
      const st = await request(app()).get(`${BASE}/auto-resolve/status`);
      expect(st.body.data).toMatchObject({ mode: 'disabled', permission_mode: 'read_only', counts: { last24h: 0, last7d: 0, last30d: 0 } });
      expect((await request(app()).put(`${BASE}/auto-resolve/mode`).send({ mode: 'dry_run' })).body.data).toEqual({ mode: 'dry_run' });
      expect((await request(app()).put(`${BASE}/auto-resolve/mode`).send({ mode: 'enabled' })).status).toBe(400);
      expect((await request(app()).put(`${BASE}/auto-resolve/mode`).send({ mode: 'yolo' })).status).toBe(400);
      expect((await request(app()).get(`${BASE}/auto-resolve/receipts`)).body.data).toMatchObject({ total: 0, items: [] });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe('receipts and counts', () => {
      const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
      const real = { alert_id: 'real', alert_title: 'R', f0rtika: { auto_resolved: true, auto_resolved_at: hoursAgo(2), auto_resolve_mode: 'enabled' }, doc_type: 'alert' };
      const dry = { alert_id: 'dry', alert_title: 'D', f0rtika: { auto_resolve_dry_run_at: hoursAgo(1), auto_resolve_mode: 'dry_run' }, doc_type: 'alert' };
      const older = { alert_id: 'older-dry', alert_title: 'O', f0rtika: { auto_resolve_dry_run_at: hoursAgo(5), auto_resolve_mode: 'dry_run' }, doc_type: 'alert' };
      const other = { alert_id: 'plain', alert_title: 'P', f0rtika: {}, doc_type: 'alert' };
      afterEach(() => { es.state.docs = null; });

      it('a dry-run receipt is listed and counted as dry run, never as resolved', async () => {
        es.state.docs = [dry, other];
        await save();
        const list = (await request(app()).get(`${BASE}/auto-resolve/receipts`)).body.data;
        expect(list.items.map((i: any) => i.alert_id)).toEqual(['dry']);
        expect(list.items[0]).toMatchObject({ auto_resolve_dry_run_at: dry.f0rtika.auto_resolve_dry_run_at, auto_resolve_mode: 'dry_run' });
        const st = (await request(app()).get(`${BASE}/auto-resolve/status`)).body.data;
        expect(st.counts).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
        expect(st.dry_run_counts).toEqual({ last24h: 1, last7d: 1, last30d: 1 });
      });

      it('a real receipt is counted as resolved, never as dry run', async () => {
        es.state.docs = [real, other];
        await save();
        expect((await request(app()).get(`${BASE}/auto-resolve/receipts`)).body.data.items.map((i: any) => i.alert_id)).toEqual(['real']);
        const st = (await request(app()).get(`${BASE}/auto-resolve/status`)).body.data;
        expect(st.counts).toEqual({ last24h: 1, last7d: 1, last30d: 1 });
        expect(st.dry_run_counts).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
      });

      it('a dry-run-then-enabled doc (leftover dry_run_at) counts only as resolved and sorts by its resolved time', async () => {
        const both = { alert_id: 'both', alert_title: 'B', doc_type: 'alert', f0rtika: { auto_resolved: true, auto_resolved_at: hoursAgo(3), auto_resolve_dry_run_at: hoursAgo(10), auto_resolve_mode: 'enabled' } };
        es.state.docs = [both];
        await save();
        const st = (await request(app()).get(`${BASE}/auto-resolve/status`)).body.data;
        expect(st.counts).toEqual({ last24h: 1, last7d: 1, last30d: 1 });
        expect(st.dry_run_counts).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
        expect((await request(app()).get(`${BASE}/auto-resolve/receipts`)).body.data.items).toHaveLength(1);
      });

      it('the sort script guards fields an older index never mapped', async () => {
        const { RECEIPT_TIME_SORT } = await import('../sophos.routes.js');
        const src = RECEIPT_TIME_SORT._script.script.source;
        expect(src).toContain("doc.containsKey(r)");
        expect(src).toContain("doc.containsKey(d)");
      });

      it('an ES failure on the receipts query surfaces as an error, a missing index as an empty list', async () => {
        es.state.docs = [dry];
        await save();
        const spy = vi.spyOn(es.client, 'search');
        spy.mockRejectedValueOnce(new Error('script_exception: boom'));
        const bad = await request(app()).get(`${BASE}/auto-resolve/receipts`);
        expect(bad.status).toBe(502);
        expect(JSON.stringify(bad.body)).toContain('script_exception');
        spy.mockRejectedValueOnce(Object.assign(new Error('index_not_found_exception'), { statusCode: 404 }));
        const none = await request(app()).get(`${BASE}/auto-resolve/receipts`);
        expect(none.status).toBe(200);
        expect(none.body.data.items).toEqual([]);
        spy.mockRestore();
      });

      it('a mixed list is requested newest-first by the receipt own time', async () => {
        es.state.docs = [older, real, dry];
        await save();
        const spy = vi.spyOn(es.client, 'search');
        const list = (await request(app()).get(`${BASE}/auto-resolve/receipts`)).body.data;
        expect(list.items.map((i: any) => i.alert_id)).toEqual(['dry', 'real', 'older-dry']);
        const arg = spy.mock.calls[0][0] as any;
        expect(arg.sort[0]._script.script.source).toContain('auto_resolve_dry_run_at');
        expect(arg.sort[0]._script.order).toBe('desc');
        expect(arg.query.bool.minimum_should_match).toBe(1);
        spy.mockRestore();
      });
    });
  });
});

describe('capabilities', () => {
  it('server.ts advertises sophos: true and mounts the integration routes before /api/integrations', async () => {
    const src = realFs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/sophos:\s*true/);
    const sophosMount = src.indexOf("app.use('/api/integrations/sophos'");
    const genericMount = src.indexOf("app.use('/api/integrations', integrationsRoutes)");
    expect(sophosMount).toBeGreaterThan(-1);
    expect(genericMount).toBeGreaterThan(sophosMount);
    expect(src).toMatch(/app\.use\('\/api\/analytics\/sophos', sophosAnalyticsRoutes\)/);
  });

  it('backend-serverless advertises sophos: false', () => {
    const src = realFs.readFileSync(new URL('../../../../backend-serverless/src/app.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/sophos:\s*false/);
  });
});
