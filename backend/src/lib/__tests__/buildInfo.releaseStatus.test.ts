import { describe, it, expect, afterEach, vi } from 'vitest';
import { getBuildInfo, resetBuildInfoCache, resolveReleaseStatus } from '../buildInfo.js';
import type { BuildInfo } from '../buildInfo.js';

const base: BuildInfo = { version: '2.11.0', commit: 'c0ffee1', commitShort: 'c0ffee1', branch: null, tag: null };

describe('resolveReleaseStatus', () => {
  it('is official when the build carries its own release tag', () => {
    expect(resolveReleaseStatus({ ...base, tag: 'v2.11.0' }, null)).toEqual({ status: 'official', aheadBy: 0 });
  });

  it('is official when the commit is the tag', () => {
    expect(resolveReleaseStatus(base, { aheadBy: 0, behindBy: 0 })).toEqual({ status: 'official', aheadBy: 0 });
  });

  it('is ahead by the number of commits after the tag', () => {
    expect(resolveReleaseStatus(base, { aheadBy: 4, behindBy: 0 })).toEqual({ status: 'ahead', aheadBy: 4 });
  });

  it('makes no claim for a commit that is not a descendant of the tag', () => {
    expect(resolveReleaseStatus(base, { aheadBy: 2, behindBy: 1 })).toEqual({ status: 'unknown', aheadBy: null });
  });

  it('makes no claim without evidence', () => {
    expect(resolveReleaseStatus(base, null)).toEqual({ status: 'unknown', aheadBy: null });
  });

  it('makes no claim for an unknown version, whatever else is known', () => {
    const build = { ...base, version: 'unknown', tag: 'vunknown' };
    expect(resolveReleaseStatus(build, { aheadBy: 0, behindBy: 0 }).status).toBe('unknown');
  });
});

describe('getBuildInfo().tag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetBuildInfoCache();
  });

  it('keeps GIT_TAG only when it is this version\'s tag', () => {
    resetBuildInfoCache();
    const version = getBuildInfo().version;
    resetBuildInfoCache();
    vi.stubEnv('GIT_TAG', `v${version}`);
    expect(getBuildInfo().tag).toBe(`v${version}`);
  });

  it('ignores a tag of another version, and an empty one', () => {
    for (const value of ['v0.0.1', '', 'main']) {
      resetBuildInfoCache();
      vi.stubEnv('GIT_TAG', value);
      expect(getBuildInfo().tag).toBeNull();
    }
  });
});
