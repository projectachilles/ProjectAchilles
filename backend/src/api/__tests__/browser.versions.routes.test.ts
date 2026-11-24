import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { TestVersionIdentity } from '../../types/testVersion.js';

let allowCheck = true;
vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = { userId: 'test-user-001' };
    next();
  },
  requirePermission: (perm: string) => (_req: any, res: any, next: any) => {
    if (perm === 'tests:sync:execute' && !allowCheck) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    next();
  },
}));

const U_UPDATE = '11111111-0000-0000-0000-000000000001';
const U_REBUILD = '11111111-0000-0000-0000-000000000002';
const U_NEWNOTE = '11111111-0000-0000-0000-000000000003';
const U_CUSTOM = '11111111-0000-0000-0000-000000000004';

const tests = [U_UPDATE, U_REBUILD, U_NEWNOTE, U_CUSTOM].map((uuid, i) => ({
  uuid, name: `Test ${i}`, techniques: [], stages: [], files: [],
  source: uuid === U_CUSTOM ? 'custom' : 'upstream',
}));

vi.mock('../../services/browser/testIndexer.js', () => ({
  TestIndexer: class {
    scanAllTests() { return []; }
    refresh() { return tests; }
    getAllTests() { return tests; }
    getTest(uuid: string) { return tests.find(t => t.uuid === uuid); }
    getCategories() { return []; }
    getSourceRoots() { return ['/nonexistent']; }
  },
}));
vi.mock('../../services/agent/test-catalog.service.js', () => ({ initCatalog: vi.fn() }));

const { createBrowserRouter } = await import('../browser.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');
const { CheckBusyError } = await import('../../services/browser/testVersions.service.js');

function ident(fp: string, over: Partial<TestVersionIdentity> = {}): TestVersionIdentity {
  return {
    fingerprint: fp, source_hash: `s-${fp}`, shared_hash: 'sh', test_tree: `tree-${fp}`,
    commit: `commit-${fp}`, commit_date: '2026-01-01T00:00:00Z', provenance: 'upstream', ...over,
  };
}

function published(over: Record<string, unknown> = {}) {
  return {
    checkedAt: '2026-11-23T10:00:00Z', commit: 'pub1', commitDate: '2026-11-22T00:00:00Z',
    error: null, errorAt: null, newTests: 2,
    byTest: new Map<string, TestVersionIdentity>([
      [U_UPDATE, ident('new')],
      [U_REBUILD, ident('same')],
      [U_NEWNOTE, ident('new')],
    ]),
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}) {
  return {
    gitEnabled: true,
    synced: vi.fn(async () => new Map<string, TestVersionIdentity>([
      [U_UPDATE, ident('old')],
      [U_REBUILD, ident('same')],
      [U_NEWNOTE, ident('old')],
      [U_CUSTOM, ident('c', { provenance: 'custom', commit: null, commit_date: null })],
    ])),
    syncedCommit: vi.fn(async () => ({ hash: 'sync1', date: '2026-11-01T00:00:00Z' })),
    published: vi.fn(() => published()),
    check: vi.fn(async () => published()),
    recordPublishedFromLocal: vi.fn(async () => undefined),
    afterSync: vi.fn(),
    ...over,
  };
}

function stamp(fp: string, over: Record<string, unknown> = {}) {
  return { ...ident(fp), deps_hash: null, modified: false, binaries: {}, ...over };
}

function makeBuild() {
  const infos: Record<string, unknown> = {
    [U_UPDATE]: { exists: true, source: 'built', builtAt: '2026-11-10T00:00:00Z', signed: true, version: stamp('old') },
    [U_REBUILD]: { exists: true, source: 'built', builtAt: '2026-11-11T00:00:00Z', signed: false, version: stamp('older') },
  };
  return {
    getBuildInfo: vi.fn((uuid: string) => infos[uuid] ?? { exists: false }),
    currentDepsHash: vi.fn(() => null),
    currentOutputsHash: vi.fn((_uuid: string): string | null => null),
  };
}

function makeApp(opts: Record<string, unknown> | 'none' = {}) {
  const app = express();
  app.use(express.json());
  const extra = opts === 'none' ? {} : {
    testVersions: makeService() as never, buildService: makeBuild() as never, ...opts,
  };
  app.use('/api/browser', createBrowserRouter({
    testSources: [{ path: '/nonexistent', provenance: 'upstream' }],
    testsSourcePath: '/nonexistent',
    ...extra,
  }));
  app.use(errorHandler);
  return app;
}

describe('GET /api/browser/tests/versions', () => {
  beforeEach(() => { allowCheck = true; delete process.env.TESTS_UPDATE_CHECK; });
  afterEach(() => { delete process.env.TESTS_UPDATE_CHECK; });

  it('returns a row per test with derived status, counters and library info', async () => {
    const res = await request(makeApp()).get('/api/browser/tests/versions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { library, tests: rows } = res.body.data;
    expect(Object.keys(rows).sort()).toEqual([U_UPDATE, U_REBUILD, U_NEWNOTE, U_CUSTOM]);

    expect(rows[U_UPDATE]).toEqual({
      status: 'update_available', reason: 'test_source_changed', custom: false,
      published: { commit: 'commit-new', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'new' },
      synced: { commit: 'commit-old', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'old' },
      built: { commit: 'commit-old', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'old', builtAt: '2026-11-10T00:00:00Z', signed: true },
    });
    expect(rows[U_REBUILD].status).toBe('rebuild_needed');
    expect(rows[U_REBUILD].reason).toBe('test_source_changed');
    expect(rows[U_REBUILD].built.signed).toBe(false);
    expect(rows[U_NEWNOTE]).toMatchObject({ status: 'not_built', updateNote: true, built: null });
    // custom: no git, never an update; published side hidden
    expect(rows[U_CUSTOM]).toMatchObject({ custom: true, status: 'not_built', published: null, built: null });
    expect(rows[U_CUSTOM].updateNote).toBeUndefined();

    expect(library).toMatchObject({
      gitEnabled: true, checkEnabled: true,
      syncedCommit: 'sync1', syncedCommitDate: '2026-11-01T00:00:00Z',
      publishedCommit: 'pub1', publishedCommitDate: '2026-11-22T00:00:00Z',
      checkedAt: '2026-11-23T10:00:00Z', checkError: null,
      updatesAvailable: 2, rebuildsNeeded: 1, newTests: 2,
    });
  });

  describe('a build that matches the synced and published versions', () => {
    const DEPS = 'd'.repeat(64);
    function matchingBuild() {
      const builds = makeBuild();
      builds.getBuildInfo.mockImplementation(((uuid: string) => (uuid === U_REBUILD
        ? { exists: true, source: 'built', builtAt: '2026-11-11T00:00:00Z', signed: true, version: stamp('same', { deps_hash: DEPS }) }
        : { exists: false })) as never);
      builds.currentDepsHash.mockImplementation((() => DEPS) as never);
      return builds;
    }

    it('is up_to_date when fingerprint, deps hash, synced and published all match', async () => {
      const res = await request(makeApp({ buildService: matchingBuild() as never })).get('/api/browser/tests/versions');
      expect(res.body.data.tests[U_REBUILD]).toEqual({
        status: 'up_to_date', custom: false,
        published: { commit: 'commit-same', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'same' },
        synced: { commit: 'commit-same', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'same' },
        built: { commit: 'commit-same', commitDate: '2026-01-01T00:00:00Z', fingerprint: 'same', builtAt: '2026-11-11T00:00:00Z', signed: true },
      });
    });

    it('is not_checked with no published side when no check has succeeded yet', async () => {
      const svc = makeService({ published: vi.fn(() => published({ checkedAt: null })) });
      const res = await request(makeApp({ testVersions: svc as never, buildService: matchingBuild() as never }))
        .get('/api/browser/tests/versions');
      const row = res.body.data.tests[U_REBUILD];
      expect(row.status).toBe('not_checked');
      expect(row.published).toBeNull();
      expect(res.body.data.library.updatesAvailable).toBe(0);
      expect(Object.values(res.body.data.tests).map(r => (r as { status: string }).status))
        .not.toContain('up_to_date');
    });
  });

  describe('embedded files the build produced (outputs hash)', () => {
    const built = (version: Record<string, unknown>) =>
      ({ exists: true, source: 'built', builtAt: '2026-11-11T00:00:00Z', signed: true, version });

    function buildsWith(uuid: string, version: Record<string, unknown>, now: string | null) {
      const builds = makeBuild();
      builds.getBuildInfo.mockImplementation(((u: string) => (u === uuid ? built(version) : { exists: false })) as never);
      builds.currentOutputsHash.mockImplementation(() => now);
      return builds;
    }

    const customStamp = () => ({
      ...ident('c', { provenance: 'custom', commit: null, commit_date: null }),
      deps_hash: null, modified: false, binaries: {}, outputs_hash: 'o1',
    });

    it('a custom test compares them: a different hash now is rebuild_needed / dependency_changed', async () => {
      const builds = buildsWith(U_CUSTOM, customStamp(), 'o2');
      const res = await request(makeApp({ buildService: builds as never })).get('/api/browser/tests/versions');
      expect(res.body.data.tests[U_CUSTOM]).toMatchObject({
        custom: true, status: 'rebuild_needed', reason: 'dependency_changed',
      });
      expect(builds.currentOutputsHash).toHaveBeenCalledWith(U_CUSTOM);
      expect(res.body.data.library.rebuildsNeeded).toBe(1);
    });

    it('a custom test with the same hash now is up_to_date', async () => {
      const builds = buildsWith(U_CUSTOM, customStamp(), 'o1');
      const res = await request(makeApp({ buildService: builds as never })).get('/api/browser/tests/versions');
      expect(res.body.data.tests[U_CUSTOM]).toMatchObject({ custom: true, status: 'up_to_date' });
    });

    it('a git test does not compare them: its folder content is in the tree fingerprint', async () => {
      const builds = buildsWith(U_REBUILD, stamp('same', { outputs_hash: 'o1' }), 'o2');
      const res = await request(makeApp({ buildService: builds as never })).get('/api/browser/tests/versions');
      expect(res.body.data.tests[U_REBUILD].status).toBe('up_to_date');
      expect(builds.currentOutputsHash).not.toHaveBeenCalledWith(U_REBUILD);
    });

    it('with git sync off every test compares them', async () => {
      const svc = makeService({
        gitEnabled: false,
        published: vi.fn(() => published({ checkedAt: null, commit: null, commitDate: null, byTest: new Map(), newTests: 0 })),
        syncedCommit: vi.fn(async () => null),
        synced: vi.fn(async () => new Map<string, TestVersionIdentity>([
          [U_REBUILD, ident('same', { commit: null, commit_date: null, test_tree: null })],
        ])),
      });
      const builds = buildsWith(
        U_REBUILD,
        stamp('same', { commit: null, commit_date: null, test_tree: null, outputs_hash: 'o1' }),
        'o2',
      );
      const res = await request(makeApp({ testVersions: svc as never, buildService: builds as never }))
        .get('/api/browser/tests/versions');
      expect(res.body.data.tests[U_REBUILD]).toMatchObject({ status: 'rebuild_needed', reason: 'dependency_changed' });
      expect(builds.currentOutputsHash).toHaveBeenCalledWith(U_REBUILD);
    });
  });

  it('counters equal the rows in each status', async () => {
    const res = await request(makeApp()).get('/api/browser/tests/versions');
    const rows = Object.values(res.body.data.tests) as Array<{ status: string; updateNote?: boolean }>;
    const updates = rows.filter(r => r.status === 'update_available' || (r.status === 'not_built' && r.updateNote)).length;
    expect(res.body.data.library.updatesAvailable).toBe(updates);
    expect(res.body.data.library.rebuildsNeeded).toBe(rows.filter(r => r.status === 'rebuild_needed').length);
  });

  it('passes the check error through and does not run a check', async () => {
    const svc = makeService({ published: vi.fn(() => published({ error: 'fetch failed', errorAt: '2026-11-23T11:00:00Z' })) });
    const res = await request(makeApp({ testVersions: svc as never })).get('/api/browser/tests/versions');
    expect(res.body.data.library.checkError).toBe('fetch failed');
    expect(svc.check).not.toHaveBeenCalled();
  });

  it('answers with checkError and no 500 when the synced versions cannot be read; git text only goes to the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = makeService({ synced: vi.fn(async () => { throw new Error('fatal: bad object at /srv/clone'); }) });
    try {
      const res = await request(makeApp({ testVersions: svc as never })).get('/api/browser/tests/versions');
      expect(res.status).toBe(200);
      expect(res.body.data.library.checkError).toBe('The test library could not be read');
      expect(JSON.stringify(res.body)).not.toContain('/srv/clone');
      expect(Object.keys(res.body.data.tests)).toHaveLength(4);
      expect(warn.mock.calls[0].join(' ')).toContain('bad object');
    } finally {
      warn.mockRestore();
    }
  });

  it('a test whose row cannot be computed is unknown_build; the other rows are unaffected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const builds = makeBuild();
    builds.currentDepsHash.mockImplementation(((uuid: string) => {
      if (uuid === U_REBUILD) throw new Error(`EISDIR: illegal operation on a directory, read`);
      return null;
    }) as () => null);
    try {
      const res = await request(makeApp({ buildService: builds as never })).get('/api/browser/tests/versions');
      expect(res.status).toBe(200);
      const rows = res.body.data.tests;
      expect(rows[U_REBUILD]).toEqual({
        status: 'unknown_build', custom: false, published: null, synced: null, built: null,
      });
      expect(rows[U_UPDATE].status).toBe('update_available');
      expect(rows[U_NEWNOTE]).toMatchObject({ status: 'not_built', updateNote: true });
      expect(rows[U_CUSTOM]).toMatchObject({ custom: true, status: 'not_built' });
      expect(res.body.data.library.rebuildsNeeded).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0].join(' ')).toContain(U_REBUILD);
    } finally {
      warn.mockRestore();
    }
  });

  it('with git sync off: gitEnabled false, no published side', async () => {
    const svc = makeService({
      gitEnabled: false,
      published: vi.fn(() => published({ checkedAt: null, commit: null, commitDate: null, byTest: new Map(), newTests: 0 })),
      syncedCommit: vi.fn(async () => null),
    });
    const res = await request(makeApp({ testVersions: svc as never })).get('/api/browser/tests/versions');
    expect(res.status).toBe(200);
    expect(res.body.data.library).toMatchObject({
      gitEnabled: false, checkEnabled: false, repoWebUrl: null, syncedCommit: null, publishedCommit: null,
      updatesAvailable: 0, rebuildsNeeded: 1,
    });
    expect(res.body.data.tests[U_UPDATE].published).toBeNull();
  });

  it('checkEnabled is false when TESTS_UPDATE_CHECK=off', async () => {
    process.env.TESTS_UPDATE_CHECK = 'off';
    const res = await request(makeApp()).get('/api/browser/tests/versions');
    expect(res.body.data.library.checkEnabled).toBe(false);
    expect(res.body.data.library.gitEnabled).toBe(true);
  });

  it('derives repoWebUrl from a github remote without credentials, null otherwise', async () => {
    const gh = { getRepoUrl: () => 'https://user:secret@github.com/acme/lib.git' } as never;
    const a = await request(makeApp({ gitSync: gh })).get('/api/browser/tests/versions');
    expect(a.body.data.library.repoWebUrl).toBe('https://github.com/acme/lib');
    const other = { getRepoUrl: () => 'https://git.example.org/acme/lib.git' } as never;
    const b = await request(makeApp({ gitSync: other })).get('/api/browser/tests/versions');
    expect(b.body.data.library.repoWebUrl).toBeNull();
  });

  it('is not answered by the :uuid handler', async () => {
    const res = await request(makeApp()).get('/api/browser/tests/versions');
    expect(res.body.data).toBeDefined();
    expect(res.body.test).toBeUndefined();
    expect(res.status).not.toBe(404);
  });

  it('answers 503 when the services are not provided', async () => {
    const res = await request(makeApp('none')).get('/api/browser/tests/versions');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Test versions are not available' });
  });
});

describe('POST /api/browser/tests/updates/check', () => {
  beforeEach(() => { allowCheck = true; });

  it('runs a check and returns the payload', async () => {
    const svc = makeService();
    const res = await request(makeApp({ testVersions: svc as never })).post('/api/browser/tests/updates/check');
    expect(res.status).toBe(200);
    expect(svc.check).toHaveBeenCalledTimes(1);
    expect(res.body.data.library.updatesAvailable).toBe(2);
  });

  it('is 403 without tests:sync:execute', async () => {
    allowCheck = false;
    const svc = makeService();
    const res = await request(makeApp({ testVersions: svc as never })).post('/api/browser/tests/updates/check');
    expect(res.status).toBe(403);
    expect(svc.check).not.toHaveBeenCalled();
  });

  it('is 409 when a check or sync is running', async () => {
    const svc = makeService({ check: vi.fn(async () => { throw new CheckBusyError(); }) });
    const res = await request(makeApp({ testVersions: svc as never })).post('/api/browser/tests/updates/check');
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('with git sync off returns the payload without error', async () => {
    const svc = makeService({ gitEnabled: false, published: vi.fn(() => published({ checkedAt: null, byTest: new Map(), commit: null, commitDate: null, newTests: 0 })) });
    const res = await request(makeApp({ testVersions: svc as never })).post('/api/browser/tests/updates/check');
    expect(res.status).toBe(200);
    expect(res.body.data.library.gitEnabled).toBe(false);
  });

  it('answers 503 when the services are not provided', async () => {
    const res = await request(makeApp('none')).post('/api/browser/tests/updates/check');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/browser/tests/sync then GET /api/browser/tests/versions', () => {
  let tmp: string;
  beforeEach(async () => {
    allowCheck = true;
    delete process.env.TESTS_UPDATE_CHECK;
    const fs = await import('fs');
    const os = await import('os');
    tmp = fs.mkdtempSync(`${os.tmpdir()}/tv-route-`);
  });
  afterEach(async () => {
    const fs = await import('fs');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a sync that moves HEAD past the last check reports no update available, before any new check finishes', async () => {
    const { TestVersionsService } = await import('../../services/browser/testVersions.service.js');
    const repo = `${tmp}/repo`;
    const rel = `tests_source/intel-driven/${U_UPDATE}`;
    const commits: Record<string, { hash: string; date: string }> = {
      c1: { hash: 'c1', date: '2026-11-01T00:00:00Z' },
      c2: { hash: 'c2', date: '2026-11-20T00:00:00Z' },
    };
    const treeAt = (c: string) => [
      { type: 'tree' as const, hash: `tree-${c}`, path: rel },
      { type: 'blob' as const, hash: `main-${c}`, path: `${rel}/${U_UPDATE}.go` },
    ];
    // What HEAD and origin/main point at in the clone, and what is upstream.
    let head = 'c1';
    let originRef = 'c1';
    let upstream = 'c1';
    let fetches = 0;
    const git = {
      isSyncing: () => false,
      getStatus: () => ({ status: 'synced', branch: 'main', commitHash: head, lastSyncTime: null }),
      getRepoUrl: () => 'https://git.example.org/acme/lib.git',
      getRepoPath: () => repo,
      publishedRef: () => 'origin/main',
      // The first check completes; any later one never does (it loses every race).
      fetchPublished: vi.fn(async () => {
        fetches++;
        if (fetches > 1) return new Promise<string>(() => undefined);
        originRef = upstream;
        return 'origin/main';
      }),
      sync: vi.fn(async () => { originRef = upstream; head = upstream; }),
      listTree: vi.fn(async (ref: string) => treeAt(ref === 'HEAD' ? head : originRef)),
      commitInfo: vi.fn(async (ref: string) => commits[ref === 'HEAD' ? head : originRef]),
      modifiedTrackedPaths: vi.fn(async () => []),
    };
    const versions = new TestVersionsService({
      gitSync: git as never,
      sourceSubdir: 'tests_source',
      listTests: () => [{ uuid: U_UPDATE, dir: `${repo}/${rel}`, provenance: 'upstream' }],
      stateFile: `${tmp}/published.json`,
    });
    const builds = {
      getBuildInfo: vi.fn((uuid: string) => (uuid === U_UPDATE
        ? { exists: true, source: 'built', builtAt: '2026-11-02T00:00:00Z', signed: true, version: undefined as unknown }
        : { exists: false })),
      currentDepsHash: vi.fn(() => null),
    };
    const app = makeApp({ testVersions: versions as never, buildService: builds as never, gitSync: git as never });

    await versions.check(); // published = c1 = synced
    const stamped = (await versions.current(U_UPDATE))!;
    builds.getBuildInfo.mockImplementation(((uuid: string) => (uuid === U_UPDATE
      ? { exists: true, source: 'built', builtAt: '2026-11-02T00:00:00Z', signed: true,
          version: { ...stamped.identity, deps_hash: null, modified: false, binaries: {} } }
      : { exists: false })) as never);
    const before = await request(app).get('/api/browser/tests/versions');
    expect(before.body.data.tests[U_UPDATE].status).toBe('up_to_date');

    upstream = 'c2';
    const synced = await request(app).post('/api/browser/tests/sync');
    expect(synced.status).toBe(200);

    const after = await request(app).get('/api/browser/tests/versions');
    expect(after.body.data.library.syncedCommit).toBe('c2');
    expect(after.body.data.library.publishedCommit).toBe('c2');
    expect(after.body.data.library.updatesAvailable).toBe(0);
    expect(after.body.data.tests[U_UPDATE].status).toBe('rebuild_needed');
  });

  it('a failure recording the published version is logged and does not fail the sync', async () => {
    const error = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = makeService({ recordPublishedFromLocal: vi.fn(async () => { throw new Error('bad ref'); }) });
    const git = {
      isSyncing: () => false,
      sync: vi.fn(async () => undefined),
      getStatus: () => ({ status: 'synced', branch: 'main', commitHash: 'x', lastSyncTime: null }),
      getRepoUrl: () => 'https://git.example.org/acme/lib.git',
    };
    try {
      const res = await request(makeApp({ testVersions: svc as never, gitSync: git as never })).post('/api/browser/tests/sync');
      expect(res.status).toBe(200);
      expect(svc.recordPublishedFromLocal).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('capabilities', () => {
  it('server.ts advertises testVersions: true and passes the services to the router', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/testVersions:\s*true/);
    expect(src).toMatch(/createBrowserRouter\(\{[\s\S]*?testVersions,[\s\S]*?buildService,[\s\S]*?\}\)/);
  });
});
