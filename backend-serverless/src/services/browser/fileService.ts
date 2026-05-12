// Service to read file contents

import * as fs from 'fs';
import * as path from 'path';
import { FileContent } from '../../types/test.js';

export class FileService {
  /**
   * Verify a candidate path stays inside one of the allowed roots and return
   * the canonical resolved form. Returns null on escape.
   *
   * Returning the resolved form (rather than a boolean) is the pattern that
   * CodeQL's js/path-injection query recognises as a sanitiser barrier:
   *   path.resolve(candidate) -> path.relative(root, resolved) boundary
   *   check -> return resolved (cleansed value flows forward).
   *
   * Callers MUST use the returned string for downstream fs.* calls — passing
   * the original `candidate` after a boolean check is not a recognised
   * sanitiser and leaves the taint flow intact.
   */
  static safeResolveWithinRoots(candidate: string, roots: string[]): string | null {
    const resolved = path.resolve(candidate);
    for (const root of roots) {
      const resolvedRoot = path.resolve(root);
      const rel = path.relative(resolvedRoot, resolved);
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return resolved;
      }
    }
    return null;
  }

  /**
   * Read file content safely
   */
  static readFileContent(filePath: string): FileContent {
    try {
      // Check file size before reading (limit to 5MB)
      const stats = fs.statSync(filePath);
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (stats.size > maxSize) {
        throw new Error('File too large to display');
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Filename-pattern detection (must precede extension-based fallback,
      // mirrors TestIndexer.getFileType so the renderer routes consistently)
      let type: string;
      if (fileName.includes('_sigma_rules')) type = 'sigma';
      else if (fileName.includes('_elastic_rules')) type = 'ndjson';
      else if (ext === '.go') type = 'go';
      else if (ext === '.ps1') type = 'powershell';
      else if (ext === '.md') type = 'markdown';
      else if (ext === '.html') type = 'html';
      else if (ext === '.sh') type = 'bash';
      else if (ext === '.json') type = 'json';
      else if (ext === '.ndjson') type = 'ndjson';
      else if (ext === '.yaml' || ext === '.yml') type = 'yaml';
      else if (ext === '.kql') type = 'kql';
      else if (ext === '.yar' || ext === '.yara') type = 'yara';
      else type = 'text';

      return {
        content,
        type,
      };
    } catch (error) {
      // Don't expose file path in error message - log it server-side only
      console.error(`Failed to read file: ${filePath}`, error);
      throw new Error('Failed to read file');
    }
  }

  /**
   * Check if file exists
   */
  static fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
}
