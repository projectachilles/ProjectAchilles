// Test catalog — caches metadata extracted from the test library at startup.
// Provides fast UUID-keyed lookups so task creation can auto-enrich metadata
// without touching the filesystem on every request.

import fs from 'fs';
import path from 'path';
import { MetadataExtractor } from '../browser/metadataExtractor.js';
import type { TestMetadata, TestSource } from '../../types/test.js';

const CATEGORY_DIRS = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

let catalog: Map<string, TestMetadata> = new Map();

/**
 * Scan one source path and add entries to the catalog map.
 * Skips UUIDs already present (first source wins).
 */
function scanSourcePath(sourcePath: string, provenance: TestSource['provenance'], next: Map<string, TestMetadata>): void {
  for (const category of CATEGORY_DIRS) {
    const categoryDir = path.join(sourcePath, category);

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
      // First source wins — skip if already indexed
      if (next.has(uuid)) continue;

      const testDir = path.join(categoryDir, uuid);

      try {
        const metadata = MetadataExtractor.extractTestMetadata(testDir, uuid, category);
        metadata.source = provenance;
        next.set(uuid, metadata);
      } catch (err) {
        console.warn(`[TestCatalog] Failed to extract metadata for ${uuid}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }
}

/**
 * Scan the test library and build an in-memory UUID → TestMetadata map.
 * Accepts a single path (backward compat) or TestSource[] for multi-source.
 * Safe to call multiple times (replaces the previous catalog).
 */
export function initCatalog(sources: TestSource[] | string): void {
  const normalized: TestSource[] = typeof sources === 'string'
    ? [{ path: sources, provenance: 'upstream' }]
    : sources;

  const next = new Map<string, TestMetadata>();

  for (const source of normalized) {
    scanSourcePath(source.path, source.provenance, next);
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
