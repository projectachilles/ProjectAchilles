import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BuildInfo } from '../../../lib/buildInfo.js';
import type { ReleaseCheckState } from '../releaseCheck.js';

let build: BuildInfo;
let state: ReleaseCheckState;

vi.mock('../../../lib/buildInfo.js', async (orig) => {
  const actual = await orig<typeof import('../../../lib/buildInfo.js')>();
  return { ...actual, getBuildInfo: () => build };
});
vi.mock('../releaseCheck.js', async (orig) => {
  const actual = await orig<typeof import('../releaseCheck.js')>();
  return { ...actual, getReleaseCheckState: () => state };
});
vi.mock('../../../data/releaseInfo.js', () => ({
  RELEASE_INFO: {
    version: '2.11.0',
    date: '2026-11-15',
    title: 'Stage Coverage and a Security Round',
    notes: '### Added\n- A card.',
    agent: { version: '0.7.4', date: '2026-11-15', notes: '### Security\n- bundled agent note' },
  },
}));

const { getAbout } = await import('../about.service.js');

const remote = (version: string, kind: 'v' | 'agent-v' = 'v') => ({
  version,
  publishedAt: '2026-11-20T09:00:00Z',
  url: `https://github.com/projectachilles/ProjectAchilles/releases/tag/${kind}${version}`,
  notes: `notes ${version}`,
});

describe('getAbout', () => {
  beforeEach(() => {
    build = { version: '2.11.0', commit: 'ca0b830356d6', commitShort: 'ca0b830', branch: 'main', tag: null };
    state = { enabled: true, checkedAt: null, error: null, platform: null, agent: null, compare: null };
  });

  it('offline: bundled notes, bundled agent, no claim, nothing newer', () => {
    const about = getAbout();
    expect(about.platform).toEqual({
      version: '2.11.0',
      commit: 'ca0b830356d6',
      commitShort: 'ca0b830',
      branch: 'main',
      status: 'unknown',
      aheadBy: null,
      releaseDate: '2026-11-15',
      title: 'Stage Coverage and a Security Round',
      notes: '### Added\n- A card.',
      releaseUrl: 'https://github.com/projectachilles/ProjectAchilles/releases/tag/v2.11.0',
    });
    expect(about.agent.official).toEqual({
      version: '0.7.4',
      date: '2026-11-15',
      notes: '### Security\n- bundled agent note',
      source: 'bundled',
    });
    expect(about.latest).toEqual({ enabled: true, checkedAt: null, error: null, platform: null, agent: null });
  });

  it('is official by tag even with no online data', () => {
    build.tag = 'v2.11.0';
    expect(getAbout().platform).toMatchObject({ status: 'official', aheadBy: 0 });
  });

  it('is ahead by the compare distance', () => {
    state.compare = { aheadBy: 4, behindBy: 0 };
    expect(getAbout().platform).toMatchObject({ status: 'ahead', aheadBy: 4 });
  });

  it('prefers the online agent release and marks its source', () => {
    state.agent = remote('0.7.5', 'agent-v');
    const about = getAbout();
    expect(about.agent.official).toEqual({
      version: '0.7.5',
      date: '2026-11-20T09:00:00Z',
      notes: 'notes 0.7.5',
      source: 'online',
    });
    expect(about.latest.agent).toEqual(remote('0.7.5', 'agent-v'));
  });

  it('keeps the bundled agent when the online one is older', () => {
    state.agent = remote('0.7.3', 'agent-v');
    expect(getAbout().agent.official).toMatchObject({ version: '0.7.4', source: 'bundled' });
  });

  it('flags a newer platform release, and only a newer one', () => {
    state.platform = remote('2.11.1');
    expect(getAbout().latest.platform).toEqual({ ...remote('2.11.1'), newer: true });
    state.platform = remote('2.11.0');
    expect(getAbout().latest.platform?.newer).toBe(false);
    state.platform = remote('2.10.1');
    expect(getAbout().latest.platform?.newer).toBe(false);
  });

  it('reports the check as disabled, without stale remote data', () => {
    state = { enabled: false, checkedAt: '2026-11-15T10:00:00Z', error: null, platform: remote('2.11.1'), agent: remote('0.7.5', 'agent-v'), compare: { aheadBy: 0, behindBy: 0 } };
    const about = getAbout();
    expect(about.latest).toEqual({ enabled: false, checkedAt: null, error: null, platform: null, agent: null });
    expect(about.agent.official?.source).toBe('bundled');
    expect(about.platform.status).toBe('unknown');
  });

  it('still answers when the last check failed', () => {
    state = { ...state, checkedAt: '2026-11-15T10:00:00Z', error: 'rate_limited', platform: remote('2.11.1') };
    const about = getAbout();
    expect(about.latest.error).toBe('rate_limited');
    expect(about.latest.platform?.version).toBe('2.11.1');
    expect(about.platform.notes).toContain('### Added');
  });

  it('makes no claim and offers nothing newer for an unknown version', () => {
    build.version = 'unknown';
    state.platform = remote('2.11.1');
    state.compare = { aheadBy: 0, behindBy: 0 };
    const about = getAbout();
    expect(about.platform.status).toBe('unknown');
    expect(about.latest.platform?.newer).toBe(false);
  });
});
