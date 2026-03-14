// Service to scan and index all F0RT1KA security tests

import * as fs from 'fs';
import * as path from 'path';
import { TestDetails, TestFile } from '../../types/test.js';
import { MetadataExtractor } from './metadataExtractor.js';

// Known category folders in the new structure
const KNOWN_CATEGORIES = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

export class TestIndexer {
  private testsSourcePath: string;
  private testCache: Map<string, TestDetails> = new Map();
  // Maps UUID -> category for efficient lookup
  private uuidToCategory: Map<string, string> = new Map();
  private static readonly UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  constructor(testsSourcePath: string) {
    this.testsSourcePath = path.resolve(testsSourcePath);
  }

  /**
   * Detect if the tests_source uses categorical structure (new) or flat structure (legacy)
   */
  private detectStructure(): 'categorical' | 'flat' {
    // Check if any known category folders exist
    for (const category of KNOWN_CATEGORIES) {
      const categoryPath = path.join(this.testsSourcePath, category);
      if (fs.existsSync(categoryPath) && fs.statSync(categoryPath).isDirectory()) {
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
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
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
      'source': 4,
      'detection': 5,
      'config': 6,
      'other': 7,
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
   */
  private scanTestDirectory(uuid: string, testDir?: string, category?: string): TestDetails | null {
    // Resolve test directory path if not provided
    if (!testDir) {
      // Check if we have a cached category mapping
      const cachedCategory = this.uuidToCategory.get(uuid);
      if (cachedCategory) {
        testDir = path.join(this.testsSourcePath, cachedCategory, uuid);
      } else {
        // Try categorical structure first
        for (const cat of KNOWN_CATEGORIES) {
          const catPath = path.join(this.testsSourcePath, cat, uuid);
          if (fs.existsSync(catPath)) {
            testDir = catPath;
            category = cat;
            break;
          }
        }
        // Fall back to flat structure
        if (!testDir) {
          testDir = path.join(this.testsSourcePath, uuid);
        }
      }
    }

    if (!fs.existsSync(testDir)) {
      console.error(`Test directory not found: ${testDir}`);
      return null;
    }

    try {
      // Extract metadata, passing category for the new structure
      const metadata = MetadataExtractor.extractTestMetadata(testDir, uuid, category);

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

      const testDetails: TestDetails = {
        ...metadata,
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
      };

      return testDetails;
    } catch (error) {
      console.error(`Error scanning test ${uuid}:`, error);
      return null;
    }
  }

  /**
   * Scan all tests in the tests_source directory
   * Supports both categorical (new) and flat (legacy) structures
   */
  public scanAllTests(): TestDetails[] {
    if (!fs.existsSync(this.testsSourcePath)) {
      throw new Error(`Tests source path not found: ${this.testsSourcePath}`);
    }

    const tests: TestDetails[] = [];
    const structure = this.detectStructure();

    // Clear the UUID-to-category map on full scan
    this.uuidToCategory.clear();

    if (structure === 'categorical') {
      console.log('Detected categorical test structure');
      // Scan each category folder
      for (const category of KNOWN_CATEGORIES) {
        const categoryPath = path.join(this.testsSourcePath, category);
        if (!fs.existsSync(categoryPath)) {
          continue;
        }

        const entries = fs.readdirSync(categoryPath);
        for (const entry of entries) {
          const fullPath = path.join(categoryPath, entry);
          const stat = fs.statSync(fullPath);

          // Only process directories with valid UUID names
          if (stat.isDirectory() && this.isValidTestDirectory(entry)) {
            // Store the UUID -> category mapping
            this.uuidToCategory.set(entry, category);

            const testDetails = this.scanTestDirectory(entry, fullPath, category);
            if (testDetails) {
              tests.push(testDetails);
              this.testCache.set(entry, testDetails);
            }
          }
        }
      }
    } else {
      console.log('Detected flat test structure (legacy)');
      // Flat structure: tests_source/{uuid}/
      const entries = fs.readdirSync(this.testsSourcePath);

      for (const entry of entries) {
        const fullPath = path.join(this.testsSourcePath, entry);
        const stat = fs.statSync(fullPath);

        // Only process directories with valid UUID names
        if (stat.isDirectory() && this.isValidTestDirectory(entry)) {
          const testDetails = this.scanTestDirectory(entry, fullPath);
          if (testDetails) {
            tests.push(testDetails);
            this.testCache.set(entry, testDetails);
          }
        }
      }
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
