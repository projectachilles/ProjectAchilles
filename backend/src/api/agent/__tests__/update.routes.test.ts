import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
import '../../../__tests__/helpers/clerk-mock.js';

// Real filesystem on purpose: containment has to hold against real symlinks
// and `..` segments, which a mocked fs cannot exercise. Only homedir() moves,
// and it must exist before any import, since some modules resolve it at load.
const { home } = await vi.hoisted(async () => {
  const nodeFs = await import('fs');
  const nodePath = await import('path');
  const nodeOs = await import('os');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'update-routes-')) };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

let testDb: Database.Database;
vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../../../services/agent/signing.service.js', () => ({
  signHash: () => 'deadbeef'.repeat(16),
}));


const { createAdminUpdateRouter } = await import('../update.routes.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');
const { buildReleaseNotes } = await import('../../../services/agent/agentBuild.service.js');

const agentBinary = (version: string) =>
  Buffer.from(`\x00MZ\x90build\t-ldflags="-s -w -X main.version=${version}"\n\x00`);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminUpdateRouter(null));
  app.use(errorHandler);
  return app;
}

describe('POST /admin/versions — binary_path containment', () => {
  let binDir: string;
  let outsideBinary: string;

  const register = (binaryPath: string) =>
    request(createApp())
      .post('/admin/versions')
      .send({ version: '1.2.3', os: 'linux', arch: 'amd64', binary_path: binaryPath });

  const versionRows = () => testDb.prepare('SELECT * FROM agent_versions').all();

  beforeAll(() => {
    binDir = path.join(home, '.projectachilles', 'binaries', 'linux-amd64');
    fs.mkdirSync(binDir, { recursive: true });

    // A perfectly valid, correctly stamped agent binary that merely lives
    // outside the binaries root — only the containment check can reject it.
    outsideBinary = path.join(home, 'elsewhere-agent');
    fs.writeFileSync(outsideBinary, agentBinary('1.2.3'));
  });

  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it('registers a stamped binary inside the binaries directory', async () => {
    const inside = path.join(binDir, 'achilles-agent-1.2.3');
    fs.writeFileSync(inside, agentBinary('1.2.3'));

    const res = await register(inside);

    expect(res.status).toBe(201);
    expect(res.body.data.binary_path).toBe(fs.realpathSync(inside));
  });

  it.each([
    ['an absolute path outside the root', () => outsideBinary],
    ['a ../ traversal out of the root', () => path.join(binDir, '..', '..', '..', 'elsewhere-agent')],
    ['a missing file inside the root', () => path.join(binDir, 'does-not-exist')],
    ['a directory inside the root', () => binDir],
  ])('rejects %s with a generic 400 and writes nothing', async (_label, target) => {
    const binaryPath = target();
    const res = await register(binaryPath);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // No path echo: the old "Binary not found: <path>" was a file-existence oracle.
    expect(res.body.error).not.toContain(binaryPath);
    expect(versionRows()).toHaveLength(0);
  });

  it('rejects a symlink inside the root that points outside it', async () => {
    const link = path.join(binDir, 'achilles-agent-symlinked');
    fs.symlinkSync(outsideBinary, link);

    const res = await register(link);

    expect(res.status).toBe(400);
    expect(versionRows()).toHaveLength(0);
  });

  it('gives a missing file and an out-of-root file the same message', async () => {
    const missing = await register(path.join(binDir, 'nope'));
    const outside = await register(outsideBinary);

    expect(missing.body.error).toBe(outside.body.error);
  });
});

// ── Release notes a person types can't pose as the server's build record ────
// Build from source writes "Built from source (<os>/<arch>) at <commit>" into
// release_notes, and Settings → Agent shows that commit as the version's
// source. The same field holds what an uploader types.

describe('release notes typed for a registered or uploaded version', () => {
  const RESERVED = /Release notes can't start with "Built from source"/;
  let binDir: string;

  const versionRows = () => testDb.prepare('SELECT release_notes FROM agent_versions').all() as Array<{ release_notes: string }>;

  const register = (releaseNotes: string) =>
    request(createApp())
      .post('/admin/versions')
      .send({ version: '1.2.3', os: 'linux', arch: 'amd64', binary_path: path.join(binDir, 'agent-notes'), release_notes: releaseNotes });

  const upload = (releaseNotes: string) =>
    request(createApp())
      .post('/admin/versions/upload')
      .field('version', '1.2.3').field('os', 'linux').field('arch', 'amd64')
      .field('allow_unsigned', 'true').field('release_notes', releaseNotes)
      .attach('binary', agentBinary('1.2.3'), 'agent');

  beforeAll(() => {
    binDir = path.join(home, '.projectachilles', 'binaries', 'linux-amd64');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'agent-notes'), agentBinary('1.2.3'));
  });

  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  const posing = [
    'Built from source (windows/amd64) at deadbee',
    'Built from source (linux/amd64) at 0123456789abcdef0123456789abcdef01234567 (source says 9.9.9)',
    'Built from source (linux/amd64)',
    '  built FROM source (linux/amd64) at deadbee  ',
    'Built from source\nby the release team',
  ];

  it.each(posing)('register by path refuses %j and registers nothing', async (notes) => {
    const res = await register(notes);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(RESERVED);
    expect(versionRows()).toEqual([]);
  });

  it.each(posing)('upload refuses %j and registers nothing', async (notes) => {
    const res = await upload(notes);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(RESERVED);
    expect(versionRows()).toEqual([]);
  });

  it('refuses exactly what the build service writes, with and without a commit', async () => {
    for (const notes of [
      buildReleaseNotes('linux', 'amd64', 'deadbee', '1.2.3', '1.2.3'),
      buildReleaseNotes('windows', 'arm64', null, '1.2.3', null),
      buildReleaseNotes('darwin', 'arm64', '0123456789abcdef0123456789abcdef01234567', '1.2.3', '1.2.2'),
    ]) {
      expect(notes).toMatch(/^Built from source/);
      expect((await register(notes)).status).toBe(400);
    }
  });

  it.each([
    'Hotfix for the heartbeat timeout',
    'Rebuilt from source by the release team',
    'Signed build. Built from sources of tag agent-v1.2.3',
    '',
  ])('still accepts ordinary notes: %j', async (notes) => {
    const res = await register(notes);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(versionRows()).toEqual([{ release_notes: notes }]);
  });

  it('accepts an upload with ordinary notes', async () => {
    const res = await upload('Hotfix for the heartbeat timeout');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(versionRows()).toEqual([{ release_notes: 'Hotfix for the heartbeat timeout' }]);
  });
});

