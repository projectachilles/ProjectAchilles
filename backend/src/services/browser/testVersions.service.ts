// Synced and published versions of the security tests, and the published
// check. The check fetches the remote branch and reads its tree: it never
// pulls, resets or cleans, so the working tree (and custom tests in it) stays
// as it is.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestVersionIdentity } from '../../types/testVersion.js';
import type { BuildVersionSource } from '../tests/buildService.js';
import { sanitizeGitError } from './gitSyncService.js';
import type { GitSyncService } from './gitSyncService.js';
import {
  identitiesFromTree,
  identityFromDisk,
  isBuildInput,
  sharedInputPrefixes,
} from './versionIdentity.js';
import type { TestLocation } from './versionIdentity.js';

export interface PublishedState {
  checkedAt: string | null;
  commit: string | null;
  commitDate: string | null;
  error: string | null;
  errorAt: string | null;
  byTest: Map<string, TestVersionIdentity>;
  newTests: number;
}

export interface TestVersionsOptions {
  gitSync?: GitSyncService;
  /** Folder of the test library inside the repository, e.g. 'tests_source' */
  sourceSubdir: string;
  listTests: () => Array<{ uuid: string; dir: string; provenance: 'upstream' | 'custom' }>;
  /** Uploaded embed dependencies of a test (relative to its folder): not source. */
  embedDependencyFiles?: (uuid: string) => string[];
  /** Where the published state is shared between processes (default: the settings directory). */
  stateFile?: string;
}

export class CheckBusyError extends Error {
  constructor(message = 'A sync or a version check is already running') {
    super(message);
    this.name = 'CheckBusyError';
  }
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIRST_CHECK_MS = 2 * 60_000;
const DISK_CACHE_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

function emptyState(): PublishedState {
  return {
    checkedAt: null, commit: null, commitDate: null,
    error: null, errorAt: null, byTest: new Map(), newTests: 0,
  };
}

function matchesPrefix(p: string, prefix: string): boolean {
  return prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix;
}

type StoredState = Omit<PublishedState, 'byTest'> & { byTest: Record<string, TestVersionIdentity> };

interface SyncedSnapshot {
  identities: Map<string, TestVersionIdentity>;
  commit: { hash: string; date: string } | null;
}

export class TestVersionsService implements BuildVersionSource {
  readonly gitEnabled: boolean;
  private readonly gitSync?: GitSyncService;
  private readonly sourceSubdir: string;
  private readonly listTests: TestVersionsOptions['listTests'];
  private readonly embedDependencyFiles: (uuid: string) => string[];

  private gitCache: { commit: { hash: string; date: string }; ids: Map<string, TestVersionIdentity> } | null = null;
  private diskCache: { at: number; ids: Map<string, TestVersionIdentity> } | null = null;
  private readonly stateFile: string;
  private loadedMtimeMs = -1;
  private state: PublishedState = emptyState();
  private checking = false;
  private firstTimer: NodeJS.Timeout | undefined;
  private interval: NodeJS.Timeout | undefined;

  constructor(opts: TestVersionsOptions) {
    this.gitSync = opts.gitSync;
    this.gitEnabled = opts.gitSync !== undefined;
    this.sourceSubdir = opts.sourceSubdir;
    this.listTests = opts.listTests;
    this.embedDependencyFiles = opts.embedDependencyFiles ?? (() => []);
    this.stateFile = opts.stateFile
      ?? path.join(os.homedir(), '.projectachilles', 'test-versions-published.json');
  }

  /** Repo-relative path ('/' separators) of a test folder, or null when it is not in the repository's library. */
  private repoRelPath(dir: string): string | null {
    if (!this.gitSync) return null;
    const rel = path.relative(this.gitSync.getRepoPath(), dir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const posix = rel.split(path.sep).join('/');
    return posix.startsWith(`${this.sourceSubdir}/`) ? posix : null;
  }

  private diskIdentity(uuid: string, dir: string, provenance: 'upstream' | 'custom'): TestVersionIdentity {
    return { ...identityFromDisk(dir, uuid, this.embedDependencyFiles(uuid)), provenance };
  }

  /** Git tests at HEAD, cached by the HEAD hash so another process's sync is noticed. */
  private async gitIdentities(
    tests: ReturnType<TestVersionsOptions['listTests']>,
  ): Promise<{ ids: Map<string, TestVersionIdentity>; commit: { hash: string; date: string } | null }> {
    const none = { ids: new Map<string, TestVersionIdentity>(), commit: null };
    if (!this.gitSync) return none;
    const gitTests: TestLocation[] = [];
    for (const t of tests) {
      const relPath = t.provenance === 'upstream' ? this.repoRelPath(t.dir) : null;
      if (relPath) gitTests.push({ uuid: t.uuid, relPath });
    }
    if (gitTests.length === 0) return none;
    try {
      const commit = await this.gitSync.commitInfo('HEAD');
      if (this.gitCache && this.gitCache.commit.hash === commit.hash) return this.gitCache;
      const entries = await this.gitSync.listTree('HEAD');
      this.gitCache = { commit, ids: identitiesFromTree(entries, gitTests, commit) };
      return this.gitCache;
    } catch {
      // No readable HEAD: the tests fall back to their folders.
      return none;
    }
  }

  private async loadSynced(): Promise<SyncedSnapshot> {
    const tests = this.listTests();
    const { ids: gitIds, commit } = await this.gitIdentities(tests);
    const now = Date.now();
    if (!this.diskCache || now - this.diskCache.at >= DISK_CACHE_MS) {
      this.diskCache = { at: now, ids: new Map() };
    }
    const identities = new Map<string, TestVersionIdentity>();
    for (const t of tests) {
      const fromGit = gitIds.get(t.uuid);
      if (fromGit) {
        identities.set(t.uuid, fromGit);
        continue;
      }
      let id = this.diskCache.ids.get(t.uuid);
      if (!id) {
        id = this.diskIdentity(t.uuid, t.dir, t.provenance);
        this.diskCache.ids.set(t.uuid, id);
      }
      identities.set(t.uuid, id);
    }
    return { identities, commit };
  }

  /** Version of every test as it is synced: git tests at HEAD, the others from their folders. */
  async synced(): Promise<Map<string, TestVersionIdentity>> {
    return (await this.loadSynced()).identities;
  }

  /** The commit the working copy is at, or null without git. */
  async syncedCommit(): Promise<{ hash: string; date: string } | null> {
    if (!this.gitSync) return null;
    const { commit } = await this.loadSynced();
    if (commit) return commit;
    try {
      return await this.gitSync.commitInfo('HEAD');
    } catch {
      return null;
    }
  }

  /** The last check's result; reloaded from the shared file when another process wrote a newer one. */
  published(): PublishedState {
    if (!this.gitEnabled) return this.state;
    try {
      const mtime = fs.statSync(this.stateFile).mtimeMs;
      if (mtime !== this.loadedMtimeMs) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<StoredState>;
        this.state = {
          checkedAt: raw.checkedAt ?? null,
          commit: raw.commit ?? null,
          commitDate: raw.commitDate ?? null,
          error: raw.error ?? null,
          errorAt: raw.errorAt ?? null,
          byTest: new Map(Object.entries(raw.byTest ?? {})),
          newTests: raw.newTests ?? 0,
        };
        this.loadedMtimeMs = mtime;
      }
    } catch {
      // Missing or unparseable: keep what is in memory.
    }
    return this.state;
  }

  private persist(): void {
    try {
      const stored: StoredState = { ...this.state, byTest: Object.fromEntries(this.state.byTest) };
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
      fs.renameSync(tmp, this.stateFile);
      this.loadedMtimeMs = fs.statSync(this.stateFile).mtimeMs;
    } catch {
      // Not persisted: this process still has the result.
    }
  }

  async current(uuid: string): Promise<{ identity: TestVersionIdentity; modified: boolean } | null> {
    const test = this.listTests().find(t => t.uuid === uuid);
    if (!test) return null;
    const relPath = test.provenance === 'upstream' ? this.repoRelPath(test.dir) : null;
    const identity = (await this.synced()).get(uuid);
    if (!relPath || !this.gitSync || !identity || identity.test_tree === null) {
      // From the folder: the identity already is the current state.
      return { identity: this.diskIdentity(uuid, test.dir, test.provenance), modified: false };
    }
    const shared = sharedInputPrefixes(relPath);
    const changed = await this.gitSync.modifiedTrackedPaths([relPath, ...shared]);
    const dirPrefix = `${relPath}/`;
    const modified = changed.some(p =>
      p.startsWith(dirPrefix) ? isBuildInput(p.slice(dirPrefix.length)) : shared.some(s => matchesPrefix(p, s)),
    );
    return { identity, modified };
  }

  /** Test folders in a published tree: <sourceSubdir>/<uuid> or <sourceSubdir>/<category>/<uuid>. */
  private publishedLocations(entries: Array<{ type: string; path: string }>): TestLocation[] {
    const prefix = `${this.sourceSubdir}/`;
    const out: TestLocation[] = [];
    for (const e of entries) {
      if (e.type !== 'tree' || !e.path.startsWith(prefix)) continue;
      const parts = e.path.slice(prefix.length).split('/');
      const last = parts[parts.length - 1];
      if ((parts.length === 1 || parts.length === 2) && UUID_PATTERN.test(last)) {
        out.push({ uuid: last, relPath: e.path });
      }
    }
    return out;
  }

  /**
   * Fetch the published branch and compare. Resolves with the (possibly
   * unchanged) state; a git failure is recorded in `error`, not thrown.
   */
  async check(): Promise<PublishedState> {
    if (!this.gitSync) return this.state;
    if (this.checking || this.gitSync.isSyncing()) throw new CheckBusyError();
    this.checking = true;
    this.published(); // start from the latest shared result
    try {
      const ref = await this.gitSync.fetchPublished();
      const [entries, commit] = await Promise.all([
        this.gitSync.listTree(ref),
        this.gitSync.commitInfo(ref),
      ]);
      const byTest = identitiesFromTree(entries, this.publishedLocations(entries), commit);
      const local = new Set(this.listTests().map(t => t.uuid));
      let newTests = 0;
      for (const uuid of byTest.keys()) if (!local.has(uuid)) newTests++;
      this.state = {
        checkedAt: new Date().toISOString(),
        commit: commit.hash,
        commitDate: commit.date,
        error: null,
        errorAt: null,
        byTest,
        newTests,
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        error: sanitizeGitError(raw, process.env.GITHUB_TOKEN),
        errorAt: new Date().toISOString(),
      };
    } finally {
      this.checking = false;
    }
    this.persist();
    return this.state;
  }

  /** After a sync or index refresh: the synced versions are stale, and the published check may have changed. */
  afterSync(): void {
    this.gitCache = null;
    this.diskCache = null;
    if (!this.gitEnabled) return;
    this.check().catch(() => { /* busy: the next timer tick checks again */ });
  }

  start(): void {
    if (!this.gitEnabled || process.env.TESTS_UPDATE_CHECK === 'off') return;
    this.stop();
    const run = (): void => { this.check().catch(() => { /* busy */ }); };
    this.firstTimer = setTimeout(() => {
      run();
      this.interval = setInterval(run, CHECK_INTERVAL_MS);
      this.interval.unref();
    }, FIRST_CHECK_MS);
    this.firstTimer.unref();
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
    this.firstTimer = undefined;
    this.interval = undefined;
  }
}

let instance: TestVersionsService | undefined;

export function setTestVersionsService(s: TestVersionsService | undefined): void {
  instance = s;
}

export function getTestVersionsService(): TestVersionsService | undefined {
  return instance;
}
