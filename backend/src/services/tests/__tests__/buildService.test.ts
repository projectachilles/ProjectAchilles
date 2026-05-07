import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promisify } from 'util';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockRmSync = vi.fn();
const mockStatSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockRenameSync = vi.fn();
const mockSymlinkSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    rmSync: mockRmSync,
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
    copyFileSync: mockCopyFileSync,
    renameSync: mockRenameSync,
    symlinkSync: mockSymlinkSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = {
    homedir: () => '/mock-home',
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

const { BuildService } = await import('../buildService.js');
type TestsSettingsService = import('../settings.js').TestsSettingsService;

// ── Helpers ──────────────────────────────────────────────────────────

const BUILDS_DIR = '/mock-home/.projectachilles/builds';
const TESTS_SOURCE = '/mock-tests';
const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createMockSettingsService(overrides: Record<string, unknown> = {}) {
  return {
    getPlatformSettings: vi.fn().mockReturnValue({ os: 'windows', arch: 'amd64' }),
    getActiveCertPfxPath: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as TestsSettingsService;
}

function createService(settingsOverrides: Record<string, unknown> = {}) {
  return new BuildService(createMockSettingsService(settingsOverrides), TESTS_SOURCE);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BuildService', () => {
  let service: InstanceType<typeof BuildService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
    mockExistsSync.mockReturnValue(false);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  // ── Group 1: getBuildInfo ─────────────────────────────────

  describe('getBuildInfo', () => {
    it('returns { exists: false } when no meta file', () => {
      mockExistsSync.mockReturnValue(false);

      const info = service.getBuildInfo(VALID_UUID);

      expect(info).toEqual({ exists: false });
    });

    it('returns build info from valid meta + binary', () => {
      const meta = {
        platform: { os: 'windows', arch: 'amd64' },
        builtAt: '2026-01-01T00:00:00.000Z',
        signed: true,
        fileSize: 1024,
        filename: `${VALID_UUID}.exe`,
      };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      const info = service.getBuildInfo(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(info.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(info.signed).toBe(true);
      expect(info.fileSize).toBe(1024);
      expect(info.filename).toBe(`${VALID_UUID}.exe`);
    });

    it('returns { exists: false } when meta exists but binary missing', () => {
      const meta = {
        platform: { os: 'windows', arch: 'amd64' },
        filename: `${VALID_UUID}.exe`,
      };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      const info = service.getBuildInfo(VALID_UUID);

      expect(info).toEqual({ exists: false });
    });

    it('handles corrupt meta JSON gracefully', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue('not-valid-json{{{');

      const info = service.getBuildInfo(VALID_UUID);

      expect(info).toEqual({ exists: false });
    });
  });

  // ── Group 2: getBinaryPath ────────────────────────────────

  describe('getBinaryPath', () => {
    it('returns binary path when meta + file exist', () => {
      const meta = { filename: `${VALID_UUID}.exe` };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      const result = service.getBinaryPath(VALID_UUID);

      expect(result).toBe(`${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`);
    });

    it('returns null when no meta file', () => {
      mockExistsSync.mockReturnValue(false);

      expect(service.getBinaryPath(VALID_UUID)).toBeNull();
    });

    it('returns null when meta exists but binary missing', () => {
      const meta = { filename: `${VALID_UUID}.exe` };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      expect(service.getBinaryPath(VALID_UUID)).toBeNull();
    });
  });

  // ── Group 3: deleteBuild ──────────────────────────────────

  describe('deleteBuild', () => {
    it('removes build directory with rmSync', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return true;
        return false;
      });

      service.deleteBuild(VALID_UUID);

      expect(mockRmSync).toHaveBeenCalledWith(
        `${BUILDS_DIR}/${VALID_UUID}`,
        { recursive: true, force: true },
      );
    });

    it('no-op when build directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      service.deleteBuild(VALID_UUID);

      expect(mockRmSync).not.toHaveBeenCalled();
    });
  });

  // ── Group 4: getEmbedDependencies ─────────────────────────

  describe('getEmbedDependencies', () => {
    it('parses //go:embed directives from Go files', () => {
      const goSource = `package main

//go:embed payload.bin
var payloadData []byte

//go:embed config.yaml
var configData string
`;
      // findTestDir: try known categories
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/payload.bin`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/config.yaml`) return false;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue(goSource);

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(2);
      expect(deps[0]).toEqual({ filename: 'payload.bin', sourceFile: 'main.go', exists: true, sourceBuilt: false });
      expect(deps[1]).toEqual({ filename: 'config.yaml', sourceFile: 'main.go', exists: false, sourceBuilt: false });
    });

    it('skips .go and .ps1 embed targets', () => {
      const goSource = `package main

//go:embed helper.go
var helperSrc string

//go:embed script.ps1
var scriptSrc string

//go:embed data.txt
var data string
`;
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue(goSource);

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0].filename).toBe('data.txt');
    });

    it('returns empty array when test dir not found', () => {
      mockExistsSync.mockReturnValue(false);

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toEqual([]);
    });

    it('marks all deps sourceBuilt: false when no build_all.sh', () => {
      const goSource = '//go:embed payload.bin\nvar d []byte\n';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue(goSource);

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0].sourceBuilt).toBe(false);
    });

    it('detects source-built via hyphen-to-underscore (validator pattern)', () => {
      const orchestratorGo = '//go:embed validator-foo.exe\nvar bin []byte\n';
      const buildScript = '#!/bin/bash\ngo build -o "validator-${vname}.exe"';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'validator_foo.go', 'check_utils.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        filename: 'validator-foo.exe',
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
    });

    it('detects source-built via UUID-prefix stage (technique pattern)', () => {
      const orchestratorGo = `//go:embed ${VALID_UUID}-T1105.exe\nvar bin []byte\n`;
      const buildScript = '#!/bin/bash\ngo build -o "${UUID}-${stage}.exe" stage-${stage}.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'stage-T1105.go', 'test_logger.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        filename: `${VALID_UUID}-T1105.exe`,
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
    });

    it('detects source-built via UUID-prefix stage (numbered prefix match)', () => {
      const orchestratorGo = `//go:embed ${VALID_UUID}-stage1.exe\nvar bin []byte\n`;
      const buildScript = '#!/bin/bash\ngo build -o "${UUID}-${stage_name}.exe"';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'stage1-defense-evasion.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0].sourceBuilt).toBe(true);
    });

    it('marks external deps as not sourceBuilt even with build_all.sh', () => {
      const orchestratorGo = '//go:embed external-tool.msi\nvar bin []byte\n';
      const buildScript = '#!/bin/bash\ngo build -o orchestrator.exe orchestrator.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        filename: 'external-tool.msi',
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: false,
      });
    });

    it('uses build_all.sh fallback for literal go build -o match', () => {
      const orchestratorGo = '//go:embed MsSense.exe\nvar bin []byte\n';
      const buildScript = '#!/bin/bash\nGOOS=windows go build -o MsSense.exe fake_mssense.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'fake_mssense.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        filename: 'MsSense.exe',
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
    });

    it('detects source-built via UUID-prefix stage with .exe.gz compound extension', () => {
      const orchestratorGo = `//go:embed ${VALID_UUID}-T1566.001.exe.gz\nvar bin []byte\n//go:embed cleanup_utility.exe.gz\nvar cu []byte\n`;
      const buildScript = '#!/bin/bash\ngo build -o "${UUID}-${technique}.exe" stage-${technique}.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'stage-T1566.001.go', 'cleanup_utility.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(2);
      expect(deps[0]).toEqual({
        filename: `${VALID_UUID}-T1566.001.exe.gz`,
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
      expect(deps[1]).toEqual({
        filename: 'cleanup_utility.exe.gz',
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
    });

    it('detects source-built via UUID-prefix stage without extension (Linux binaries)', () => {
      const orchestratorGo = `//go:embed ${VALID_UUID}-T1553.001\nvar bin []byte\n`;
      const buildScript = '#!/bin/bash\ngo build -o "${UUID}-${technique}" stage-${technique}.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'stage-T1553.001.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        filename: `${VALID_UUID}-T1553.001`,
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
    });

    it('detects source-built via direct match (cleanup_utility pattern)', () => {
      const orchestratorGo = '//go:embed cleanup_utility.exe\nvar bin []byte\n';
      const buildScript = '#!/bin/bash\ngo build -o "${cleanup}" cleanup_utility.go';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'cleanup_utility.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps).toHaveLength(1);
      expect(deps[0].sourceBuilt).toBe(true);
    });
  });

  // ── Group 5: saveUploadedFile ─────────────────────────────

  describe('saveUploadedFile', () => {
    beforeEach(() => {
      // Set up findTestDir to find the test directory
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
    });

    it('writes buffer to test directory', () => {
      // Set up embed deps
      const goSource = '//go:embed payload.bin\nvar d []byte\n';
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue(goSource);
      // Also need existsSync for the embed check
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      const buffer = Buffer.from('file-content');
      service.saveUploadedFile(VALID_UUID, 'payload.bin', buffer);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/payload.bin`,
        buffer,
      );
    });

    it('rejects path traversal (../malicious)', () => {
      expect(() =>
        service.saveUploadedFile(VALID_UUID, '../malicious.txt', Buffer.from('x')),
      ).toThrow('Invalid filename');
    });

    it('rejects filenames not in embed dependencies list', () => {
      // No embed deps
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue('package main\n');

      expect(() =>
        service.saveUploadedFile(VALID_UUID, 'unknown.bin', Buffer.from('x')),
      ).toThrow("Filename 'unknown.bin' is not a known embed dependency for this test");
    });

    it('rejects uploads for source-built dependencies', () => {
      const orchestratorGo = '//go:embed validator-foo.exe\nvar bin []byte\n';
      const buildScript = '#!/bin/bash\ngo build -o "validator-${vname}.exe"';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/build_all.sh`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['orchestrator.go', 'validator_foo.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('/build_all.sh')) return buildScript;
        if (typeof p === 'string' && p.endsWith('/orchestrator.go')) return orchestratorGo;
        return 'package main\n';
      });

      expect(() =>
        service.saveUploadedFile(VALID_UUID, 'validator-foo.exe', Buffer.from('x')),
      ).toThrow("Cannot upload 'validator-foo.exe': this binary is built from source by build_all.sh");
    });
  });

  // ── Group 6: buildAndSign — Standard Go Build ─────────────

  describe('buildAndSign — standard go build', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;

    beforeEach(() => {
      // findTestDir: category match
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        // go.mod doesn't exist (we auto-create it)
        if (p.endsWith('go.mod')) return false;
        if (p.endsWith('go.sum')) return false;
        // build_all.sh doesn't exist (standard build)
        if (p.endsWith('build_all.sh')) return false;
        // Build output dir
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        // After build, stat the output binary
        return { size: 2048 };
      });
      mockReaddirSync.mockReturnValue(['main.go']);
    });

    it('calls go mod init, mod tidy, mod download, go build', async () => {
      const result = await service.buildAndSign(VALID_UUID);

      expect(result.exists).toBe(true);
      expect(result.platform).toEqual({ os: 'windows', arch: 'amd64' });

      const calls = mockExecFileAsync.mock.calls;
      const cmds = calls.map(c => `${c[0]} ${c[1].join(' ')}`);

      expect(cmds).toEqual(expect.arrayContaining([
        expect.stringContaining('go mod init'),
        expect.stringContaining('go mod tidy'),
        expect.stringContaining('go mod download'),
        expect.stringContaining('go build'),
      ]));
    });

    it('cleans up auto-generated go.mod/go.sum in finally block', async () => {
      // After the build, go.mod and go.sum will exist
      const existingFiles = new Set<string>();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p.endsWith('build_all.sh')) return false;
        if (existingFiles.has(p)) return true;
        if (p.endsWith('go.mod')) return false; // No pre-existing go.mod
        if (p.endsWith('go.sum')) return false;
        return false;
      });

      // After mod init, go.mod should exist for cleanup
      mockExecFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes('init')) {
          existingFiles.add(`${testDir}/go.mod`);
        }
        if (args.includes('tidy')) {
          existingFiles.add(`${testDir}/go.sum`);
        }
        return { stdout: '', stderr: '' };
      });

      await service.buildAndSign(VALID_UUID);

      expect(mockUnlinkSync).toHaveBeenCalledWith(`${testDir}/go.mod`);
      expect(mockUnlinkSync).toHaveBeenCalledWith(`${testDir}/go.sum`);
    });

    it('writes build metadata JSON on success', async () => {
      await service.buildAndSign(VALID_UUID);

      const metaWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('build-meta.json'),
      );
      expect(metaWrite).toBeDefined();

      const meta = JSON.parse(metaWrite![1] as string);
      expect(meta.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(meta.signed).toBe(false);
      expect(meta.filename).toBe(`${VALID_UUID}.exe`);
    });

    it('rejects invalid UUID format', async () => {
      await expect(service.buildAndSign('not-a-uuid')).rejects.toThrow('Invalid UUID format');
    });

    it('throws BuildError when no Go source files found', async () => {
      mockReaddirSync.mockReturnValue([]);

      await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow('No Go source files found');
    });

    it('throws when test directory not found', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow('Test directory not found');
    });
  });

  // ── findTestDir — path traversal guard (defense in depth) ──

  describe('findTestDir — path traversal guard', () => {
    // findTestDir is private; access via type assertion. UUID_REGEX prevents
    // traversal at every public entry point in practice — these tests pin
    // the internal guard so the defense-in-depth check can't be silently
    // removed. CodeQL `js/path-injection` (PR #204 alerts 117–121) reads
    // this guard as the sanitiser that clears the data-flow alerts.
    type FindTestDir = (uuid: string) => string | null;
    const callFindTestDir = (svc: typeof service, uuid: string): string | null =>
      (svc as unknown as { findTestDir: FindTestDir }).findTestDir(uuid);

    it('returns null when the candidate path would escape basePath', () => {
      // Without the guard, a malicious UUID-shaped input could resolve
      // outside basePath. Use enough `..` segments to escape both the
      // categorised lookup (3 levels deep) and the flat lookup (2 levels).
      mockExistsSync.mockReturnValue(true); // would return a match without the guard
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      expect(callFindTestDir(service, '../../../../etc')).toBeNull();
      expect(callFindTestDir(service, '../../../etc/passwd')).toBeNull();
    });

    it('returns the canonical dir when candidate stays inside basePath', () => {
      const expectedDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;
      mockExistsSync.mockImplementation((p: string) => p === expectedDir);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      expect(callFindTestDir(service, VALID_UUID)).toBe(expectedDir);
    });
  });

  // ── Group 6.5: buildAndSign — LOG_DIR injection (issue #202) ─

  describe('buildAndSign — LOG_DIR injection', () => {
    const testDir = `${TESTS_SOURCE}/mitre-top10/${VALID_UUID}`;
    const injectedPath = `${testDir}/_achilles_log_dir.go`;

    // Helper: stage a test directory with given .go files and contents.
    // The test_logger.go reference is the standard form from f0_library —
    // `filepath.Join(LOG_DIR, "bundle_results.json")`.
    function stageTest(files: Record<string, string>) {
      const fileNames = Object.keys(files);
      mockReaddirSync.mockReturnValue(fileNames);
      mockReadFileSync.mockImplementation((p: string) => {
        for (const [name, content] of Object.entries(files)) {
          if (typeof p === 'string' && p.endsWith('/' + name)) return content;
        }
        return '';
      });
      const existing = new Set<string>([testDir]);
      mockExistsSync.mockImplementation((p: string) => {
        if (existing.has(p)) return true;
        if (p.endsWith('build_all.sh')) return false;
        if (p.endsWith('go.mod') || p.endsWith('go.sum')) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      // After write, mark the injected file as existing so cleanup's
      // existsSync check sees it.
      mockWriteFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string') existing.add(p);
      });
    }

    it('injects _achilles_log_dir.go when LOG_DIR is referenced but not declared', async () => {
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\n\nimport "path/filepath"\nfunc x() string { return filepath.Join(LOG_DIR, "out.json") }',
      });

      await service.buildAndSign(VALID_UUID);

      const writes = mockWriteFileSync.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0] === injectedPath,
      );
      expect(writes).toHaveLength(1);
      const content = writes[0][1] as string;
      expect(content).toMatch(/Code generated by ProjectAchilles buildService/);
      expect(content).toMatch(/const LOG_DIR =/);
      expect(content).toMatch(/const ARTIFACT_DIR =/);
    });

    it('emits Windows paths (C:\\F0) when target OS is windows', async () => {
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
      });

      await service.buildAndSign(VALID_UUID);

      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === injectedPath,
      );
      const content = write![1] as string;
      expect(content).toContain('`C:\\F0`');
      expect(content).toContain('`c:\\Users\\fortika-test`');
    });

    it('emits POSIX paths (/tmp/F0) when target OS is linux', async () => {
      service = createService({
        getPlatformSettings: vi.fn().mockReturnValue({ os: 'linux', arch: 'amd64' }),
      });
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
      });

      await service.buildAndSign(VALID_UUID);

      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === injectedPath,
      );
      const content = write![1] as string;
      expect(content).toContain('`/tmp/F0`');
      expect(content).toContain('`/home/fortika-test`');
    });

    it('skips injection when LOG_DIR is already declared in another file', async () => {
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
        'test_logger_windows.go': '//go:build windows\npackage main\nconst LOG_DIR = `C:\\F0`',
      });

      await service.buildAndSign(VALID_UUID);

      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === injectedPath,
      );
      expect(write).toBeUndefined();
    });

    it('skips injection when LOG_DIR is not referenced anywhere', async () => {
      stageTest({
        'main.go': 'package main\nfunc main() {}\n',
      });

      await service.buildAndSign(VALID_UUID);

      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === injectedPath,
      );
      expect(write).toBeUndefined();
    });

    it('removes the injected file in finally even when the build fails', async () => {
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
      });
      // Fail the actual `go build` step (mod init / tidy / download succeed)
      mockExecFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args[0] === 'build') {
          throw Object.assign(new Error('build failed'), { stderr: 'syntax error' });
        }
        return { stdout: '', stderr: '' };
      });

      await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow();

      // Cleanup must still happen
      expect(mockUnlinkSync).toHaveBeenCalledWith(injectedPath);
    });
  });

  // ── Group 7: buildAndSign — build_all.sh Mode ─────────────

  describe('buildAndSign — build_all.sh mode', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;

    it('executes bash build_all.sh when script exists (SCRIPT_DIR pattern)', async () => {
      // For categorized tests with SCRIPT_DIR pattern, runs from repo root as-is
      const repoRoot = '/';

      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/build_all.sh`) return true;
        // Candidate output at repo root build dir
        if (p === `${repoRoot}build/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 4096 };
      });
      // Script uses SCRIPT_DIR (no flat TEST_DIR pattern) — no patching needed
      mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');

      await service.buildAndSign(VALID_UUID);

      // Categorized + SCRIPT_DIR: runs from repo root with relative path
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'bash',
        [`mock-tests/cyber-hygiene/${VALID_UUID}/build_all.sh`],
        expect.objectContaining({ cwd: repoRoot }),
      );
      expect(mockCopyFileSync).toHaveBeenCalled();
    });

    it('patches build_all.sh for categorized tests with flat TEST_DIR', async () => {
      const repoRoot = '/';
      const patchedPath = `${BUILDS_DIR}/${VALID_UUID}/.build-patched.sh`;

      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/build_all.sh`) return true;
        if (p === patchedPath) return true; // cleanup check
        // Candidate output at repo root build dir
        if (p === `${repoRoot}build/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 4096 };
      });
      // Script has flat TEST_DIR pattern — triggers patching
      mockReadFileSync.mockReturnValue(
        'TEST_UUID="test-id"\nTEST_DIR="tests_source/${TEST_UUID}"\ncd ../..  \n-o ../../build/',
      );

      await service.buildAndSign(VALID_UUID);

      // Should write patched script and execute it
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        patchedPath,
        expect.stringContaining('tests_source/cyber-hygiene/'),
        expect.objectContaining({ mode: 0o755 }),
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'bash',
        [patchedPath],
        expect.objectContaining({ cwd: repoRoot }),
      );
    });

    it('searches candidate output paths for binary', async () => {
      const repoRoot = '/';

      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/build_all.sh`) return true;
        // First candidates don't exist
        if (p === `${repoRoot}build/${VALID_UUID}/${VALID_UUID}.exe`) return false;
        if (p === `${testDir}/build/${VALID_UUID}/${VALID_UUID}.exe`) return false;
        // Third candidate exists
        if (p === `${testDir}/${VALID_UUID}.exe`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      // SCRIPT_DIR pattern — no patching
      mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');

      await service.buildAndSign(VALID_UUID);

      // Should copy from the third candidate (testDir/<uuid>.exe)
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        `${testDir}/${VALID_UUID}.exe`,
        expect.stringContaining(VALID_UUID),
      );
    });
  });

  // ── Group 8: buildAndSign — Code Signing ──────────────────

  describe('buildAndSign — code signing', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;

    function setupStandardBuild() {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p.endsWith('build_all.sh')) return false;
        if (p.endsWith('go.mod')) return false;
        if (p.endsWith('go.sum')) return false;
        if (p.endsWith('.signed')) return false;
        if (p.endsWith('.tmp-pass')) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      mockReaddirSync.mockReturnValue(['main.go']);
    }

    it('signs binary with osslsigncode when active cert exists', async () => {
      setupStandardBuild();

      const certService = createMockSettingsService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });
      const svc = new BuildService(certService, TESTS_SOURCE);

      // Make the signed file "exist" after osslsigncode runs
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p.endsWith('build_all.sh')) return false;
        if (p.endsWith('go.mod') || p.endsWith('go.sum')) return false;
        if (p.endsWith('.tmp-pass')) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });

      const result = await svc.buildAndSign(VALID_UUID);

      expect(result.signed).toBe(true);

      // Verify osslsigncode was called
      const signCall = mockExecFileAsync.mock.calls.find(
        c => c[0] === 'osslsigncode',
      );
      expect(signCall).toBeDefined();
      expect(signCall![1]).toEqual(expect.arrayContaining([
        'sign', '-pkcs12', '/certs/cert.pfx',
      ]));
    });

    it('passes password via temp file (security pattern)', async () => {
      setupStandardBuild();

      const certService = createMockSettingsService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });
      const svc = new BuildService(certService, TESTS_SOURCE);

      await svc.buildAndSign(VALID_UUID);

      // Check that password was written to a temp file
      const passWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.tmp-pass'),
      );
      expect(passWrite).toBeDefined();
      expect(passWrite![1]).toBe('cert-pass');
      expect(passWrite![2]).toEqual({ mode: 0o600 });

      // Temp file should be cleaned up
      const passUnlink = mockUnlinkSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.tmp-pass'),
      );
      expect(passUnlink).toBeDefined();
    });

    it('continues with unsigned binary when signing fails', async () => {
      setupStandardBuild();

      const certService = createMockSettingsService({
        getActiveCertPfxPath: vi.fn().mockReturnValue({
          pfxPath: '/certs/cert.pfx',
          password: 'cert-pass',
        }),
      });
      const svc = new BuildService(certService, TESTS_SOURCE);

      // Make osslsigncode fail
      mockExecFileAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'osslsigncode') {
          throw new Error('Signing failed');
        }
        return { stdout: '', stderr: '' };
      });

      const result = await svc.buildAndSign(VALID_UUID);

      expect(result.exists).toBe(true);
      expect(result.signed).toBe(false);
    });
  });

  // ── Group 9: uploadBinary ────────────────────────────────

  describe('uploadBinary', () => {
    // Valid PE buffer: starts with "MZ" (0x4D 0x5A) magic bytes
    const validPeBuffer = Buffer.concat([
      Buffer.from([0x4D, 0x5A]),
      Buffer.alloc(100, 0),
    ]);

    it('writes binary and metadata to build directory', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false; // ensureBuildDir creates it
        return false;
      });

      const info = service.uploadBinary(VALID_UUID, validPeBuffer);

      expect(info.exists).toBe(true);
      expect(info.source).toBe('uploaded');
      expect(info.signed).toBe(false);
      expect(info.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(info.fileSize).toBe(validPeBuffer.length);

      // Verify binary was written
      const binaryWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith(`${VALID_UUID}.exe`),
      );
      expect(binaryWrite).toBeDefined();
      expect(binaryWrite![1]).toBe(validPeBuffer);

      // Verify metadata was written
      const metaWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('build-meta.json'),
      );
      expect(metaWrite).toBeDefined();
      const meta = JSON.parse(metaWrite![1] as string);
      expect(meta.source).toBe('uploaded');
      expect(meta.signed).toBe(false);
    });

    it('rejects empty buffer', () => {
      expect(() =>
        service.uploadBinary(VALID_UUID, Buffer.alloc(0)),
      ).toThrow('Empty file');
    });

    it('rejects non-PE buffer (missing MZ header)', () => {
      const invalidBuffer = Buffer.from('not a PE file');
      expect(() =>
        service.uploadBinary(VALID_UUID, invalidBuffer),
      ).toThrow('missing MZ header');
    });

    it('rejects invalid UUID format', () => {
      expect(() =>
        service.uploadBinary('not-a-uuid', validPeBuffer),
      ).toThrow('Invalid UUID format');
    });

    it('uses platform settings for filename', () => {
      // Linux platform — no .exe extension
      const linuxService = createService({
        getPlatformSettings: vi.fn().mockReturnValue({ os: 'linux', arch: 'amd64' }),
      });

      mockExistsSync.mockReturnValue(false);

      const info = linuxService.uploadBinary(VALID_UUID, validPeBuffer);

      expect(info.filename).toBe(VALID_UUID); // No .exe extension
    });
  });

  // ── Group 10: buildAndSign — platform auto-detection ──────

  describe('buildAndSign — platform auto-detection', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;

    function setupBuildWithGoSource(mainContent: string, otherFiles: Record<string, string> = {}) {
      const allGoFiles = [`${VALID_UUID}.go`, ...Object.keys(otherFiles)];
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/${VALID_UUID}.go`) return true;
        // Other .go files
        for (const f of Object.keys(otherFiles)) {
          if (p === `${testDir}/${f}`) return true;
        }
        if (p.endsWith('build_all.sh')) return false;
        if (p.endsWith('go.mod')) return false;
        if (p.endsWith('go.sum')) return false;
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return false;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      mockReaddirSync.mockReturnValue(allGoFiles);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith(`${VALID_UUID}.go`)) return mainContent;
        for (const [name, content] of Object.entries(otherFiles)) {
          if (typeof p === 'string' && p.endsWith(`/${name}`)) return content;
        }
        return 'package main\n';
      });
    }

    it('detects linux from //go:build linux tag on main file', async () => {
      setupBuildWithGoSource('//go:build linux\npackage main\nfunc main() {}\n');

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'linux', arch: 'amd64' });
      // No .exe extension for Linux
      expect(result.filename).toBe(VALID_UUID);
      // GOOS should be linux in the build env
      const buildCall = mockExecFileAsync.mock.calls.find(
        c => c[0] === 'go' && c[1].includes('build'),
      );
      expect(buildCall![2]).toEqual(expect.objectContaining({
        env: expect.objectContaining({ GOOS: 'linux' }),
      }));
    });

    it('detects darwin from //go:build darwin tag', async () => {
      setupBuildWithGoSource('//go:build darwin\npackage main\nfunc main() {}\n');

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'darwin', arch: 'amd64' });
      expect(result.filename).toBe(VALID_UUID);
    });

    it('detects windows from //go:build windows tag → builds with .exe', async () => {
      setupBuildWithGoSource('//go:build windows\npackage main\nfunc main() {}\n');

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(result.filename).toBe(`${VALID_UUID}.exe`);
    });

    it('falls back to global platform when no build tag present', async () => {
      setupBuildWithGoSource('package main\nfunc main() {}\n');

      const result = await service.buildAndSign(VALID_UUID);

      // Global setting is windows/amd64 from createMockSettingsService
      expect(result.platform).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('preserves arch from global settings (e.g., arm64)', async () => {
      const svc = createService({
        getPlatformSettings: vi.fn().mockReturnValue({ os: 'windows', arch: 'arm64' }),
      });
      setupBuildWithGoSource('//go:build linux\npackage main\nfunc main() {}\n');

      const result = await svc.buildAndSign(VALID_UUID);

      // OS from build tag, arch from global
      expect(result.platform).toEqual({ os: 'linux', arch: 'arm64' });
    });

    it('detects OS from legacy // +build linux syntax', async () => {
      setupBuildWithGoSource('// +build linux\n\npackage main\nfunc main() {}\n');

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'linux', arch: 'amd64' });
    });

    it('detects OS from secondary .go file when main has no tag', async () => {
      setupBuildWithGoSource(
        'package main\nfunc main() {}\n',
        { 'helper_linux.go': '//go:build linux\npackage main\nfunc helper() {}\n' },
      );

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'linux', arch: 'amd64' });
    });

    it('prefers main file tag over secondary file tag', async () => {
      setupBuildWithGoSource(
        '//go:build darwin\npackage main\nfunc main() {}\n',
        { 'helper_linux.go': '//go:build linux\npackage main\nfunc helper() {}\n' },
      );

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'darwin', arch: 'amd64' });
    });
  });

  // ── Group 11: getDetectedPlatform ───────────────────────

  describe('getDetectedPlatform', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;

    it('returns detected platform from build tags', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/${VALID_UUID}.go`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue([`${VALID_UUID}.go`]);
      mockReadFileSync.mockReturnValue('//go:build linux\npackage main\n');

      const result = service.getDetectedPlatform(VALID_UUID);

      expect(result).toEqual({ os: 'linux', arch: 'amd64' });
    });

    it('returns null when test directory not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = service.getDetectedPlatform(VALID_UUID);

      expect(result).toBeNull();
    });

    it('falls back to global platform when no build tags', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/${VALID_UUID}.go`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue([`${VALID_UUID}.go`]);
      mockReadFileSync.mockReturnValue('package main\nfunc main() {}\n');

      const result = service.getDetectedPlatform(VALID_UUID);

      expect(result).toEqual({ os: 'windows', arch: 'amd64' });
    });
  });

  // ── Group 12: source field passthrough ────────────────────

  describe('getBuildInfo — source field', () => {
    it('passes through source field from metadata', () => {
      const meta = {
        platform: { os: 'windows', arch: 'amd64' },
        builtAt: '2026-01-01T00:00:00.000Z',
        signed: false,
        fileSize: 1024,
        filename: `${VALID_UUID}.exe`,
        source: 'uploaded',
      };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      const info = service.getBuildInfo(VALID_UUID);

      expect(info.source).toBe('uploaded');
    });

    it('returns undefined source for legacy metadata without source field', () => {
      const meta = {
        platform: { os: 'windows', arch: 'amd64' },
        builtAt: '2026-01-01T00:00:00.000Z',
        signed: true,
        fileSize: 1024,
        filename: `${VALID_UUID}.exe`,
      };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));

      const info = service.getBuildInfo(VALID_UUID);

      expect(info.source).toBeUndefined();
    });
  });
});
