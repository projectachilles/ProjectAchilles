import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Organization scoping of the Elasticsearch-backed routes (#710); mirrors
 * backend/src/api/__tests__/analyticsOrgScope.routes.test.ts (serverless has no archive routes).
 *
 * Results carry the org of the task that produced them (routing.oid =
 * tasks.org_id), and a caller in an organization can only create tasks under
 * its own Clerk org (#708). So scopeResultsToCallerOrg fills a missing ?org=
 * with the caller's org and refuses any other value. Callers without an
 * organization are unchanged unless REQUIRE_ORG_ISOLATION=true.
 *
 * Real clerk.middleware (requirePermission, getUserOrgId); only @clerk/express
 * and the Elasticsearch layer are mocked.
 */

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (req: any, res: any, next: any) => {
    if (req.auth?.userId) {
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
}));

vi.mock('../../middleware/urlValidation.js', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = async () => ({ configured: true, connectionType: 'cloud', indexPattern: 'achilles-results-*' });
    isConfigured = async () => true;
  },
}));

const calls: Array<{ method: string; args: unknown[] }> = [];
const record = (method: string, value: unknown) => (...args: unknown[]) => {
  calls.push({ method, args });
  return Promise.resolve(value);
};

vi.mock('../../services/analytics/elasticsearch.js', () => ({
  ElasticsearchService: class {
    getDefenseScore = record('getDefenseScore', { score: 1 });
    getDefenseScoreByOrg = record('getDefenseScoreByOrg', []);
    getOrganizations = record('getOrganizations', []);
    getAvailableTests = record('getAvailableTests', []);
    getExecutedTestUuids = record('getExecutedTestUuids', []);
    getAvailableTechniques = record('getAvailableTechniques', []);
  },
}));

vi.mock('../../services/analytics/index-management.service.js', () => ({
  createResultsIndex: vi.fn().mockResolvedValue({ created: true }),
  listResultsIndices: vi.fn().mockResolvedValue([]),
}));

const { default: analyticsRoutes } = await import('../analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

const ORG_A = 'org_a';
const ORG_B = 'org_b';

function appAs(orgId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = {
      userId: 'user-1',
      ...(orgId ? { orgId } : {}),
      sessionClaims: { metadata: { role: 'admin' } },
    };
    next();
  });
  app.use('/api/analytics', analyticsRoutes);
  app.use(errorHandler);
  return app;
}

/** The org argument the named service method last received. */
function orgPassedTo(method: string): unknown {
  const call = [...calls].reverse().find((c) => c.method === method);
  if (!call) throw new Error(`${method} was not called`);
  const [first] = call.args;
  if (method === 'getDefenseScore' || method === 'getDefenseScoreByOrg') return (first as { org?: string }).org;
  return first;
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  delete process.env.REQUIRE_ORG_ISOLATION;
});

describe('a caller in an organization', () => {
  it('queries its own org when ?org= is omitted', async () => {
    const res = await request(appAs(ORG_A)).get('/api/analytics/defense-score');
    expect(res.status).toBe(200);
    expect(orgPassedTo('getDefenseScore')).toBe(ORG_A);
  });

  it('may name its own org', async () => {
    const res = await request(appAs(ORG_A)).get(`/api/analytics/defense-score?org=${ORG_A}`);
    expect(res.status).toBe(200);
    expect(orgPassedTo('getDefenseScore')).toBe(ORG_A);
  });

  it("is refused another org's results, and nothing is queried", async () => {
    const res = await request(appAs(ORG_A)).get(`/api/analytics/defense-score?org=${ORG_B}`);
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('gets only its own bucket from /defense-score/by-org', async () => {
    const res = await request(appAs(ORG_A)).get('/api/analytics/defense-score/by-org');
    expect(res.status).toBe(200);
    expect(orgPassedTo('getDefenseScoreByOrg')).toBe(ORG_A);
  });

  it('is refused a repeated ?org=', async () => {
    const res = await request(appAs(ORG_A)).get(`/api/analytics/defense-score?org=${ORG_A}&org=${ORG_B}`);
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it.each([
    ['/organizations', 'getOrganizations'],
    ['/available-tests', 'getAvailableTests'],
    ['/executed-test-uuids', 'getExecutedTestUuids'],
    ['/available-techniques', 'getAvailableTechniques'],
  ])('GET %s, which takes no filters, is limited to its org', async (path, method) => {
    const res = await request(appAs(ORG_A)).get(`/api/analytics${path}`);
    expect(res.status).toBe(200);
    expect(orgPassedTo(method)).toBe(ORG_A);
  });

  it('can still read the install settings (not results)', async () => {
    const res = await request(appAs(ORG_A)).get(`/api/analytics/settings?org=${ORG_B}`);
    expect(res.status).toBe(200);
  });
});

describe('a caller without an organization', () => {
  it('queries every org by default and the org it names', async () => {
    const app = appAs();
    await request(app).get('/api/analytics/defense-score');
    expect(orgPassedTo('getDefenseScore')).toBeUndefined();
    await request(app).get(`/api/analytics/defense-score?org=${ORG_B}`);
    expect(orgPassedTo('getDefenseScore')).toBe(ORG_B);
  });

  it('is refused results, but not the install settings, when REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    const app = appAs();
    expect((await request(app).get('/api/analytics/defense-score')).status).toBe(403);
    expect((await request(app).get('/api/analytics/organizations')).status).toBe(403);
    expect((await request(app).get('/api/analytics/settings')).status).toBe(200);
    expect(calls).toEqual([]);
  });
});
