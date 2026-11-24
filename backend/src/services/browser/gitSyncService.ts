// Service to sync tests from GitHub repository

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, CleanOptions } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { isUsableSourceRoot } from './repositoryRoot.js';
import { TreeTooLargeError } from './versionIdentity.js';

/**
 * Non-`git*` variables simple-git v4 also guards (mirrors `GitEnvKeys` in
 * @simple-git/argv-parser). Each one can make git run an arbitrary program.
 */
const GUARDED_NON_GIT_ENV_KEYS = new Set(['editor', 'visual', 'pager', 'prefix', 'ssh_askpass']);

/**
 * Environment for git child processes: the ambient env minus every variable
 * simple-git v4 guards, plus a hard GIT_TERMINAL_PROMPT=0.
 *
 * v4 strips guarded variables (all `git*` keys and the set above) from the
 * child unless allow-listed, and THROWS if one is passed explicitly via
 * `.env()` — so a plain `{ ...process.env }` would crash on any shell that
 * sets EDITOR or PAGER. Stripping them also prevents ambient Git
 * configuration or credentials from reaching the child. GitSyncService adds
 * only its own command-scoped HTTP authentication variables when configured.
 *
 * GIT_TERMINAL_PROMPT=0 is enforced here rather than inherited from
 * scripts/start.sh so that no launch path can make a missing or expired token
 * on a private repo hang the sync on a username prompt.
 */
export function gitChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = key.toLowerCase().trim();
    if (value === undefined || normalized.startsWith('git') || GUARDED_NON_GIT_ENV_KEYS.has(normalized)) {
      continue;
    }
    env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

const AUTH_ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];

/**
 * Most that `git ls-tree` may print for listTree(). The library's listing is
 * about 0.3 MB (2,000 entries); 64 MB is roughly 500,000 entries.
 */
export const MAX_TREE_LISTING_BYTES = 64 * 1024 * 1024;

/** Every simple-git instance this service uses goes through here. */
export function createGit(
  baseDir?: string,
  githubToken?: string,
  extraEnv: Record<string, string> = {},
  /** Aborting it kills the running git command (simple-git's abort plugin). */
  abort?: AbortSignal,
): SimpleGit {
  const env = gitChildEnv();
  const allowEnvironment = ['GIT_TERMINAL_PROMPT'];

  // Callers' own, fixed variables (e.g. GIT_NO_LAZY_FETCH). Never ambient ones.
  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
    allowEnvironment.push(key);
  }

  if (!githubToken) {
    return simpleGit({ baseDir, allowEnvironment, ...(abort ? { abort } : {}) }).env(env);
  }

  // Keep credentials out of command arguments, repository remotes, and
  // simple-git's diagnostic-bearing task metadata. Git reads this config
  // only from the environment of the command-scoped child process.
  const basicCredential = Buffer.from(`x-access-token:${githubToken}`, 'utf8').toString('base64');
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
  env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basicCredential}`;
  allowEnvironment.push(...AUTH_ENV_KEYS);

  // simple-git 4.0.x has two gates: allowEnvironment stops the keys being
  // stripped, and GIT_CONFIG_COUNT is also refused outright unless this flag
  // is set. The flag is on only for a token, and the only config passed is
  // the one built above (ambient GIT_CONFIG_* is dropped by gitChildEnv).
  return simpleGit({
    baseDir,
    allowEnvironment,
    unsafe: { allowUnsafeConfigEnvCount: true },
    ...(abort ? { abort } : {}),
  }).env(env);
}

/**
 * Redact the configured credential in every representation this service sends
 * to Git, plus URL userinfo from clones created by older versions.
 */
export function sanitizeGitError(message: string, githubToken?: string): string {
  const marker = '\u0000GIT_CREDENTIAL\u0000';
  let sanitized = message;

  if (githubToken) {
    const url = new URL('https://credential.invalid');
    url.username = githubToken;

    const basicCredential = Buffer.from(`x-access-token:${githubToken}`, 'utf8').toString('base64');
    const representations = [
      githubToken,
      url.username,
      Buffer.from(githubToken, 'utf8').toString('base64'),
      Buffer.from(githubToken, 'utf8').toString('base64url'),
      basicCredential,
      Buffer.from(`x-access-token:${githubToken}`, 'utf8').toString('base64url'),
    ];
    const values = new Set<string>();

    for (const representation of representations) {
      for (const value of [representation, encodeURIComponent(representation)]) {
        values.add(value);
        values.add(value.replace(/%[0-9A-F]{2}/g, match => match.toLowerCase()));
      }
    }

    for (const value of [...values].filter(Boolean).sort((a, b) => b.length - a.length)) {
      sanitized = sanitized.split(value).join(marker);
    }
  }

  // Protect credentials left in an existing remote by an older deployment,
  // or supplied directly in the configured repository URL.
  sanitized = sanitized.replace(/(https?:\/\/)[^\s/@]+@/gi, `$1${marker}@`);
  return sanitized.split(marker).join('[TOKEN]');
}

/** One line of `git ls-tree -r -t`: blobs and trees only (submodule commits are skipped). */
export interface GitTreeEntry {
  type: 'blob' | 'tree';
  hash: string;
  path: string;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  commitHash: string | null;
  branch: string;
  status: 'synced' | 'syncing' | 'error' | 'never_synced';
  error?: string;
  testCount?: number;
}

export interface GitSyncConfig {
  repoUrl: string;
  branch: string;
  localPath: string;
  githubToken?: string;
  sparseCheckoutPaths?: string[];
  sourceSubdir?: string;
}

export class GitSyncService {
  private config: GitSyncConfig;
  private syncStatus: SyncStatus;

  constructor(config: GitSyncConfig) {
    this.config = {
      ...config,
      localPath: path.resolve(config.localPath),
    };

    this.syncStatus = {
      lastSyncTime: null,
      commitHash: null,
      branch: config.branch,
      status: 'never_synced',
    };
  }

  /**
   * Check if the local repository exists
   */
  public repoExists(): boolean {
    const gitDir = path.join(this.config.localPath, '.git');
    return fs.existsSync(gitDir);
  }

  /** The configured remote URL (may carry credentials: never send it to a client as is). */
  public getRepoUrl(): string {
    return this.config.repoUrl;
  }

  /** The clone folder (operator-set; the folders inside it are repository content). */
  public getRepoPath(): string {
    return this.config.localPath;
  }

  /**
   * Get the path to the configured source subdirectory within the repo
   */
  public getSourcePath(): string {
    return path.join(this.config.localPath, this.config.sourceSubdir || 'tests_source');
  }

  /**
   * Get the path to tests_source within the repo (alias for backward compat)
   */
  public getTestsSourcePath(): string {
    return this.getSourcePath();
  }

  /**
   * Run a remote operation without the token first, and with it only when
   * that fails.
   *
   * Git itself sends credentials only after the server asks for them. The
   * auth header from createGit() is sent on every request, and GitHub answers
   * 401 to a bad token even for a public repository. Sent first, an expired
   * or revoked token would break the sync of a repository that needs no token.
   */
  private async withTokenFallback<T>(run: (token?: string) => Promise<T>): Promise<T> {
    try {
      return await run(undefined);
    } catch (error) {
      if (!this.config.githubToken) {
        throw error;
      }
      console.log('  Anonymous access failed, retrying with the configured token...');
      return run(this.config.githubToken);
    }
  }

  /**
   * Point `origin` at the configured repository. Removes credentials
   * persisted by older versions, and follows a changed TESTS_REPO_URL on an
   * existing clone, so every fetch goes to the repository that is configured
   * now. Runs before each fetch.
   */
  private async pointOriginAtConfiguredRepo(): Promise<void> {
    await createGit(this.config.localPath).remote(['set-url', 'origin', this.config.repoUrl]);
  }

  /** The remote-tracking ref of the configured branch: what pull() resets to and fetchPublished() updates. */
  public publishedRef(): string {
    return `origin/${this.config.branch}`;
  }

  /**
   * Clone the repository using sparse checkout (tests_source + shared libraries)
   */
  public async clone(): Promise<void> {
    const sparsePaths = this.config.sparseCheckoutPaths || ['tests_source', 'preludeorg-libraries', 'utils'];
    console.log(`Cloning repository from ${this.config.repoUrl} (sparse: ${sparsePaths.join(', ')})...`);
    this.syncStatus.status = 'syncing';

    try {
      // Ensure parent directory exists
      const parentDir = path.dirname(this.config.localPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Clone with sparse checkout - only download what we need
      await this.withTokenFallback(async (token) => {
        const git = createGit(undefined, token);
        await git.clone(this.config.repoUrl, this.config.localPath, [
          '--branch', this.config.branch,
          '--single-branch',
          '--depth', '1',
          '--filter=blob:none',  // Partial clone - don't download blobs until needed
          '--sparse',            // Enable sparse checkout
        ]);

        // Configure sparse checkout to include only the requested paths.
        // This downloads the files, so it needs the same access as the clone.
        const repoGit = createGit(this.config.localPath, token);
        await repoGit.raw(['sparse-checkout', 'set', ...sparsePaths]);
      });

      // Update status
      await this.updateStatus();
      console.log(`✓ Repository cloned successfully (sparse checkout: ${sparsePaths.join(', ')})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during clone';
      const sanitizedError = sanitizeGitError(errorMessage, this.config.githubToken);
      this.syncStatus = {
        ...this.syncStatus,
        status: 'error',
        error: 'Clone failed',
      };
      console.error(`✗ Failed to clone repository: ${sanitizedError}`);
      throw new Error('Clone failed');
    }
  }

  /**
   * Pull latest changes from the repository
   */
  public async pull(): Promise<void> {
    if (!this.repoExists()) {
      throw new Error('Repository does not exist. Call clone() first.');
    }

    console.log('Pulling latest changes...');
    this.syncStatus.status = 'syncing';

    try {
      // Initialize git for the local repo
      const repoGit = createGit(this.config.localPath);

      await this.pointOriginAtConfiguredRepo();

      // Fetch and reset to handle force pushes. The reset downloads the
      // changed files (partial clone), so it needs the same access as the fetch.
      await this.withTokenFallback(async (token) => {
        const remoteGit = createGit(this.config.localPath, token);
        await remoteGit.fetch(['--depth', '1']);
        await remoteGit.reset(['--hard', this.publishedRef()]);
      });

      // Clean untracked files
      await repoGit.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);

      // Update status
      await this.updateStatus();
      console.log(`✓ Repository synced successfully (${this.syncStatus.commitHash?.substring(0, 7)})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during pull';
      const sanitizedError = sanitizeGitError(errorMessage, this.config.githubToken);
      this.syncStatus = {
        ...this.syncStatus,
        status: 'error',
        error: 'Pull failed',
      };
      console.error(`✗ Failed to pull repository: ${sanitizedError}`);
      throw new Error('Pull failed');
    }
  }

  /**
   * Ensure repository is available (clone if missing, otherwise use existing)
   * Does NOT automatically pull - call pull() separately if you want latest.
   * Re-applies sparse checkout paths if the existing repo has different paths configured.
   */
  public async ensureRepo(): Promise<void> {
    if (this.repoExists()) {
      console.log(`Repository already exists at ${this.config.localPath}`);

      // Verify sparse checkout includes the expected paths (may differ if a previous
      // clone used different sparseCheckoutPaths for the same localPath, or if the
      // initial clone failed partway through).
      const sparsePaths = this.config.sparseCheckoutPaths;
      if (sparsePaths && sparsePaths.length > 0) {
        const sourceDir = path.join(this.config.localPath, this.config.sourceSubdir || sparsePaths[0]);
        if (!fs.existsSync(sourceDir)) {
          console.log(`  Sparse checkout missing ${this.config.sourceSubdir || sparsePaths[0]}, re-applying...`);
          await this.withTokenFallback(async (token) => {
            const repoGit = createGit(this.config.localPath, token);
            await repoGit.raw(['sparse-checkout', 'set', ...sparsePaths]);
            await repoGit.checkout(this.config.branch);
          });
        }
      }

      await this.updateStatus();
      return;
    }

    await this.clone();
  }

  /**
   * Sync the repository (clone if missing, pull if exists)
   */
  public async sync(): Promise<void> {
    if (this.repoExists()) {
      await this.pull();
    } else {
      await this.clone();
    }
  }

  /**
   * Update sync status from the local repository
   */
  private async updateStatus(): Promise<void> {
    if (!this.repoExists()) {
      this.syncStatus = {
        lastSyncTime: null,
        commitHash: null,
        branch: this.config.branch,
        status: 'never_synced',
      };
      return;
    }

    try {
      const repoGit = createGit(this.config.localPath);
      const log = await repoGit.log({ maxCount: 1 });
      const currentBranch = await repoGit.revparse(['--abbrev-ref', 'HEAD']);

      // Count test directories (UUIDs in category folders)
      let testCount = 0;
      const testsSourcePath = this.getTestsSourcePath();
      if (fs.existsSync(testsSourcePath) && isUsableSourceRoot(testsSourcePath)) {
        const categories = fs.readdirSync(testsSourcePath);
        for (const category of categories) {
          const categoryPath = path.join(testsSourcePath, category);
          const stat = fs.statSync(categoryPath);
          if (stat.isDirectory()) {
            const entries = fs.readdirSync(categoryPath);
            // Count UUID directories (8-4-4-4-12 format)
            const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
            testCount += entries.filter(e => uuidPattern.test(e)).length;
          }
        }
      }

      this.syncStatus = {
        lastSyncTime: new Date().toISOString(),
        commitHash: log.latest?.hash || null,
        branch: currentBranch.trim(),
        status: 'synced',
        testCount,
      };
    } catch (error) {
      console.error('Failed to update sync status:', error);
      // Keep previous status but mark as error
      this.syncStatus.status = 'error';
      this.syncStatus.error = 'Failed to read repository status';
    }
  }

  /**
   * Every blob and tree at `ref`, in one `git ls-tree -r -t`. Needs trees
   * only, so it works for paths outside the sparse checkout. Lazy fetching is
   * off so a missing object fails instead of downloading blobs.
   *
   * The listing is repository content, so its size is limited: past
   * `maxBytes` git is stopped and TreeTooLargeError is thrown, before the
   * whole output is held in memory and parsed.
   */
  public async listTree(ref: string, maxBytes: number = MAX_TREE_LISTING_BYTES): Promise<GitTreeEntry[]> {
    const stop = new AbortController();
    const git = createGit(this.config.localPath, undefined, { GIT_NO_LAZY_FETCH: '1' }, stop.signal);
    let bytes = 0;
    let tooLarge = false;
    git.outputHandler((_command, stdout) => {
      stdout.on('data', (chunk: Buffer | string) => {
        bytes += chunk.length;
        if (bytes > maxBytes && !tooLarge) {
          tooLarge = true;
          stop.abort();
        }
      });
    });
    let output: string;
    try {
      output = await git.raw(['ls-tree', '-r', '-t', '-z', ref]);
    } catch (err) {
      if (tooLarge) throw new TreeTooLargeError();
      throw err;
    }
    // The last chunk can cross the limit as git exits: nothing was aborted.
    if (tooLarge) throw new TreeTooLargeError();
    // -z keeps paths unquoted; tolerate newline-separated output as well.
    const lines = output.includes('\0') ? output.split('\0') : output.split('\n');
    const entries: GitTreeEntry[] = [];
    for (const line of lines) {
      // <mode> SP <type> SP <hash> TAB <path>
      const match = /^\d+ (blob|tree) ([0-9a-f]+)\t(.+)$/.exec(line);
      if (match) {
        entries.push({ type: match[1] as 'blob' | 'tree', hash: match[2], path: match[3] });
      }
    }
    return entries;
  }

  /** Hash and committer date (ISO 8601) of the commit `ref` points at. */
  public async commitInfo(ref: string): Promise<{ hash: string; date: string }> {
    const git = createGit(this.config.localPath);
    const output = await git.raw(['log', '-1', '--format=%H %cI', ref]);
    const [hash, date] = output.trim().split(' ');
    if (!hash || !date) {
      throw new Error(`Could not read commit info for ${ref}`);
    }
    return { hash, date };
  }

  /** Tracked files under `paths` that differ from HEAD (staged or not). Untracked files are ignored. */
  public async modifiedTrackedPaths(paths: string[]): Promise<string[]> {
    if (paths.length === 0) return [];
    const git = createGit(this.config.localPath);
    const output = await git.raw(['status', '--porcelain', '--untracked-files=no', '--', ...paths]);
    return output
      .split('\n')
      .filter(line => line.length > 3)
      .map(line => line.slice(3).replace(/^.* -> /, '').replace(/^"(.*)"$/, '$1'));
  }

  /**
   * Fetch the published branch and nothing else: no reset, no clean, so the
   * working tree (and any custom tests in it) stays as it is. Returns the ref
   * to read it from.
   */
  public async fetchPublished(): Promise<string> {
    const branch = this.config.branch;
    await this.pointOriginAtConfiguredRepo();
    await this.withTokenFallback(async (token) => {
      const git = createGit(this.config.localPath, token);
      await git.fetch(['--depth', '1', 'origin', branch]);
    });
    return this.publishedRef();
  }

  /**
   * Get current sync status
   */
  public getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Check if sync is currently in progress
   */
  public isSyncing(): boolean {
    return this.syncStatus.status === 'syncing';
  }
}
