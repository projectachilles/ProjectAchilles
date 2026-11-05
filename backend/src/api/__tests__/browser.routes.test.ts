import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = { userId: 'test-user-001' };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const UUID = '11111111-2222-3333-4444-555555555555';
const fakeTest = {
  uuid: UUID,
  name: 'Fake Test',
  stages: [],
  files: [{ name: 'a.md', path: '/x/a.md', type: 'markdown', size: 1, category: 'documentation' }],
};
const mockOverview = { safety: ['no writes outside C:\\F0'] };

const mockExtractOverview = vi.fn();
vi.mock('../../services/browser/overviewExtractor.js', () => ({
  extractOverview: (...args: unknown[]) => mockExtractOverview(...args),
}));

vi.mock('../../services/browser/testIndexer.js', () => ({
  TestIndexer: class {
    scanAllTests() { return []; }
    refresh() { return [fakeTest]; }
    getAllTests() { return [fakeTest]; }
    getTest(uuid: string) { return uuid === UUID ? fakeTest : undefined; }
    getCategories() { return []; }
  },
}));

vi.mock('../../services/agent/test-catalog.service.js', () => ({ initCatalog: vi.fn() }));

const { createBrowserRouter } = await import('../browser.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/browser', createBrowserRouter({
    testSources: [{ path: '/nonexistent', provenance: 'upstream' }],
    testsSourcePath: '/nonexistent',
  }));
  app.use(errorHandler);
  return app;
}

describe('browser routes: overview', () => {
  beforeEach(() => {
    mockExtractOverview.mockReset();
    mockExtractOverview.mockReturnValue(mockOverview);
  });

  it('includes overview in test details', async () => {
    const res = await request(makeApp()).get(`/api/browser/tests/${UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.test.overview).toEqual(mockOverview);
    expect(mockExtractOverview).toHaveBeenCalledWith(fakeTest.files, expect.any(Function), UUID);
  });

  it('memoises per test and recomputes after refresh', async () => {
    const app = makeApp();
    await request(app).get(`/api/browser/tests/${UUID}`);
    await request(app).get(`/api/browser/tests/${UUID}`);
    expect(mockExtractOverview).toHaveBeenCalledTimes(1);

    const refresh = await request(app).post('/api/browser/tests/refresh');
    expect(refresh.status).toBe(200);
    await request(app).get(`/api/browser/tests/${UUID}`);
    expect(mockExtractOverview).toHaveBeenCalledTimes(2);
  });

  it('does not put overview on list items', async () => {
    const res = await request(makeApp()).get('/api/browser/tests');
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(1);
    expect(res.body.tests[0]).not.toHaveProperty('overview');
    expect(mockExtractOverview).not.toHaveBeenCalled();
  });
});
