import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TestMetadata } from '../../../types/test.js';

// ── Mock setup ──────────────────────────────────────────────────────

const mockAxiosGet = vi.fn();
const mockIsAxiosError = vi.fn();

vi.mock('axios', () => ({
  default: { get: mockAxiosGet, isAxiosError: mockIsAxiosError },
  isAxiosError: mockIsAxiosError,
}));

const { GitHubMetadataService } = await import('../githubMetadataService.js');

// ── Helpers ──────────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/owner/test-repo.git';
const BRANCH = 'main';
const UUID1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

function createService(token?: string) {
  return new GitHubMetadataService({
    repoUrl: REPO_URL,
    branch: BRANCH,
    githubToken: token,
  });
}

function makeTestMeta(uuid: string, category = 'cyber-hygiene'): TestMetadata {
  return {
    uuid,
    name: `Test ${uuid.slice(0, 8)}`,
    techniques: ['T1059'],
    tactics: [],
    tags: [],
    stages: [],
    isMultiStage: false,
    category,
  } as TestMetadata;
}

function makeCommitResponse(date: string, message: string) {
  return {
    data: [{
      commit: {
        committer: { date },
        message,
      },
    }],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('GitHubMetadataService', () => {
  let service: InstanceType<typeof GitHubMetadataService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  // ── Group 1: Constructor & URL Parsing ─────────────────────

  describe('constructor and URL parsing', () => {
    it('parses owner and repo from HTTPS URL with .git suffix', () => {
      // If parsing fails, constructor throws
      const svc = createService();
      expect(svc).toBeDefined();
    });

    it('parses owner and repo from URL without .git suffix', () => {
      const svc = new GitHubMetadataService({
        repoUrl: 'https://github.com/myorg/myrepo',
        branch: 'main',
      });
      expect(svc).toBeDefined();
    });

    it('throws on invalid GitHub URL', () => {
      expect(() => new GitHubMetadataService({
        repoUrl: 'https://gitlab.com/owner/repo',
        branch: 'main',
      })).toThrow('Cannot parse GitHub owner/repo from URL');
    });
  });

  // ── Group 2: fetchCommitInfo ───────────────────────────────

  describe('fetchCommitInfo (via fetchAllModificationDates)', () => {
    it('calls GitHub API with correct path and branch params', async () => {
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-01-15T10:00:00Z', 'Update test'));
      const test = makeTestMeta(UUID1, 'cyber-hygiene');

      await service.fetchAllModificationDates([test]);

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/test-repo/commits',
        expect.objectContaining({
          params: {
            path: `tests_source/cyber-hygiene/${UUID1}`,
            per_page: 1,
            sha: 'main',
          },
          timeout: 10000,
        }),
      );
    });

    it('includes Authorization header when token is set', async () => {
      const svc = createService('ghp_testToken123');
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-01-15T10:00:00Z', 'Fix'));

      await svc.fetchAllModificationDates([makeTestMeta(UUID1)]);

      const callOpts = mockAxiosGet.mock.calls[0][1];
      expect(callOpts.headers.Authorization).toBe('Bearer ghp_testToken123');
    });

    it('omits Authorization header when no token', async () => {
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-01-15T10:00:00Z', 'Fix'));

      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      const callOpts = mockAxiosGet.mock.calls[0][1];
      expect(callOpts.headers.Authorization).toBeUndefined();
    });

    it('truncates commit message to first line and max 120 chars', async () => {
      const longMessage = 'A'.repeat(150) + '\n\nDetailed description';
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-01-15T10:00:00Z', longMessage));

      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      const info = service.getCommitInfo(UUID1);
      expect(info).toBeDefined();
      expect(info!.lastCommitMessage).toHaveLength(120);
    });

    it('returns null for empty commit list (no results from API)', async () => {
      mockAxiosGet.mockResolvedValue({ data: [] });

      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      expect(service.getCommitInfo(UUID1)).toBeUndefined();
    });

    it('swallows individual fetch errors without propagating', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      expect(service.getCommitInfo(UUID1)).toBeUndefined();
    });

    it('handles 403 rate limit gracefully', async () => {
      const rateLimitError = new Error('Rate limited');
      (rateLimitError as unknown as Record<string, unknown>).response = { status: 403 };
      mockAxiosGet.mockRejectedValue(rateLimitError);
      mockIsAxiosError.mockReturnValue(true);

      // Should not throw
      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      expect(service.getCommitInfo(UUID1)).toBeUndefined();
    });
  });

  // ── Group 3: Batch Processing ──────────────────────────────

  describe('batch processing', () => {
    it('fetches all tests across multiple batches', async () => {
      // Create 15 tests (batch size is 10, so 2 batches)
      const tests = Array.from({ length: 15 }, (_, i) => {
        const uuid = `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`;
        return makeTestMeta(uuid);
      });

      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-01-15T10:00:00Z', 'Update'));

      await service.fetchAllModificationDates(tests);

      expect(mockAxiosGet).toHaveBeenCalledTimes(15);
    });

    it('caches successful results and skips failures', async () => {
      const test1 = makeTestMeta(UUID1);
      const test2 = makeTestMeta(UUID2);

      mockAxiosGet
        .mockResolvedValueOnce(makeCommitResponse('2026-01-15T10:00:00Z', 'Success'))
        .mockRejectedValueOnce(new Error('Failed'));

      await service.fetchAllModificationDates([test1, test2]);

      expect(service.getCommitInfo(UUID1)).toBeDefined();
      expect(service.getCommitInfo(UUID1)!.lastModifiedDate).toBe('2026-01-15T10:00:00Z');
      expect(service.getCommitInfo(UUID2)).toBeUndefined();
    });
  });

  // ── Group 4: Cache Operations ──────────────────────────────

  describe('cache operations', () => {
    it('getCommitInfo returns cached data', async () => {
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-02-01T12:00:00Z', 'Add test'));

      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);

      const info = service.getCommitInfo(UUID1);
      expect(info).toEqual({
        lastModifiedDate: '2026-02-01T12:00:00Z',
        lastCommitMessage: 'Add test',
      });
    });

    it('getCommitInfo returns undefined for uncached UUID', () => {
      expect(service.getCommitInfo('nonexistent')).toBeUndefined();
    });

    it('clearCache empties the cache', async () => {
      mockAxiosGet.mockResolvedValue(makeCommitResponse('2026-02-01T12:00:00Z', 'Test'));

      await service.fetchAllModificationDates([makeTestMeta(UUID1)]);
      expect(service.getCommitInfo(UUID1)).toBeDefined();

      service.clearCache();
      expect(service.getCommitInfo(UUID1)).toBeUndefined();
    });
  });
});
