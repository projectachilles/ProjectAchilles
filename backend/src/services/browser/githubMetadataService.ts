// Service to fetch per-test modification dates from GitHub API

import axios from 'axios';
import type { TestMetadata } from '../../types/test.js';

export interface GitCommitInfo {
  lastModifiedDate: string;
  lastCommitMessage: string;
}

export class GitHubMetadataService {
  private owner: string;
  private repo: string;
  private branch: string;
  private token?: string;
  private cache = new Map<string, GitCommitInfo>();

  constructor(options: {
    repoUrl: string;
    branch: string;
    githubToken?: string;
  }) {
    const parsed = this.parseGitHubUrl(options.repoUrl);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
    this.branch = options.branch;
    this.token = options.githubToken;
  }

  private parseGitHubUrl(url: string): { owner: string; repo: string } {
    // Match github.com/owner/repo (with optional .git suffix)
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) {
      throw new Error(`Cannot parse GitHub owner/repo from URL: ${url}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  /**
   * Fetch modification dates for all tests in batches.
   * Runs in background — failures are logged but don't propagate.
   */
  async fetchAllModificationDates(tests: TestMetadata[]): Promise<void> {
    const batchSize = 10;
    const batchDelay = 200; // ms between batches
    let fetched = 0;
    let failed = 0;

    console.log(`📡 Fetching GitHub metadata for ${tests.length} tests...`);

    for (let i = 0; i < tests.length; i += batchSize) {
      const batch = tests.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(test => this.fetchCommitInfo(test))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled' && result.value) {
          this.cache.set(batch[j].uuid, result.value);
          fetched++;
        } else if (result.status === 'rejected') {
          failed++;
        }
      }

      // Delay between batches to be kind to the API
      if (i + batchSize < tests.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    console.log(`✓ GitHub metadata: ${fetched} fetched, ${failed} failed, ${tests.length} total`);
  }

  private async fetchCommitInfo(test: TestMetadata): Promise<GitCommitInfo | null> {
    const testPath = `tests_source/${test.category}/${test.uuid}`;
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await axios.get(
        `https://api.github.com/repos/${this.owner}/${this.repo}/commits`,
        {
          params: {
            path: testPath,
            per_page: 1,
            sha: this.branch,
          },
          headers,
          timeout: 10000,
        }
      );

      if (response.data.length === 0) {
        return null;
      }

      const commit = response.data[0];
      return {
        lastModifiedDate: commit.commit.committer.date,
        lastCommitMessage: commit.commit.message.split('\n')[0].substring(0, 120),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.warn(`⚠ GitHub API rate limit hit while fetching metadata for ${test.uuid}`);
      }
      // Individual failures are silently swallowed — the test just won't have a date
      return null;
    }
  }

  /**
   * Get cached commit info for a test.
   */
  getCommitInfo(uuid: string): GitCommitInfo | undefined {
    return this.cache.get(uuid);
  }

  /**
   * Clear the cache (call after sync to force re-fetch).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
