import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { GitSyncService, MAX_TREE_LISTING_BYTES, gitChildEnv } from '../gitSyncService.js';
import { TreeTooLargeError } from '../versionIdentity.js';

// A real repository and the real git: the limit is about what git prints, and
// about stopping git, so neither is mocked here.
describe('GitSyncService.listTree against a real repository', () => {
  let repo: string;
  let service: GitSyncService;
  const FILES = 400;

  // The environment for the test's own git commands. Every GIT_* variable of
  // the surrounding process is dropped (gitChildEnv): this suite also runs
  // from the pre-commit hook, where git sets GIT_DIR and GIT_INDEX_FILE to the
  // real repository, and a `git init` or `git commit` that inherited them
  // would act on that repository instead of the temp one.
  const gitEnv = (): Record<string, string> => ({
    ...gitChildEnv(),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  });

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv() });

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'listtree-'));
    git('init', '-q', '-b', 'main');
    // Stop before `add` and `commit` unless git is working in the temp repository.
    const gitDir = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-dir').trim()));
    if (gitDir !== path.join(fs.realpathSync(repo), '.git')) {
      throw new Error(`git is not using the temp repository (git dir: ${gitDir})`);
    }
    const dir = path.join(repo, 'tests_source', 'intel-driven', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < FILES; i++) fs.writeFileSync(path.join(dir, `file-${i}.go`), `package main // ${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'files');
    service = new GitSyncService({ repoUrl: 'https://example.invalid/repo.git', branch: 'main', localPath: repo });
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('lists every blob and tree of a repository within the limit', async () => {
    const entries = await service.listTree('HEAD');

    expect(entries.filter(e => e.type === 'blob')).toHaveLength(FILES);
    expect(entries.filter(e => e.type === 'tree').map(e => e.path)).toEqual([
      'tests_source',
      'tests_source/intel-driven',
      'tests_source/intel-driven/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ]);
    expect(entries[entries.length - 1].hash).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('stops git and refuses a listing larger than the limit', async () => {
    const full = Buffer.byteLength(git('ls-tree', '-r', '-t', '-z', 'HEAD'));
    expect(full).toBeGreaterThan(20_000);

    await expect(service.listTree('HEAD', 4096)).rejects.toBeInstanceOf(TreeTooLargeError);
    // One byte under the full size is still too large; the full size is not.
    await expect(service.listTree('HEAD', full - 1)).rejects.toBeInstanceOf(TreeTooLargeError);
    await expect(service.listTree('HEAD', full)).resolves.toHaveLength(FILES + 3);
  });

  it('still reports a git failure as a git failure', async () => {
    const failure = await service.listTree('no-such-ref').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TreeTooLargeError);
  });

  it('the default limit is far above the listing of the library today (about 0.3 MB)', () => {
    expect(MAX_TREE_LISTING_BYTES).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  });
});
