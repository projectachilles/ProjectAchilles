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
  env: vi.fn().mockReturnThis(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
  CleanOptions: { FORCE: 1, RECURSIVE: 2 },
}));

const { GitSyncService } = await import('../gitSyncService.js');
const { simpleGit } = await import('simple-git');

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

  // ── Group 1: Constructor & Repository Handling ─────────────

  describe('constructor and repository handling', () => {
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

    it('uses command-scoped HTTP auth without putting the token in the clone URL', async () => {
      const token = 'github_pat_private/value+with=reserved';
      const svc = createService(token);
      mockExistsSync.mockReturnValue(false);
      mockGitInstance.clone.mockRejectedValueOnce(new Error('could not read Username'));

      await svc.clone();

      const clonedUrl = mockGitInstance.clone.mock.calls[1][0];
      expect(clonedUrl).toBe(REPO_URL);
      expect(clonedUrl).not.toContain(token);

      const envCalls = mockGitInstance.env.mock.calls as unknown as Array<[Record<string, string>]>;
      const authEnv = envCalls.map(([env]) => env).find(env => env.GIT_CONFIG_VALUE_0);
      expect(authEnv).toMatchObject({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_TERMINAL_PROMPT: '0',
      });
      const authorization = authEnv?.GIT_CONFIG_VALUE_0;
      expect(authorization).toMatch(/^Authorization: Basic /);
      expect(authorization).not.toContain(token);
      const encodedCredential = authorization?.replace('Authorization: Basic ', '') || '';
      expect(Buffer.from(encodedCredential, 'base64').toString('utf8')).toBe(`x-access-token:${token}`);
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

    it.each([
      ['classic PAT', 'ghp_classicToken123'],
      ['fine-grained PAT', 'github_pat_private/value+with=reserved'],
      ['OAuth token', 'gho_oauthToken123'],
      ['arbitrary credential', 'custom.secret/value+123='],
    ])('keeps %s raw and encoded forms out of observable clone errors', async (_family, token) => {
      mockExistsSync.mockReturnValue(false);
      const url = new URL('https://github.com/repo');
      url.username = token;
      const basicCredential = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
      // The anonymous attempt fails first; the token attempt's error is the one reported.
      mockGitInstance.clone
        .mockRejectedValueOnce(new Error('could not read Username'))
        .mockRejectedValueOnce(new Error(
          `Authentication failed for ${url.toString()} (${encodeURIComponent(token)}; Authorization: Basic ${basicCredential})`,
        ));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const svc = createService(token);

      try {
        await expect(svc.clone()).rejects.toThrow('Clone failed');
        const status = svc.getStatus();
        const logged = consoleError.mock.calls.flat().join(' ');

        expect(status).toMatchObject({ status: 'error', error: 'Clone failed' });
        expect(logged).toContain('Authentication failed');
        expect(logged).toContain('[TOKEN]');
        for (const exposed of [token, encodeURIComponent(token), url.username, basicCredential]) {
          expect(JSON.stringify(status)).not.toContain(exposed);
          expect(logged).not.toContain(exposed);
        }
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  // ── Group 3: pull ──────────────────────────────────────────

  describe('pull', () => {
    it('throws when repo does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.pull()).rejects.toThrow('Repository does not exist');
    });

    it('keeps the remote credential-free while authenticating fetch and hard reset', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${LOCAL_PATH}/.git`) return true;
        if (p === `${LOCAL_PATH}/tests_source`) return false;
        return false;
      });
      const token = 'github_pat_pullToken123';
      const svc = createService(token);
      mockGitInstance.fetch.mockRejectedValueOnce(new Error('could not read Username'));

      await svc.pull();

      expect(mockGitInstance.remote).toHaveBeenCalledWith(['set-url', 'origin', REPO_URL]);
      expect(mockGitInstance.fetch).toHaveBeenCalledWith(['--depth', '1']);
      expect(mockGitInstance.reset).toHaveBeenCalledWith(['--hard', 'origin/main']);
      expect(JSON.stringify(mockGitInstance.remote.mock.calls)).not.toContain(token);

      const envCalls = mockGitInstance.env.mock.calls as unknown as Array<[Record<string, string>]>;
      const authEnv = envCalls.map(([env]) => env).find(env => env.GIT_CONFIG_VALUE_0);
      expect(authEnv?.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
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

    it('returns stable public errors while sanitizing pull diagnostics', async () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${LOCAL_PATH}/.git`,
      );
      mockGitInstance.fetch
        .mockRejectedValueOnce(new Error('could not read Username'))
        .mockRejectedValueOnce(new Error('Failed to fetch https://ghp_secretToken999@github.com/repo'));

      const svc = createService('ghp_secretToken999');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(svc.pull()).rejects.toThrow('Pull failed');
        const status = svc.getStatus();
        const logged = consoleError.mock.calls.flat().join(' ');

        expect(status).toMatchObject({ status: 'error', error: 'Pull failed' });
        expect(logged).toContain('[TOKEN]');
        expect(logged).not.toContain('ghp_secretToken999');
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  // ── Token is a fallback, never sent first ──────────────────
  //
  // Git itself only sends credentials after the server asks for them. An
  // always-on auth header breaks a PUBLIC repository when the configured
  // token is expired or revoked (GitHub answers 401), so the service tries
  // without the token first and uses it only when that attempt fails.

  describe('token fallback', () => {
    const TOKEN = 'github_pat_fallbackToken';
    let events: string[];

    beforeEach(() => {
      events = [];
      vi.mocked(simpleGit).mockImplementation(((options: { unsafe?: unknown }) => {
        events.push(options?.unsafe ? 'git:token' : 'git:anonymous');
        return mockGitInstance;
      }) as never);
      for (const op of ['clone', 'fetch', 'reset', 'raw'] as const) {
        mockGitInstance[op].mockImplementation(async () => {
          events.push(op);
          return '';
        });
      }
    });

    const repoOnDisk = () =>
      mockExistsSync.mockImplementation((p: string) => p === `${LOCAL_PATH}/.git`);

    it('clone never uses the token when the anonymous clone works', async () => {
      await createService(TOKEN).clone();

      expect(events).not.toContain('git:token');
      expect(mockGitInstance.clone).toHaveBeenCalledTimes(1);
    });

    it('clone retries with the token when the anonymous clone fails', async () => {
      mockGitInstance.clone.mockImplementationOnce(async () => {
        events.push('clone');
        throw new Error('could not read Username');
      });
      const svc = createService(TOKEN);

      await svc.clone();

      // The sparse-checkout that follows downloads files, so it must run
      // with the same credentials as the clone that worked.
      expect(events.slice(0, 6)).toEqual([
        'git:anonymous', 'clone', 'git:token', 'clone', 'git:token', 'raw',
      ]);
      expect(svc.getStatus().status).not.toBe('error');
    });

    it('pull never uses the token when the anonymous fetch works', async () => {
      repoOnDisk();

      await createService(TOKEN).pull();

      expect(events).not.toContain('git:token');
      expect(mockGitInstance.fetch).toHaveBeenCalledTimes(1);
    });

    it('pull retries fetch and reset with the token when the anonymous attempt fails', async () => {
      repoOnDisk();
      mockGitInstance.fetch.mockImplementationOnce(async () => {
        events.push('fetch');
        throw new Error('could not read Username');
      });
      const svc = createService(TOKEN);

      await svc.pull();

      const fromFetch = events.slice(events.indexOf('fetch'));
      expect(fromFetch.slice(0, 4)).toEqual(['fetch', 'git:token', 'fetch', 'reset']);
      expect(svc.getStatus().status).toBe('synced');
    });

    it('pull retries with the token when the reset cannot download files anonymously', async () => {
      repoOnDisk();
      mockGitInstance.reset.mockImplementationOnce(async () => {
        events.push('reset');
        throw new Error('could not read Username');
      });

      await createService(TOKEN).pull();

      const fromReset = events.slice(events.indexOf('reset'));
      expect(fromReset.slice(0, 4)).toEqual(['reset', 'git:token', 'fetch', 'reset']);
    });

    it('does not retry when no token is configured', async () => {
      repoOnDisk();
      mockGitInstance.fetch.mockImplementationOnce(async () => {
        throw new Error('network down');
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(createService().pull()).rejects.toThrow('Pull failed');
        expect(mockGitInstance.fetch).toHaveBeenCalledTimes(1);
      } finally {
        consoleError.mockRestore();
      }
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
  // ── Version identity helpers ───────────────────────────────

  describe('version identity helpers', () => {
    it('fetchPublished never calls reset or clean', async () => {
      const ref = await service.fetchPublished();

      expect(ref).toBe('origin/main');
      expect(mockGitInstance.fetch).toHaveBeenCalledWith(['--depth', '1', 'origin', 'main']);
      expect(mockGitInstance.reset).not.toHaveBeenCalled();
      expect(mockGitInstance.clean).not.toHaveBeenCalled();
    });

    it('fetchPublished points origin at the configured repository before fetching', async () => {
      await service.fetchPublished();

      expect(mockGitInstance.remote).toHaveBeenCalledWith(['set-url', 'origin', REPO_URL]);
      expect(mockGitInstance.remote.mock.invocationCallOrder[0])
        .toBeLessThan(mockGitInstance.fetch.mock.invocationCallOrder[0]);
    });

    it('fetchPublished with a token: set-url once, then the anonymous fetch and the token retry', async () => {
      const withToken = createService('tok-placeholder');
      mockGitInstance.fetch
        .mockRejectedValueOnce(new Error('auth required'))
        .mockResolvedValueOnce(undefined);

      await withToken.fetchPublished();

      expect(mockGitInstance.remote).toHaveBeenCalledTimes(1);
      expect(mockGitInstance.fetch).toHaveBeenCalledTimes(2);
      expect(mockGitInstance.remote.mock.invocationCallOrder[0])
        .toBeLessThan(mockGitInstance.fetch.mock.invocationCallOrder[0]);
    });

    it('publishedRef names the remote-tracking ref that fetchPublished and pull update', async () => {
      expect(service.publishedRef()).toBe('origin/main');
      expect(await service.fetchPublished()).toBe(service.publishedRef());
    });

    it('listTree parses mode/type/hash/path lines including paths with spaces', async () => {
      mockGitInstance.raw.mockResolvedValueOnce(
        [
          '040000 tree aaa111\ttests_source',
          '100644 blob bbb222\ttests_source/my test/some file.go',
          '160000 commit ccc333\tvendor/sub',
        ].join('\n') + '\n',
      );

      const entries = await service.listTree('origin/main');

      expect(mockGitInstance.raw).toHaveBeenCalledWith(['ls-tree', '-r', '-t', '-z', 'origin/main']);
      expect(entries).toEqual([
        { type: 'tree', hash: 'aaa111', path: 'tests_source' },
        { type: 'blob', hash: 'bbb222', path: 'tests_source/my test/some file.go' },
      ]);
    });

    it('listTree reads NUL-separated output', async () => {
      mockGitInstance.raw.mockResolvedValueOnce('100644 blob bbb222\ta b/c d.go\0');

      expect(await service.listTree('HEAD')).toEqual([
        { type: 'blob', hash: 'bbb222', path: 'a b/c d.go' },
      ]);
    });

    it('commitInfo returns hash and ISO committer date', async () => {
      mockGitInstance.raw.mockResolvedValueOnce('abc123 2026-11-01T10:00:00+00:00\n');

      expect(await service.commitInfo('origin/main')).toEqual({
        hash: 'abc123',
        date: '2026-11-01T10:00:00+00:00',
      });
    });

    it('modifiedTrackedPaths ignores untracked files and returns changed paths', async () => {
      mockGitInstance.raw.mockResolvedValueOnce(' M tests_source/x/main.go\nR  a -> tests_source/x/b.go\n');

      expect(await service.modifiedTrackedPaths(['tests_source/x'])).toEqual([
        'tests_source/x/main.go',
        'tests_source/x/b.go',
      ]);
      expect(mockGitInstance.raw).toHaveBeenCalledWith([
        'status', '--porcelain', '--untracked-files=no', '--', 'tests_source/x',
      ]);
      expect(await service.modifiedTrackedPaths([])).toEqual([]);
    });
  });
});
