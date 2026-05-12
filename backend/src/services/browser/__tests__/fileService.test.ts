import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    readFileSync: mockReadFileSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { FileService } = await import('../fileService.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('FileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── readFileContent ────────────────────────────────────────

  describe('readFileContent', () => {
    it('reads file and detects Go type', () => {
      mockStatSync.mockReturnValue({ size: 100 });
      mockReadFileSync.mockReturnValue('package main');

      const result = FileService.readFileContent('/test/main.go');

      expect(result.content).toBe('package main');
      expect(result.type).toBe('go');
    });

    it('detects powershell type for .ps1', () => {
      mockStatSync.mockReturnValue({ size: 50 });
      mockReadFileSync.mockReturnValue('Write-Host "hi"');

      expect(FileService.readFileContent('/test/script.ps1').type).toBe('powershell');
    });

    it('detects markdown type for .md', () => {
      mockStatSync.mockReturnValue({ size: 50 });
      mockReadFileSync.mockReturnValue('# Title');

      expect(FileService.readFileContent('/test/README.md').type).toBe('markdown');
    });

    it('detects html, bash, json, yaml, kql, yara, ndjson types', () => {
      mockStatSync.mockReturnValue({ size: 10 });
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
        expect(FileService.readFileContent(filePath).type).toBe(expectedType);
      }
    });

    it('detects sigma type from filename pattern (overrides .yml extension)', () => {
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue('title: test');

      expect(FileService.readFileContent('/test/abc_sigma_rules.yml').type).toBe('sigma');
    });

    it('detects ndjson type from elastic_rules filename pattern', () => {
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue('{"rule":{}}');

      expect(FileService.readFileContent('/test/abc_elastic_rules.ndjson').type).toBe('ndjson');
    });

    it('defaults to text for unknown extensions', () => {
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue('data');

      expect(FileService.readFileContent('/test/data.bin').type).toBe('text');
    });

    it('throws when file exceeds 5MB', () => {
      mockStatSync.mockReturnValue({ size: 6 * 1024 * 1024 });

      expect(() => FileService.readFileContent('/test/huge.bin'))
        .toThrow('Failed to read file');
    });

    it('throws generic error without exposing file path', () => {
      mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });

      expect(() => FileService.readFileContent('/secret/path/file.go'))
        .toThrow('Failed to read file');
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
