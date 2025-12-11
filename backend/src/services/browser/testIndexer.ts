// Service to scan and index all F0RT1KA security tests

import * as fs from 'fs';
import * as path from 'path';
import { TestDetails, TestFile } from '../../types/test.js';
import { MetadataExtractor } from './metadataExtractor.js';

export class TestIndexer {
  private testsSourcePath: string;
  private testCache: Map<string, TestDetails> = new Map();
  private static readonly UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  constructor(testsSourcePath: string) {
    this.testsSourcePath = path.resolve(testsSourcePath);
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
    if (fileName.endsWith('.kql') || fileName.endsWith('.yara') || fileName.endsWith('.yar')) {
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
   */
  private scanTestDirectory(uuid: string): TestDetails | null {
    const testDir = path.join(this.testsSourcePath, uuid);

    if (!fs.existsSync(testDir)) {
      console.error(`Test directory not found: ${testDir}`);
      return null;
    }

    try {
      // Extract metadata
      const metadata = MetadataExtractor.extractTestMetadata(testDir, uuid);

      // Get all files
      const files = this.getTestFiles(testDir);

      // Check for specific files
      const hasReadme = files.some(f => f.name === 'README.md');
      const hasInfoCard = files.some(f => f.name === `${uuid}_info.md`);
      const hasSafetyDoc = files.some(f => f.name === 'SAFETY.md');
      const attackFlowFile = files.find(f => f.name.endsWith('_attack_flow.html') || f.name.includes('attack_flow'));
      const hasAttackFlow = !!attackFlowFile;
      const hasDetectionFiles = files.some(f => f.category === 'detection');
      const hasDefenseGuidance = files.some(f => f.category === 'defense');

      const testDetails: TestDetails = {
        ...metadata,
        files,
        hasAttackFlow,
        attackFlowPath: attackFlowFile?.path,
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
   */
  public scanAllTests(): TestDetails[] {
    if (!fs.existsSync(this.testsSourcePath)) {
      throw new Error(`Tests source path not found: ${this.testsSourcePath}`);
    }

    const tests: TestDetails[] = [];
    const entries = fs.readdirSync(this.testsSourcePath);

    for (const entry of entries) {
      const fullPath = path.join(this.testsSourcePath, entry);
      const stat = fs.statSync(fullPath);

      // Only process directories with valid UUID names
      if (stat.isDirectory() && this.isValidTestDirectory(entry)) {
        const testDetails = this.scanTestDirectory(entry);
        if (testDetails) {
          tests.push(testDetails);
          this.testCache.set(entry, testDetails);
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
    return this.scanAllTests();
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
