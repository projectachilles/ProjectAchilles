import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    readdirSync: mockReaddirSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const mockExtractTestMetadata = vi.fn();
vi.mock('../metadataExtractor.js', () => ({
  MetadataExtractor: { extractTestMetadata: mockExtractTestMetadata },
}));

const { TestIndexer } = await import('../testIndexer.js');

// ── Helpers ──────────────────────────────────────────────────────────

const TESTS_PATH = '/repo/tests_source';
const UUID1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

function makeMetadata(uuid: string, overrides: Record<string, unknown> = {}) {
  return {
    uuid,
    name: `Test ${uuid.slice(0, 8)}`,
    techniques: ['T1059'],
    tactics: [],
    tags: [],
    stages: [],
    isMultiStage: false,
    ...overrides,
  };
}

function fileStat(isDir: boolean, size = 100) {
  return { isFile: () => !isDir, isDirectory: () => isDir, size };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TestIndexer', () => {
  let indexer: InstanceType<typeof TestIndexer>;

  beforeEach(() => {
    vi.clearAllMocks();
    indexer = new TestIndexer(TESTS_PATH);
    mockExistsSync.mockReturnValue(false);
    mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));
  });

  // ── Group 1: Structure Detection ─────────────────────────

  describe('detectStructure (via scanAllTests)', () => {
    it('detects categorical when a known category folder exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return fileStat(true);
        return fileStat(false);
      });
      mockReaddirSync.mockReturnValue([]);

      const tests = indexer.scanAllTests();

      expect(tests).toEqual([]);
    });

    it('detects flat when no category folders exist', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      const tests = indexer.scanAllTests();

      expect(tests).toEqual([]);
    });

    it('checks all four known categories: cyber-hygiene, intel-driven, mitre-top10, phase-aligned', () => {
      const checkedPaths: string[] = [];
      mockExistsSync.mockImplementation((p: string) => {
        checkedPaths.push(p);
        if (p === TESTS_PATH) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      indexer.scanAllTests();

      expect(checkedPaths).toContain(`${TESTS_PATH}/cyber-hygiene`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/intel-driven`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/mitre-top10`);
      expect(checkedPaths).toContain(`${TESTS_PATH}/phase-aligned`);
    });
  });

  // ── Group 2: File Categorization ──────────────────────────

  describe('file categorization (via getTestFiles)', () => {
    function setupSingleFileTest(fileName: string) {
      // Set up categorical structure with one UUID dir containing one file
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return fileStat(true);
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return fileStat(true);
        // File inside UUID dir
        return fileStat(false, 200);
      });
      // Category dir lists UUIDs; UUID dir lists files
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [fileName];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));
    }

    it('categorizes _DEFENSE_GUIDANCE files as defense (before .md check)', () => {
      setupSingleFileTest('T1059_DEFENSE_GUIDANCE.md');
      const tests = indexer.scanAllTests();
      const file = tests[0].files[0];
      expect(file.category).toBe('defense');
    });

    it('categorizes _dr_rules files as defense', () => {
      setupSingleFileTest('T1059_dr_rules.kql');
      const tests = indexer.scanAllTests();
      const file = tests[0].files[0];
      expect(file.category).toBe('defense');
    });

    it('categorizes .md files as documentation', () => {
      setupSingleFileTest('README.md');
      const tests = indexer.scanAllTests();
      const file = tests[0].files[0];
      expect(file.category).toBe('documentation');
    });

    it('categorizes .go and .ps1 as source', () => {
      setupSingleFileTest('main.go');
      let tests = indexer.scanAllTests();
      expect(tests[0].files[0].category).toBe('source');

      vi.clearAllMocks();
      indexer = new TestIndexer(TESTS_PATH);
      setupSingleFileTest('script.ps1');
      tests = indexer.scanAllTests();
      expect(tests[0].files[0].category).toBe('source');
    });

    it('categorizes .kql, .yara, .yar as detection', () => {
      setupSingleFileTest('query.kql');
      let tests = indexer.scanAllTests();
      expect(tests[0].files[0].category).toBe('detection');

      vi.clearAllMocks();
      indexer = new TestIndexer(TESTS_PATH);
      setupSingleFileTest('rule.yara');
      tests = indexer.scanAllTests();
      expect(tests[0].files[0].category).toBe('detection');
    });
  });

  // ── Group 3: File Type Detection ──────────────────────────

  describe('file type detection', () => {
    function getTypeForFile(fileName: string) {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('cyber-hygiene')) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [fileName];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));

      const tests = indexer.scanAllTests();
      return tests[0]?.files[0]?.type;
    }

    it('detects go, powershell, markdown types correctly', () => {
      expect(getTypeForFile('main.go')).toBe('go');
      vi.clearAllMocks(); indexer = new TestIndexer(TESTS_PATH);
      expect(getTypeForFile('script.ps1')).toBe('powershell');
      vi.clearAllMocks(); indexer = new TestIndexer(TESTS_PATH);
      expect(getTypeForFile('README.md')).toBe('markdown');
    });

    it('detects kql and yara types', () => {
      expect(getTypeForFile('rules.kql')).toBe('kql');
      vi.clearAllMocks(); indexer = new TestIndexer(TESTS_PATH);
      expect(getTypeForFile('detect.yara')).toBe('yara');
      vi.clearAllMocks(); indexer = new TestIndexer(TESTS_PATH);
      expect(getTypeForFile('detect.yar')).toBe('yara');
    });

    it('returns other for unknown extensions', () => {
      expect(getTypeForFile('data.bin')).toBe('other');
    });
  });

  // ── Group 4: getTestFiles — Filtering & Sorting ───────────

  describe('getTestFiles filtering and sorting', () => {
    function setupMultiFileDir(files: string[]) {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('cyber-hygiene')) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return files;
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));
    }

    it('excludes .exe, .msi, .dll build artifacts', () => {
      setupMultiFileDir(['main.go', 'build.exe', 'installer.msi', 'helper.dll']);
      const tests = indexer.scanAllTests();
      const names = tests[0].files.map(f => f.name);
      expect(names).toEqual(['main.go']);
    });

    it('excludes test_execution_log.json and test_execution_log.txt', () => {
      setupMultiFileDir(['main.go', 'test_execution_log.json', 'test_execution_log.txt']);
      const tests = indexer.scanAllTests();
      const names = tests[0].files.map(f => f.name);
      expect(names).toEqual(['main.go']);
    });

    it('sorts by category order: documentation → diagram → defense → source → detection → config → other', () => {
      const files = [
        'main.go',            // source (4)
        'README.md',          // documentation (1)
        'flow.html',          // diagram (2)
        'rules.kql',          // detection (5)
        'go.mod',             // config (6)
        'T1059_DEFENSE_GUIDANCE.md', // defense (3)
        'data.bin',           // other (7)
      ];
      setupMultiFileDir(files);

      const tests = indexer.scanAllTests();
      const categories = tests[0].files.map(f => f.category);
      expect(categories).toEqual([
        'documentation', 'diagram', 'defense', 'source', 'detection', 'config', 'other',
      ]);
    });

    it('sorts alphabetically within the same category', () => {
      setupMultiFileDir(['zebra.go', 'alpha.go']);
      const tests = indexer.scanAllTests();
      const names = tests[0].files.map(f => f.name);
      expect(names).toEqual(['alpha.go', 'zebra.go']);
    });
  });

  // ── Group 5: scanAllTests ─────────────────────────────────

  describe('scanAllTests', () => {
    it('throws when testsSourcePath does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => indexer.scanAllTests()).toThrow('Tests source path not found');
    });

    it('scans categorical structure: iterates category folders for UUID dirs', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('cyber-hygiene')) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return ['main.go'];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, { category: 'cyber-hygiene' }));

      const tests = indexer.scanAllTests();

      expect(tests).toHaveLength(1);
      expect(mockExtractTestMetadata).toHaveBeenCalledWith(
        `${TESTS_PATH}/cyber-hygiene/${UUID1}`,
        UUID1,
        'cyber-hygiene',
      );
    });

    it('scans flat/legacy structure: finds UUID dirs at root level', () => {
      // No category folders → flat
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/${UUID1}`) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return [UUID1];
        if (p === `${TESTS_PATH}/${UUID1}`) return ['main.go'];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));

      const tests = indexer.scanAllTests();

      expect(tests).toHaveLength(1);
      expect(mockExtractTestMetadata).toHaveBeenCalledWith(
        `${TESTS_PATH}/${UUID1}`,
        UUID1,
        undefined,
      );
    });

    it('skips non-UUID directory names', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return ['not-a-uuid', 'README.md', '.git'];
        return [];
      });
      mockStatSync.mockReturnValue(fileStat(true));

      const tests = indexer.scanAllTests();

      expect(tests).toHaveLength(0);
      expect(mockExtractTestMetadata).not.toHaveBeenCalled();
    });

    it('populates testCache and uuidToCategory maps', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/intel-driven`) return true;
        if (p === `${TESTS_PATH}/intel-driven/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('intel-driven')) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/intel-driven`) return [UUID1];
        if (p === `${TESTS_PATH}/intel-driven/${UUID1}`) return ['main.go'];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, { category: 'intel-driven' }));

      indexer.scanAllTests();

      // Verify cache via getAllTests
      expect(indexer.getAllTests()).toHaveLength(1);
      // Verify getTest uses cache
      const cached = indexer.getTest(UUID1);
      expect(cached).toBeTruthy();
      expect(cached!.uuid).toBe(UUID1);
    });
  });

  // ── Group 6: getTest + Cache Behavior ─────────────────────

  describe('getTest and cache', () => {
    it('returns cached test when available', () => {
      // Populate cache
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation(() => fileStat(true));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));

      indexer.scanAllTests();
      vi.clearAllMocks();

      // Second call should use cache
      const result = indexer.getTest(UUID1);
      expect(result).toBeTruthy();
      expect(mockExtractTestMetadata).not.toHaveBeenCalled();
    });

    it('scans on cache miss and looks up in categorical structure', () => {
      // No scan yet — cache is empty; getTest should try to find it
      mockExistsSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockReturnValue(fileStat(false, 100));
      mockReaddirSync.mockReturnValue([]);
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));

      const result = indexer.getTest(UUID1);

      expect(result).toBeTruthy();
      expect(mockExtractTestMetadata).toHaveBeenCalled();
    });

    it('returns null for nonexistent UUID', () => {
      mockExistsSync.mockReturnValue(false);

      const result = indexer.getTest('00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });
  });

  // ── Group 7: refresh, getAllTests, getCategories ───────────

  describe('refresh, getAllTests, getCategories', () => {
    function populateCache() {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/intel-driven`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        if (p === `${TESTS_PATH}/intel-driven/${UUID2}`) return true;
        return false;
      });
      mockStatSync.mockImplementation(() => fileStat(true));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/intel-driven`) return [UUID2];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [];
        if (p === `${TESTS_PATH}/intel-driven/${UUID2}`) return [];
        return [];
      });
      mockExtractTestMetadata.mockImplementation((_dir: string, uuid: string, category?: string) =>
        makeMetadata(uuid, { category }),
      );
    }

    it('refresh clears cache and rescans', () => {
      populateCache();
      indexer.scanAllTests();
      expect(indexer.getAllTests()).toHaveLength(2);

      // Modify mock so only one test remains
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [];
        return [];
      });
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });

      const refreshed = indexer.refresh();

      expect(refreshed).toHaveLength(1);
      expect(indexer.getAllTests()).toHaveLength(1);
    });

    it('getCategories returns sorted unique categories from cache', () => {
      populateCache();
      indexer.scanAllTests();

      const categories = indexer.getCategories();

      expect(categories).toEqual(['cyber-hygiene', 'intel-driven']);
    });
  });

  // ── Group 8: Search & Filter ──────────────────────────────

  describe('search and filter', () => {
    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation(() => fileStat(true));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(
        makeMetadata(UUID1, {
          name: 'Credential Dumping',
          category: 'cyber-hygiene',
          techniques: ['T1003', 'T1059.001'],
          description: 'Tests LSASS credential access',
        }),
      );
      indexer.scanAllTests();
    });

    it('searchTests matches by name, uuid, technique, category, description', () => {
      expect(indexer.searchTests('Credential')).toHaveLength(1);
      expect(indexer.searchTests(UUID1.slice(0, 8))).toHaveLength(1);
      expect(indexer.searchTests('T1003')).toHaveLength(1);
      expect(indexer.searchTests('cyber-hygiene')).toHaveLength(1);
      expect(indexer.searchTests('LSASS')).toHaveLength(1);
      expect(indexer.searchTests('nonexistent')).toHaveLength(0);
    });

    it('filterByTechnique returns tests with matching technique', () => {
      expect(indexer.filterByTechnique('T1003')).toHaveLength(1);
      expect(indexer.filterByTechnique('T9999')).toHaveLength(0);
    });

    it('filterByCategory matches case-insensitively', () => {
      expect(indexer.filterByCategory('Cyber-Hygiene')).toHaveLength(1);
      expect(indexer.filterByCategory('CYBER-HYGIENE')).toHaveLength(1);
      expect(indexer.filterByCategory('unknown')).toHaveLength(0);
    });
  });

  // ── Group 9: scanTestDirectory details ────────────────────

  describe('scanTestDirectory details', () => {
    it('detects hasAttackFlow, hasReadme, hasInfoCard, hasSafetyDoc from files', () => {
      const files = [
        'README.md',
        `${UUID1}_info.md`,
        'SAFETY.md',
        `${UUID1}_attack_flow.html`,
        'rules.kql',
        'T1059_DEFENSE_GUIDANCE.md',
      ];

      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('cyber-hygiene')) return fileStat(true);
        return fileStat(false, 200);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return files;
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1));

      const tests = indexer.scanAllTests();
      const test = tests[0];

      expect(test.hasReadme).toBe(true);
      expect(test.hasInfoCard).toBe(true);
      expect(test.hasSafetyDoc).toBe(true);
      expect(test.hasAttackFlow).toBe(true);
      expect(test.hasDetectionFiles).toBe(true);
      expect(test.hasDefenseGuidance).toBe(true);
    });

    it('returns null and logs error when scanTestDirectory throws', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation((p: string) => {
        if (p.endsWith(UUID1) || p.endsWith('cyber-hygiene')) return fileStat(true);
        return fileStat(false, 100);
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) throw new Error('permission denied');
        return [];
      });
      mockExtractTestMetadata.mockImplementation(() => {
        throw new Error('extraction failed');
      });

      // Should not throw — error is caught internally
      const tests = indexer.scanAllTests();
      expect(tests).toHaveLength(0);
    });
  });

  // ── Group 10: filterBySeverity ────────────────────────────

  describe('filterBySeverity', () => {
    it('matches case-insensitively', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TESTS_PATH) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene`) return true;
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return true;
        return false;
      });
      mockStatSync.mockImplementation(() => fileStat(true));
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === `${TESTS_PATH}/cyber-hygiene`) return [UUID1];
        if (p === `${TESTS_PATH}/cyber-hygiene/${UUID1}`) return [];
        return [];
      });
      mockExtractTestMetadata.mockReturnValue(makeMetadata(UUID1, { severity: 'critical' }));
      indexer.scanAllTests();

      expect(indexer.filterBySeverity('Critical')).toHaveLength(1);
      expect(indexer.filterBySeverity('high')).toHaveLength(0);
    });
  });
});
