import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const build = { version: '2.11.0', commit: 'abc1234def', commitShort: 'abc1234', branch: 'main', tag: null as string | null };
vi.mock('../../../lib/buildInfo.js', () => ({ getBuildInfo: () => build }));

const {
  NOTES_LIMIT,
  agentNotes,
  getReleaseCheckState,
  isReleaseCheckEnabled,
  releaseRepo,
  resetReleaseCheckForTests,
  runReleaseCheck,
} = await import('../releaseCheck.js');

const REPO = 'https://api.github.com/repos/projectachilles/ProjectAchilles';

interface Rel { tag_name: string; draft?: boolean; prerelease?: boolean; body?: string }
const rel = (r: Rel) => ({
  draft: false,
  prerelease: false,
  body: `notes of ${r.tag_name}`,
  published_at: '2026-11-16T10:00:00Z',
  html_url: `https://github.com/projectachilles/ProjectAchilles/releases/tag/${r.tag_name}`,
  ...r,
});

const LIST = [
  rel({ tag_name: 'v3.0.0', draft: true }),
  rel({ tag_name: 'v2.12.0', prerelease: true }),
  rel({ tag_name: 'agent-v0.7.5', body: 'Install with curl\n\n---\n\n### Security\n- fix' }),
  rel({ tag_name: 'v2.11.1' }),
  rel({ tag_name: 'v2.9.0' }),
  rel({ tag_name: 'agent-v0.7.4' }),
  rel({ tag_name: 'v2.11.0' }),
  rel({ tag_name: 'something-else' }),
];

type Call = { url: string; init: RequestInit | undefined };
function fakeFetch(handlers: { releases?: () => Response; compare?: () => Response }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/compare/')) return (handlers.compare ?? (() => json({ ahead_by: 0, behind_by: 0 })))();
    return (handlers.releases ?? (() => json(LIST)))();
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('release check', () => {
  beforeEach(() => {
    resetReleaseCheckForTests();
    build.commit = 'abc1234def';
    build.version = '2.11.0';
  });
  afterEach(() => vi.unstubAllEnvs());

  it('picks the highest platform and agent release, skipping drafts and prereleases', async () => {
    const { impl } = fakeFetch({});
    await runReleaseCheck(impl);
    const state = getReleaseCheckState();
    expect(state.platform?.version).toBe('2.11.1');
    expect(state.agent?.version).toBe('0.7.5');
    expect(state.platform?.url).toContain('/releases/tag/v2.11.1');
    expect(state.platform?.publishedAt).toBe('2026-11-16T10:00:00Z');
    expect(state.checkedAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(state.enabled).toBe(true);
  });

  it('keeps only the changelog part of agent notes', async () => {
    const { impl } = fakeFetch({});
    await runReleaseCheck(impl);
    expect(getReleaseCheckState().agent?.notes).toBe('### Security\n- fix');
    expect(agentNotes('no separator here')).toBe('no separator here');
    expect(agentNotes('a --- b\nstill body')).toBe('a --- b\nstill body');
  });

  it('cuts notes at NOTES_LIMIT and says where the rest is', async () => {
    const { impl } = fakeFetch({ releases: () => json([rel({ tag_name: 'v2.11.1', body: 'x'.repeat(70_000) })]) });
    await runReleaseCheck(impl);
    const notes = getReleaseCheckState().platform?.notes ?? '';
    expect(notes.length).toBeLessThanOrEqual(NOTES_LIMIT + 40);
    expect(notes.endsWith('_The notes continue on GitHub._')).toBe(true);
  });

  it('reads ahead_by and behind_by from the compare call', async () => {
    const { impl, calls } = fakeFetch({ compare: () => json({ ahead_by: 4, behind_by: 0 }) });
    await runReleaseCheck(impl);
    expect(getReleaseCheckState().compare).toEqual({ aheadBy: 4, behindBy: 0 });
    expect(calls.map((c) => c.url)).toEqual([
      `${REPO}/releases?per_page=30`,
      `${REPO}/compare/v2.11.0...abc1234def`,
    ]);
  });

  it('treats a compare 404 as no data, not an error', async () => {
    const { impl } = fakeFetch({ compare: () => json({ message: 'Not Found' }, 404) });
    await runReleaseCheck(impl);
    const state = getReleaseCheckState();
    expect(state.compare).toBeNull();
    expect(state.error).toBeNull();
    expect(state.platform?.version).toBe('2.11.1');
  });

  it.each([
    [403, 'rate_limited'],
    [429, 'rate_limited'],
    [500, 'http'],
  ])('maps HTTP %i to %s and keeps the last good data', async (status, error) => {
    await runReleaseCheck(fakeFetch({ compare: () => json({ ahead_by: 2, behind_by: 0 }) }).impl);
    const good = getReleaseCheckState();
    await runReleaseCheck(fakeFetch({ releases: () => json({ message: 'no' }, status) }).impl);
    const state = getReleaseCheckState();
    expect(state.error).toBe(error);
    expect(state.platform).toEqual(good.platform);
    expect(state.agent).toEqual(good.agent);
    expect(state.compare).toEqual(good.compare);
    expect(state.checkedAt).toBe(good.checkedAt);
  });

  it('maps a thrown fetch to network and never throws', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(runReleaseCheck(impl)).resolves.toBeUndefined();
    expect(getReleaseCheckState().error).toBe('network');
    expect(getReleaseCheckState().platform).toBeNull();
  });

  it.each([
    ['an object', () => json({ not: 'a list' })],
    ['HTML', () => new Response('<html>blocked</html>', { status: 200 })],
  ])('maps %s where a list was expected to parse', async (_name, releases) => {
    await runReleaseCheck(fakeFetch({ releases }).impl);
    expect(getReleaseCheckState().error).toBe('parse');
  });

  it('sends only the Accept and User-Agent headers, and no token', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_should_never_be_sent');
    const { impl, calls } = fakeFetch({});
    await runReleaseCheck(impl);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect([...headers.keys()].sort()).toEqual(['accept', 'user-agent']);
      expect(headers.get('user-agent')).toBe('ProjectAchilles');
      expect(call.init?.method ?? 'GET').toBe('GET');
      expect(call.init?.body).toBeUndefined();
      expect(call.url).not.toContain('ghp_');
    }
  });

  it.each(['off', 'OFF', 'false', '0'])('makes no request when RELEASE_CHECK is %s', async (value) => {
    vi.stubEnv('RELEASE_CHECK', value);
    const { impl, calls } = fakeFetch({});
    await runReleaseCheck(impl);
    expect(calls).toHaveLength(0);
    expect(isReleaseCheckEnabled()).toBe(false);
    expect(getReleaseCheckState().enabled).toBe(false);
  });

  it('is on by default and for any other value', () => {
    expect(isReleaseCheckEnabled({})).toBe(true);
    expect(isReleaseCheckEnabled({ RELEASE_CHECK: 'on' })).toBe(true);
  });

  it('falls back to the default repo for an invalid RELEASE_CHECK_REPO', async () => {
    for (const bad of ['https://evil.example/x', '../../x', 'a/b/c', 'a b/c', '']) {
      expect(releaseRepo({ RELEASE_CHECK_REPO: bad })).toBe('projectachilles/ProjectAchilles');
    }
    expect(releaseRepo({ RELEASE_CHECK_REPO: 'my-org/My.Fork_1' })).toBe('my-org/My.Fork_1');
    vi.stubEnv('RELEASE_CHECK_REPO', 'https://evil.example/x');
    const { impl, calls } = fakeFetch({});
    await runReleaseCheck(impl);
    expect(calls.every((c) => c.url.startsWith(`${REPO}/`))).toBe(true);
  });

  it('skips the compare call when the commit or the version is unknown', async () => {
    build.commit = null as unknown as string;
    let { impl, calls } = fakeFetch({});
    await runReleaseCheck(impl);
    expect(calls).toHaveLength(1);
    build.commit = 'abc1234def';
    build.version = 'unknown';
    ({ impl, calls } = fakeFetch({}));
    await runReleaseCheck(impl);
    expect(calls).toHaveLength(1);
  });

  it('survives releases with missing fields', async () => {
    const odd = [{ tag_name: 'v2.11.2' }, { tag_name: null }, null, 'x', rel({ tag_name: 'agent-v0.7.6', body: undefined })];
    await runReleaseCheck(fakeFetch({ releases: () => json(odd) }).impl);
    const state = getReleaseCheckState();
    expect(state.error).toBeNull();
    expect(state.platform).toEqual({ version: '2.11.2', publishedAt: '', url: '', notes: '' });
    expect(state.agent?.version).toBe('0.7.6');
  });
});
