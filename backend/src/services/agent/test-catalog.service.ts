// Test catalog — caches metadata extracted from the test library at startup.
// Provides fast UUID-keyed lookups so task creation can auto-enrich metadata
// without touching the filesystem on every request.

import fs from 'fs';
import path from 'path';
import { MetadataExtractor } from '../browser/metadataExtractor.js';
import type { TestMetadata } from '../../types/test.js';

const CATEGORY_DIRS = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

let catalog: Map<string, TestMetadata> = new Map();

/**
 * Scan the test library and build an in-memory UUID → TestMetadata map.
 * Safe to call multiple times (replaces the previous catalog).
 */
export function initCatalog(testsSourcePath: string): void {
  const next = new Map<string, TestMetadata>();

  for (const category of CATEGORY_DIRS) {
    const categoryDir = path.join(testsSourcePath, category);

    if (!fs.existsSync(categoryDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(categoryDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const uuid = entry.name;
      const testDir = path.join(categoryDir, uuid);

      try {
        const metadata = MetadataExtractor.extractTestMetadata(testDir, uuid, category);
        next.set(uuid, metadata);
      } catch (err) {
        console.warn(`[TestCatalog] Failed to extract metadata for ${uuid}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }

  catalog = next;
  console.log(`[TestCatalog] Loaded ${catalog.size} test entries`);
}

/**
 * Look up metadata for a test by UUID.
 * Returns null if the UUID is not in the catalog.
 */
export function getTestMetadata(uuid: string): TestMetadata | null {
  return catalog.get(uuid) ?? null;
}

/**
 * Return the number of entries in the catalog.
 */
export function getCatalogSize(): number {
  return catalog.size;
}

/**
 * Clear the catalog (useful for testing).
 */
export function resetCatalog(): void {
  catalog = new Map();
}
