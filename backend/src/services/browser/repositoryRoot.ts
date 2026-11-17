// Source roots that come out of a Git clone.
//
// An operator-set root (TESTS_SOURCE_PATH, CUSTOM_TESTS_PATH) may be a
// symlink: a mounted or relocated library. The root of a Git-synced library is
// different: `<clone>/tests_source` is repository content, so the repository
// decides whether it is a folder or a link. Such a root is registered here
// with its clone folder, and every reader asks before using it. It is usable
// only while it is a real folder at its own place inside the clone.

import * as fs from 'fs';
import * as path from 'path';

/** Resolved root path -> resolved clone folder. */
const repositoryRoots = new Map<string, string>();
/** Last problem logged per root, so a refused root is reported once, not per read. */
const reported = new Map<string, string>();

export type RepositoryRootCheck =
  /** Not below a registered root: an operator path, no rule applies. */
  | { guarded: false }
  /** Below a registered root. `canonicalRoot` is null when the root must not be used. */
  | { guarded: true; canonicalRoot: string | null };

/**
 * Declare that `root` is content of the Git clone at `cloneDir`. The clone
 * folder itself is the operator's (TESTS_LOCAL_PATH) and may be a symlink.
 */
export function registerRepositoryRoot(root: string, cloneDir: string): void {
  repositoryRoots.set(path.resolve(root), path.resolve(cloneDir));
}

/** For tests. */
export function clearRepositoryRoots(): void {
  repositoryRoots.clear();
  reported.clear();
}

function isSameOrInside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function report(root: string, problem: string): void {
  if (reported.get(root) === problem) return;
  reported.set(root, problem);
  console.warn(
    `⚠ Test library folder refused: ${root} ${problem}. ` +
    'A folder that comes from the test repository must be a real folder inside the clone, ' +
    'so no test from it is listed, read or built. Fix the repository and sync again, ' +
    'or set TESTS_REPO_URL to an empty value and point TESTS_SOURCE_PATH at a library you control.',
  );
}

/**
 * Check the registered repository root that `candidate` is, or lies below.
 *
 * The root is usable when its canonical path is exactly the place it has
 * inside the canonical clone folder, which rules out a link in the root
 * itself or in any folder between the clone and the root, wherever the link
 * points (a link to `.git` or to another folder of the clone is refused too).
 */
export function checkRepositoryRoot(candidate: string): RepositoryRootCheck {
  const resolved = path.resolve(candidate);

  for (const [root, cloneDir] of repositoryRoots) {
    if (!isSameOrInside(root, resolved)) continue;

    let canonicalRoot: string;
    let expected: string;
    try {
      expected = path.join(fs.realpathSync(cloneDir), path.relative(cloneDir, root));
      canonicalRoot = fs.realpathSync(root);
    } catch {
      // Not there (never synced) or unreadable: nothing to use, nothing to report.
      return { guarded: true, canonicalRoot: null };
    }

    if (canonicalRoot !== expected) {
      report(root, 'is a link that leads to another folder');
      return { guarded: true, canonicalRoot: null };
    }
    try {
      if (!fs.lstatSync(root).isDirectory()) {
        report(root, 'is not a folder');
        return { guarded: true, canonicalRoot: null };
      }
    } catch {
      return { guarded: true, canonicalRoot: null };
    }

    reported.delete(root);
    return { guarded: true, canonicalRoot };
  }

  return { guarded: false };
}

/** False only for a repository root that must not be used. */
export function isUsableSourceRoot(root: string): boolean {
  const check = checkRepositoryRoot(root);
  return !check.guarded || check.canonicalRoot !== null;
}
