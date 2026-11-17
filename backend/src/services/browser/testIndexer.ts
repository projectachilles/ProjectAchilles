// Service to scan and index all F0RT1KA security tests

import * as fs from 'fs';
import * as path from 'path';
import type { TestDetails, TestFile, TestSource, TestSourceProvenance } from '../../types/test.js';
import { MetadataExtractor } from './metadataExtractor.js';
import { isUsableSourceRoot } from './repositoryRoot.js';

// Known category folders in the new structure
const KNOWN_CATEGORIES = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

interface UuidCategoryEntry {
  category: string;
  sourcePath: string;
}

export class TestIndexer {
  private sources: TestSource[];
  private testCache: Map<string, TestDetails> = new Map();
  // Maps UUID -> { category, sourcePath } for efficient lookup on cache miss
  private uuidToCategory: Map<string, UuidCategoryEntry> = new Map();
  private static readonly UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  constructor(sources: TestSource[] | string) {
    if (typeof sources === 'string') {
      this.sources = [{ path: path.resolve(sources), provenance: 'upstream' }];
    } else {
      this.sources = sources.map(s => ({ ...s, path: path.resolve(s.path) }));
    }
  }

  /**
   * Resolved root directories for all configured sources. Used by route
   * handlers to constrain `FileService.readFileContent` to paths inside the
   * indexed test library, closing CodeQL js/path-injection alerts.
   */
  getSourceRoots(): string[] {
    return this.sources.map(s => s.path);
  }

  /** A repository path is indexable only when its final entry is not a symlink. */
  private isRealDirectory(candidate: string): boolean {
    try {
      const stats = fs.lstatSync(candidate);
      return !stats.isSymbolicLink() && stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * The test folder called `name` inside `parent`, or null. The path is built
   * from the entry the directory listing returns, never from the caller's
   * string, so a lookup can only reach a folder that is really there.
   */
  private findTestDir(parent: string, name: string): string | null {
    let entries: string[];
    try {
      entries = fs.readdirSync(parent);
    } catch {
      return null;
    }
    const entry = entries.find(candidate => candidate === name);
    if (!entry) return null;
    const dir = path.join(parent, entry);
    return this.isRealDirectory(dir) ? dir : null;
  }

  /**
   * Detect if a source directory uses categorical structure (new) or flat structure (legacy)
   */
  private detectStructure(basePath: string): 'categorical' | 'flat' {
    // Check if any known category folders exist
    for (const category of KNOWN_CATEGORIES) {
      const categoryPath = path.join(basePath, category);
      if (fs.existsSync(categoryPath) && this.isRealDirectory(categoryPath)) {
        return 'categorical';
      }
    }
    return 'flat';
  }

  /**
   * Categorize a file based on its name and extension
   */
  private categorizeFile(fileName: string): TestFile['category'] {
    // Defense guidance files - check BEFORE general .md check
    if (fileName.includes('_DEFENSE_GUIDANCE') ||
        fileName.includes('_dr_rules') ||
        fileName.includes('_hardening')) {
      return 'defense';
    }
    // References files - check BEFORE general .md check
    if (fileName.includes('_references')) {
      return 'references';
    }
    if (fileName.endsWith('.md')) {
      return 'documentation';
    }
    if (fileName.endsWith('.html')) {
      return 'diagram';
    }
    if (fileName.endsWith('.go') || fileName.endsWith('.ps1')) {
      return 'source';
    }
    if (fileName.includes('_sigma_rules') || fileName.includes('_elastic_rules')) {
      return 'detection';
    }
    if (fileName.endsWith('.kql') || fileName.endsWith('.yara') || fileName.endsWith('.yar') || fileName.endsWith('.ndjson')) {
      return 'detection';
    }
    if (fileName.endsWith('.sh') || fileName === 'go.mod' || fileName === 'go.sum') {
      return 'config';
    }
    return 'other';
  }

  /**
   * Get file type from extension
   */
  private getFileType(fileName: string): TestFile['type'] {
    // Filename-pattern detection (must precede extension-based fallback)
    if (fileName.includes('_sigma_rules')) return 'sigma';
    if (fileName.includes('_elastic_rules')) return 'ndjson';

    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.go':
        return 'go';
      case '.ps1':
        return 'powershell';
      case '.md':
        return 'markdown';
      case '.html':
        return 'html';
      case '.sh':
        return 'bash';
      case '.kql':
        return 'kql';
      case '.yara':
      case '.yar':
        return 'yara';
      case '.ndjson':
        return 'ndjson';
      case '.yaml':
      case '.yml':
        return 'yaml';
      default:
        return 'other';
    }
  }

  /**
   * Get all files in a test directory
   */
  private getTestFiles(testDir: string): TestFile[] {
    const files: TestFile[] = [];
    const entries = fs.readdirSync(testDir);

    // Filter out build artifacts and embedded binaries
    const filteredEntries = entries.filter(entry => {
      return !entry.endsWith('.exe') &&
             !entry.endsWith('.msi') &&
             !entry.endsWith('.dll') &&
             entry !== 'test_execution_log.json' &&
             entry !== 'test_execution_log.txt';
    });

    for (const entry of filteredEntries) {
      const filePath = path.join(testDir, entry);
      const stat = fs.lstatSync(filePath);

      if (!stat.isSymbolicLink() && stat.isFile()) {
        files.push({
          name: entry,
          path: filePath,
          type: this.getFileType(entry),
          size: stat.size,
          category: this.categorizeFile(entry),
        });
      }
    }

    // Sort files: documentation first, then defense, then source, then detection, then config, then others
    const categoryOrder: Record<TestFile['category'], number> = {
      'documentation': 1,
      'diagram': 2,
      'defense': 3,
      'references': 4,
      'source': 5,
      'detection': 6,
      'config': 7,
      'other': 8,
    };

    files.sort((a, b) => {
      const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

    return files;
  }

  /**
   * Check if directory is a valid test directory (UUID format)
   */
  private isValidTestDirectory(dirName: string): boolean {
    // UUID format: 8-4-4-4-12 characters
    return TestIndexer.UUID_PATTERN.test(dirName);
  }

  /**
   * Scan a single test directory and extract full details
   * @param uuid - The test UUID
   * @param testDir - Full path to the test directory (optional, will be resolved if not provided)
   * @param category - The category folder name (optional, for categorical structure)
   * @param provenance - Source provenance to stamp on the result
   */
  private scanTestDirectory(
    uuid: string,
    testDir?: string,
    category?: string,
    provenance?: TestSourceProvenance,
    sourceRoot?: string,
  ): TestDetails | null {
    // Resolve test directory path if not provided
    if (!testDir) {
      // A lookup by id: only a UUID can name a test, whoever the caller is.
      if (!this.isValidTestDirectory(uuid)) return null;

      // Check if we have a cached category mapping
      const cached = this.uuidToCategory.get(uuid);
      if (cached) {
        testDir = isUsableSourceRoot(cached.sourcePath)
          ? this.findTestDir(path.join(cached.sourcePath, cached.category), uuid) ?? undefined
          : undefined;
        provenance = this.getProvenanceForPath(cached.sourcePath);
        sourceRoot = cached.sourcePath;
      } else {
        // Search all sources for this UUID
        for (const source of this.sources) {
          if (!isUsableSourceRoot(source.path)) continue;
          // Try categorical structure first
          for (const cat of KNOWN_CATEGORIES) {
            const catPath = this.findTestDir(path.join(source.path, cat), uuid);
            if (catPath) {
              testDir = catPath;
              category = cat;
              provenance = source.provenance;
              sourceRoot = source.path;
              break;
            }
          }
          if (testDir) break;

          // Try flat structure
          const flatPath = this.findTestDir(source.path, uuid);
          if (flatPath) {
            testDir = flatPath;
            provenance = source.provenance;
            sourceRoot = source.path;
            break;
          }
        }
      }

      if (!testDir) {
        console.error(`Test directory not found: ${uuid}`);
        return null;
      }
    }

    if (!this.isRealDirectory(testDir)) {
      console.error(`Test directory not found: ${testDir}`);
      return null;
    }

    // From here on the id is the folder's own name, as the listing gave it,
    // on every path into this method: no file name is built from the caller's
    // string.
    uuid = path.basename(testDir);

    try {
      // Extract metadata, passing category for the new structure
      const metadata = MetadataExtractor.extractTestMetadata(
        testDir,
        uuid,
        category,
        sourceRoot ? [sourceRoot] : this.getSourceRoots(),
      );

      // Get all files
      const files = this.getTestFiles(testDir);

      // Check for specific files
      const hasReadme = files.some(f => f.name === 'README.md');
      const hasInfoCard = files.some(f => f.name === `${uuid}_info.md`);
      const hasSafetyDoc = files.some(f => f.name === 'SAFETY.md');
      const attackFlowFile = files.find(f => f.name.endsWith('_attack_flow.html') || f.name.includes('attack_flow'));
      const hasAttackFlow = !!attackFlowFile;
      const killChainFile = files.find(f => f.name === 'kill_chain.html');
      const hasKillChain = !!killChainFile;
      const hasDetectionFiles = files.some(f => f.category === 'detection');
      const hasDefenseGuidance = files.some(f => f.category === 'defense');
      const hasReferences = files.some(f => f.category === 'references');

      const testDetails: TestDetails = {
        ...metadata,
        source: provenance,
        files,
        hasAttackFlow,
        attackFlowPath: attackFlowFile?.path,
        hasKillChain,
        killChainPath: killChainFile?.path,
        hasReadme,
        hasInfoCard,
        hasSafetyDoc,
        hasDetectionFiles,
        hasDefenseGuidance,
        hasReferences,
      };

      return testDetails;
    } catch (error) {
      console.error(`Error scanning test ${uuid}:`, error);
      return null;
    }
  }

  /** Resolve provenance for a given source path */
  private getProvenanceForPath(sourcePath: string): TestSourceProvenance {
    for (const s of this.sources) {
      if (s.path === sourcePath) return s.provenance;
    }
    return 'upstream';
  }

  /**
   * Scan a single source directory for tests
   */
  private scanSource(source: TestSource, tests: TestDetails[]): void {
    if (!fs.existsSync(source.path)) return;
    // A Git-synced root that is a link, or is reached through one, is
    // repository content pointing somewhere else: index nothing from it.
    if (!isUsableSourceRoot(source.path)) return;

    const structure = this.detectStructure(source.path);

    if (structure === 'categorical') {
      for (const category of KNOWN_CATEGORIES) {
        const categoryPath = path.join(source.path, category);
        if (!this.isRealDirectory(categoryPath)) continue;

        const entries = fs.readdirSync(categoryPath);
        for (const entry of entries) {
          // Skip if UUID already indexed (first source wins)
          if (this.testCache.has(entry)) continue;

          const fullPath = path.join(categoryPath, entry);
          if (this.isRealDirectory(fullPath) && this.isValidTestDirectory(entry)) {
            this.uuidToCategory.set(entry, { category, sourcePath: source.path });

            const testDetails = this.scanTestDirectory(entry, fullPath, category, source.provenance, source.path);
            if (testDetails) {
              tests.push(testDetails);
              this.testCache.set(entry, testDetails);
            }
          }
        }
      }
    } else {
      const entries = fs.readdirSync(source.path);

      for (const entry of entries) {
        // Skip if UUID already indexed (first source wins)
        if (this.testCache.has(entry)) continue;

        const fullPath = path.join(source.path, entry);
        if (this.isRealDirectory(fullPath) && this.isValidTestDirectory(entry)) {
          const testDetails = this.scanTestDirectory(entry, fullPath, undefined, source.provenance, source.path);
          if (testDetails) {
            tests.push(testDetails);
            this.testCache.set(entry, testDetails);
          }
        }
      }
    }
  }

  /**
   * Scan all tests across all source directories
   * Sources are scanned in order — first source wins on UUID collisions
   */
  public scanAllTests(): TestDetails[] {
    this.testCache.clear();
    this.uuidToCategory.clear();

    const tests: TestDetails[] = [];

    for (const source of this.sources) {
      this.scanSource(source, tests);
    }

    console.log(`Indexed ${tests.length} security tests`);
    return tests;
  }

  /**
   * Get a specific test by UUID
   */
  public getTest(uuid: string): TestDetails | null {
    if (this.testCache.has(uuid)) {
      return this.testCache.get(uuid)!;
    }

    return this.scanTestDirectory(uuid);
  }

  /**
   * Get all cached tests
   */
  public getAllTests(): TestDetails[] {
    return Array.from(this.testCache.values());
  }

  /**
   * Refresh the test cache
   */
  public refresh(): TestDetails[] {
    this.testCache.clear();
    this.uuidToCategory.clear();
    return this.scanAllTests();
  }

  /**
   * Get all unique categories from indexed tests
   */
  public getCategories(): string[] {
    const categories = new Set<string>();
    for (const test of this.testCache.values()) {
      if (test.category) {
        categories.add(test.category);
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * Search tests by keyword (name, technique, category)
   */
  public searchTests(query: string): TestDetails[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTests().filter(test => {
      return (
        test.name.toLowerCase().includes(lowerQuery) ||
        test.uuid.toLowerCase().includes(lowerQuery) ||
        test.techniques.some(t => t.toLowerCase().includes(lowerQuery)) ||
        test.category?.toLowerCase().includes(lowerQuery) ||
        test.description?.toLowerCase().includes(lowerQuery)
      );
    });
  }

  /**
   * Filter tests by technique
   */
  public filterByTechnique(technique: string): TestDetails[] {
    return this.getAllTests().filter(test =>
      test.techniques.includes(technique)
    );
  }

  /**
   * Filter tests by category
   */
  public filterByCategory(category: string): TestDetails[] {
    return this.getAllTests().filter(test =>
      test.category?.toLowerCase() === category.toLowerCase()
    );
  }

  /**
   * Filter tests by severity
   */
  public filterBySeverity(severity: string): TestDetails[] {
    return this.getAllTests().filter(test =>
      test.severity?.toLowerCase() === severity.toLowerCase()
    );
  }
}
