// Service to sync tests from GitHub repository

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, CleanOptions } from 'simple-git';
import type { SimpleGit } from 'simple-git';

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

/** Every simple-git instance this service uses goes through here. */
export function createGit(baseDir?: string, githubToken?: string): SimpleGit {
  const env = gitChildEnv();
  const allowEnvironment = ['GIT_TERMINAL_PROMPT'];

  if (!githubToken) {
    return simpleGit({ baseDir, allowEnvironment }).env(env);
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
  }).env(env);
}

/**
 * Redact the configured credential in every representation this service sends
 * to Git, plus URL userinfo from clones created by older versions.
 */
function sanitizeGitError(message: string, githubToken?: string): string {
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
      const git = createGit(undefined, this.config.githubToken);
      await git.clone(this.config.repoUrl, this.config.localPath, [
        '--branch', this.config.branch,
        '--single-branch',
        '--depth', '1',
        '--filter=blob:none',  // Partial clone - don't download blobs until needed
        '--sparse',            // Enable sparse checkout
      ]);

      // Configure sparse checkout to include only the requested paths
      const repoGit = createGit(this.config.localPath, this.config.githubToken);
      await repoGit.raw(['sparse-checkout', 'set', ...sparsePaths]);

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

      // Remove credentials persisted by older versions and keep the remote
      // suitable for status output and future diagnostics.
      await repoGit.remote(['set-url', 'origin', this.config.repoUrl]);

      // Fetch and reset to handle force pushes
      const fetchGit = createGit(this.config.localPath, this.config.githubToken);
      await fetchGit.fetch(['--depth', '1']);
      await repoGit.reset(['--hard', `origin/${this.config.branch}`]);

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
          const repoGit = createGit(this.config.localPath, this.config.githubToken);
          await repoGit.raw(['sparse-checkout', 'set', ...sparsePaths]);
          await repoGit.checkout(this.config.branch);
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
      if (fs.existsSync(testsSourcePath)) {
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
