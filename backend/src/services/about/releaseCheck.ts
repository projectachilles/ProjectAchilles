import { getBuildInfo } from '../../lib/buildInfo.js';
import type { TagCompare } from '../../lib/buildInfo.js';
import { compareVersions } from '../../lib/version.js';

/**
 * Once a day, ask GitHub which platform and agent releases are the newest, and
 * how far this build's commit is from its release tag. The About dialog
 * (GET /api/about) reads the result from memory.
 *
 * Rules this file keeps:
 * - Never on a request path. Requests read the cached state; a slow or failing
 *   GitHub can't delay or break anything.
 * - Nothing about the install is sent. Two anonymous GETs to a fixed host and
 *   repository, with an Accept and a User-Agent header and nothing else: no
 *   token (not even GITHUB_TOKEN), no query that identifies the install.
 * - RELEASE_CHECK=off turns every outbound call off.
 * - A failed attempt keeps the last good answer.
 */

export interface RemoteRelease {
  version: string;
  publishedAt: string;
  url: string;
  /** Markdown from the release page. Remote content: render as untrusted. */
  notes: string;
}

export type ReleaseCheckError = 'network' | 'rate_limited' | 'http' | 'parse';

export interface ReleaseCheckState {
  enabled: boolean;
  /** Last successful check, ISO time. */
  checkedAt: string | null;
  /** Outcome of the last attempt. */
  error: ReleaseCheckError | null;
  platform: RemoteRelease | null;
  agent: RemoteRelease | null;
  compare: TagCompare | null;
}

export const NOTES_LIMIT = 60_000;
const NOTES_CONTINUE = '\n\n_The notes continue on GitHub._';
const DEFAULT_REPO = 'projectachilles/ProjectAchilles';
const REQUEST_TIMEOUT_MS = 10_000;
const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const PLATFORM_TAG = /^v(\d+\.\d+\.\d+)$/;
const AGENT_TAG = /^agent-v(\d+\.\d+\.\d+)$/;

export function isReleaseCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['off', 'false', '0'].includes((env.RELEASE_CHECK ?? '').trim().toLowerCase());
}

/** The repository whose releases count as official. A fork can name its own. */
export function releaseRepo(env: NodeJS.ProcessEnv = process.env): string {
  const repo = (env.RELEASE_CHECK_REPO ?? '').trim();
  return /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.split('/').some((part) => /^\.+$/.test(part))
    ? repo
    : DEFAULT_REPO;
}

/**
 * Agent release pages open with install commands and a checksum block, then a
 * `---` line, then the changelog section (release-agent.yml). About shows only
 * the changelog part.
 */
export function agentNotes(body: string): string {
  const lines = body.split(/\r?\n/);
  const separator = lines.findIndex((line) => line.trim() === '---');
  return (separator < 0 ? body : lines.slice(separator + 1).join('\n')).trim();
}

function limit(notes: string): string {
  return notes.length > NOTES_LIMIT ? notes.slice(0, NOTES_LIMIT) + NOTES_CONTINUE : notes;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function newest(releases: unknown[], tag: RegExp, notesOf: (body: string) => string): RemoteRelease | null {
  let best: RemoteRelease | null = null;
  for (const item of releases) {
    if (!item || typeof item !== 'object') continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true || release.prerelease === true) continue;
    const match = tag.exec(text(release.tag_name));
    if (!match) continue;
    if (best && compareVersions(match[1], best.version) <= 0) continue;
    const url = text(release.html_url);
    best = {
      version: match[1],
      publishedAt: text(release.published_at),
      url: url.startsWith('https://github.com/') ? url : '',
      notes: limit(notesOf(text(release.body))),
    };
  }
  return best;
}

function initialState(): ReleaseCheckState {
  return { enabled: isReleaseCheckEnabled(), checkedAt: null, error: null, platform: null, agent: null, compare: null };
}

let state: ReleaseCheckState = initialState();
let timers: NodeJS.Timeout[] = [];

class CheckFailure extends Error {
  constructor(readonly kind: ReleaseCheckError) {
    super(kind);
  }
}

async function get(fetchImpl: typeof fetch, url: string): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ProjectAchilles' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CheckFailure('network');
  }
}

async function fetchReleases(fetchImpl: typeof fetch, repo: string): Promise<unknown[]> {
  const response = await get(fetchImpl, `https://api.github.com/repos/${repo}/releases?per_page=30`);
  if (response.status === 403 || response.status === 429) throw new CheckFailure('rate_limited');
  if (!response.ok) throw new CheckFailure('http');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CheckFailure('parse');
  }
  if (!Array.isArray(body)) throw new CheckFailure('parse');
  return body;
}

/**
 * How far this build's commit is from its release tag.
 *
 * `previous` is returned for anything that isn't a definite answer (a network
 * error, a rate limit, a 5xx, a body we can't read): otherwise one bad call
 * would make an install lose its "official release" line until the next day.
 * Null only when there is nothing to ask, or GitHub says it doesn't know the
 * commit or the tag (404: a fork, a local build).
 */
async function fetchCompare(fetchImpl: typeof fetch, repo: string, previous: TagCompare | null): Promise<TagCompare | null> {
  const build = getBuildInfo();
  if (!build.commit || build.version === 'unknown') return null;
  if (!/^[0-9a-f]{7,40}$/i.test(build.commit)) return null;
  try {
    const response = await get(fetchImpl, `https://api.github.com/repos/${repo}/compare/v${build.version}...${build.commit}`);
    if (response.status === 404) return null;
    if (!response.ok) return previous;
    const body = (await response.json()) as Record<string, unknown>;
    const aheadBy = body.ahead_by;
    const behindBy = body.behind_by;
    return typeof aheadBy === 'number' && typeof behindBy === 'number' ? { aheadBy, behindBy } : previous;
  } catch {
    return previous;
  }
}

/** One attempt. Never throws; the outcome is in getReleaseCheckState(). */
export async function runReleaseCheck(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!isReleaseCheckEnabled()) {
    state = { ...state, enabled: false };
    return;
  }
  const repo = releaseRepo();
  try {
    const releases = await fetchReleases(fetchImpl, repo);
    const compare = await fetchCompare(fetchImpl, repo, state.compare);
    state = {
      enabled: true,
      checkedAt: new Date().toISOString(),
      error: null,
      platform: newest(releases, PLATFORM_TAG, (body) => body.trim()),
      agent: newest(releases, AGENT_TAG, agentNotes),
      compare,
    };
  } catch (error) {
    state = { ...state, enabled: true, error: error instanceof CheckFailure ? error.kind : 'network' };
  }
}

export function getReleaseCheckState(): ReleaseCheckState {
  return { ...state, enabled: isReleaseCheckEnabled() };
}

/** Schedule the check: once shortly after start, then daily. No-op when off or under test. */
export function startReleaseCheck(): void {
  if (!isReleaseCheckEnabled() || process.env.NODE_ENV === 'test' || timers.length > 0) return;
  const first = setTimeout(() => void runReleaseCheck(), FIRST_CHECK_DELAY_MS);
  const daily = setInterval(() => void runReleaseCheck(), CHECK_INTERVAL_MS);
  first.unref();
  daily.unref();
  timers = [first, daily];
}

/** Tests only. */
export function resetReleaseCheckForTests(): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  state = initialState();
}
