import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promisify } from 'util';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockMkdtempSync = vi.fn();
const mockCpSync = vi.fn();
const mockRmSync = vi.fn();
const mockRenameSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    mkdtempSync: mockMkdtempSync,
    cpSync: mockCpSync,
    rmSync: mockRmSync,
    renameSync: mockRenameSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = {
    homedir: () => '/mock-home',
    tmpdir: () => '/tmp',
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const mockExecFileAsync = vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ stdout: string; stderr: string }>>();
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = mockExecFileAsync;

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: mockExecFile,
    default: { ...actual, execFile: mockExecFile },
  };
});

const mockRegisterVersion = vi.fn();
vi.mock('../update.service.js', () => ({
  registerVersion: mockRegisterVersion,
}));

const { AgentBuildService } = await import('../agentBuild.service.js');
type TestsSettingsService = import('../../tests/settings.js').TestsSettingsService;

// ── Helpers ──────────────────────────────────────────────────────────

const AGENT_SOURCE = '/repo/agent';
const BUILD_WORK_DIR = '/tmp/agent-build-xyz';
const BIN_DIR_WIN = '/mock-home/.projectachilles/binaries/windows-amd64';
const BIN_DIR_LINUX = '/mock-home/.projectachilles/binaries/linux-amd64';

function createMockSettingsService(overrides: Record<string, unknown> = {}) {
  return {
    getActiveCertPfxPath: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as TestsSettingsService;
}

function createService(settingsOverrides: Record<string, unknown> = {}) {
  return new AgentBuildService(createMockSettingsService(settingsOverrides), AGENT_SOURCE);
}

const MOCK_VERSION_RESULT = {
  version: '1.0.0',
  os: 'windows' as const,
  arch: 'amd64' as const,
  binary_path: `${BIN_DIR_WIN}/achilles-agent-1.0.0.exe`,
  binary_sha256: 'abc123',
  binary_size: 2048,
  release_notes: 'Built from source (windows/amd64)',
  mandatory: false,
  signed: false,
  created_at: '2026-01-01T00:00:00.000Z',
};

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentBuildService', () => {
  let service: InstanceType<typeof AgentBuildService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
    mockExistsSync.mockReturnValue(false);
    mockMkdtempSync.mockReturnValue(BUILD_WORK_DIR);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockRegisterVersion.mockReturnValue(MOCK_VERSION_RESULT);
  });

  // ── Group 1: Input Validation ──────────────────────────────

  describe('input validation', () => {
    it('rejects invalid version string (special chars, spaces)', async () => {
      await expect(service.buildAndSign('v1.0 beta!', 'windows', 'amd64'))
        .rejects.toThrow('Invalid version string');
    });

    it('throws when go.mod not found at agent source path', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.buildAndSign('1.0.0', 'windows', 'amd64'))
        .rejects.toThrow('Agent source not found');
    });

    it('accepts valid version strings (dots, hyphens, underscores)', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        return false;
      });

      // Should not throw validation error — will proceed to build
      await service.buildAndSign('1.0.0-rc_1', 'windows', 'amd64');

      expect(mockCpSync).toHaveBeenCalled();
    });
  });

  // ── Group 2: Build Process ─────────────────────────────────

  describe('build process', () => {
    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        return false;
      });
    });

    it('copies source to temp directory via cpSync', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      expect(mockMkdtempSync).toHaveBeenCalled();
      expect(mockCpSync).toHaveBeenCalledWith(AGENT_SOURCE, BUILD_WORK_DIR, { recursive: true });
    });

    it('calls go mod tidy, go mod download, go build with correct ldflags', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      const calls = mockExecFileAsync.mock.calls;
      const cmds = calls.map(c => `${c[0]} ${(c[1] as string[]).join(' ')}`);

      expect(cmds).toEqual(expect.arrayContaining([
        expect.stringContaining('go mod tidy'),
        expect.stringContaining('go mod download'),
      ]));

      // Check go build with ldflags
      const buildCall = calls.find(c => (c[1] as string[]).includes('build'));
      expect(buildCall).toBeDefined();
      const buildArgs = buildCall![1] as string[];
      expect(buildArgs).toContain('-ldflags');
      const ldflagsIdx = buildArgs.indexOf('-ldflags');
      expect(buildArgs[ldflagsIdx + 1]).toContain('-X main.version=1.0.0');
    });

    it('sets GOOS, GOARCH, CGO_ENABLED=0 in environment', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      const buildCall = mockExecFileAsync.mock.calls.find(
        c => (c[1] as string[]).includes('build'),
      );
      const opts = buildCall![2] as { env: NodeJS.ProcessEnv };
      expect(opts.env.GOOS).toBe('windows');
      expect(opts.env.GOARCH).toBe('amd64');
      expect(opts.env.CGO_ENABLED).toBe('0');
    });

    it('uses .tmp extension during build, renames to final on success', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      // Build output should use .tmp
      const buildCall = mockExecFileAsync.mock.calls.find(
        c => (c[1] as string[]).includes('build'),
      );
      const buildArgs = buildCall![1] as string[];
      const outputArg = buildArgs[buildArgs.indexOf('-o') + 1];
      expect(outputArg).toMatch(/\.tmp$/);

      // Rename from .tmp to final
      expect(mockRenameSync).toHaveBeenCalledWith(
        `${BIN_DIR_WIN}/achilles-agent-1.0.0.exe.tmp`,
        `${BIN_DIR_WIN}/achilles-agent-1.0.0.exe`,
      );
    });

    it('cleans up temp build directory in finally block', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      expect(mockRmSync).toHaveBeenCalledWith(BUILD_WORK_DIR, { recursive: true, force: true });
    });
  });

  // ── Group 3: Output & Registration ─────────────────────────

  describe('output and registration', () => {
    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        return false;
      });
    });

    it('creates output directory at ~/.projectachilles/binaries/{os}-{arch}/', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      expect(mockMkdirSync).toHaveBeenCalledWith(BIN_DIR_WIN, { recursive: true });
    });

    it('adds .exe extension for Windows, no extension for Linux', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');
      expect(mockRenameSync).toHaveBeenCalledWith(
        expect.anything(),
        `${BIN_DIR_WIN}/achilles-agent-1.0.0.exe`,
      );

      vi.clearAllMocks();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        return false;
      });
      mockMkdtempSync.mockReturnValue(BUILD_WORK_DIR);
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockRegisterVersion.mockReturnValue({ ...MOCK_VERSION_RESULT, os: 'linux' });

      await service.buildAndSign('1.0.0', 'linux', 'amd64');
      expect(mockRenameSync).toHaveBeenCalledWith(
        expect.anything(),
        `${BIN_DIR_LINUX}/achilles-agent-1.0.0`,
      );
    });

    it('calls registerVersion with correct args', async () => {
      await service.buildAndSign('1.0.0', 'windows', 'amd64');

      expect(mockRegisterVersion).toHaveBeenCalledWith(
        '1.0.0',
        'windows',
        'amd64',
        `${BIN_DIR_WIN}/achilles-agent-1.0.0.exe`,
        'Built from source (windows/amd64)',
        false,  // mandatory
        false,  // signed (no cert)
      );
    });
  });

  // ── Group 4: Code Signing ──────────────────────────────────

  describe('code signing', () => {
    function setupBuildWithCert() {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        if (p.endsWith('.tmp-pass')) return true;
        return false;
      });
    }

    it('signs Windows binary when active cert exists', async () => {
      setupBuildWithCert();
      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });

      await svc.buildAndSign('1.0.0', 'windows', 'amd64');

      const signCall = mockExecFileAsync.mock.calls.find(
        c => c[0] === 'osslsigncode',
      );
      expect(signCall).toBeDefined();
      expect(signCall![1]).toEqual(expect.arrayContaining([
        'sign', '-pkcs12', '/certs/cert.pfx',
      ]));
      expect(mockRegisterVersion).toHaveBeenCalledWith(
        '1.0.0', 'windows', 'amd64',
        expect.any(String), expect.any(String),
        false, true, // signed = true
      );
    });

    it('skips signing for Linux builds even when cert available', async () => {
      setupBuildWithCert();
      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });

      await svc.buildAndSign('1.0.0', 'linux', 'amd64');

      const signCall = mockExecFileAsync.mock.calls.find(
        c => c[0] === 'osslsigncode',
      );
      expect(signCall).toBeUndefined();
      expect(mockRegisterVersion).toHaveBeenCalledWith(
        '1.0.0', 'linux', 'amd64',
        expect.any(String), expect.any(String),
        false, false, // signed = false
      );
    });

    it('passes password via temp file with mode 0o600', async () => {
      setupBuildWithCert();
      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'secret-pass',
        }),
      });

      await svc.buildAndSign('1.0.0', 'windows', 'amd64');

      const passWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.tmp-pass'),
      );
      expect(passWrite).toBeDefined();
      expect(passWrite![1]).toBe('secret-pass');
      expect(passWrite![2]).toEqual({ mode: 0o600 });
    });

    it('cleans up temp pass file in finally block', async () => {
      setupBuildWithCert();
      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });

      await svc.buildAndSign('1.0.0', 'windows', 'amd64');

      const passUnlink = mockUnlinkSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.tmp-pass'),
      );
      expect(passUnlink).toBeDefined();
    });

    it('continues with unsigned binary when osslsigncode fails', async () => {
      setupBuildWithCert();
      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });

      mockExecFileAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'osslsigncode') {
          throw new Error('Signing failed');
        }
        return { stdout: '', stderr: '' };
      });

      const result = await svc.buildAndSign('1.0.0', 'windows', 'amd64');

      expect(result).toBeDefined();
      // registerVersion called with signed=false because signing failed
      expect(mockRegisterVersion).toHaveBeenCalledWith(
        '1.0.0', 'windows', 'amd64',
        expect.any(String), expect.any(String),
        false, false,
      );
    });
  });

  // ── Group 5: Error Handling ────────────────────────────────

  describe('error handling', () => {
    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        return false;
      });
    });

    it('throws BuildError when go build fails (includes stderr)', async () => {
      mockExecFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if ((args as string[]).includes('build')) {
          const err = new Error('exit code 1') as Error & { stderr: string };
          err.stderr = 'undefined: main.run';
          throw err;
        }
        return { stdout: '', stderr: '' };
      });

      await expect(service.buildAndSign('1.0.0', 'windows', 'amd64'))
        .rejects.toThrow('undefined: main.run');
    });

    it('throws when source copy fails', async () => {
      mockCpSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      await expect(service.buildAndSign('1.0.0', 'windows', 'amd64'))
        .rejects.toThrow('Failed to copy agent source');
    });

    it('cleans up temp dir on build failure', async () => {
      // cpSync must succeed so we reach the second try/finally block
      mockCpSync.mockReturnValue(undefined);

      mockExecFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if ((args as string[]).includes('build')) {
          throw new Error('build failed');
        }
        return { stdout: '', stderr: '' };
      });

      await expect(service.buildAndSign('1.0.0', 'windows', 'amd64')).rejects.toThrow();

      expect(mockRmSync).toHaveBeenCalledWith(BUILD_WORK_DIR, { recursive: true, force: true });
    });

    it('cleans up .signed file when signing fails', async () => {
      // Ensure cpSync succeeds
      mockCpSync.mockReturnValue(undefined);

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${AGENT_SOURCE}/go.mod`) return true;
        if (p.endsWith('.signed')) return true;
        if (p.endsWith('.tmp-pass')) return true;
        return false;
      });

      const svc = createService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });

      mockExecFileAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'osslsigncode') {
          throw new Error('Signing failed');
        }
        return { stdout: '', stderr: '' };
      });

      await svc.buildAndSign('1.0.0', 'windows', 'amd64');

      const signedUnlink = mockUnlinkSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.signed'),
      );
      expect(signedUnlink).toBeDefined();
    });
  });
});
