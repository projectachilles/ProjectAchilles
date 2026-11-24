import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../services/agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../services/outcomes/edr.js', () => ({ fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }) }));
vi.mock('../../services/notices/userLabel.js', () => ({ resolveUserLabel: async (id: string) => id }));
vi.mock('../../services/agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => ({ uuid, name: `Test ${uuid}`, techniques: [] }),
}));

const { launchSpy } = vi.hoisted(() => ({ launchSpy: vi.fn() }));
vi.mock('../../services/campaigns/runs.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/campaigns/runs.service.js')>();
  return { ...actual, launchRun: (...a: Parameters<typeof actual.launchRun>) => (launchSpy.getMockImplementation() ? launchSpy(...a) : actual.launchRun(...a)) };
});

let auth: { userId: string; orgId?: string; sessionClaims?: Record<string, unknown> } = { userId: 'u1', orgId: 'org-1' };
const denied = new Set<string>();
vi.mock('../../middleware/clerk.middleware.js', async () => {
  const { AppError } = await import('../../middleware/error.middleware.js');
  const actual = await vi.importActual<typeof import('../../middleware/clerk.middleware.js')>('../../middleware/clerk.middleware.js');
  return {
    getUserDisplayName: actual.getUserDisplayName,
    requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = auth; next(); },
    requirePermission: (p: string) => (_req: any, res: any, next: any) =>
      denied.has(p) ? res.status(403).json({ success: false, error: 'Insufficient permissions' }) : next(),
    getUserId: (a: any) => a?.userId,
    getUserOrgId: (a: any) => a?.orgId,
    validateRequestOrgId: (id: string, a: any) => {
      if (a?.orgId && id !== a.orgId) throw new AppError('org_id does not match your organization', 403);
    },
  };
});

const { default: campaignsRoutes } = await import('../campaigns.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');
const { PartialRunError } = await import('../../services/campaigns/runs.service.js');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/campaigns', campaignsRoutes);
  a.use(errorHandler);
  return a;
};

const body = (over: Record<string, unknown> = {}) => ({
  org_id: 'org-1', name: 'Q4 plan', test_uuids: ['t1'], agent_ids: ['a1'], ...over,
});

async function create(over: Record<string, unknown> = {}) {
  const res = await request(app()).post('/api/campaigns').send(body(over));
  return res;
}

function insertRun(id: string, campaignId: string, org: string, startedAt = '2026-10-23T19:07:00.000Z') {
  testDb.prepare(
    `INSERT INTO campaign_runs (id, campaign_id, org_id, started_by, started_at, notice_id, snapshot, task_count)
     VALUES (?, ?, ?, 'u1', ?, NULL, ?, 0)`,
  ).run(id, campaignId, org, startedAt, JSON.stringify({
    campaign_name: 'Q4 plan', framework_label: null,
    tests: [{ uuid: 't1', name: 'Test t1' }],
    agents: [{ id: 'a1', hostname: 'h1', os: 'windows' }],
    skipped: [{ test_uuid: 't1', agent_id: 'a1', reason: 'not built' }],
  }));
}

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'a1', org_id: 'org-1' });
  auth = { userId: 'u1', orgId: 'org-1' };
  denied.clear();
  launchSpy.mockReset();
  delete process.env.REQUIRE_ORG_ISOLATION;
});
afterEach(() => { delete process.env.REQUIRE_ORG_ISOLATION; });

describe('campaigns CRUD', () => {
  it('creates, lists, gets, updates and deletes', async () => {
    const c = await create();
    expect(c.status).toBe(201);
    const id = c.body.data.id;
    expect((await request(app()).get('/api/campaigns')).body.data).toHaveLength(1);
    expect((await request(app()).get(`/api/campaigns/${id}`)).body.data.name).toBe('Q4 plan');
    const put = await request(app()).put(`/api/campaigns/${id}`).send(body({ name: 'Renamed' }));
    expect(put.status).toBe(200);
    expect(put.body.data.name).toBe('Renamed');
    expect((await request(app()).delete(`/api/campaigns/${id}`)).status).toBe(200);
    expect((await request(app()).get(`/api/campaigns/${id}`)).status).toBe(404);
  });

  it('rejects malformed input with 400 instead of 500', async () => {
    for (const bad of [{ test_uuids: 'x' }, { agent_ids: [1] }, { name: '   ' }, { name: 'x'.repeat(121) }, { test_uuids: [''] }, { org_id: 5 }]) {
      const res = await create(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('403 when body org_id differs from the caller org', async () => {
    expect((await create({ org_id: 'org-2' })).status).toBe(403);
  });
});

describe('permission matrix', () => {
  it('read-only role gets 403 on write routes but can read', async () => {
    const c = await create();
    const id = c.body.data.id;
    denied.add('endpoints:tasks:create');
    expect((await create({ name: 'other' })).status).toBe(403);
    expect((await request(app()).put(`/api/campaigns/${id}`).send(body())).status).toBe(403);
    expect((await request(app()).delete(`/api/campaigns/${id}`)).status).toBe(403);
    expect((await request(app()).post(`/api/campaigns/${id}/runs`).send({ org_id: 'org-1' })).status).toBe(403);
    expect((await request(app()).get('/api/campaigns')).status).toBe(200);
    expect((await request(app()).get(`/api/campaigns/${id}/preflight`)).status).toBe(200);
  });

  it('no read permission gets 403 on reads', async () => {
    denied.add('endpoints:tasks:read');
    expect((await request(app()).get('/api/campaigns')).status).toBe(403);
    expect((await request(app()).get('/api/campaigns/runs/r1')).status).toBe(403);
  });
});

describe('cross-org isolation', () => {
  it('404s a campaign, its runs, a run and its CSV for another org', async () => {
    const c = await create();
    const id = c.body.data.id;
    insertRun('run-1', id, 'org-1');
    auth = { userId: 'u2', orgId: 'org-2' };
    expect((await request(app()).get(`/api/campaigns/${id}`)).status).toBe(404);
    expect((await request(app()).get(`/api/campaigns/${id}/runs`)).status).toBe(404);
    expect((await request(app()).get(`/api/campaigns/${id}/preflight`)).status).toBe(404);
    expect((await request(app()).get('/api/campaigns/runs/run-1')).status).toBe(404);
    expect((await request(app()).get('/api/campaigns/runs/run-1/export.csv')).status).toBe(404);
    expect((await request(app()).post(`/api/campaigns/${id}/runs`).send({ org_id: 'org-2' })).status).toBe(404);
  });

  it('GET /:id/runs 404s an unknown campaign instead of returning []', async () => {
    expect((await request(app()).get('/api/campaigns/nope/runs')).status).toBe(404);
  });

  it('REQUIRE_ORG_ISOLATION=true gives 403 on every route for a no-org caller', async () => {
    const c = await create();
    const id = c.body.data.id;
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    auth = { userId: 'u1' };
    const calls = [
      request(app()).get('/api/campaigns'),
      request(app()).get(`/api/campaigns/${id}`),
      request(app()).post('/api/campaigns').send(body()),
      request(app()).put(`/api/campaigns/${id}`).send(body()),
      request(app()).delete(`/api/campaigns/${id}`),
      request(app()).get(`/api/campaigns/${id}/preflight`),
      request(app()).post(`/api/campaigns/${id}/runs`).send({ org_id: 'org-1' }),
      request(app()).get(`/api/campaigns/${id}/runs`),
      request(app()).get('/api/campaigns/runs/r1'),
      request(app()).get('/api/campaigns/runs/r1/export.csv'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });
});

describe('hardening (fix round 1)', () => {
  it('PUT and DELETE as another org 404 and leave the row untouched', async () => {
    const c = await create();
    const id = c.body.data.id;
    auth = { userId: 'u2', orgId: 'org-2' };
    expect((await request(app()).put(`/api/campaigns/${id}`).send(body({ org_id: 'org-2', name: 'Hijacked' }))).status).toBe(404);
    expect((await request(app()).delete(`/api/campaigns/${id}`)).status).toBe(404);
    auth = { userId: 'u1', orgId: 'org-1' };
    const got = await request(app()).get(`/api/campaigns/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.name).toBe('Q4 plan');
  });

  it('isolation 403 beats validation 400 for a no-org caller', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    auth = { userId: 'u1' };
    const res = await request(app()).post('/api/campaigns').send({ name: 5 });
    expect(res.status).toBe(403);
  });

  it('caps description and framework_label length', async () => {
    expect((await create({ description: 'x'.repeat(2001) })).status).toBe(400);
    expect((await create({ framework_label: 'x'.repeat(121) })).status).toBe(400);
    expect((await create({ description: 'x'.repeat(2000), framework_label: 'x'.repeat(120) })).status).toBe(201);
  });
});

describe('GET /runs (all runs, incl. deleted campaigns)', () => {
  it('lists a deleted campaign run with its snapshot name; org-2 does not see it', async () => {
    const c = await create();
    const id = c.body.data.id;
    insertRun('run-1', id, 'org-1');
    await request(app()).delete(`/api/campaigns/${id}`);
    const res = await request(app()).get('/api/campaigns/runs');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      total: 1,
      items: [
        expect.objectContaining({
          id: 'run-1', campaign_id: id, campaign_name: 'Q4 plan', campaign_deleted: true,
          started_by: 'u1', started_by_name: 'u1', task_count: 0, percent_protected: null,
        }),
      ],
    });
    auth = { userId: 'u2', orgId: 'org-2' };
    expect((await request(app()).get('/api/campaigns/runs')).body.data).toEqual({ items: [], total: 0 });
  });

  it('marks a live campaign campaign_deleted false', async () => {
    const c = await create();
    insertRun('run-1', c.body.data.id, 'org-1');
    const res = await request(app()).get('/api/campaigns/runs');
    expect(res.body.data.items[0].campaign_deleted).toBe(false);
  });
});

describe('run list pagination', () => {
  async function seed(n: number) {
    const c = await create();
    const id = c.body.data.id;
    for (let i = 0; i < n; i++) insertRun(`run-${String(i).padStart(3, '0')}`, id, 'org-1', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    return id;
  }

  it('defaults to 25, honours limit/offset and reports total on both lists', async () => {
    const id = await seed(30);
    for (const url of ['/api/campaigns/runs', `/api/campaigns/${id}/runs`]) {
      const def = await request(app()).get(url);
      expect(def.body.data.total, url).toBe(30);
      expect(def.body.data.items, url).toHaveLength(25);
      expect(def.body.data.items[0].id, url).toBe('run-029');
      const page = await request(app()).get(`${url}?limit=10&offset=25`);
      expect(page.body.data.total, url).toBe(30);
      expect(page.body.data.items.map((r: { id: string }) => r.id), url).toEqual(['run-004', 'run-003', 'run-002', 'run-001', 'run-000']);
    }
  });

  it('clamps limit to 1..100 and offset to >= 0; junk falls back to defaults', async () => {
    const id = await seed(120);
    for (const url of ['/api/campaigns/runs', `/api/campaigns/${id}/runs`]) {
      const q = async (qs: string) => (await request(app()).get(`${url}?${qs}`)).body.data;
      expect((await q('limit=0')).items, url).toHaveLength(1);
      expect((await q('limit=-5')).items, url).toHaveLength(1);
      expect((await q('limit=500')).items, url).toHaveLength(100);
      expect((await q('limit=abc')).items, url).toHaveLength(25);
      expect((await q('offset=-3')).items[0].id, url).toBe('run-119');
      expect((await q('offset=xyz')).items[0].id, url).toBe('run-119');
      expect((await q('offset=119')).items.map((r: { id: string }) => r.id), url).toEqual(['run-000']);
      expect((await q('limit=10')).total, url).toBe(120);
    }
  });
});

describe('run launch', () => {
  it('maps PartialRunError to 409 { success, error, skipped }', async () => {
    const c = await create();
    const skipped = [{ test_uuid: 't1', agent_id: 'a1', reason: 'not built' }];
    launchSpy.mockImplementation(() => { throw new PartialRunError(skipped); });
    const res = await request(app()).post(`/api/campaigns/${c.body.data.id}/runs`).send({ org_id: 'org-1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('cannot run'), skipped });
  });

  it('passes confirm_partial and orgs through, 201 on success', async () => {
    const c = await create();
    launchSpy.mockImplementation(() => ({ run_id: 'r9', task_count: 1, skipped: 0 }));
    const res = await request(app()).post(`/api/campaigns/${c.body.data.id}/runs`).send({ org_id: 'org-1', confirm_partial: true });
    expect(res.status).toBe(201);
    expect(res.body.data.run_id).toBe('r9');
    expect(launchSpy).toHaveBeenCalledWith(c.body.data.id, { callerOrg: 'org-1', orgId: 'org-1', userId: 'u1', userDisplay: 'u1', confirmPartial: true });
  });

  it('passes the session display name as userDisplay', async () => {
    const c = await create();
    launchSpy.mockImplementation(() => ({ run_id: 'r9', task_count: 1, skipped: 0 }));
    auth = { userId: 'u1', orgId: 'org-1', sessionClaims: { email: 'jane@example.com' } };
    await request(app()).post(`/api/campaigns/${c.body.data.id}/runs`).send({ org_id: 'org-1' });
    expect(launchSpy).toHaveBeenCalledWith(c.body.data.id, expect.objectContaining({ userId: 'u1', userDisplay: 'jane@example.com' }));
  });

  it('rejects a non-boolean confirm_partial with 400', async () => {
    const c = await create();
    expect((await request(app()).post(`/api/campaigns/${c.body.data.id}/runs`).send({ org_id: 'org-1', confirm_partial: 'yes' })).status).toBe(400);
  });
});

describe('run matrix and CSV', () => {
  it('serves the matrix before /:id and CSV with as-of headers', async () => {
    const c = await create();
    insertRun('run-1', c.body.data.id, 'org-1');
    const m = await request(app()).get('/api/campaigns/runs/run-1');
    expect(m.status).toBe(200);
    expect(m.body.data.run.id).toBe('run-1');

    const csv = await request(app()).get('/api/campaigns/runs/run-1/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv; charset=utf-8');
    const asOf = csv.headers['x-report-as-of'];
    expect(new Date(asOf).toISOString()).toBe(asOf);
    const compact = asOf.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace(/^(\d{8}T\d{4})\d{2}Z$/, '$1Z');
    expect(csv.headers['content-disposition']).toBe(`attachment; filename="campaign-run-run-1-${compact}.csv"`);
    expect(csv.text.split('\r\n')[0]).toBe('test,techniques,host,os,outcome,exit_code,reason,completed_at,as_of,stages,edr,version,version_state');
    expect(csv.text.split("\r\n")[1]).toBe(`Test t1,,h1,windows,na,,not built,,${asOf},,,,`);
  });
});

describe('capabilities', () => {
  it('server.ts advertises campaigns: true', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/campaigns:\s*true/);
    expect(src).toMatch(/app\.use\('\/api\/campaigns', campaignsRoutes\)/);
  });
});
