// Service to sync tests from GitHub repository

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit, CleanOptions } from 'simple-git';

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
  private git: SimpleGit;
  private syncStatus: SyncStatus;

  constructor(config: GitSyncConfig) {
    this.config = {
      ...config,
      localPath: path.resolve(config.localPath),
    };

    this.git = simpleGit();
    this.syncStatus = {
      lastSyncTime: null,
      commitHash: null,
      branch: config.branch,
      status: 'never_synced',
    };
  }

  /**
   * Get the authenticated repo URL (with token if provided)
   */
  private getAuthenticatedUrl(): string {
    if (!this.config.githubToken) {
      return this.config.repoUrl;
    }

    // Insert token into URL: https://TOKEN@github.com/owner/repo.git
    const url = new URL(this.config.repoUrl);
    url.username = this.config.githubToken;
    return url.toString();
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
      const authUrl = this.getAuthenticatedUrl();
      await this.git.clone(authUrl, this.config.localPath, [
        '--branch', this.config.branch,
        '--single-branch',
        '--depth', '1',
        '--filter=blob:none',  // Partial clone - don't download blobs until needed
        '--sparse',            // Enable sparse checkout
      ]);

      // Configure sparse checkout to include only the requested paths
      const repoGit = simpleGit(this.config.localPath);
      await repoGit.raw(['sparse-checkout', 'set', ...sparsePaths]);

      // Update status
      await this.updateStatus();
      console.log(`✓ Repository cloned successfully (sparse checkout: ${sparsePaths.join(', ')})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during clone';
      // Remove token from error messages for security
      const sanitizedError = errorMessage.replace(/ghp_[a-zA-Z0-9]+/g, '[TOKEN]');
      this.syncStatus = {
        ...this.syncStatus,
        status: 'error',
        error: sanitizedError,
      };
      console.error(`✗ Failed to clone repository: ${sanitizedError}`);
      throw new Error(`Clone failed: ${sanitizedError}`);
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
      const repoGit = simpleGit(this.config.localPath);

      // Configure auth for pull (in case remote changed)
      const authUrl = this.getAuthenticatedUrl();
      await repoGit.remote(['set-url', 'origin', authUrl]);

      // Fetch and reset to handle force pushes
      await repoGit.fetch(['--depth', '1']);
      await repoGit.reset(['--hard', `origin/${this.config.branch}`]);

      // Clean untracked files
      await repoGit.clean(CleanOptions.FORCE + CleanOptions.RECURSIVE);

      // Update status
      await this.updateStatus();
      console.log(`✓ Repository synced successfully (${this.syncStatus.commitHash?.substring(0, 7)})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during pull';
      const sanitizedError = errorMessage.replace(/ghp_[a-zA-Z0-9]+/g, '[TOKEN]');
      this.syncStatus = {
        ...this.syncStatus,
        status: 'error',
        error: sanitizedError,
      };
      console.error(`✗ Failed to pull repository: ${sanitizedError}`);
      throw new Error(`Pull failed: ${sanitizedError}`);
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
          const repoGit = simpleGit(this.config.localPath);
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
      const repoGit = simpleGit(this.config.localPath);
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
