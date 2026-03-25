import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
    readdirSync: mockReaddirSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const mockGitInstance = {
  clone: vi.fn().mockResolvedValue(undefined),
  remote: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn().mockResolvedValue(undefined),
  clean: vi.fn().mockResolvedValue(undefined),
  log: vi.fn().mockResolvedValue({ latest: { hash: 'abc123def456' } }),
  revparse: vi.fn().mockResolvedValue('main'),
  raw: vi.fn().mockResolvedValue(''),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
  CleanOptions: { FORCE: 1, RECURSIVE: 2 },
}));

const { GitSyncService } = await import('../gitSyncService.js');

// ── Helpers ──────────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/owner/repo.git';
const LOCAL_PATH = '/data/repo';
const BRANCH = 'main';

function createService(token?: string) {
  return new GitSyncService({
    repoUrl: REPO_URL,
    branch: BRANCH,
    localPath: LOCAL_PATH,
    githubToken: token,
  });
}

const UUID1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// ── Tests ────────────────────────────────────────────────────────────

describe('GitSyncService', () => {
  let service: InstanceType<typeof GitSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
    mockExistsSync.mockReturnValue(false);
    mockGitInstance.log.mockResolvedValue({ latest: { hash: 'abc123def456' } });
    mockGitInstance.revparse.mockResolvedValue('main');
  });

  // ── Group 1: Constructor & URL Handling ────────────────────

  describe('constructor and URL handling', () => {
    it('repoExists returns false when .git directory missing', () => {
      mockExistsSync.mockReturnValue(false);

      expect(service.repoExists()).toBe(false);
    });

    it('repoExists returns true when .git directory exists', () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${LOCAL_PATH}/.git`,
      );

      expect(service.repoExists()).toBe(true);
    });

    it('getTestsSourcePath returns tests_source subpath', () => {
      expect(service.getTestsSourcePath()).toBe(`${LOCAL_PATH}/tests_source`);
    });
  });

  // ── Group 2: clone ─────────────────────────────────────────

  describe('clone', () => {
    it('creates parent directory if missing', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        if (p === `${LOCAL_PATH}/.git`) return false;
        return false;
      });

      await service.clone();

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });

    it('calls git.clone with sparse checkout flags', async () => {
      mockExistsSync.mockReturnValue(false);

      await service.clone();

      expect(mockGitInstance.clone).toHaveBeenCalledWith(
        REPO_URL,
        LOCAL_PATH,
        expect.arrayContaining([
          '--branch', BRANCH,
          '--single-branch',
          '--depth', '1',
          '--filter=blob:none',
          '--sparse',
        ]),
      );
    });

    it('configures sparse-checkout for tests_source, preludeorg-libraries, and utils', async () => {
      mockExistsSync.mockReturnValue(false);

      await service.clone();

      expect(mockGitInstance.raw).toHaveBeenCalledWith([
        'sparse-checkout', 'set', 'tests_source', 'preludeorg-libraries', 'utils',
      ]);
    });

    it('inserts token into URL when githubToken is set', async () => {
      const svc = createService('ghp_abc123XYZ');
      mockExistsSync.mockReturnValue(false);

      await svc.clone();

      const clonedUrl = mockGitInstance.clone.mock.calls[0][0];
      expect(clonedUrl).toContain('ghp_abc123XYZ');
      expect(clonedUrl).toContain('github.com');
    });

    it('sets status to syncing during clone, then synced', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // After clone, .git exists for updateStatus
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });

      await service.clone();

      const status = service.getStatus();
      expect(status.status).toBe('synced');
    });

    it('sanitizes token from error messages on failure', async () => {
      mockExistsSync.mockReturnValue(false);
      mockGitInstance.clone.mockRejectedValueOnce(
        new Error('Authentication failed for https://ghp_abc123XYZ@github.com/repo'),
      );

      const svc = createService('ghp_abc123XYZ');

      await expect(svc.clone()).rejects.toThrow('[TOKEN]');
      const status = svc.getStatus();
      expect(status.status).toBe('error');
      expect(status.error).not.toContain('ghp_abc123XYZ');
      expect(status.error).toContain('[TOKEN]');
    });
  });

  // ── Group 3: pull ──────────────────────────────────────────

  describe('pull', () => {
    it('throws when repo does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.pull()).rejects.toThrow('Repository does not exist');
    });

    it('sets remote URL, fetches, and hard resets', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });

      await service.pull();

      expect(mockGitInstance.remote).toHaveBeenCalledWith(['set-url', 'origin', REPO_URL]);
      expect(mockGitInstance.fetch).toHaveBeenCalledWith(['--depth', '1']);
      expect(mockGitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
    });

    it('cleans untracked files with FORCE + RECURSIVE', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });

      await service.pull();

      // CleanOptions.FORCE (1) + CleanOptions.RECURSIVE (2) = 3
      expect(mockGitInstance.clean).toHaveBeenCalledWith(3);
    });

    it('sets status to error with sanitized message on failure', async () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${LOCAL_PATH}/.git`,
      );
      mockGitInstance.fetch.mockRejectedValueOnce(
        new Error('Failed to fetch https://ghp_secretToken999@github.com/repo'),
      );

      const svc = createService('ghp_secretToken999');
      await expect(svc.pull()).rejects.toThrow('[TOKEN]');

      const status = svc.getStatus();
      expect(status.status).toBe('error');
      expect(status.error).toContain('[TOKEN]');
      expect(status.error).not.toContain('ghp_secretToken999');
    });
  });

  // ── Group 4: ensureRepo & sync ─────────────────────────────

  describe('ensureRepo and sync', () => {
    it('ensureRepo clones if repo missing', async () => {
      mockExistsSync.mockReturnValue(false);

      await service.ensureRepo();

      expect(mockGitInstance.clone).toHaveBeenCalled();
    });

    it('ensureRepo just updates status if repo exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });

      await service.ensureRepo();

      expect(mockGitInstance.clone).not.toHaveBeenCalled();
    });

    it('sync calls pull when repo exists', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });

      await service.sync();

      expect(mockGitInstance.fetch).toHaveBeenCalled();
      expect(mockGitInstance.reset).toHaveBeenCalled();
    });

    it('sync calls clone when repo missing', async () => {
      mockExistsSync.mockReturnValue(false);

      await service.sync();

      expect(mockGitInstance.clone).toHaveBeenCalled();
    });
  });

  // ── Group 5: Status & Helpers ──────────────────────────────

  describe('status and helpers', () => {
    it('getStatus returns copy of status object', () => {
      const status1 = service.getStatus();
      const status2 = service.getStatus();

      expect(status1).toEqual(status2);
      expect(status1).not.toBe(status2); // different references
    });

    it('initial status is never_synced', () => {
      const status = service.getStatus();

      expect(status.status).toBe('never_synced');
      expect(status.lastSyncTime).toBeNull();
      expect(status.commitHash).toBeNull();
      expect(status.branch).toBe('main');
    });

    it('isSyncing returns true only during active sync', () => {
      expect(service.isSyncing()).toBe(false);
    });

    it('updateStatus handles errors gracefully (sets status to error)', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });
      mockGitInstance.log.mockRejectedValueOnce(new Error('git log failed'));

      await service.ensureRepo();

      const status = service.getStatus();
      expect(status.status).toBe('error');
      expect(status.error).toBe('Failed to read repository status');
    });
  });

  // ── Group 6: Test Count Calculation ────────────────────────

  describe('test count calculation', () => {
    it('counts UUID directories across category folders', async () => {
      const uuid2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/tests_source`) return ['cyber-hygiene', 'intel-driven'];
        if (p === `${LOCAL_PATH}/tests_source/cyber-hygiene`) return [UUID1];
        if (p === `${LOCAL_PATH}/tests_source/intel-driven`) return [uuid2];
        return [];
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      await service.ensureRepo();

      const status = service.getStatus();
      expect(status.testCount).toBe(2);
    });

    it('returns 0 when tests_source does not exist', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        return false;
      });

      await service.ensureRepo();

      const status = service.getStatus();
      expect(status.testCount).toBe(0);
    });

    it('ignores non-UUID directory names in count', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/tests_source`) return ['cyber-hygiene'];
        if (p === `${LOCAL_PATH}/tests_source/cyber-hygiene`) return [
          UUID1,          // valid UUID
          'not-a-uuid',   // should be ignored
          'README.md',    // should be ignored
        ];
        return [];
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      await service.ensureRepo();

      const status = service.getStatus();
      expect(status.testCount).toBe(1);
    });
  });
});
