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
  pull: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
}

describe('TestVersionsService', () => {
  let tmp: string;
  let repo: string;
  let fake: Fake;
  let customDir: string;

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
      pull: vi.fn(),
      sync: vi.fn(),
    };
    delete process.env.TESTS_UPDATE_CHECK;
  });

  afterEach(() => {
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
    expect(state.error).toContain('fetch failed');
    expect(state.error).not.toContain('s3cret');
    expect(state.errorAt).not.toBeNull();
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
      expect(state.error).toContain('lock held');
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
      const svc = makeService();
      expect((await svc.synced()).get(UUID_A)?.commit).toBe('c0ffee');
      fake.commitInfo.mockImplementation(async (ref: string) =>
        ref === 'HEAD' ? { hash: 'newhead', date: COMMIT.date } : REMOTE);
      expect((await svc.synced()).get(UUID_A)?.commit).toBe('newhead');
      expect(headCalls()).toBe(2);
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
