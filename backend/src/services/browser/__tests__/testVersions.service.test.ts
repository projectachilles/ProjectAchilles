import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  TestVersionsService,
  CheckBusyError,
  setTestVersionsService,
  getTestVersionsService,
} from '../testVersions.service.js';
import type { GitSyncService } from '../gitSyncService.js';
import type { TreeEntry } from '../versionIdentity.js';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_NEW = 'c1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_CUSTOM = 'd1b2c3d4-e5f6-7890-abcd-ef1234567890';
const COMMIT = { hash: 'c0ffee', date: '2026-11-01T10:00:00+00:00' };
const REMOTE = { hash: 'beef01', date: '2026-11-20T10:00:00+00:00' };

function blob(p: string, hash: string): TreeEntry {
  return { type: 'blob', hash, path: p };
}

function treeFor(uuid: string, hash: string): TreeEntry[] {
  const rel = `tests_source/intel-driven/${uuid}`;
  return [
    { type: 'tree', hash: `t-${hash}`, path: rel },
    blob(`${rel}/${uuid}.go`, hash),
    blob(`${rel}/README.md`, 'readme'),
  ];
}

interface Fake {
  fetchPublished: ReturnType<typeof vi.fn>;
  listTree: ReturnType<typeof vi.fn>;
  commitInfo: ReturnType<typeof vi.fn>;
  modifiedTrackedPaths: ReturnType<typeof vi.fn>;
  isSyncing: ReturnType<typeof vi.fn>;
  getRepoPath: ReturnType<typeof vi.fn>;
  publishedRef: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
}

/** Frozen clock for the HEAD cache: step past its 5 s window. */
function clockAt0(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
}
function pastHeadCache(): void {
  vi.setSystemTime(Date.now() + 6000);
}

describe('TestVersionsService', () => {
  let tmp: string;
  let repo: string;
  let fake: Fake;
  let customDir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  function makeService(opts: { git?: boolean; embed?: (uuid: string) => string[]; jitter?: number } = {}): TestVersionsService {
    return new TestVersionsService({
      gitSync: opts.git === false ? undefined : (fake as unknown as GitSyncService),
      sourceSubdir: 'tests_source',
      listTests: () => [
        { uuid: UUID_A, dir: path.join(repo, 'tests_source', 'intel-driven', UUID_A), provenance: 'upstream' },
        { uuid: UUID_CUSTOM, dir: customDir, provenance: 'custom' },
      ],
      embedDependencyFiles: opts.embed,
      startJitterMs: opts.jitter,
      stateFile: path.join(tmp, 'state', 'published.json'),
    });
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'));
    repo = path.join(tmp, 'repo');
    customDir = path.join(tmp, 'custom', UUID_CUSTOM);
    fs.mkdirSync(path.join(repo, 'tests_source', 'intel-driven', UUID_A), { recursive: true });
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'main.go'), 'package main\n');
    fake = {
      fetchPublished: vi.fn().mockResolvedValue('origin/main'),
      listTree: vi.fn().mockImplementation(async (ref: string) =>
        ref === 'HEAD'
          ? treeFor(UUID_A, 'h1')
          : [...treeFor(UUID_A, 'h2'), ...treeFor(UUID_NEW, 'h3')]),
      commitInfo: vi.fn().mockImplementation(async (ref: string) => (ref === 'HEAD' ? COMMIT : REMOTE)),
      modifiedTrackedPaths: vi.fn().mockResolvedValue([]),
      isSyncing: vi.fn().mockReturnValue(false),
      getRepoPath: vi.fn().mockReturnValue(repo),
      publishedRef: vi.fn().mockReturnValue('origin/main'),
      pull: vi.fn(),
      sync: vi.fn(),
    };
    delete process.env.TESTS_UPDATE_CHECK;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    delete process.env.TESTS_UPDATE_CHECK;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('check() calls fetchPublished, then listTree and commitInfo with the returned ref, and never pull/sync', async () => {
    const svc = makeService();
    const state = await svc.check();
    expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
    expect(fake.listTree).toHaveBeenCalledWith('origin/main');
    expect(fake.commitInfo).toHaveBeenCalledWith('origin/main');
    expect(fake.pull).not.toHaveBeenCalled();
    expect(fake.sync).not.toHaveBeenCalled();
    expect(state.commit).toBe('beef01');
    expect(state.commitDate).toBe(REMOTE.date);
    expect(state.checkedAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(state.byTest.get(UUID_A)?.commit).toBe('beef01');
    expect(svc.published().commit).toBe('beef01');
  });

  it('a failed check keeps the previous byTest and commit, sets error and errorAt', async () => {
    const svc = makeService();
    await svc.check();
    fake.fetchPublished.mockRejectedValue(new Error('fetch failed: https://user:s3cret@example.invalid/x.git'));
    const state = await svc.check();
    expect(state.commit).toBe('beef01');
    expect(state.byTest.has(UUID_A)).toBe(true);
    expect(state.error).toBe('The update check failed');
    expect(state.errorAt).not.toBeNull();
  });

  describe('check error text', () => {
    it.each([
      ["fatal: unable to access 'https://example.invalid/lib.git/': Could not resolve host: example.invalid", 'Could not reach the test repository'],
      ["fatal: unable to access 'https://example.invalid/lib.git/': Failed to connect to example.invalid port 443: Connection timed out", 'Could not reach the test repository'],
      ['getaddrinfo EAI_AGAIN example.invalid', 'Could not reach the test repository'],
      ["fatal: unable to access 'https://example.invalid/lib.git/': The requested URL returned error: 403", 'The test repository rejected the credentials'],
      ["remote: Invalid username or token.\nfatal: Authentication failed for 'https://example.invalid/lib.git/'", 'The test repository rejected the credentials'],
      ["fatal: could not read Username for 'https://example.invalid': terminal prompts disabled", 'The test repository rejected the credentials'],
      ["fatal: Unable to create '/srv/clone/.git/shallow.lock': File exists.", 'The update check failed'],
      ['fatal: bad object refs/remotes/origin/main', 'The update check failed'],
    ])('%s -> %s', async (message, expected) => {
      fake.fetchPublished.mockRejectedValue(new Error(message));
      const state = await makeService().check();
      expect(state.error).toBe(expected);
      expect(makeService().published().error).toBe(expected);
    });

    it('stores no repository URL, path or credential, and logs the sanitized detail once', async () => {
      fake.fetchPublished.mockRejectedValue(
        new Error("fatal: unable to access 'https://user:s3cret@example.invalid/lib.git/': Could not resolve host"),
      );
      const state = await makeService().check();
      expect(state.error).toBe('Could not reach the test repository');
      expect(fs.readFileSync(path.join(tmp, 'state', 'published.json'), 'utf8')).not.toContain('example.invalid');
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('Could not resolve host');
      expect(logged).not.toContain('s3cret');
    });
  });

  it('a failed check keeps a newer good result another process wrote while it ran', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
    const a = makeService();
    let fail: (e: Error) => void = () => undefined;
    fake.fetchPublished.mockReturnValueOnce(new Promise<string>((_r, reject) => { fail = reject; }));
    const running = a.check();

    vi.setSystemTime(new Date('2026-11-23T10:00:05Z'));
    await makeService().check(); // another process, same state file: succeeds

    vi.setSystemTime(new Date('2026-11-23T10:00:10Z'));
    fail(new Error('Could not resolve host'));
    const state = await running;

    expect(state.error).toBeNull();
    expect(state.commit).toBe('beef01');
    expect(state.checkedAt).toBe('2026-11-23T10:00:05.000Z');
    const shared = makeService().published();
    expect(shared.error).toBeNull();
    expect(shared.errorAt).toBeNull();
    expect(shared.checkedAt).toBe('2026-11-23T10:00:05.000Z');
  });

  it('a failed check after an older good result still records the error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
    await makeService().check();
    vi.setSystemTime(new Date('2026-11-23T11:00:00Z'));
    fake.fetchPublished.mockRejectedValue(new Error('Could not resolve host'));
    const state = await makeService().check();
    expect(state.error).toBe('Could not reach the test repository');
    expect(state.checkedAt).toBe('2026-11-23T10:00:00.000Z');
    expect(makeService().published().error).toBe('Could not reach the test repository');
  });

  describe('recordPublishedFromLocal (after a Sync)', () => {
    it('records what the sync fetched as the published version, without a network call', async () => {
      const svc = makeService();
      await svc.check(); // published = beef01
      // Sync: the remote moved on, pull() fetched it and reset HEAD to it.
      const synced = { hash: 'beef99', date: '2026-11-23T09:00:00+00:00' };
      fake.commitInfo.mockImplementation(async () => synced);
      fake.listTree.mockImplementation(async () => treeFor(UUID_A, 'h9'));
      fake.fetchPublished.mockClear();

      await svc.recordPublishedFromLocal();

      expect(fake.fetchPublished).not.toHaveBeenCalled();
      expect(fake.listTree).toHaveBeenCalledWith('origin/main');
      expect(fake.commitInfo).toHaveBeenCalledWith('origin/main');
      const state = svc.published();
      expect(state.commit).toBe((await svc.syncedCommit())!.hash);
      expect(state.commit).toBe('beef99');
      expect(state.error).toBeNull();
      expect(state.newTests).toBe(0);
      expect(state.byTest.get(UUID_A)?.fingerprint).toBe((await svc.synced()).get(UUID_A)?.fingerprint);
      // persisted for the other processes
      expect(makeService().published().commit).toBe('beef99');
    });

    it('drops the synced caches', async () => {
      const svc = makeService();
      await svc.synced();
      const headCalls = () => fake.listTree.mock.calls.filter(c => c[0] === 'HEAD').length;
      expect(headCalls()).toBe(1);
      await svc.recordPublishedFromLocal();
      await svc.synced();
      expect(headCalls()).toBe(2);
    });

    it('does nothing without git', async () => {
      const svc = makeService({ git: false });
      await svc.recordPublishedFromLocal();
      expect(svc.published().checkedAt).toBeNull();
      expect(fake.listTree).not.toHaveBeenCalled();
    });

    it('while a check runs, it records again from the local ref once that check ends', async () => {
      const svc = makeService();
      let release: (ref: string) => void = () => undefined;
      fake.fetchPublished.mockReturnValueOnce(new Promise<string>(r => { release = r; }));
      const running = svc.check();
      await svc.recordPublishedFromLocal();
      const localReads = () => fake.listTree.mock.calls.filter(c => c[0] === 'origin/main').length;
      expect(localReads()).toBe(1);
      release('origin/main');
      await running;
      expect(localReads()).toBe(3); // the check's own read, then the local re-read
      expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
    });
  });

  it('with TESTS_UPDATE_CHECK=off, afterSync() only drops the caches', async () => {
    process.env.TESTS_UPDATE_CHECK = 'off';
    const svc = makeService();
    svc.afterSync();
    await new Promise(r => setTimeout(r, 20));
    expect(fake.fetchPublished).not.toHaveBeenCalled();
  });

  it('a git test whose HEAD tree cannot be read gets no identity; custom tests keep theirs', async () => {
    fake.listTree.mockRejectedValue(new Error('fatal: bad object HEAD'));
    const svc = makeService();
    const synced = await svc.synced();
    expect(synced.has(UUID_A)).toBe(false);
    expect(synced.get(UUID_CUSTOM)?.provenance).toBe('custom');
    await expect(svc.current(UUID_A)).rejects.toThrow('bad object');
  });

  describe('syncedError (the synced library could not be read)', () => {
    it('is null before any read and after a successful one', async () => {
      const svc = makeService();
      expect(svc.syncedError()).toBeNull();
      await svc.synced();
      expect(svc.syncedError()).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('is set when the HEAD tree or commit cannot be read for git tests, and cleared by the next successful read', async () => {
      clockAt0();
      const svc = makeService();
      fake.listTree.mockRejectedValueOnce(new Error('fatal: bad object HEAD'));
      const synced = await svc.synced();
      expect(synced.has(UUID_A)).toBe(false);
      expect(svc.syncedError()).toBe('The test library could not be read');

      await svc.synced();
      expect(svc.syncedError()).toBeNull();

      pastHeadCache();
      fake.commitInfo.mockRejectedValueOnce(new Error('fatal: ambiguous argument HEAD'));
      await svc.synced();
      expect(svc.syncedError()).toBe('The test library could not be read');
    });

    it('logs the sanitized detail once for repeated identical failures, and again for a different one', async () => {
      clockAt0();
      const svc = makeService();
      fake.listTree.mockRejectedValue(new Error("fatal: unable to read tree in 'https://user:s3cret@example.invalid/lib.git'"));
      await svc.synced();
      await svc.synced();
      await svc.syncedCommit();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('unable to read tree');
      expect(logged).not.toContain('s3cret');

      fake.listTree.mockRejectedValue(new Error('fatal: bad object HEAD'));
      await svc.synced();
      await svc.synced();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1].map(String).join(' ')).toContain('bad object');

      // After a good read, the same failure is news again (HEAD's tree is
      // cached now, so it is the commit read that fails).
      fake.listTree.mockResolvedValue(treeFor(UUID_A, 'h1'));
      await svc.synced();
      expect(svc.syncedError()).toBeNull();
      pastHeadCache();
      fake.commitInfo.mockRejectedValueOnce(new Error('fatal: bad object HEAD'));
      await svc.synced();
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('stays null without git (every test is read from its folder)', async () => {
      fake.listTree.mockRejectedValue(new Error('fatal: bad object HEAD'));
      const svc = makeService({ git: false });
      await svc.synced();
      expect(svc.syncedError()).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('a git test missing from the HEAD tree gets no identity and no stamp', async () => {
    fake.listTree.mockResolvedValue([]);
    const svc = makeService();
    expect((await svc.synced()).has(UUID_A)).toBe(false);
    expect(await svc.current(UUID_A)).toBeNull();
  });

  it('current() of a custom test reads only that test, and never git', async () => {
    const embed = vi.fn(() => [] as string[]);
    const svc = makeService({ embed });
    const cur = await svc.current(UUID_CUSTOM);
    expect(cur?.identity.provenance).toBe('custom');
    expect(cur?.modified).toBe(false);
    expect(embed.mock.calls).toEqual([[UUID_CUSTOM]]);
    expect(fake.listTree).not.toHaveBeenCalled();
    expect(fake.commitInfo).not.toHaveBeenCalled();
  });

  it('current() of a git test uses the cached tree identities and reads no folder', async () => {
    const embed = vi.fn(() => [] as string[]);
    const svc = makeService({ embed });
    const first = await svc.current(UUID_A);
    const second = await svc.current(UUID_A);
    expect(first?.identity.commit).toBe('c0ffee');
    expect(second?.identity).toEqual(first?.identity);
    expect(fake.listTree.mock.calls.filter(c => c[0] === 'HEAD')).toHaveLength(1);
    expect(embed).not.toHaveBeenCalled();
  });

  it('check() while another check runs, or while gitSync.isSyncing(), rejects with CheckBusyError', async () => {
    const svc = makeService();
    let release: (ref: string) => void = () => undefined;
    fake.fetchPublished.mockReturnValue(new Promise<string>(r => { release = r; }));
    const first = svc.check();
    await expect(svc.check()).rejects.toBeInstanceOf(CheckBusyError);
    release('origin/main');
    await first;

    fake.fetchPublished.mockResolvedValue('origin/main');
    fake.isSyncing.mockReturnValue(true);
    await expect(svc.check()).rejects.toBeInstanceOf(CheckBusyError);
  });

  it('uuids present at the published ref and not locally are counted in newTests; locally-only tests are not flagged', async () => {
    const svc = makeService();
    const state = await svc.check();
    expect(state.newTests).toBe(1);
    expect(state.byTest.has(UUID_NEW)).toBe(true);
    expect(state.byTest.has(UUID_CUSTOM)).toBe(false);
  });

  it('custom tests and all tests when gitSync is undefined get disk identities; published() stays empty; check() resolves without calling git', async () => {
    const svc = makeService({ git: false });
    expect(svc.gitEnabled).toBe(false);
    const synced = await svc.synced();
    expect(synced.get(UUID_CUSTOM)?.provenance).toBe('custom');
    expect(synced.get(UUID_CUSTOM)?.test_tree).toBeNull();
    const state = await svc.check();
    expect(state.byTest.size).toBe(0);
    expect(state.checkedAt).toBeNull();
    expect(svc.published().byTest.size).toBe(0);
    expect(fake.fetchPublished).not.toHaveBeenCalled();
    expect(fake.listTree).not.toHaveBeenCalled();
    expect(await svc.syncedCommit()).toBeNull();
  });

  it('with git, synced() reads HEAD for upstream tests and the disk for custom ones', async () => {
    const svc = makeService();
    const synced = await svc.synced();
    expect(synced.get(UUID_A)?.commit).toBe('c0ffee');
    expect(synced.get(UUID_A)?.provenance).toBe('upstream');
    expect(synced.get(UUID_CUSTOM)?.provenance).toBe('custom');
    expect(fake.listTree).toHaveBeenCalledWith('HEAD');
    expect(await svc.syncedCommit()).toEqual(COMMIT);
  });

  it('uploaded embed dependencies do not change a disk identity', async () => {
    const withDep = makeService({ git: false, embed: () => ['validator.dat'] });
    const before = (await withDep.synced()).get(UUID_CUSTOM)!.fingerprint;
    fs.writeFileSync(path.join(customDir, 'validator.dat'), 'blob');
    const after = (await makeService({ git: false, embed: () => ['validator.dat'] }).synced()).get(UUID_CUSTOM)!.fingerprint;
    expect(after).toBe(before);
    const cur = await makeService({ git: false, embed: () => ['validator.dat'] }).current(UUID_CUSTOM);
    expect(cur?.identity.fingerprint).toBe(before);
    expect(cur?.modified).toBe(false);
  });

  it('current(uuid).modified is true only when modifiedTrackedPaths returns a build-input path', async () => {
    const svc = makeService();
    const rel = `tests_source/intel-driven/${UUID_A}`;
    fake.modifiedTrackedPaths.mockResolvedValue([`${rel}/README.md`]);
    expect((await svc.current(UUID_A))?.modified).toBe(false);
    fake.modifiedTrackedPaths.mockResolvedValue([`${rel}/${UUID_A}.go`]);
    const cur = await svc.current(UUID_A);
    expect(cur?.modified).toBe(true);
    expect(cur?.identity.commit).toBe('c0ffee');
    fake.modifiedTrackedPaths.mockResolvedValue(['preludeorg-libraries/lib.go']);
    expect((await svc.current(UUID_A))?.modified).toBe(true);
    expect(fake.modifiedTrackedPaths.mock.calls[0][0]).toContain(rel);
    expect(await svc.current('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('timer: first check at 2 min, next at +6 h', async () => {
    vi.useFakeTimers();
    const svc = makeService();
    svc.start();
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
    expect(fake.fetchPublished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 3_600_000 - 1);
    expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.fetchPublished).toHaveBeenCalledTimes(2);
    svc.stop();
    await vi.advanceTimersByTimeAsync(7 * 3_600_000);
    expect(fake.fetchPublished).toHaveBeenCalledTimes(2);
  });

  it('timer: none with TESTS_UPDATE_CHECK=off, but check() still works', async () => {
    vi.useFakeTimers();
    process.env.TESTS_UPDATE_CHECK = 'off';
    const svc = makeService();
    svc.start();
    await vi.advanceTimersByTimeAsync(7 * 3_600_000);
    expect(fake.fetchPublished).not.toHaveBeenCalled();
    await svc.check();
    expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
  });

  it('afterSync invalidates synced()', async () => {
    process.env.TESTS_UPDATE_CHECK = 'off';
    const svc = makeService();
    await svc.synced();
    await svc.synced();
    expect(fake.listTree.mock.calls.filter(c => c[0] === 'HEAD')).toHaveLength(1);
    svc.afterSync();
    await svc.synced();
    expect(fake.listTree.mock.calls.filter(c => c[0] === 'HEAD')).toHaveLength(2);
  });

  it('afterSync starts a published check in the background', async () => {
    const svc = makeService();
    svc.afterSync();
    await vi.waitFor(() => expect(svc.published().commit).toBe('beef01'));
  });

  describe('shared state across processes', () => {
    const stateFile = () => path.join(tmp, 'state', 'published.json');

    it('a second service instance pointed at the same state file returns the first instance\'s check result from published()', async () => {
      await makeService().check();
      const other = makeService();
      const state = other.published();
      expect(state.commit).toBe('beef01');
      expect(state.newTests).toBe(1);
      expect(state.byTest.get(UUID_NEW)?.commit).toBe('beef01');
      expect(fs.statSync(stateFile()).mode & 0o777).toBe(0o600);
    });

    it('a failed check is persisted with its error and keeps the previous byTest', async () => {
      const first = makeService();
      await first.check();
      fake.fetchPublished.mockRejectedValue(new Error('lock held'));
      await first.check();
      const state = makeService().published();
      expect(state.error).toBe('The update check failed');
      expect(state.errorAt).not.toBeNull();
      expect(state.byTest.has(UUID_A)).toBe(true);
      expect(state.commit).toBe('beef01');
    });

    it('an unparseable or missing state file leaves published() at its current state and does not throw', async () => {
      const svc = makeService();
      expect(() => svc.published()).not.toThrow();
      expect(svc.published().checkedAt).toBeNull();
      await svc.check();
      fs.writeFileSync(stateFile(), '{not json');
      expect(svc.published().commit).toBe('beef01');
      fs.rmSync(stateFile());
      expect(svc.published().commit).toBe('beef01');
    });

    it('the state file is written with a temp-file-then-rename', async () => {
      const svc = makeService();
      await svc.check();
      // A half-written temp file left by a crashed writer is never read as the state.
      fs.writeFileSync(`${stateFile()}.9999.tmp`, '{"commit": "tru');
      const before = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
      expect(before.commit).toBe('beef01');
      fake.commitInfo.mockImplementation(async (ref: string) =>
        ref === 'HEAD' ? COMMIT : { hash: 'beef02', date: REMOTE.date });
      await svc.check();
      expect(JSON.parse(fs.readFileSync(stateFile(), 'utf8')).commit).toBe('beef02');
      expect(fs.readdirSync(path.dirname(stateFile())).filter(f => f.includes(String(process.pid)))).toEqual([]);
      expect(makeService().published().commit).toBe('beef02');
    });
  });

  describe('synced cache', () => {
    const headCalls = () => fake.listTree.mock.calls.filter(c => c[0] === 'HEAD').length;

    it('synced() recomputes when HEAD changes without afterSync() being called', async () => {
      clockAt0();
      const svc = makeService();
      expect((await svc.synced()).get(UUID_A)?.commit).toBe('c0ffee');
      pastHeadCache();
      fake.commitInfo.mockImplementation(async (ref: string) =>
        ref === 'HEAD' ? { hash: 'newhead', date: COMMIT.date } : REMOTE);
      expect((await svc.synced()).get(UUID_A)?.commit).toBe('newhead');
      expect(headCalls()).toBe(2);
    });

    describe('HEAD cache (5 s)', () => {
      const headReads = () => fake.commitInfo.mock.calls.filter(c => c[0] === 'HEAD').length;

      it('two calls within 5 s read HEAD once; a call after 5 s reads it again', async () => {
        clockAt0();
        const svc = makeService();
        await svc.synced();
        vi.setSystemTime(Date.now() + 4900);
        await svc.synced();
        expect(headReads()).toBe(1);
        vi.setSystemTime(Date.now() + 200);
        await svc.synced();
        expect(headReads()).toBe(2);
      });

      it('afterSync() clears it', async () => {
        process.env.TESTS_UPDATE_CHECK = 'off';
        clockAt0();
        const svc = makeService();
        await svc.synced();
        svc.afterSync();
        await svc.synced();
        expect(headReads()).toBe(2);
      });

      it('recordPublishedFromLocal() clears it', async () => {
        clockAt0();
        const svc = makeService();
        await svc.synced();
        await svc.recordPublishedFromLocal();
        await svc.synced();
        expect(headReads()).toBe(2);
      });

      it('current() reads HEAD live: a HEAD change within 5 s shows in its commit and fingerprint', async () => {
        clockAt0();
        const svc = makeService();
        const before = await svc.current(UUID_A);
        fake.commitInfo.mockImplementation(async (ref: string) =>
          ref === 'HEAD' ? { hash: 'newhead', date: COMMIT.date } : REMOTE);
        fake.listTree.mockImplementation(async (ref: string) =>
          ref === 'HEAD' ? treeFor(UUID_A, 'h9') : []);
        const after = await svc.current(UUID_A);
        expect(before?.identity.commit).toBe('c0ffee');
        expect(after?.identity.commit).toBe('newhead');
        expect(after?.identity.fingerprint).not.toBe(before?.identity.fingerprint);
      });

      it('a synced() just before current() does not make current() return the stale commit', async () => {
        clockAt0();
        const svc = makeService();
        await svc.synced();
        fake.commitInfo.mockImplementation(async (ref: string) =>
          ref === 'HEAD' ? { hash: 'newhead', date: COMMIT.date } : REMOTE);
        const cur = await svc.current(UUID_A);
        expect(cur?.identity.commit).toBe('newhead');
      });

      it('after current() saw a new HEAD, synced() returns identities for it', async () => {
        clockAt0();
        const svc = makeService();
        await svc.synced();
        fake.commitInfo.mockImplementation(async (ref: string) =>
          ref === 'HEAD' ? { hash: 'newhead', date: COMMIT.date } : REMOTE);
        await svc.current(UUID_A);
        expect((await svc.synced()).get(UUID_A)?.commit).toBe('newhead');
      });

      it('does not cache a failed read', async () => {
        clockAt0();
        const svc = makeService();
        fake.commitInfo.mockRejectedValueOnce(new Error('fatal: bad HEAD'));
        await svc.synced();
        await svc.synced();
        expect(headReads()).toBe(2);
      });
    });

    it('does not call listTree again when HEAD is unchanged', async () => {
      const svc = makeService();
      await svc.synced();
      await svc.synced();
      expect(headCalls()).toBe(1);
    });

    it('disk identities are reused within 30 s and recomputed after', async () => {
      vi.useFakeTimers();
      const svc = makeService({ git: false });
      const first = (await svc.synced()).get(UUID_CUSTOM)!.fingerprint;
      fs.writeFileSync(path.join(customDir, 'main.go'), 'package main\n// changed\n');
      await vi.advanceTimersByTimeAsync(29_000);
      expect((await svc.synced()).get(UUID_CUSTOM)!.fingerprint).toBe(first);
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await svc.synced()).get(UUID_CUSTOM)!.fingerprint).not.toBe(first);
    });
  });

  describe('timed checks', () => {
    it('a timed check is skipped when the state file shows a check finished < 10 min ago by another instance, and runs when it is older', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
      await makeService().check(); // writes checkedAt = 10:00
      const other = makeService();
      other.start();
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(fake.fetchPublished).toHaveBeenCalledTimes(1); // only the first instance's
      // next tick is 6 h later: the shared result is older than 10 min
      await vi.advanceTimersByTimeAsync(6 * 3_600_000);
      expect(fake.fetchPublished).toHaveBeenCalledTimes(2);
      other.stop();
    });

    it('an on-demand check() runs even when another instance checked a minute ago', async () => {
      await makeService().check();
      await makeService().check();
      expect(fake.fetchPublished).toHaveBeenCalledTimes(2);
    });

    it('startJitterMs delays the first timed check by at most that much', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const svc = makeService({ jitter: 60_000 });
      svc.start();
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 29_999);
      expect(fake.fetchPublished).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
      svc.stop();
      vi.mocked(Math.random).mockRestore();
    });

    it('afterSync() during a running check triggers exactly one more check after it finishes', async () => {
      const svc = makeService();
      let release: (ref: string) => void = () => undefined;
      fake.fetchPublished.mockReturnValueOnce(new Promise<string>(r => { release = r; }));
      const first = svc.check();
      svc.afterSync();
      svc.afterSync();
      expect(fake.fetchPublished).toHaveBeenCalledTimes(1);
      release('origin/main');
      await first;
      await vi.waitFor(() => expect(fake.fetchPublished).toHaveBeenCalledTimes(2));
      await new Promise(r => setTimeout(r, 20));
      expect(fake.fetchPublished).toHaveBeenCalledTimes(2);
    });
  });

  it('set/get registry', () => {
    const svc = makeService();
    setTestVersionsService(svc);
    expect(getTestVersionsService()).toBe(svc);
    setTestVersionsService(undefined);
    expect(getTestVersionsService()).toBeUndefined();
  });
});
