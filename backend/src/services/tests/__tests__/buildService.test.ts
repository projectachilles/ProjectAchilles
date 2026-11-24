import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promisify } from 'util';
import { createHash } from 'crypto';
import type { BuildInfo } from '../../../types/tests.js';
import type { TestVersionIdentity } from '../../../types/testVersion.js';
import type { BuildVersionSource } from '../buildService.js';

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
const mockUtimesSync = vi.fn();
// hashFiles (deps hash) resolves and lstat()s each entry: follow existsSync.
const mockRealpathSync = vi.fn((p: string) => p);
const mockLstatSync = vi.fn((p: string) => {
  if (!mockExistsSync(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
});

// Build marker files (BUILDS_DIR/<uuid>/.building and the takeover's temp and
// claim files next to it) live in this store, outside the per-test fs mocks:
// a build reads its marker back to check it still owns it, and the per-test
// readFileSync mocks know nothing about it. The in-memory-fs suite below
// models markers in its own files and turns the store off.
const markerStore = {
  enabled: true,
  files: new Map<string, { data: string; mtimeMs: number }>(),
};
function isMarkerPath(p: unknown): p is string {
  return markerStore.enabled && typeof p === 'string' && /\/\.building(?:$|\.)/.test(p);
}
function markerEnoent(p: string): Error {
  return Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
}
const markerAware = {
  writeFileSync: (...args: unknown[]) => {
    const [p, data, opts] = args;
    if (!isMarkerPath(p)) return mockWriteFileSync(...args);
    if ((opts as { flag?: string } | undefined)?.flag === 'wx' && markerStore.files.has(p)) {
      throw Object.assign(new Error(`EEXIST: ${p}`), { code: 'EEXIST' });
    }
    markerStore.files.set(p, { data: String(data), mtimeMs: Date.now() });
  },
  readFileSync: (...args: unknown[]) => {
    const [p, opts] = args;
    if (!isMarkerPath(p)) return mockReadFileSync(...args);
    const f = markerStore.files.get(p);
    if (!f) throw markerEnoent(p);
    return opts ? f.data : Buffer.from(f.data);
  },
  statSync: (...args: unknown[]) => {
    const [p] = args;
    if (!isMarkerPath(p)) return mockStatSync(...args);
    const f = markerStore.files.get(p);
    if (!f) throw markerEnoent(p);
    return { mtimeMs: f.mtimeMs, size: f.data.length, isFile: () => true, isDirectory: () => false };
  },
  unlinkSync: (...args: unknown[]) => {
    const [p] = args;
    if (!isMarkerPath(p)) return mockUnlinkSync(...args);
    if (!markerStore.files.delete(p)) throw markerEnoent(p);
  },
  renameSync: (...args: unknown[]) => {
    const [from, to] = args;
    if (!isMarkerPath(from)) return mockRenameSync(...args);
    const f = markerStore.files.get(from);
    if (!f) throw markerEnoent(from);
    markerStore.files.delete(from);
    markerStore.files.set(String(to), f);
  },
  utimesSync: (...args: unknown[]) => {
    const [p, , mtime] = args;
    if (!isMarkerPath(p)) return mockUtimesSync(...args);
    const f = markerStore.files.get(p);
    if (!f) throw markerEnoent(p);
    f.mtimeMs = mtime instanceof Date ? mtime.getTime() : Number(mtime) * 1000;
  },
  rmSync: (...args: unknown[]) => {
    const [p] = args;
    if (markerStore.enabled && typeof p === 'string') {
      for (const k of [...markerStore.files.keys()]) if (k.startsWith(`${p}/`)) markerStore.files.delete(k);
    }
    return mockRmSync(...args);
  },
};

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: markerAware.readFileSync,
    writeFileSync: markerAware.writeFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    rmSync: markerAware.rmSync,
    statSync: markerAware.statSync,
    unlinkSync: markerAware.unlinkSync,
    copyFileSync: mockCopyFileSync,
    renameSync: markerAware.renameSync,
    symlinkSync: mockSymlinkSync,
    realpathSync: mockRealpathSync,
    lstatSync: mockLstatSync,
    utimesSync: markerAware.utimesSync,
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

const { BuildService, BuildError, BuildSupersededError } = await import('../buildService.js');
const { deriveStatus } = await import('../../browser/testVersionStatus.js');
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

/** The error `fn` throws (fails the test when it returns). */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

function createService(settingsOverrides: Record<string, unknown> = {}) {
  return new BuildService(createMockSettingsService(settingsOverrides), TESTS_SOURCE);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BuildService', () => {
  let service: InstanceType<typeof BuildService>;

  beforeEach(() => {
    vi.clearAllMocks();
    markerStore.enabled = true;
    markerStore.files.clear();
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
    it('renames the build directory away, then removes the renamed one with rmSync', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${VALID_UUID}`) return true;
        return false;
      });

      service.deleteBuild(VALID_UUID);

      expect(mockRenameSync).toHaveBeenCalledTimes(1);
      const [from, to] = mockRenameSync.mock.calls[0] as [string, string];
      expect(from).toBe(`${BUILDS_DIR}/${VALID_UUID}`);
      expect(to).toMatch(new RegExp(`^${BUILDS_DIR}/${VALID_UUID}\\.deleting-[0-9a-f]{16}$`));
      expect(mockRmSync).toHaveBeenCalledWith(to, { recursive: true, force: true });
    });

    it('no-op when build directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      service.deleteBuild(VALID_UUID);

      expect(mockRmSync).not.toHaveBeenCalled();
    });
  });

  // ── Group 4: listBuiltUuids ───────────────────────────────

  describe('listBuiltUuids', () => {
    const BUILT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const UPLOADED_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const NO_BINARY_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    it('returns [] when the builds directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(service.listBuiltUuids()).toEqual([]);
    });

    it('returns UUIDs with a binary (built and uploaded both count), excludes meta-only dirs', () => {
      mockReaddirSync.mockReturnValue([BUILT_UUID, UPLOADED_UUID, NO_BINARY_UUID]);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === BUILDS_DIR) return true;
        if (p === `${BUILDS_DIR}/${BUILT_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${BUILT_UUID}/${BUILT_UUID}.exe`) return true;
        if (p === `${BUILDS_DIR}/${UPLOADED_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${UPLOADED_UUID}/${UPLOADED_UUID}.exe`) return true;
        // NO_BINARY_UUID has metadata but the binary file is missing
        if (p === `${BUILDS_DIR}/${NO_BINARY_UUID}/build-meta.json`) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === `${BUILDS_DIR}/${BUILT_UUID}/build-meta.json`) {
          return JSON.stringify({
            filename: `${BUILT_UUID}.exe`,
            platform: { os: 'windows', arch: 'amd64' },
            signed: false, fileSize: 100, builtAt: '2026-05-20T00:00:00Z', source: 'built',
          });
        }
        if (p === `${BUILDS_DIR}/${UPLOADED_UUID}/build-meta.json`) {
          return JSON.stringify({
            filename: `${UPLOADED_UUID}.exe`,
            platform: { os: 'windows', arch: 'amd64' },
            signed: false, fileSize: 100, builtAt: '2026-05-20T00:00:00Z', source: 'uploaded',
          });
        }
        if (p === `${BUILDS_DIR}/${NO_BINARY_UUID}/build-meta.json`) {
          return JSON.stringify({
            filename: `${NO_BINARY_UUID}.exe`,
            platform: { os: 'windows', arch: 'amd64' },
            signed: false, fileSize: 100, builtAt: '2026-05-20T00:00:00Z', source: 'built',
          });
        }
        return '';
      });

      const result = service.listBuiltUuids();
      expect([...result].sort()).toEqual([BUILT_UUID, UPLOADED_UUID].sort());
      expect(result).not.toContain(NO_BINARY_UUID);
    });

    it('returns [] when readdirSync throws (e.g. permission denied)', () => {
      mockExistsSync.mockImplementation((p: string) => p === BUILDS_DIR);
      mockReaddirSync.mockImplementation(() => { throw new Error('EACCES: permission denied'); });
      expect(service.listBuiltUuids()).toEqual([]);
    });

    it('ignores non-UUID entries in the builds directory', () => {
      mockReaddirSync.mockReturnValue([BUILT_UUID, '.DS_Store', 'not-a-uuid', '.build-patched.sh']);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === BUILDS_DIR) return true;
        if (p === `${BUILDS_DIR}/${BUILT_UUID}/build-meta.json`) return true;
        if (p === `${BUILDS_DIR}/${BUILT_UUID}/${BUILT_UUID}.exe`) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        filename: `${BUILT_UUID}.exe`,
        platform: { os: 'windows', arch: 'amd64' },
        signed: false, fileSize: 100, builtAt: '2026-05-20T00:00:00Z', source: 'built',
      }));

      expect(service.listBuiltUuids()).toEqual([BUILT_UUID]);
    });
  });

  // ── Group 5: getEmbedDependencies ─────────────────────────

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

    it('ignores //go:embed mentioned inside a prose comment', () => {
      const goSource = `package main

// Embedded gzip-compressed stage binaries. The //go:embed directives and
// their variables live in the per-OS files.

type validator struct {
	Binary []byte // Embedded signed binary (populated via //go:embed)
	Name   string
}

var (
	//go:embed payload.bin
	payloadData []byte
)
`;
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`) return true;
        if (p === `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}/payload.bin`) return true;
        return false;
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockReturnValue(goSource);

      const deps = service.getEmbedDependencies(VALID_UUID);

      expect(deps.map(d => d.filename)).toEqual(['payload.bin']);
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

    it('marks a build-created embed directory as source-built', () => {
      const orchestratorGo = '//go:embed generated\nvar assets embed.FS\n';
      const buildScript = '#!/bin/bash\nrm -rf generated\nmkdir -p generated "${BUILD_DIR}"\ngo run ./cmd/generate .';
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
        filename: 'generated',
        sourceFile: 'orchestrator.go',
        exists: false,
        sourceBuilt: true,
      });
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
    const injectedPath = `${testDir}/achilles_log_dir.go`;

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

    it('injects achilles_log_dir.go when LOG_DIR is referenced but not declared', async () => {
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

    it('skips injection when LOG_DIR is declared inside a grouped const ( … ) block', async () => {
      // Regression: real f0_library bundles (e.g. the Entra ID Tenant Security
      // Hygiene Bundle) declare LOG_DIR as a member of a parenthesised
      // `const ( … )` group, where the member line carries no `const`/`var`
      // keyword. The v1 detection regex only matched the single-line form, so
      // it mis-classified the test as "not declared", injected a SECOND
      // declaration, and `go build` failed with `LOG_DIR redeclared in this
      // block`. Injection must be skipped here.
      stageTest({
        'main.go': 'package main\n\nconst (\n\tTARGET_DIR = `c:\\F0`\n\tLOG_DIR    = `c:\\F0`\n)\n\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
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

    it('injected filename does NOT start with `_` or `.` (go build would skip those)', async () => {
      // Regression for the v1 fix: underscore-prefixed files are ignored
      // by `go build` per the Go spec, so the injection ran but the build
      // silently skipped the synthesised file and the original
      // `undefined: LOG_DIR` error persisted in production despite
      // injectLogDirIfMissing returning a path.
      stageTest({
        'main.go': 'package main\nfunc main() {}',
        'test_logger.go': 'package main\nfunc x() { _ = LOG_DIR }',
      });

      await service.buildAndSign(VALID_UUID);

      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('.go') && c[0].includes('log_dir'),
      );
      expect(write).toBeDefined();
      const filePath = write![0] as string;
      const basename = filePath.split('/').pop()!;
      expect(basename.startsWith('_')).toBe(false);
      expect(basename.startsWith('.')).toBe(false);
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

  describe('resolveInside', () => {
    type WithResolveInside = { resolveInside(root: string, ...parts: string[]): string | null };
    const resolveInside = (root: string, ...parts: string[]) =>
      (service as unknown as WithResolveInside).resolveInside(root, ...parts);

    it('returns the resolved path for a child of the root', () => {
      expect(resolveInside('/repo', 'build', VALID_UUID, `${VALID_UUID}.exe`))
        .toBe(`/repo/build/${VALID_UUID}/${VALID_UUID}.exe`);
      expect(resolveInside('/repo/./tests/..', 'a.exe')).toBe('/repo/a.exe');
    });

    it.each([
      ['a parent segment', ['../x']],
      ['a parent segment inside a part', ['build', '../../x']],
      ['an absolute part', ['/etc/passwd']],
      ['the root itself', []],
      ['a part that resolves to the root', ['build', '..']],
    ])('returns null for %s', (_label, parts) => {
      expect(resolveInside('/repo', ...parts)).toBeNull();
    });
  });

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

    it('does not hand the backend secrets in its environment to build_all.sh', async () => {
      const secrets = {
        CLERK_SECRET_KEY: 'sk_test_placeholder',
        ENCRYPTION_SECRET: 'placeholder-encryption-secret',
        ELASTICSEARCH_API_KEY: 'placeholder-es-key',
        GITHUB_TOKEN: 'placeholder-token',
      };
      const saved: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(secrets)) {
        saved[name] = process.env[name];
        process.env[name] = value;
      }
      try {
        mockExistsSync.mockImplementation((p: string) => {
          if (p === testDir) return true;
          if (p === `${testDir}/build_all.sh`) return true;
          if (p === `/build/${VALID_UUID}/${VALID_UUID}.exe`) return true;
          return false;
        });
        mockStatSync.mockImplementation((p: string) => {
          if (p === testDir) return { isDirectory: () => true };
          return { size: 4096 };
        });
        mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');

        await service.buildAndSign(VALID_UUID);

        const bashCall = mockExecFileAsync.mock.calls.find(c => c[0] === 'bash');
        const { env } = bashCall![2] as { env: Record<string, string | undefined> };
        for (const name of Object.keys(secrets)) expect(env).not.toHaveProperty(name);
        // What a build does need is still there.
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.GOOS).toBe('windows');
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });

    it('surfaces the end of stdout when build_all.sh fails with empty stderr', async () => {
      mockExistsSync.mockImplementation((p: string) => p === testDir || p === `${testDir}/build_all.sh`);
      mockReaddirSync.mockReturnValue([]);
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 4096 };
      });
      mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');
      // A script whose signing error went to stdout before `set -e` exited
      mockExecFileAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'bash') {
          throw Object.assign(new Error('Command failed: bash build_all.sh\n'), {
            code: 1,
            stderr: '',
            stdout: '[SUCCESS] Built: out.exe\n[ERROR] Signing failed — aborting (fail-loud)\n',
          });
        }
        return { stdout: '', stderr: '' };
      });

      const failure = service.buildAndSign(VALID_UUID);
      await expect(failure).rejects.toBeInstanceOf(BuildError);
      await expect(failure).rejects.toThrow('[ERROR] Signing failed — aborting (fail-loud)');
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

    it('falls back to the first file in a build/<uuid> folder when no candidate exists', async () => {
      const repoBuildDir = `/build/${VALID_UUID}`;
      const testBuildDir = `${testDir}/build/${VALID_UUID}`;

      mockExistsSync.mockImplementation((p: string) =>
        p === testDir || p === `${testDir}/build_all.sh` || p === repoBuildDir || p === testBuildDir);
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === repoBuildDir) return []; // empty: try the next base
        if (p === testBuildDir) return ['orchestrator.exe', 'second.exe'];
        return [];
      });
      mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');

      const info = await service.buildAndSign(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(mockReaddirSync).toHaveBeenCalledWith(repoBuildDir);
      expect(mockCopyFileSync).toHaveBeenCalledTimes(1);
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        `${testBuildDir}/orchestrator.exe`,
        `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`,
      );
    });

    it('still fails when neither a candidate nor a build/<uuid> file exists', async () => {
      mockExistsSync.mockImplementation((p: string) => p === testDir || p === `${testDir}/build_all.sh`);
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        return { size: 2048 };
      });
      mockReaddirSync.mockReturnValue([]);
      mockReadFileSync.mockReturnValue('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"');

      await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow('build_all.sh completed but output binary not found');
      expect(mockCopyFileSync).not.toHaveBeenCalled();
    });

    it('records a per-OS binaries map for a cross-platform build_all.sh build', async () => {
      const repoRoot = '/';
      // Dual-platform test: untagged main + per-OS logger files drive detection.
      mockReaddirSync.mockReturnValue([`${VALID_UUID}.go`, 'logger_windows.go', 'logger_linux.go']);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === testDir) return true;
        if (p === `${testDir}/build_all.sh`) return true;
        // build_all.sh emits BOTH OS artifacts in one run (repo-root build dir).
        if (p === `${repoRoot}build/${VALID_UUID}/${VALID_UUID}.exe`) return true;
        if (p === `${repoRoot}build/${VALID_UUID}/${VALID_UUID}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === testDir) return { isDirectory: () => true };
        if (typeof p === 'string' && p.endsWith('.exe')) return { size: 4096 };
        return { size: 2048 };
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('_windows.go')) return '//go:build windows\npackage main';
        if (typeof p === 'string' && p.endsWith('_linux.go')) return '//go:build linux\npackage main';
        if (typeof p === 'string' && p.endsWith('build_all.sh')) return 'SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"';
        return 'package main';
      });

      await service.buildAndSign(VALID_UUID);

      const metaWrite = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('build-meta.json'),
      );
      expect(metaWrite).toBeDefined();
      const meta = JSON.parse(metaWrite![1] as string);
      expect(meta.binaries.windows.filename).toBe(`${VALID_UUID}.exe`);
      expect(meta.binaries.linux.filename).toBe(VALID_UUID);
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

    it('falls back to global platform when secondary files carry conflicting OS tags', async () => {
      // Dual-platform test shape: untagged main + linux and windows companions.
      // Regression test: previously the alphabetically-first tag (linux) won,
      // producing an extensionless Linux binary for Windows agents.
      setupBuildWithGoSource(
        'package main\nfunc main() {}\n',
        {
          'orchestrator_embed_linux.go': '//go:build linux\npackage main\n',
          'orchestrator_embed_windows.go': '//go:build windows\npackage main\n',
          'test_logger_linux.go': '//go:build linux\npackage main\n',
          'test_logger_windows.go': '//go:build windows\npackage main\n',
        },
      );

      const result = await service.buildAndSign(VALID_UUID);

      // Global setting is windows/amd64 from createMockSettingsService
      expect(result.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(result.filename).toBe(`${VALID_UUID}.exe`);
    });

    it('detects OS when multiple secondary files agree on a single tag', async () => {
      setupBuildWithGoSource(
        'package main\nfunc main() {}\n',
        {
          'test_logger_linux.go': '//go:build linux\npackage main\n',
          'stage1_paths_linux.go': '//go:build linux\npackage main\n',
        },
      );

      const result = await service.buildAndSign(VALID_UUID);

      expect(result.platform).toEqual({ os: 'linux', arch: 'amd64' });
      expect(result.filename).toBe(VALID_UUID);
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

  // ── Build jobs ────────────────────────────────────────────

  describe('build jobs', () => {
    it('runs buildAndSign once, joins a running build, and records the outcome', async () => {
      let finish!: (info: BuildInfo) => void;
      const spy = vi.spyOn(service, 'buildAndSign').mockImplementation(
        () => new Promise<BuildInfo>((resolve) => { finish = resolve; }),
      );

      const first = service.startBuild(VALID_UUID);
      const second = service.startBuild(VALID_UUID);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(VALID_UUID);
      expect(second.promise).toBe(first.promise);
      expect(service.isBuilding(VALID_UUID)).toBe(true);
      expect(service.getBuildJob(VALID_UUID)?.status).toBe('running');

      finish({ exists: true });
      await first.promise;

      expect(service.isBuilding(VALID_UUID)).toBe(false);
      expect(service.getBuildJob(VALID_UUID)?.status).toBe('succeeded');
    });

    it('logs a failed build once, even when callers joined it', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(service, 'buildAndSign').mockRejectedValue(new Error('go build: undefined: foo'));

      const first = service.startBuild(VALID_UUID);
      service.startBuild(VALID_UUID);
      await expect(first.promise).rejects.toThrow('go build: undefined: foo');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('Build failed for %s: %s', VALID_UUID, 'go build: undefined: foo');
      errorSpy.mockRestore();
    });

    it('never puts the test id into the log format string', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const hostileId = 'x%s%o';
      vi.spyOn(service, 'buildAndSign').mockRejectedValue(new Error('boom'));

      await expect(service.startBuild(hostileId).promise).rejects.toThrow('boom');

      expect(errorSpy.mock.calls[0][0]).not.toContain(hostileId);
      errorSpy.mockRestore();
    });

    it('has no job for a test that was never built in this process', () => {
      expect(service.getBuildJob(VALID_UUID)).toBeUndefined();
      expect(service.isBuilding(VALID_UUID)).toBe(false);
    });

    it('serializes builds for different tests (one slot, FIFO)', async () => {
      const otherUuid = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890';
      let finishFirst!: (info: BuildInfo) => void;
      const spy = vi.spyOn(service, 'buildAndSign').mockImplementation((id: string) =>
        id === VALID_UUID
          ? new Promise<BuildInfo>((resolve) => { finishFirst = resolve; })
          : Promise.resolve({ exists: true }),
      );

      const first = service.startBuild(VALID_UUID);
      const second = service.startBuild(otherUuid);

      // The first build holds the only slot; the second is accepted (its job
      // reads "running") but buildAndSign hasn't been invoked for it yet.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(VALID_UUID);
      expect(service.getBuildJob(otherUuid)?.status).toBe('running');

      finishFirst({ exists: true });
      await first.promise;
      await second.promise;

      // The second build ran only after the first released the slot.
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(otherUuid);
    });
  });
  // ── Version stamp ─────────────────────────────────────────

  describe('version stamp', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;
    const binaryPath = `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`;
    const binaryBytes = Buffer.from('built binary bytes');
    const binarySha = createHash('sha256').update(binaryBytes).digest('hex');
    const depBytes = Buffer.from('embedded dependency');
    const identity: TestVersionIdentity = {
      fingerprint: 'f'.repeat(64),
      source_hash: 's'.repeat(64),
      shared_hash: 'h'.repeat(64),
      test_tree: 'tree123',
      commit: 'abc1234',
      commit_date: '2026-11-01T00:00:00Z',
      provenance: 'upstream',
    };

    function stampedService(current: BuildVersionSource['current']) {
      return new BuildService(
        createMockSettingsService(), TESTS_SOURCE, { current },
      );
    }

    function writtenMeta() {
      const write = mockWriteFileSync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('build-meta.json'),
      );
      expect(write).toBeDefined();
      return JSON.parse(write![1] as string);
    }

    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) => p === testDir || p === `${testDir}/dep.dat`);
      mockStatSync.mockImplementation((p: string) =>
        p === testDir ? { isDirectory: () => true } : { size: 2048 });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === binaryPath) return binaryBytes;
        if (p === `${testDir}/main.go`) return '//go:embed dep.dat\nvar dep []byte\n';
        if (p === `${testDir}/dep.dat`) return depBytes;
        throw new Error(`unexpected read ${p}`);
      });
    });

    it('a successful build writes version with fingerprint, commit, modified:false, deps_hash and a sha256 for every file in binaries', async () => {
      const svc = stampedService(async () => ({ identity, modified: false }));

      const info = await svc.buildAndSign(VALID_UUID);

      const meta = writtenMeta();
      expect(meta.version).toEqual({
        ...identity,
        deps_hash: svc.currentDepsHash(VALID_UUID),
        // dep.dat is uploaded, not built: no embedded file the build produces
        outputs_hash: null,
        modified: false,
        binaries: { [`${VALID_UUID}.exe`]: binarySha },
      });
      expect(meta.version.deps_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(meta.version.binaries)).toEqual(
        Object.values(meta.binaries as Record<string, { filename: string }>).map(b => b.filename),
      );
      // getBuildInfo hands the stamp back
      mockExistsSync.mockImplementation((p: string) => p.endsWith('build-meta.json') || p === binaryPath);
      mockReadFileSync.mockReturnValue(JSON.stringify(meta));
      expect(svc.getBuildInfo(VALID_UUID).version).toEqual(meta.version);
      expect(info.exists).toBe(true);
    });

    it('currentDepsHash is null without embed dependencies and changes with their content', () => {
      mockReadFileSync.mockImplementation((p: string) =>
        p === `${testDir}/main.go` ? 'package main' : Buffer.from('x'));
      expect(createService().currentDepsHash(VALID_UUID)).toBeNull();

      const first = (() => {
        mockReadFileSync.mockImplementation((p: string) =>
          p === `${testDir}/main.go` ? '//go:embed dep.dat\nvar d []byte' : depBytes);
        return createService().currentDepsHash(VALID_UUID);
      })();
      mockReadFileSync.mockImplementation((p: string) =>
        p === `${testDir}/main.go` ? '//go:embed dep.dat\nvar d []byte' : Buffer.from('other'));
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(createService().currentDepsHash(VALID_UUID)).not.toBe(first);
    });

    it('versionSource.current is called before the compile step', async () => {
      const order: string[] = [];
      mockExecFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
        order.push(`exec:${cmd} ${args[0]}`);
        return { stdout: '', stderr: '' };
      });
      const svc = stampedService(async () => {
        order.push('current');
        return { identity, modified: false };
      });

      await svc.buildAndSign(VALID_UUID);

      expect(order[0]).toBe('current');
      expect(order.some(o => o.startsWith('exec:go build'))).toBe(true);
    });

    describe('identity read again after the build', () => {
      function sequence(...reads: Array<() => Promise<{ identity: TestVersionIdentity; modified: boolean } | null>>) {
        const current = vi.fn<BuildVersionSource['current']>();
        for (const read of reads) current.mockImplementationOnce(read);
        return current;
      }
      const same = async () => ({ identity, modified: false });

      function expectNoStampWarning(warn: ReturnType<typeof vi.spyOn>, info: BuildInfo) {
        expect(info.exists).toBe(true);
        expect(info).not.toHaveProperty('version');
        expect(writtenMeta()).not.toHaveProperty('version');
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = warn.mock.calls[0].map(String).join(' ');
        expect(logged).toContain(VALID_UUID);
        expect(logged).toContain('source changed while it was being built');
      }

      it('a build during which the library commit changed gets no stamp and a warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const current = sequence(same, async () => ({ identity: { ...identity, commit: 'def5678' }, modified: false }));
        try {
          const info = await stampedService(current).buildAndSign(VALID_UUID);
          expect(current).toHaveBeenCalledTimes(2);
          expectNoStampWarning(warn, info);
        } finally {
          warn.mockRestore();
        }
      });

      it('a build during which the test\'s fingerprint changed gets no stamp', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // A test without git: no commit, only the folder's fingerprint.
        const noGit = { ...identity, commit: null, commit_date: null, test_tree: null, provenance: 'custom' as const };
        const current = sequence(
          async () => ({ identity: noGit, modified: false }),
          async () => ({ identity: { ...noGit, fingerprint: 'e'.repeat(64), source_hash: 't'.repeat(64) }, modified: false }),
        );
        try {
          expectNoStampWarning(warn, await stampedService(current).buildAndSign(VALID_UUID));
        } finally {
          warn.mockRestore();
        }
      });

      it.each([
        ['throws', async () => { throw new Error('git unavailable'); }],
        ['returns null', async () => null],
      ])('the second identity read failing voids the stamp (%s)', async (_label, second) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          expectNoStampWarning(warn, await stampedService(sequence(same, second)).buildAndSign(VALID_UUID));
        } finally {
          warn.mockRestore();
        }
      });

      it('an unchanged identity still stamps, and versionSource.current is called twice, the first time before the compile', async () => {
        const order: string[] = [];
        mockExecFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
          order.push(`exec:${cmd} ${args[0]}`);
          return { stdout: '', stderr: '' };
        });
        const current = vi.fn<BuildVersionSource['current']>(async () => {
          order.push('current');
          return { identity, modified: false };
        });

        const info = await stampedService(current).buildAndSign(VALID_UUID);

        expect(current).toHaveBeenCalledTimes(2);
        expect(order[0]).toBe('current');
        expect(order[order.length - 1]).toBe('current');
        expect(order.findIndex(o => o.startsWith('exec:go build'))).toBeGreaterThan(0);
        expect(info.version).toMatchObject({ ...identity, modified: false });
        expect(writtenMeta().version).toMatchObject({ fingerprint: identity.fingerprint, commit: identity.commit });
      });
    });

    it('modified source gives version.modified === true', async () => {
      const svc = stampedService(async () => ({ identity, modified: true }));
      await svc.buildAndSign(VALID_UUID);
      expect(writtenMeta().version.modified).toBe(true);
    });

    it.each([
      ['throws', async () => { throw new Error('git unavailable'); }, 'git unavailable'],
      ['returns null', async () => null, 'no version'],
    ])('versionSource.current %s: the build still succeeds with no version, and says why', async (_label, current, why) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const svc = stampedService(current);

      const info = await svc.buildAndSign(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(writtenMeta()).not.toHaveProperty('version');
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(' ');
      expect(logged).toContain(VALID_UUID);
      expect(logged).toContain(why);
      warn.mockRestore();
    });

    it('a git error from versionSource.current is logged without the credential', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const saved = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'tok-placeholder-123';
      try {
        const svc = stampedService(async () => {
          throw new Error('fatal: unable to access https://x-access-token:tok-placeholder-123@example.invalid/lib.git');
        });
        await svc.buildAndSign(VALID_UUID);
        const logged = warn.mock.calls[0].map(String).join(' ');
        expect(logged).toContain('unable to access');
        expect(logged).not.toContain('tok-placeholder-123');
      } finally {
        if (saved === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = saved;
        warn.mockRestore();
      }
    });

    it('an artifact that cannot be hashed leaves no stamp, and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === binaryPath) throw new Error('EACCES: permission denied');
        if (p === `${testDir}/main.go`) return '//go:embed dep.dat\nvar dep []byte\n';
        if (p === `${testDir}/dep.dat`) return depBytes;
        throw new Error(`unexpected read ${p}`);
      });
      const svc = stampedService(async () => ({ identity, modified: false }));

      const info = await svc.buildAndSign(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(writtenMeta()).not.toHaveProperty('version');
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0].map(String).join(' ');
      expect(logged).toContain(VALID_UUID);
      expect(logged).toContain('EACCES');
      warn.mockRestore();
    });

    it('no versionSource passed: build works, no version', async () => {
      const info = await createService().buildAndSign(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(writtenMeta()).not.toHaveProperty('version');
      expect(info).not.toHaveProperty('version');
    });

    it('uploadBinary writes no version, and removes one left by an earlier build', () => {
      const svc = stampedService(async () => ({ identity, modified: false }));
      const peBytes = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(10)]);

      svc.uploadBinary(VALID_UUID, peBytes);

      // The metadata is rewritten whole, so a stamp from an earlier build is gone
      expect(writtenMeta()).not.toHaveProperty('version');
      expect(writtenMeta().source).toBe('uploaded');
    });
  });

  describe('version stamp — embedded files a build_all.sh produces (outputs hash)', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;
    const stageName = `${VALID_UUID}-T1.exe`;
    const identity: TestVersionIdentity = {
      fingerprint: 'f'.repeat(64),
      source_hash: 's'.repeat(64),
      shared_hash: 'h'.repeat(64),
      test_tree: null,
      commit: null,
      commit_date: null,
      provenance: 'custom',
    };

    // A small in-memory filesystem behind the fs mocks, so build_all.sh can
    // "write" its outputs and the hashes read them back.
    const files = new Map<string, Buffer>();
    const dirs = new Set<string>();
    // mtime per file (ms); a file without one was written "now".
    const mtimes = new Map<string, number>();
    let buildRuns = 0;
    let removeStageAtEnd = false;

    function addDir(p: string): void {
      for (let d = p; d !== '/' && !dirs.has(d); d = d.slice(0, d.lastIndexOf('/')) || '/') dirs.add(d);
      dirs.add('/');
    }
    function put(p: string, content: string | Buffer): void {
      addDir(p.slice(0, p.lastIndexOf('/')) || '/');
      files.set(p, Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf8'));
    }
    function enoent(p: string): Error {
      return Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    }

    function service() {
      return new BuildService(createMockSettingsService(), TESTS_SOURCE, {
        current: async () => ({ identity, modified: false }),
      });
    }
    function writtenStamp() {
      const write = [...mockWriteFileSync.mock.calls].reverse().find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('build-meta.json'),
      );
      expect(write).toBeDefined();
      return JSON.parse(String(write![1])).version;
    }

    beforeEach(() => {
      // This suite's files model the markers too.
      markerStore.enabled = false;
      files.clear();
      dirs.clear();
      mtimes.clear();
      buildRuns = 0;
      removeStageAtEnd = false;
      put(`${testDir}/main.go`, [
        'package main',
        '//go:embed generated',
        'var certs embed.FS',
        `//go:embed ${stageName}`,
        'var stage []byte',
        '//go:embed payload.dat',
        'var payload []byte',
        '',
      ].join('\n'));
      put(`${testDir}/stage-T1.go`, 'package main\n');
      put(`${testDir}/build_all.sh`, [
        'SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"',
        'mkdir -p generated',
        `go build -o ${stageName} stage-T1.go`,
        '',
      ].join('\n'));
      // Written by the test author into the folder the script also creates.
      put(`${testDir}/generated/authored.txt`, 'hand-written');
      // Uploaded (not source-built): covered by deps_hash.
      put(`${testDir}/payload.dat`, 'uploaded payload');

      const exists = (p: string) => files.has(p) || dirs.has(p);
      mockExistsSync.mockImplementation(exists);
      mockStatSync.mockImplementation((p: string) => {
        if (!exists(p)) throw enoent(p);
        return {
          isDirectory: () => dirs.has(p), isFile: () => files.has(p), size: files.get(p)?.length ?? 0,
          mtimeMs: mtimes.get(p) ?? Date.now(),
        };
      });
      mockLstatSync.mockImplementation(((p: string) => {
        if (!exists(p)) throw enoent(p);
        return { isSymbolicLink: () => false, isFile: () => files.has(p), isDirectory: () => dirs.has(p) };
      }) as never);
      mockReaddirSync.mockImplementation(((p: string) => {
        if (!dirs.has(p)) throw enoent(p);
        const names = new Set<string>();
        for (const entry of [...files.keys(), ...dirs]) {
          if (entry !== p && entry.startsWith(`${p}/`)) names.add(entry.slice(p.length + 1).split('/')[0]);
        }
        return [...names].sort();
      }) as never);
      mockReadFileSync.mockImplementation(((p: string, enc?: unknown) => {
        const b = files.get(p);
        if (!b) throw enoent(p);
        return enc ? b.toString('utf8') : b;
      }) as never);
      mockWriteFileSync.mockImplementation(((p: string, data: string | Buffer, opts?: { flag?: string }) => {
        if (opts?.flag === 'wx' && files.has(p)) {
          throw Object.assign(new Error(`EEXIST: ${p}`), { code: 'EEXIST' });
        }
        mtimes.set(p, Date.now());
        put(p, data);
      }) as never);
      mockRenameSync.mockImplementation(((from: string, to: string) => {
        if (dirs.has(from)) {
          // A directory: move everything under it.
          for (const f of [...files.keys()]) {
            if (!f.startsWith(`${from}/`)) continue;
            const moved = `${to}${f.slice(from.length)}`;
            const mtime = mtimes.get(f);
            put(moved, files.get(f)!);
            if (mtime !== undefined) mtimes.set(moved, mtime);
            files.delete(f);
            mtimes.delete(f);
          }
          for (const d of [...dirs]) {
            if (d === from || d.startsWith(`${from}/`)) {
              dirs.delete(d);
              addDir(`${to}${d.slice(from.length)}`);
            }
          }
          return;
        }
        const b = files.get(from);
        if (!b) throw enoent(from);
        const mtime = mtimes.get(from);
        files.delete(from);
        mtimes.delete(from);
        put(to, b);
        if (mtime !== undefined) mtimes.set(to, mtime);
        else mtimes.delete(to);
      }) as never);
      mockUtimesSync.mockImplementation(((p: string, _atime: Date, mtime: Date) => {
        if (!files.has(p)) throw enoent(p);
        mtimes.set(p, mtime.getTime());
      }) as never);
      mockRmSync.mockImplementation(((p: string) => {
        for (const f of [...files.keys()]) if (f === p || f.startsWith(`${p}/`)) { files.delete(f); mtimes.delete(f); }
        for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
      }) as never);
      mockCopyFileSync.mockImplementation(((from: string, to: string) => {
        const b = files.get(from);
        if (!b) throw enoent(from);
        put(to, b);
      }) as never);
      mockMkdirSync.mockImplementation(((p: string) => addDir(p)) as never);
      mockUnlinkSync.mockImplementation(((p: string) => {
        if (!files.delete(p)) throw enoent(p);
        mtimes.delete(p);
      }) as never);
      mockExecFileAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'bash') {
          buildRuns++;
          // What the script makes: a generated file, the stage, the output.
          put(`${testDir}/generated/cert.pem`, `generated by run ${buildRuns}`);
          put(`${testDir}/${stageName}`, `stage binary ${buildRuns}`);
          put(`${testDir}/build/${VALID_UUID}/${VALID_UUID}.exe`, 'orchestrator');
          if (removeStageAtEnd) {
            files.delete(`${testDir}/${stageName}`);
            files.delete(`${testDir}/generated/cert.pem`);
            files.delete(`${testDir}/generated/authored.txt`);
            dirs.delete(`${testDir}/generated`);
          }
        }
        return { stdout: '', stderr: '' };
      });
    });

    afterEach(() => {
      // Hand the later suites back the default fs mocks (plain no-ops, and
      // lstat following existsSync).
      for (const m of [mockWriteFileSync, mockCopyFileSync, mockMkdirSync, mockUnlinkSync, mockRenameSync, mockUtimesSync, mockRmSync]) {
        m.mockImplementation(() => undefined);
      }
      markerStore.enabled = true;
      mockLstatSync.mockImplementation((p: string) => {
        if (!mockExistsSync(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
      });
    });

    it('classes the folder and the stage as source-built and the payload as uploaded', () => {
      const deps = service().getEmbedDependencies(VALID_UUID);
      expect(deps.map(d => [d.filename, d.sourceBuilt])).toEqual([
        ['generated', true], [stageName, true], ['payload.dat', false],
      ]);
    });

    it('stamps outputs_hash from the source-built embeds as they are after the build', async () => {
      const svc = service();
      const beforeBuild = svc.currentOutputsHash(VALID_UUID);

      await svc.buildAndSign(VALID_UUID);

      const stamp = writtenStamp();
      expect(stamp.outputs_hash).toMatch(/^[0-9a-f]{64}$/);
      // Taken after the build: it covers what the build wrote, not what was there before.
      expect(stamp.outputs_hash).not.toBe(beforeBuild);
      expect(svc.currentOutputsHash(VALID_UUID)).toBe(stamp.outputs_hash);
      // The uploaded payload stays in deps_hash, not in the outputs hash.
      expect(stamp.deps_hash).toBe(svc.currentDepsHash(VALID_UUID));
      put(`${testDir}/payload.dat`, 'another payload');
      expect(svc.currentOutputsHash(VALID_UUID)).toBe(stamp.outputs_hash);
    });

    it('currentOutputsHash changes when a file inside a source-built folder is edited', async () => {
      const svc = service();
      await svc.buildAndSign(VALID_UUID);
      const stamped = writtenStamp().outputs_hash;

      put(`${testDir}/generated/authored.txt`, 'hand-written, edited');

      expect(svc.currentOutputsHash(VALID_UUID)).not.toBe(stamped);
      expect(svc.currentDepsHash(VALID_UUID)).toBe(writtenStamp().deps_hash);
    });

    it('outputs_hash is null when the build leaves no source-built embed behind', async () => {
      removeStageAtEnd = true;
      const svc = service();
      await svc.buildAndSign(VALID_UUID);
      expect(writtenStamp().outputs_hash).toBeNull();
      expect(svc.currentOutputsHash(VALID_UUID)).toBeNull();
    });

    describe('build marker (.building)', () => {
      const marker = `${BUILDS_DIR}/${VALID_UUID}/.building`;
      // BUILD_TIMEOUT (300 s) + the 60 s signing timeout in buildService.ts.
      const STALE_AFTER_MS = 300_000 + 60_000;

      function bashAlso(fn: () => void): void {
        const base = mockExecFileAsync.getMockImplementation()!;
        mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
          const result = await base(cmd, args, opts);
          if (cmd === 'bash') fn();
          return result;
        });
      }

      it('a build creates .building in the build directory and removes it on success, on a failed compile and on a thrown error', async () => {
        const seen: boolean[] = [];
        bashAlso(() => { seen.push(files.has(marker)); });
        const svc = service();

        // success
        await svc.buildAndSign(VALID_UUID);
        expect(seen).toEqual([true]);
        expect(files.has(marker)).toBe(false);
        const created = mockWriteFileSync.mock.calls.find(c => c[0] === marker);
        expect(created?.[2]).toMatchObject({ flag: 'wx' });
        expect(String(created?.[1])).toContain(String(process.pid));

        // failed compile
        mockExecFileAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'bash') {
            seen.push(files.has(marker));
            throw Object.assign(new Error('exit 1'), { stderr: 'compile failed' });
          }
          return { stdout: '', stderr: '' };
        });
        await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow(/compile failed/);
        expect(seen).toEqual([true, true]);
        expect(files.has(marker)).toBe(false);

        // a thrown error after the script ran (no output binary)
        mockExecFileAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'bash') seen.push(files.has(marker));
          return { stdout: '', stderr: '' };
        });
        files.delete(`${testDir}/build/${VALID_UUID}/${VALID_UUID}.exe`);
        await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow('output binary not found');
        expect(seen).toEqual([true, true, true]);
        expect(files.has(marker)).toBe(false);
      });

      it('a second BuildService instance (simulating another worker, same BUILDS_DIR) reports isBuildingAnywhere true while the first is building, and false after', async () => {
        const worker = service();
        const other = service();
        const during: Array<[boolean, boolean]> = [];
        bashAlso(() => { during.push([other.isBuilding(VALID_UUID), other.isBuildingAnywhere(VALID_UUID)]); });

        expect(other.isBuildingAnywhere(VALID_UUID)).toBe(false);
        await worker.buildAndSign(VALID_UUID);

        // The other worker has no in-memory job, only the marker tells it.
        expect(during).toEqual([[false, true]]);
        expect(other.isBuildingAnywhere(VALID_UUID)).toBe(false);
      });

      it('a build is refused with the already-building error while a fresh marker from another process exists; a stale marker is replaced and the build runs', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          put(marker, '{"pid":1,"startedAt":"2026-11-23T00:00:00.000Z"}');
          mtimes.set(marker, Date.now() - 1_000);
          const svc = service();
          expect(svc.isBuildingAnywhere(VALID_UUID)).toBe(true);

          const refused = svc.buildAndSign(VALID_UUID);
          await expect(refused).rejects.toMatchObject({ statusCode: 409, message: 'Build in progress for this test' });
          expect(mockExecFileAsync.mock.calls.some(c => c[0] === 'bash')).toBe(false);
          // The other process's marker is left alone.
          expect(files.has(marker)).toBe(true);

          mtimes.set(marker, Date.now() - STALE_AFTER_MS - 1_000);
          expect(svc.isBuildingAnywhere(VALID_UUID)).toBe(false);

          const info = await svc.buildAndSign(VALID_UUID);
          expect(info.exists).toBe(true);
          expect(mockExecFileAsync.mock.calls.some(c => c[0] === 'bash')).toBe(true);
          expect(files.has(marker)).toBe(false);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
        } finally {
          warn.mockRestore();
        }
      });

      it('a dependency present before the build and missing at stamp time yields no stamp and a warning naming it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          // e.g. a Sync's `git clean` removes the uploaded payload after the compile
          bashAlso(() => { files.delete(`${testDir}/payload.dat`); });
          const svc = service();

          const info = await svc.buildAndSign(VALID_UUID);

          expect(info.exists).toBe(true);
          expect(info).not.toHaveProperty('version');
          const meta = JSON.parse(String(files.get(`${BUILDS_DIR}/${VALID_UUID}/build-meta.json`)));
          expect(meta).not.toHaveProperty('version');
          expect(warn).toHaveBeenCalledTimes(1);
          const logged = warn.mock.calls[0].map(String).join(' ');
          expect(logged).toContain(VALID_UUID);
          expect(logged).toContain('payload.dat');
        } finally {
          warn.mockRestore();
        }
      });

      it('.building is not reported as an artifact', async () => {
        const svc = service();
        // Only a marker: nothing is built.
        put(marker, '{}');
        expect(svc.getBuildInfo(VALID_UUID)).toEqual({ exists: false });
        expect(svc.listBuiltUuids()).toEqual([]);
        files.delete(marker);

        await svc.buildAndSign(VALID_UUID);
        const info = svc.getBuildInfo(VALID_UUID);
        const listed = svc.listBuiltUuids();
        put(marker, '{}');
        expect(svc.getBuildInfo(VALID_UUID)).toEqual(info);
        expect(svc.listBuiltUuids()).toEqual(listed);
        expect(listed).toEqual([VALID_UUID]);
      });

      // ── Owned markers (H1.1) ──────────────────────────────

      interface MarkerHandle { path: string; token: string }
      interface MarkerInternals {
        acquireBuildMarker(uuid: string): MarkerHandle;
        refreshBuildMarker(handle: MarkerHandle): void;
        releaseBuildMarker(handle: MarkerHandle, uuid: string): void;
      }
      const internals = (svc: InstanceType<typeof BuildService>) => svc as unknown as MarkerInternals;
      const FOREIGN = JSON.stringify({ pid: 4242, startedAt: '2026-11-23T00:00:00.000Z', token: 'f'.repeat(32) });
      const markerJson = () => JSON.parse(String(files.get(marker))) as { pid: number; startedAt: string; token: string };
      /** Files next to the marker a takeover may leave behind (temp file, claim). */
      const markerLeftovers = () => [...files.keys()].filter(f => f.startsWith(`${marker}.`));

      it('acquire returns the marker path and a random token that is in the file; release removes it', () => {
        const svc = service();
        const handle = internals(svc).acquireBuildMarker(VALID_UUID);
        expect(handle.path).toBe(marker);
        expect(handle.token).toMatch(/^[0-9a-f]{32}$/);
        expect(markerJson()).toEqual({ pid: process.pid, startedAt: expect.any(String), token: handle.token });
        // A second acquire gets a different token (and is refused while the first holds it).
        expect(thrownBy(() => internals(service()).acquireBuildMarker(VALID_UUID)))
          .toMatchObject({ statusCode: 409, message: 'Build in progress for this test' });
        internals(svc).refreshBuildMarker(handle);
        expect(markerJson().token).toBe(handle.token);
        internals(svc).releaseBuildMarker(handle, VALID_UUID);
        expect(files.has(marker)).toBe(false);
        const again = internals(svc).acquireBuildMarker(VALID_UUID);
        expect(again.token).not.toBe(handle.token);
        internals(svc).releaseBuildMarker(again, VALID_UUID);
      });

      it('release leaves a marker that holds another build\'s token in place, with one warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const svc = service();
          const handle = internals(svc).acquireBuildMarker(VALID_UUID);
          put(marker, FOREIGN);
          internals(svc).releaseBuildMarker(handle, VALID_UUID);
          expect(String(files.get(marker))).toBe(FOREIGN);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
        } finally {
          warn.mockRestore();
        }
      });

      it('refresh does not touch a marker that holds another build\'s token: it stops the build instead', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const svc = service();
          const handle = internals(svc).acquireBuildMarker(VALID_UUID);
          put(marker, FOREIGN);
          const old = Date.now() - 100_000;
          mtimes.set(marker, old);
          const err = thrownBy(() => internals(svc).refreshBuildMarker(handle));
          expect(err).toBeInstanceOf(BuildSupersededError);
          expect(err).toBeInstanceOf(BuildError);
          expect(err).toMatchObject({ message: 'Build was superseded by another build of this test' });
          expect(String(files.get(marker))).toBe(FOREIGN);
          expect(mtimes.get(marker)).toBe(old);
          expect(mockUtimesSync).not.toHaveBeenCalled();
          // The error is the report; release afterwards stays quiet and leaves the marker.
          internals(svc).releaseBuildMarker(handle, VALID_UUID);
          expect(String(files.get(marker))).toBe(FOREIGN);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      describe('two instances racing for the same stale marker', () => {
        const stale = JSON.stringify({ pid: 1, startedAt: '2026-11-23T00:00:00.000Z', token: '0'.repeat(32) });
        let warn: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
          warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
          put(marker, stale);
          mtimes.set(marker, Date.now() - STALE_AFTER_MS - 1_000);
        });
        afterEach(() => { warn.mockRestore(); });

        async function expectOneRan(first: Promise<BuildInfo>, second: Promise<BuildInfo>): Promise<void> {
          const [a, b] = await Promise.allSettled([first, second]);
          const ran = [a, b].filter(r => r.status === 'fulfilled');
          const refused = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
          expect(ran).toHaveLength(1);
          expect(refused).toHaveLength(1);
          expect(refused[0].reason).toMatchObject({ statusCode: 409, message: 'Build in progress for this test' });
          expect(buildRuns).toBe(1);
          expect(files.has(marker)).toBe(false);
          expect(markerLeftovers()).toEqual([]);
        }

        it('B judged the marker stale, then A took it over before B acted: B is refused', async () => {
          const a = service();
          const b = service();
          // B reads the stale marker; A's whole takeover runs right after that read.
          let aBuild: Promise<BuildInfo> | null = null;
          let started = false;
          const base = mockReadFileSync.getMockImplementation()!;
          mockReadFileSync.mockImplementation(((p: string, enc?: unknown) => {
            const result = base(p, enc);
            if (p === marker && !started) {
              started = true;
              aBuild = a.buildAndSign(VALID_UUID);
            }
            return result;
          }) as never);

          const bBuild = b.buildAndSign(VALID_UUID);
          expect(aBuild).not.toBeNull();
          await expectOneRan(aBuild!, bBuild);
        });

        it('B looks at the marker while A is replacing it: B is refused', async () => {
          const a = service();
          const b = service();
          let bBuild: Promise<BuildInfo> | null = null;
          let started = false;
          const base = mockRenameSync.getMockImplementation()!;
          mockRenameSync.mockImplementation(((from: string, to: string) => {
            if (to === marker && !started) {
              started = true;
              bBuild = b.buildAndSign(VALID_UUID);
            }
            return base(from, to);
          }) as never);

          const aBuild = a.buildAndSign(VALID_UUID);
          expect(bBuild).not.toBeNull();
          await expectOneRan(aBuild, bBuild!);
        });
      });

      describe('a build another build superseded stops (controller ruling)', () => {
        const SUPERSEDED = 'Build was superseded by another build of this test';
        const outputPath = `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`;
        const metaPath = `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`;
        let warn: ReturnType<typeof vi.spyOn>;
        beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
        afterEach(() => { warn.mockRestore(); });

        it('replaced while build_all.sh runs: stops before copying its outputs, writes no build-meta.json, leaves the other marker', async () => {
          bashAlso(() => { put(marker, FOREIGN); });
          const svc = service();

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toSatisfy(
            (e: unknown) => e instanceof BuildSupersededError && (e as Error).message === SUPERSEDED);

          expect(files.has(outputPath)).toBe(false);
          expect(files.has(metaPath)).toBe(false);
          expect(String(files.get(marker))).toBe(FOREIGN);
          // build_all.sh temp files are still cleaned up.
          expect([...files.keys()].filter(f => /\.build-patched\.sh$|\.tmp-inner-pass$/.test(f))).toEqual([]);
          expect(warn).not.toHaveBeenCalled();
        });

        it('replaced between two steps of a go build: the next step never runs, go.mod is restored, no build-meta.json', async () => {
          files.delete(`${testDir}/build_all.sh`);
          const originalGoMod = 'module example.test/original\n\ngo 1.22\n';
          put(`${testDir}/go.mod`, originalGoMod);
          const calls: string[] = [];
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
            calls.push(`${cmd} ${args.join(' ')}`);
            if (cmd === 'go' && args[0] === 'mod' && args[1] === 'tidy') {
              put(`${testDir}/go.mod`, 'module example.test/original\n\ngo 1.22\n\nrequire example.test/dep v1.0.0\n');
              put(`${testDir}/go.sum`, 'example.test/dep v1.0.0 h1:x=\n');
              put(marker, FOREIGN);
            }
            return { stdout: '', stderr: '' };
          });
          const svc = service();

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          expect(calls).toEqual(['go mod tidy']);
          expect(calls.some(c => c.startsWith('go mod download') || c.startsWith('go build'))).toBe(false);
          expect(String(files.get(`${testDir}/go.mod`))).toBe(originalGoMod);
          expect(files.has(`${testDir}/go.sum`)).toBe(false);
          expect(files.has(metaPath)).toBe(false);
          expect(files.has(outputPath)).toBe(false);
          expect(String(files.get(marker))).toBe(FOREIGN);
        });

        it('replaced while signing: the signed file never replaces the artifact, no build-meta.json', async () => {
          const svc = new BuildService(createMockSettingsService({
            getActiveCertPfxPath: vi.fn().mockReturnValue({ pfxPath: '/certs/active.pfx', password: 'pw' }),
          }), TESTS_SOURCE, { current: async () => ({ identity, modified: false }) });
          const base = mockExecFileAsync.getMockImplementation()!;
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
            if (cmd === 'osslsigncode') {
              put(`${outputPath}.signed`, 'signed by the superseded build');
              put(marker, FOREIGN);
              return { stdout: '', stderr: '' };
            }
            return base(cmd, args, opts);
          });

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          // What it copied while it still held the marker stays (see the report).
          expect(String(files.get(outputPath))).toBe('orchestrator');
          expect(files.has(`${outputPath}.signed`)).toBe(false);
          expect(files.has(`${BUILDS_DIR}/${VALID_UUID}/.tmp-pass`)).toBe(false);
          expect(files.has(metaPath)).toBe(false);
          expect(String(files.get(marker))).toBe(FOREIGN);
        });

        it('replaced during the stamp\'s identity read: the stamp\'s own check refuses it, and no build-meta.json is written', async () => {
          let reads = 0;
          const svc = new BuildService(createMockSettingsService(), TESTS_SOURCE, {
            current: async () => {
              if (++reads === 2) put(marker, FOREIGN);
              return { identity, modified: false };
            },
          });

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          expect(reads).toBe(2);
          expect(files.has(metaPath)).toBe(false);
          expect(String(files.get(marker))).toBe(FOREIGN);
          // The stamp's last-line check logged why it would not stamp.
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
        });

        it('a takeover that lands between the check and the touch stops the build at that refresh', async () => {
          // Touches: 1 before the first temp file, 2 right before bash.
          let touches = 0;
          mockUtimesSync.mockImplementation(((p: string, _atime: Date, mtime: Date) => {
            if (!files.has(p)) throw enoent(p);
            if (p === marker && ++touches === 2) put(marker, FOREIGN); // the other build renames its marker in
            mtimes.set(p, mtime.getTime());
          }) as never);

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          expect(touches).toBe(2);
          // Stopped at the refresh before bash: the step never ran.
          expect(buildRuns).toBe(0);
          expect(String(files.get(marker))).toBe(FOREIGN);
        });

        it('darwin: superseded before rcodesign stops the build there, as on Windows (rcodesign never runs)', async () => {
          const svc = new BuildService(createMockSettingsService({
            getPlatformSettings: vi.fn().mockReturnValue({ os: 'darwin', arch: 'arm64' }),
          }), TESTS_SOURCE, { current: async () => ({ identity, modified: false }) });
          const darwinOutput = `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}`;
          // Superseded right after the copy, i.e. at the refresh before
          // rcodesign. The marker then reads as ours again (at the stat that
          // follows the signing block), so only a build that stopped AT the
          // darwin refresh rejects.
          let ours: Buffer | undefined;
          const baseCopy = mockCopyFileSync.getMockImplementation()!;
          mockCopyFileSync.mockImplementation(((from: string, to: string) => {
            baseCopy(from, to);
            if (to === darwinOutput) {
              ours = files.get(marker);
              put(marker, FOREIGN);
            }
          }) as never);
          const baseStat = mockStatSync.getMockImplementation()!;
          mockStatSync.mockImplementation(((p: string) => {
            if (p === darwinOutput && ours && String(files.get(marker)) === FOREIGN) put(marker, ours);
            return baseStat(p);
          }) as never);
          const signers: string[] = [];
          const base = mockExecFileAsync.getMockImplementation()!;
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
            if (cmd === 'rcodesign') signers.push(cmd);
            return base(cmd, args, opts);
          });

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          expect(files.has(darwinOutput)).toBe(true);
          expect(signers).toEqual([]);
          expect(files.has(metaPath)).toBe(false);
        });

        it('a transient error reading the marker (EMFILE) is not "superseded": one warning, the build goes on and stamps', async () => {
          let failures = 1;
          const base = mockReadFileSync.getMockImplementation()!;
          mockReadFileSync.mockImplementation(((p: string, enc?: unknown) => {
            if (p === marker && failures > 0) {
              failures--;
              throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
            }
            return base(p, enc);
          }) as never);

          const info = await service().buildAndSign(VALID_UUID);

          expect(failures).toBe(0);
          expect(info.version).toBeDefined();
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
          expect(files.has(marker)).toBe(false);
        });

        it('a marker that is gone mid-build counts as superseded', async () => {
          bashAlso(() => { files.delete(marker); });

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(SUPERSEDED);

          expect(files.has(metaPath)).toBe(false);
          expect(files.has(outputPath)).toBe(false);
        });

        it('the async job of a superseded build ends failed with the message', async () => {
          const error = vi.spyOn(console, 'error').mockImplementation(() => {});
          try {
            bashAlso(() => { put(marker, FOREIGN); });
            const svc = service();

            const { promise } = svc.startBuild(VALID_UUID);
            await expect(promise).rejects.toThrow(SUPERSEDED);

            expect(svc.getBuildJob(VALID_UUID)).toMatchObject({ status: 'failed', error: SUPERSEDED });
            expect(error).toHaveBeenCalledWith('Build failed for %s: %s', VALID_UUID, SUPERSEDED);
          } finally {
            error.mockRestore();
          }
        });
      });

      describe('the previous stamp is voided before a build replaces the artifact (controller ruling)', () => {
        const metaPath = `${BUILDS_DIR}/${VALID_UUID}/build-meta.json`;
        const outputPath = `${BUILDS_DIR}/${VALID_UUID}/${VALID_UUID}.exe`;
        const readMeta = () => JSON.parse(String(files.get(metaPath))) as Record<string, unknown>;
        const withoutVersion = (m: Record<string, unknown>) => {
          const copy = { ...m };
          delete copy.version;
          return copy;
        };
        const metaTemps = () => [...files.keys()].filter(f => f.startsWith(`${metaPath}.`));
        let warn: ReturnType<typeof vi.spyOn>;
        beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
        afterEach(() => { warn.mockRestore(); });

        /** A successful build first, so there is a stamped build-meta.json to protect. */
        async function stampedBuild(svc = service()): Promise<{ raw: string; meta: Record<string, unknown> }> {
          await svc.buildAndSign(VALID_UUID);
          const raw = String(files.get(metaPath));
          const meta = JSON.parse(raw) as Record<string, unknown>;
          expect(meta.version).toBeDefined();
          return { raw, meta };
        }

        /** The plain path: no build_all.sh, go build writes `bytes` to its -o path (or fails). */
        function plainPath(goBuild: (out: string) => void): void {
          files.delete(`${testDir}/build_all.sh`);
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
            if (cmd === 'go' && args[0] === 'build') goBuild(args[2]);
            return { stdout: '', stderr: '' };
          });
        }

        it('a build that fails after its artifact was copied leaves build-meta.json without version, every other field intact', async () => {
          const prior = await stampedBuild();
          const base = mockStatSync.getMockImplementation()!;
          mockStatSync.mockImplementation(((p: string) => {
            if (p === outputPath) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
            return base(p);
          }) as never);

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow('EIO');

          mockStatSync.mockImplementation(base);
          expect(readMeta()).not.toHaveProperty('version');
          expect(readMeta()).toEqual(withoutVersion(prior.meta));
          expect(service().getBuildInfo(VALID_UUID)).toMatchObject({ exists: true, source: 'built' });
          expect(service().getBuildInfo(VALID_UUID)).not.toHaveProperty('version');
          expect(metaTemps()).toEqual([]);
          expect(warn).not.toHaveBeenCalled();
        });

        it('a superseded build that had reached the copy leaves build-meta.json without version', async () => {
          const prior = await stampedBuild();
          const svc = new BuildService(createMockSettingsService({
            getActiveCertPfxPath: vi.fn().mockReturnValue({ pfxPath: '/certs/active.pfx', password: 'pw' }),
          }), TESTS_SOURCE, { current: async () => ({ identity, modified: false }) });
          const base = mockExecFileAsync.getMockImplementation()!;
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
            if (cmd === 'osslsigncode') {
              put(marker, FOREIGN);
              return { stdout: '', stderr: '' };
            }
            return base(cmd, args, opts);
          });

          await expect(svc.buildAndSign(VALID_UUID)).rejects.toThrow('Build was superseded by another build of this test');

          expect(readMeta()).toEqual(withoutVersion(prior.meta));
        });

        it('build_all.sh exiting non-zero before any copy leaves the previous stamp untouched', async () => {
          const prior = await stampedBuild();
          mockExecFileAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'bash') throw Object.assign(new Error('exit 1'), { stderr: 'script failed' });
            return { stdout: '', stderr: '' };
          });

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(/script failed/);

          expect(String(files.get(metaPath))).toBe(prior.raw);
        });

        it('a go build compile error leaves the previous stamp untouched (the artifact is provably the stamped one)', async () => {
          plainPath(out => put(out, 'plain binary v1'));
          const prior = await stampedBuild();
          plainPath(() => { throw Object.assign(new Error('exit 1'), { stderr: './main.go:3: undefined: foo' }); });

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(/undefined: foo/);

          expect(String(files.get(metaPath))).toBe(prior.raw);
          expect(metaTemps()).toEqual([]);
        });

        it('a go build that wrote the artifact and then failed leaves the stamp voided', async () => {
          plainPath(out => put(out, 'plain binary v1'));
          const prior = await stampedBuild();
          plainPath(out => {
            put(out, 'half-written');
            throw Object.assign(new Error('exit 1'), { stderr: 'write failed' });
          });

          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(/write failed/);

          expect(readMeta()).toEqual(withoutVersion(prior.meta));
        });

        it('a superseded build whose go build fails never puts the old stamp back (review: Important)', async () => {
          plainPath(out => put(out, 'plain binary v1'));
          const prior = await stampedBuild();
          // The artifact is untouched (the hash would match), but another
          // build took the marker over while go build ran.
          plainPath(() => {
            put(marker, FOREIGN);
            throw Object.assign(new Error('exit 1'), { stderr: './main.go:3: undefined: foo' });
          });

          // The build's own error, not a superseded one.
          await expect(service().buildAndSign(VALID_UUID)).rejects.toThrow(/undefined: foo/);

          expect(readMeta()).toEqual(withoutVersion(prior.meta));
          expect(String(files.get(marker))).toBe(FOREIGN);
        });

        it('a successful rebuild ends with the new stamp', async () => {
          await stampedBuild();
          const newer = { ...identity, fingerprint: 'e'.repeat(64) };
          const svc = new BuildService(createMockSettingsService(), TESTS_SOURCE, {
            current: async () => ({ identity: newer, modified: false }),
          });

          await svc.buildAndSign(VALID_UUID);

          expect((readMeta().version as { fingerprint: string }).fingerprint).toBe(newer.fingerprint);
          expect(metaTemps()).toEqual([]);
          expect(warn).not.toHaveBeenCalled();
        });

        it('a failing rewrite only warns, once, with the uuid; the build still succeeds and stamps', async () => {
          await stampedBuild();
          const base = mockRenameSync.getMockImplementation()!;
          mockRenameSync.mockImplementation(((from: string, to: string) => {
            if (to === metaPath) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
            return base(from, to);
          }) as never);

          const info = await service().buildAndSign(VALID_UUID);

          expect(info.version).toBeDefined();
          expect(readMeta().version).toBeDefined();
          expect(metaTemps()).toEqual([]);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
        });

        it('an unparseable build-meta.json is left alone with one warning, and the build still succeeds', async () => {
          put(metaPath, 'not json{');

          const info = await service().buildAndSign(VALID_UUID);

          expect(info.version).toBeDefined();
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0].map(String).join(' ')).toContain(VALID_UUID);
        });

        it('uploadBinary writes its meta (no version) before the binary: a failed binary write never leaves the old stamp', async () => {
          await stampedBuild();
          const order: string[] = [];
          const base = mockWriteFileSync.getMockImplementation()!;
          mockWriteFileSync.mockImplementation(((p: string, ...rest: unknown[]) => {
            if (p === metaPath || p === outputPath) order.push(p === metaPath ? 'meta' : 'binary');
            if (p === outputPath) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
            return (base as (...a: unknown[]) => unknown)(p, ...rest);
          }) as never);

          expect(() => service().uploadBinary(VALID_UUID, Buffer.from([0x4D, 0x5A, 1, 2]))).toThrow('ENOSPC');

          expect(order).toEqual(['meta', 'binary']);
          expect(readMeta()).not.toHaveProperty('version');
          expect(readMeta()).toMatchObject({ source: 'uploaded' });
        });
      });

      it('a refreshed marker keeps a second instance\'s isBuildingAnywhere true past the stale bound', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
          vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
          const svc = new BuildService(createMockSettingsService({
            getActiveCertPfxPath: vi.fn().mockReturnValue({ pfxPath: '/certs/active.pfx', password: 'pw' }),
          }), TESTS_SOURCE, { current: async () => ({ identity, modified: false }) });
          const other = service();
          const seen: Array<[string, boolean]> = [];
          const base = mockExecFileAsync.getMockImplementation()!;
          // Each step takes 250 s: two steps outlast the 360 s bound from the start.
          mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
            seen.push([cmd, other.isBuildingAnywhere(VALID_UUID)]);
            vi.setSystemTime(Date.now() + 250_000);
            return base(cmd, args, opts);
          });

          await svc.buildAndSign(VALID_UUID);

          expect(seen.map(s => s[0])).toEqual(['bash', 'osslsigncode']);
          expect(seen.every(s => s[1])).toBe(true);
          expect(other.isBuildingAnywhere(VALID_UUID)).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    // ── Writes into a test folder hold the marker (H1.2) ─────

    describe('test folder lock (uploads and deletes)', () => {
      const marker = `${BUILDS_DIR}/${VALID_UUID}/.building`;
      const buildDir = `${BUILDS_DIR}/${VALID_UUID}`;
      const FOREIGN = JSON.stringify({ pid: 4242, startedAt: '2026-11-23T00:00:00.000Z', token: 'f'.repeat(32) });
      const pe = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(16, 0)]);

      interface Operation {
        name: string;
        /** The write the operation makes under the lock. */
        isWrite: (p: string) => boolean;
        run: (svc: InstanceType<typeof BuildService>) => unknown;
        mock: typeof mockWriteFileSync;
      }
      const operations: Operation[] = [
        {
          name: 'saveUploadedFile',
          isWrite: p => p === `${testDir}/payload.dat`,
          run: svc => svc.saveUploadedFile(VALID_UUID, 'payload.dat', Buffer.from('new payload')),
          mock: mockWriteFileSync,
        },
        {
          name: 'uploadBinary',
          isWrite: p => p === `${buildDir}/${VALID_UUID}.exe` || p === `${buildDir}/build-meta.json`,
          run: svc => svc.uploadBinary(VALID_UUID, pe),
          mock: mockWriteFileSync,
        },
        {
          name: 'deleteBuild',
          // The rename away is its first write; the removal follows.
          isWrite: p => p === buildDir,
          run: svc => svc.deleteBuild(VALID_UUID),
          mock: mockRenameSync,
        },
      ];

      beforeEach(() => {
        // An earlier build's output, so deleteBuild has something to remove.
        put(`${buildDir}/${VALID_UUID}.exe`, 'old binary');
      });

      /** Run `hook` inside the operation's own write, before it happens. */
      function duringWrite(op: Operation, hook: (p: string) => void): void {
        const base = op.mock.getMockImplementation()!;
        op.mock.mockImplementation(((...args: unknown[]) => {
          const p = String(args[0]);
          if (op.isWrite(p)) hook(p);
          return (base as (...a: unknown[]) => unknown)(...args);
        }) as never);
      }

      for (const op of operations) {
        describe(op.name, () => {
          it('holds the marker while it writes and releases it after', () => {
            const svc = service();
            const other = service();
            const during: Array<[boolean, boolean]> = [];
            duringWrite(op, () => { during.push([files.has(marker), other.isBuildingAnywhere(VALID_UUID)]); });

            op.run(svc);

            expect(during.length).toBeGreaterThan(0);
            expect(during.every(([held, seen]) => held && seen)).toBe(true);
            expect(files.has(marker)).toBe(false);
            expect(other.isBuildingAnywhere(VALID_UUID)).toBe(false);
            expect([...files.keys()].filter(f => f.startsWith(`${marker}.`))).toEqual([]);
          });

          it('releases the marker when the write throws', () => {
            const svc = service();
            duringWrite(op, () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); });

            expect(() => op.run(svc)).toThrow('ENOSPC');
            expect(files.has(marker)).toBe(false);
            expect(service().isBuildingAnywhere(VALID_UUID)).toBe(false);
          });

          it('is refused with the running-build 409 while another process\'s fresh marker exists, and writes nothing', () => {
            put(marker, FOREIGN);
            const svc = service();
            const writes: string[] = [];
            duringWrite(op, p => { writes.push(p); });

            expect(thrownBy(() => op.run(svc)))
              .toMatchObject({ statusCode: 409, message: 'Build in progress for this test' });
            expect(writes).toEqual([]);
            expect(String(files.get(marker))).toBe(FOREIGN);
          });

          it('a build another instance starts while it holds the marker is refused with 409', async () => {
            const svc = service();
            const other = service();
            let build: Promise<BuildInfo> | null = null;
            let started = false;
            duringWrite(op, () => {
              if (started) return;
              started = true;
              build = other.buildAndSign(VALID_UUID);
            });

            op.run(svc);

            expect(build).not.toBeNull();
            await expect(build).rejects.toMatchObject({ statusCode: 409, message: 'Build in progress for this test' });
            expect(buildRuns).toBe(0);
          });
        });
      }

      describe('deleteBuild renames the directory away before removing it (review)', () => {
        const underUuid = () => [...files.keys(), ...dirs].filter(f => f.startsWith(`${BUILDS_DIR}/${VALID_UUID}`));

        it('after a delete nothing named after the uuid remains in BUILDS_DIR', () => {
          put(`${buildDir}/build-meta.json`, '{}');
          service().deleteBuild(VALID_UUID);
          expect(underUuid()).toEqual([]);
        });

        it('listBuiltUuids never returns a .deleting- directory; the next delete of the test removes a leftover one', () => {
          const leftover = `${BUILDS_DIR}/${VALID_UUID}.deleting-0123456789abcdef`;
          put(`${leftover}/build-meta.json`, JSON.stringify({ filename: `${VALID_UUID}.exe`, platform: { os: 'windows', arch: 'amd64' } }));
          put(`${leftover}/${VALID_UUID}.exe`, 'old binary');
          files.delete(`${buildDir}/${VALID_UUID}.exe`);
          dirs.delete(buildDir);
          const svc = service();

          expect(svc.listBuiltUuids()).toEqual([]);

          svc.deleteBuild(VALID_UUID); // no build directory: only the leftover goes
          expect(underUuid()).toEqual([]);
        });

        it('a build started right after the rename is not affected by the removal', async () => {
          const svc = service();
          const other = service();
          let build: Promise<BuildInfo> | null = null;
          const base = mockRmSync.getMockImplementation()!;
          mockRmSync.mockImplementation(((p: string, opts?: unknown) => {
            if (p.includes('.deleting-') && !build) build = other.buildAndSign(VALID_UUID);
            return (base as (...a: unknown[]) => unknown)(p, opts);
          }) as never);

          svc.deleteBuild(VALID_UUID);

          expect(build).not.toBeNull();
          const info = await build!;
          expect(info.exists).toBe(true);
          expect(files.has(`${buildDir}/build-meta.json`)).toBe(true);
          expect(other.getBuildInfo(VALID_UUID)).toMatchObject({ exists: true, source: 'built' });
          expect(files.has(marker)).toBe(false);
          expect(underUuid().filter(f => f.includes('.deleting-'))).toEqual([]);
        });
      });

      it('with no contention the three operations behave as before', () => {
        const svc = service();
        svc.saveUploadedFile(VALID_UUID, 'payload.dat', Buffer.from('new payload'));
        expect(String(files.get(`${testDir}/payload.dat`))).toBe('new payload');
        const info = svc.uploadBinary(VALID_UUID, pe);
        expect(info).toMatchObject({ exists: true, source: 'uploaded', fileSize: pe.length });
        expect(svc.getBuildInfo(VALID_UUID)).toMatchObject({ exists: true, source: 'uploaded' });
        svc.deleteBuild(VALID_UUID);
        expect(dirs.has(buildDir)).toBe(false);
        expect(svc.getBuildInfo(VALID_UUID)).toEqual({ exists: false });
        // Deleting a build that is not there stays a no-op.
        mockRmSync.mockClear();
        svc.deleteBuild(VALID_UUID);
        expect(mockRmSync).not.toHaveBeenCalled();
        expect(files.has(marker)).toBe(false);
      });
    });

    describe('deps_hash', () => {
      // A compressed helper the script compiles, signs and gzips into the test
      // folder. No source-built rule matches the `.exe.gz` name, so it is
      // classed as external (uploaded) and covered by deps_hash.
      const helper = 'helper.exe.gz';

      function embedHelper(): void {
        put(`${testDir}/main.go`, `${files.get(`${testDir}/main.go`)!.toString('utf8')}//go:embed ${helper}\nvar helper []byte\n`);
        put(`${testDir}/build_all.sh`, `${files.get(`${testDir}/build_all.sh`)!.toString('utf8')}${[
          'go build -o helper.exe ./helper',
          'gzip -9 -k helper.exe',
          `mv helper.exe.gz "$SCRIPT_DIR/${helper}"`,
          '',
        ].join('\n')}`);
      }

      /** The script also writes the helper, with different bytes on every run (signature time, gzip header). */
      function scriptWritesHelper(): void {
        const base = mockExecFileAsync.getMockImplementation()!;
        mockExecFileAsync.mockImplementation(async (cmd: string, args: string[], opts?: unknown) => {
          const result = await base(cmd, args, opts);
          if (cmd === 'bash') put(`${testDir}/${helper}`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, buildRuns, 0x42]));
          return result;
        });
      }

      it('classes the script-produced helper as external', () => {
        embedHelper();
        const dep = service().getEmbedDependencies(VALID_UUID).find(d => d.filename === helper);
        expect(dep).toMatchObject({ sourceBuilt: false });
      });

      it('a build whose script produces an external-classed embed stamps deps_hash from the file as it is after the build', async () => {
        embedHelper();
        scriptWritesHelper();
        const svc = service();
        const beforeBuild = svc.currentDepsHash(VALID_UUID);
        expect(files.has(`${testDir}/${helper}`)).toBe(false);

        await svc.buildAndSign(VALID_UUID);

        const stamp = writtenStamp();
        expect(stamp.deps_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(stamp.deps_hash).not.toBe(beforeBuild);
        expect(stamp.deps_hash).toBe(svc.currentDepsHash(VALID_UUID));
      });

      it('a build whose script rewrites an external-classed embed that existed before stamps deps_hash from the rewritten file', async () => {
        embedHelper();
        scriptWritesHelper();
        put(`${testDir}/${helper}`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00]));
        const svc = service();
        const beforeBuild = svc.currentDepsHash(VALID_UUID);

        await svc.buildAndSign(VALID_UUID);

        const stamp = writtenStamp();
        expect(stamp.deps_hash).not.toBe(beforeBuild);
        expect(stamp.deps_hash).toBe(svc.currentDepsHash(VALID_UUID));
      });

      it('an uploaded dependency the build does not touch has the same deps_hash as before the build', async () => {
        const svc = service();
        const beforeBuild = svc.currentDepsHash(VALID_UUID);
        expect(beforeBuild).toMatch(/^[0-9a-f]{64}$/);

        await svc.buildAndSign(VALID_UUID);

        expect(writtenStamp().deps_hash).toBe(beforeBuild);
      });

      it('editing the dependency after the build changes currentDepsHash', async () => {
        embedHelper();
        scriptWritesHelper();
        const svc = service();
        await svc.buildAndSign(VALID_UUID);
        const stamp = writtenStamp();
        const statusInput = (currentDepsHash: string | null) => ({
          build: { exists: true, source: 'built' as const, version: stamp },
          synced: identity,
          published: undefined,
          publishedKnown: false,
          hasGit: false,
          currentDepsHash,
          currentOutputsHash: svc.currentOutputsHash(VALID_UUID),
        });
        expect(deriveStatus(statusInput(svc.currentDepsHash(VALID_UUID)))).toEqual({ status: 'up_to_date' });

        // Someone replaces the helper after the build: the binary no longer embeds what is on disk.
        put(`${testDir}/${helper}`, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x99, 0x99]));

        expect(svc.currentDepsHash(VALID_UUID)).not.toBe(stamp.deps_hash);
        expect(deriveStatus(statusInput(svc.currentDepsHash(VALID_UUID))))
          .toEqual({ status: 'rebuild_needed', reason: 'dependency_changed' });
      });
    });
  });
  // ── go.mod restore ────────────────────────────────────────

  describe('buildAndSign — pre-existing go.mod', () => {
    const testDir = `${TESTS_SOURCE}/cyber-hygiene/${VALID_UUID}`;
    const goMod = `${testDir}/go.mod`;
    const goSum = `${testDir}/go.sum`;
    const originalMod = Buffer.from('module original\n');
    const originalSum = Buffer.from('original sum\n');
    let files: Map<string, Buffer>;

    beforeEach(() => {
      files = new Map([[goMod, originalMod]]);
      mockExistsSync.mockImplementation((p: string) => p === testDir || files.has(p));
      mockStatSync.mockImplementation((p: string) =>
        p === testDir ? { isDirectory: () => true } : { size: 2048 });
      mockReaddirSync.mockReturnValue(['main.go']);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('.go')) return 'package main';
        const f = files.get(p);
        if (!f) throw new Error(`unexpected read ${p}`);
        return f;
      });
      mockWriteFileSync.mockImplementation((p: string, data: Buffer | string) => {
        files.set(p, Buffer.from(data));
      });
      mockUnlinkSync.mockImplementation((p: string) => { files.delete(p); });
      // tidy rewrites go.mod and creates/rewrites go.sum
      mockExecFileAsync.mockImplementation(async (_c: string, args: string[]) => {
        if (args.includes('tidy')) {
          files.set(goMod, Buffer.from('module tidied\n'));
          files.set(goSum, Buffer.from('tidy sum\n'));
        }
        return { stdout: '', stderr: '' };
      });
    });

    afterEach(() => {
      mockWriteFileSync.mockReset();
      mockUnlinkSync.mockReset();
    });

    it('a build of a test with its own go.mod restores go.mod to its original content afterwards', async () => {
      const seenByCompile: string[] = [];
      mockExecFileAsync.mockImplementation(async (_c: string, args: string[]) => {
        if (args.includes('tidy')) files.set(goMod, Buffer.from('module tidied\n'));
        if (args[0] === 'build') seenByCompile.push(files.get(goMod)!.toString());
        return { stdout: '', stderr: '' };
      });

      await service.buildAndSign(VALID_UUID);

      expect(seenByCompile).toEqual(['module tidied\n']); // compile used the tidied file
      expect(files.get(goMod)).toEqual(originalMod);
    });

    it('a go.sum created by the build is removed when none existed, and restored when one did', async () => {
      await service.buildAndSign(VALID_UUID);
      expect(files.has(goSum)).toBe(false);

      files.set(goMod, originalMod);
      files.set(goSum, originalSum);
      await service.buildAndSign(VALID_UUID);
      expect(files.get(goSum)).toEqual(originalSum);
      expect(files.get(goMod)).toEqual(originalMod);
    });

    it('the restore also happens when the compile fails', async () => {
      mockExecFileAsync.mockImplementation(async (_c: string, args: string[]) => {
        if (args.includes('tidy')) {
          files.set(goMod, Buffer.from('module tidied\n'));
          files.set(goSum, Buffer.from('tidy sum\n'));
        }
        if (args[0] === 'build') throw new Error('compile failed');
        return { stdout: '', stderr: '' };
      });

      await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow();

      expect(files.get(goMod)).toEqual(originalMod);
      expect(files.has(goSum)).toBe(false);
    });

    it('a restore failure is logged and does not fail the build', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockWriteFileSync.mockImplementation((p: string, data: Buffer | string) => {
        if (p === goMod) throw new Error('disk full');
        files.set(p, Buffer.from(data));
      });

      const info = await service.buildAndSign(VALID_UUID);

      expect(info.exists).toBe(true);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    describe('with a build_all.sh that runs go mod tidy', () => {
      const script = `${testDir}/build_all.sh`;
      const output = `/build/${VALID_UUID}/${VALID_UUID}.exe`;

      beforeEach(() => {
        files.set(script, Buffer.from('SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"\ngo mod tidy\n'));
        files.set(output, Buffer.from('MZ built'));
        mockExecFileAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'bash') {
            files.set(goMod, Buffer.from('module tidied\n'));
            files.set(goSum, Buffer.from('tidy sum\n'));
          }
          return { stdout: '', stderr: '' };
        });
      });

      it('restores go.mod to its original content and removes a go.sum the script created', async () => {
        await service.buildAndSign(VALID_UUID);

        expect(mockExecFileAsync.mock.calls.some(c => c[0] === 'bash')).toBe(true);
        expect(files.get(goMod)).toEqual(originalMod);
        expect(files.has(goSum)).toBe(false);
      });

      it('restores a go.sum that existed before the build', async () => {
        files.set(goSum, originalSum);

        await service.buildAndSign(VALID_UUID);

        expect(files.get(goSum)).toEqual(originalSum);
        expect(files.get(goMod)).toEqual(originalMod);
      });

      it('restores them when the script fails', async () => {
        mockExecFileAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'bash') {
            files.set(goMod, Buffer.from('module tidied\n'));
            files.set(goSum, Buffer.from('tidy sum\n'));
            throw Object.assign(new Error('exit 1'), { stderr: 'build failed' });
          }
          return { stdout: '', stderr: '' };
        });

        await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow();

        expect(files.get(goMod)).toEqual(originalMod);
        expect(files.has(goSum)).toBe(false);
      });

      it('a restore failure is logged and does not fail the build', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockWriteFileSync.mockImplementation((p: string, data: Buffer | string) => {
          if (p === goMod) throw new Error('disk full');
          files.set(p, Buffer.from(data));
        });

        const info = await service.buildAndSign(VALID_UUID);

        expect(info.exists).toBe(true);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      });

      it('a script failure is reported, not masked by a restore failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockWriteFileSync.mockImplementation((p: string, data: Buffer | string) => {
          if (p === goMod) throw new Error('disk full');
          files.set(p, Buffer.from(data));
        });
        mockExecFileAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'bash') throw Object.assign(new Error('exit 1'), { stderr: 'script broke' });
          return { stdout: '', stderr: '' };
        });

        await expect(service.buildAndSign(VALID_UUID)).rejects.toThrow(/script broke/);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      });
    });
  });
});
