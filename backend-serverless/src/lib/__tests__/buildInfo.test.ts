import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBuildInfo, resetBuildInfoCache } from '../buildInfo.js';

const COMMIT_VARS = [
  'RENDER_GIT_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'RAILWAY_GIT_COMMIT_SHA',
  'GIT_COMMIT',
  'SOURCE_COMMIT',
];
const BRANCH_VARS = ['RENDER_GIT_BRANCH', 'VERCEL_GIT_COMMIT_REF', 'RAILWAY_GIT_BRANCH', 'GIT_BRANCH'];

describe('buildInfo', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [...COMMIT_VARS, ...BRANCH_VARS]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    resetBuildInfoCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetBuildInfoCache();
  });

  // The whole point: /api/health used to report a hardcoded '1.0.0' from before
  // 2.0.0, so a deployment could not say what it was running and "did my deploy
  // pick up that fix?" had to be answered from dashboard timestamps.
  it('reports the real package version, not a hardcoded one', () => {
    const info = getBuildInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.version).not.toBe('1.0.0');
  });

  it('returns nulls when no platform injected a commit', () => {
    const info = getBuildInfo();
    expect(info.commit).toBeNull();
    expect(info.commitShort).toBeNull();
    expect(info.branch).toBeNull();
  });

  it.each([
    ['RENDER_GIT_COMMIT', 'RENDER_GIT_BRANCH'],
    ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF'],
    ['RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_GIT_BRANCH'],
    ['GIT_COMMIT', 'GIT_BRANCH'],
  ])('reads the commit and branch from %s', (commitVar, branchVar) => {
    process.env[commitVar] = '6085fd7abcdef1234567890';
    process.env[branchVar] = 'main';
    resetBuildInfoCache();

    const info = getBuildInfo();
    expect(info.commit).toBe('6085fd7abcdef1234567890');
    expect(info.commitShort).toBe('6085fd7');
    expect(info.branch).toBe('main');
  });

  // Order matters: an image may carry a stale GIT_COMMIT baked in at build
  // time while the platform injects the real one at deploy time.
  it('prefers the platform variable over the generic fallback', () => {
    process.env.GIT_COMMIT = 'staleaaaaaaaaaaaaaaa';
    process.env.RENDER_GIT_COMMIT = 'freshbbbbbbbbbbbbbb';
    resetBuildInfoCache();

    expect(getBuildInfo().commit).toBe('freshbbbbbbbbbbbbbb');
  });

  it('ignores a variable set to an empty or whitespace value', () => {
    process.env.RENDER_GIT_COMMIT = '   ';
    process.env.GIT_COMMIT = 'realccccccccccccccc';
    resetBuildInfoCache();

    expect(getBuildInfo().commit).toBe('realccccccccccccccc');
  });

  it('caches, so the health endpoint does not re-read package.json per request', () => {
    const first = getBuildInfo();
    process.env.RENDER_GIT_COMMIT = 'ignoredddddddddddd';
    expect(getBuildInfo()).toBe(first);
  });
});
