import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockLstatSync = vi.fn();
const mockRealpathSync = vi.fn();
const mockOpenSync = vi.fn();
const mockFstatSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockCloseSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    lstatSync: mockLstatSync,
    realpathSync: mockRealpathSync,
    openSync: mockOpenSync,
    fstatSync: mockFstatSync,
    readFileSync: mockReadFileSync,
    closeSync: mockCloseSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { FileService } = await import('../fileService.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('FileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
    mockRealpathSync.mockImplementation((p: string) => p);
    mockOpenSync.mockReturnValue(41);
    mockFstatSync.mockReturnValue({ isFile: () => true, size: 100, dev: 1, ino: 2 });
    mockStatSync.mockReturnValue({ dev: 1, ino: 2 });
  });

  // ── readFileContent ────────────────────────────────────────

  describe('readFileContent', () => {
    it('reads file and detects Go type', () => {
      mockReadFileSync.mockReturnValue('package main');

      const result = FileService.readFileContent('/test/main.go', ['/test']);

      expect(result.content).toBe('package main');
      expect(result.type).toBe('go');
      expect(mockFstatSync).toHaveBeenCalledWith(41);
      expect(mockReadFileSync).toHaveBeenCalledWith(41, 'utf-8');
      expect(mockCloseSync).toHaveBeenCalledWith(41);
    });

    it('detects powershell type for .ps1', () => {
      mockReadFileSync.mockReturnValue('Write-Host "hi"');

      expect(FileService.readFileContent('/test/script.ps1', ['/test']).type).toBe('powershell');
    });

    it('detects markdown type for .md', () => {
      mockReadFileSync.mockReturnValue('# Title');

      expect(FileService.readFileContent('/test/README.md', ['/test']).type).toBe('markdown');
    });

    it('detects html, bash, json, yaml, kql, yara, ndjson types', () => {
      mockReadFileSync.mockReturnValue('content');

      const cases: [string, string][] = [
        ['/test/flow.html', 'html'],
        ['/test/run.sh', 'bash'],
        ['/test/config.json', 'json'],
        ['/test/config.yaml', 'yaml'],
        ['/test/config.yml', 'yaml'],
        ['/test/query.kql', 'kql'],
        ['/test/rule.yar', 'yara'],
        ['/test/rule.yara', 'yara'],
        ['/test/rules.ndjson', 'ndjson'],
      ];

      for (const [filePath, expectedType] of cases) {
        expect(FileService.readFileContent(filePath, ['/test']).type).toBe(expectedType);
      }
    });

    it('detects sigma type from filename pattern (overrides .yml extension)', () => {
      mockReadFileSync.mockReturnValue('title: test');

      expect(FileService.readFileContent('/test/abc_sigma_rules.yml', ['/test']).type).toBe('sigma');
    });

    it('detects ndjson type from elastic_rules filename pattern', () => {
      mockReadFileSync.mockReturnValue('{"rule":{}}');

      expect(FileService.readFileContent('/test/abc_elastic_rules.ndjson', ['/test']).type).toBe('ndjson');
    });

    it('defaults to text for unknown extensions', () => {
      mockReadFileSync.mockReturnValue('data');

      expect(FileService.readFileContent('/test/data.bin', ['/test']).type).toBe('text');
    });

    it('throws when file exceeds 5MB', () => {
      mockFstatSync.mockReturnValue({ isFile: () => true, size: 6 * 1024 * 1024, dev: 1, ino: 2 });

      expect(() => FileService.readFileContent('/test/huge.bin', ['/test']))
        .toThrow('Failed to read file');
    });

    it('throws generic error without exposing file path', () => {
      mockOpenSync.mockImplementation(() => { throw new Error('ENOENT'); });

      expect(() => FileService.readFileContent('/secret/path/file.go', ['/secret/path']))
        .toThrow('Failed to read file');
    });

    it('rejects a symbolic link in the candidate path', () => {
      mockLstatSync.mockImplementation((p: string) => ({
        isSymbolicLink: () => p === '/test/link.md',
      }));

      expect(() => FileService.readFileContent('/test/link.md', ['/test']))
        .toThrow('Failed to read file');
      expect(mockOpenSync).not.toHaveBeenCalled();
    });

    it('rejects a symbolic link in an intermediate directory', () => {
      mockLstatSync.mockImplementation((p: string) => ({
        isSymbolicLink: () => p === '/test/linked-directory',
      }));

      expect(() => FileService.readFileContent('/test/linked-directory/file.md', ['/test']))
        .toThrow('Failed to read file');
      expect(mockOpenSync).not.toHaveBeenCalled();
    });

    it('rejects a canonical target outside the allowed root', () => {
      mockRealpathSync.mockImplementation((p: string) => p === '/test/link.md' ? '/etc/passwd' : p);

      expect(() => FileService.readFileContent('/test/link.md', ['/test']))
        .toThrow('Failed to read file');
      expect(mockOpenSync).not.toHaveBeenCalled();
    });

    it('rejects a file swapped after the descriptor is opened', () => {
      mockStatSync.mockReturnValue({ dev: 9, ino: 9 });

      expect(() => FileService.readFileContent('/test/main.go', ['/test']))
        .toThrow('Failed to read file');
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockCloseSync).toHaveBeenCalledWith(41);
    });
  });

  // ── safeResolveWithinRoots ─────────────────────────────────

  describe('safeResolveWithinRoots', () => {
    it('returns the resolved path when candidate is inside a root', () => {
      const result = FileService.safeResolveWithinRoots('/var/lib/tests/abc/main.go', ['/var/lib/tests']);
      expect(result).toBe('/var/lib/tests/abc/main.go');
    });

    it('returns null when candidate escapes via ..', () => {
      const result = FileService.safeResolveWithinRoots('/var/lib/tests/../../etc/passwd', ['/var/lib/tests']);
      expect(result).toBeNull();
    });

    it('returns null when candidate is outside all roots', () => {
      const result = FileService.safeResolveWithinRoots('/tmp/evil', ['/var/lib/tests', '/opt/library']);
      expect(result).toBeNull();
    });

    it('returns the resolved path when candidate is inside any of multiple roots', () => {
      const result = FileService.safeResolveWithinRoots('/opt/library/xyz/file.md', ['/var/lib/tests', '/opt/library']);
      expect(result).toBe('/opt/library/xyz/file.md');
    });

    it('returns null when candidate equals the root (root itself is not a subpath)', () => {
      const result = FileService.safeResolveWithinRoots('/var/lib/tests', ['/var/lib/tests']);
      expect(result).toBeNull();
    });

    it('normalises redundant segments before checking containment', () => {
      const result = FileService.safeResolveWithinRoots('/var/lib/tests/./abc/./file.go', ['/var/lib/tests']);
      expect(result).toBe('/var/lib/tests/abc/file.go');
    });

    it('returns null when roots list is empty', () => {
      const result = FileService.safeResolveWithinRoots('/var/lib/tests/abc', []);
      expect(result).toBeNull();
    });
  });

  // ── fileExists ─────────────────────────────────────────────

  describe('fileExists', () => {
    it('returns true when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      expect(FileService.fileExists('/test/file.go')).toBe(true);
    });

    it('returns false when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(FileService.fileExists('/test/missing.go')).toBe(false);
    });
  });
});
