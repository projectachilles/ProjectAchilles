// Service to read file contents

import * as fs from 'fs';
import * as path from 'path';
import type { FileContent } from '../../types/test.js';

interface SecurePath {
  canonicalPath: string;
  canonicalRoot: string;
}

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
      // Empty rel means candidate IS the root (not a subpath); leading `..`
      // means it escaped; isAbsolute catches Windows drive switches.
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return resolved;
      }
    }
    return null;
  }

  /**
   * Resolve an existing path beneath an allowed root without accepting a
   * symbolic link at the root or in any descendant component.
   */
  private static secureResolveWithinRoots(candidate: string, roots: string[]): SecurePath | null {
    const resolved = path.resolve(candidate);

    for (const root of roots) {
      const resolvedRoot = path.resolve(root);
      const relative = path.relative(resolvedRoot, resolved);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue;

      try {
        let current = resolvedRoot;
        if (fs.lstatSync(current).isSymbolicLink()) continue;

        let hasSymlink = false;
        for (const component of relative.split(path.sep)) {
          current = path.join(current, component);
          if (fs.lstatSync(current).isSymbolicLink()) {
            hasSymlink = true;
            break;
          }
        }
        if (hasSymlink) continue;

        const canonicalRoot = fs.realpathSync(resolvedRoot);
        const canonicalPath = fs.realpathSync(resolved);
        const canonicalRelative = path.relative(canonicalRoot, canonicalPath);
        if (canonicalRelative !== '' &&
            !canonicalRelative.startsWith('..') &&
            !path.isAbsolute(canonicalRelative)) {
          return { canonicalPath, canonicalRoot };
        }
      } catch {
        // Missing, unreadable, or concurrently replaced paths are unsafe.
      }
    }

    return null;
  }

  /**
   * Read file content safely
   */
  static readFileContent(filePath: string, roots: string[]): FileContent {
    let descriptor: number | null = null;

    try {
      const secured = this.secureResolveWithinRoots(filePath, roots);
      if (!secured) throw new Error('File path is outside the allowed roots or contains a symbolic link');

      const noFollow = fs.constants.O_NOFOLLOW ?? 0;
      descriptor = fs.openSync(secured.canonicalPath, fs.constants.O_RDONLY | noFollow);

      // Check the same filesystem object that will be read (limit to 5MB).
      const stats = fs.fstatSync(descriptor);
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!stats.isFile() || stats.size > maxSize) {
        throw new Error('File too large to display');
      }

      // Re-resolve after open and bind the pathname to the opened descriptor.
      // This catches a directory or file swapped between validation and open.
      const verified = this.secureResolveWithinRoots(filePath, roots);
      if (!verified ||
          verified.canonicalPath !== secured.canonicalPath ||
          verified.canonicalRoot !== secured.canonicalRoot) {
        throw new Error('File path changed while opening');
      }

      const pathStats = fs.statSync(verified.canonicalPath);
      if (pathStats.dev !== stats.dev || pathStats.ino !== stats.ino) {
        throw new Error('Opened file does not match validated path');
      }

      const content = fs.readFileSync(descriptor, 'utf-8');
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
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }

  /**
   * Check if file exists
   */
  static fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
}
