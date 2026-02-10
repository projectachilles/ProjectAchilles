import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const mockExtractTestMetadata = vi.fn();
vi.mock('../../browser/metadataExtractor.js', () => ({
  MetadataExtractor: { extractTestMetadata: mockExtractTestMetadata },
}));

const { initCatalog, getTestMetadata, getCatalogSize, resetCatalog } =
  await import('../test-catalog.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

const TESTS_PATH = '/repo/tests_source';
const UUID1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

function makeDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

function makeMetadata(uuid: string, category: string) {
  return {
    uuid,
    name: `Test ${uuid.slice(0, 8)}`,
    category,
    techniques: ['T1059'],
    tactics: [],
    tags: [],
    stages: [],
    isMultiStage: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('test-catalog.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCatalog();
    mockExistsSync.mockReturnValue(false);
  });

  // ── initCatalog ────────────────────────────────────────────

  describe('initCatalog', () => {
    it('scans category dirs and populates catalog', () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${TESTS_PATH}/cyber-hygiene`,
      );
      mockReaddirSync.mockReturnValue([makeDirent(UUID1, true)]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, 'cyber-hygiene'));

      initCatalog(TESTS_PATH);

      expect(getCatalogSize()).toBe(1);
      expect(getTestMetadata(UUID1)).toBeTruthy();
    });

    it('scans all four known category directories', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      initCatalog(TESTS_PATH);

      const checkedPaths = mockExistsSync.mock.calls.map(c => c[0]);
      expect(checkedPaths).toContain(`${TESTS_PATH}/cyber-hygiene`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/intel-driven`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/mitre-top10`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/phase-aligned`);
    });

    it('skips non-directory entries', () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${TESTS_PATH}/cyber-hygiene`,
      );
      mockReaddirSync.mockReturnValue([
        makeDirent(UUID1, true),
        makeDirent('README.md', false),
      ]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, 'cyber-hygiene'));

      initCatalog(TESTS_PATH);

      expect(getCatalogSize()).toBe(1);
      expect(mockExtractTestMetadata).toHaveBeenCalledTimes(1);
    });

    it('skips missing category directories', () => {
      mockExistsSync.mockReturnValue(false);

      initCatalog(TESTS_PATH);

      expect(getCatalogSize()).toBe(0);
      expect(mockReaddirSync).not.toHaveBeenCalled();
    });

    it('continues when extractTestMetadata throws for a single test', () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${TESTS_PATH}/cyber-hygiene`,
      );
      mockReaddirSync.mockReturnValue([
        makeDirent(UUID1, true),
        makeDirent(UUID2, true),
      ]);
      mockExtractTestMetadata
        .mockImplementationOnce(() => { throw new Error('bad metadata'); })
        .mockReturnValueOnce(makeMetadata(UUID2, 'cyber-hygiene'));

      initCatalog(TESTS_PATH);

      expect(getCatalogSize()).toBe(1);
      expect(getTestMetadata(UUID1)).toBeNull();
      expect(getTestMetadata(UUID2)).toBeTruthy();
    });

    it('continues when readdirSync throws for a category', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cyber-hygiene')) throw new Error('EACCES');
        return [];
      });

      // Should not throw
      initCatalog(TESTS_PATH);

      expect(getCatalogSize()).toBe(0);
    });

    it('replaces previous catalog on re-init', () => {
      mockExistsSync.mockImplementation((p: string) =>
        p === `${TESTS_PATH}/cyber-hygiene`,
      );
      mockReaddirSync.mockReturnValue([makeDirent(UUID1, true)]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, 'cyber-hygiene'));

      initCatalog(TESTS_PATH);
      expect(getCatalogSize()).toBe(1);

      // Re-init with empty
      mockReaddirSync.mockReturnValue([]);
      initCatalog(TESTS_PATH);
      expect(getCatalogSize()).toBe(0);
    });
  });

  // ── getTestMetadata ────────────────────────────────────────

  describe('getTestMetadata', () => {
    it('returns metadata for known UUID', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([makeDirent(UUID1, true)]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, 'intel-driven'));

      initCatalog(TESTS_PATH);
      const meta = getTestMetadata(UUID1);

      expect(meta).toBeTruthy();
      expect(meta!.uuid).toBe(UUID1);
      expect(meta!.category).toBe('intel-driven');
    });

    it('returns null for unknown UUID', () => {
      expect(getTestMetadata('nonexistent')).toBeNull();
    });
  });

  // ── getCatalogSize & resetCatalog ──────────────────────────

  describe('getCatalogSize and resetCatalog', () => {
    it('returns 0 for empty catalog', () => {
      expect(getCatalogSize()).toBe(0);
    });

    it('resetCatalog clears all entries', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([makeDirent(UUID1, true)]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, 'cyber-hygiene'));

      initCatalog(TESTS_PATH);
      expect(getCatalogSize()).toBe(1);

      resetCatalog();
      expect(getCatalogSize()).toBe(0);
    });
  });
});
