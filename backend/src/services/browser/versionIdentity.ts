// Version identity of a security test: a fingerprint of everything that goes
// into its built binary, computed from git trees (upstream tests) or from the
// files on disk (custom tests).

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { TestVersionIdentity } from '../../types/testVersion.js';

export interface TreeEntry {
  type: 'blob' | 'tree';
  hash: string;
  /** Relative to the repo root, '/' separators */
  path: string;
}

export interface TestLocation {
  uuid: string;
  /** e.g. 'tests_source/intel-driven/<uuid>' or 'tests_source/<uuid>' */
  relPath: string;
}

// NOTE: changing any of the input lists below (excluded extensions, shared
// inputs, disk exclusions) or the hash line format changes every fingerprint,
// so every stored fingerprint compares as older once. Change them deliberately.

/** Files with these extensions inside a test folder are not build inputs. */
export const BUILD_INPUT_EXCLUDED_EXT: readonly string[] = [
  '.md', '.html', '.kql', '.yar', '.yara', '.ndjson',
];

/** Compiled output never counts as source when hashing a folder on disk. */
const DISK_BINARY_EXT: readonly string[] = ['.exe', '.dll', '.so', '.dylib', '.bin'];

/**
 * Files the build service can leave in a test folder (see buildService.ts):
 * - build/ (build_all.sh output), and `<uuid>` / `<uuid>-<stage>` binaries
 *   without extension (Linux/macOS orchestrator and stage binaries);
 * - go.sum: `go mod tidy` writes it when go.mod exists without one (the
 *   auto-created go.mod/go.sum are removed afterwards);
 * - achilles_log_dir.go: synthesized LOG_DIR file, removed in `finally`.
 */
// A deliberate edit to go.sum is not detected: `go mod tidy` can create it
// during a build, so it cannot be told apart from a generated one.
const DISK_GENERATED_NAMES: readonly string[] = ['go.sum', 'achilles_log_dir.go'];

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * Shared inputs of a test, as repo-relative prefixes. A trailing '/' means a
 * directory; anything else is an exact file path.
 */
export function sharedInputPrefixes(relPath: string): string[] {
  const parts = relPath.split('/').filter(Boolean);
  const prefixes = ['preludeorg-libraries/'];
  // Categorized layout: <sourceSubdir>/<category>/<uuid>
  if (parts.length === 3) {
    prefixes.push(`${parts[0]}/${parts[1]}/shared/`);
  }
  prefixes.push('utils/resolve_org.sh', 'utils/codesign/');
  return prefixes;
}

/** Whether a file inside the test folder is a build input (not documentation/detection content). */
export function isBuildInput(pathInTest: string): boolean {
  return !BUILD_INPUT_EXCLUDED_EXT.includes(extOf(pathInTest));
}

function hashLines(lines: Array<{ path: string; hash: string }>): string {
  const sorted = lines.map(l => `${l.path}\0${l.hash}\n`).sort();
  return sha256(sorted.join(''));
}

function fingerprintOf(uuid: string, sourceHash: string, sharedHash: string): string {
  return sha256(`${uuid}\n${sourceHash}\n${sharedHash}`);
}

function matchesPrefix(p: string, prefix: string): boolean {
  return prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix;
}

export function identitiesFromTree(
  entries: TreeEntry[],
  tests: TestLocation[],
  commit: { hash: string; date: string },
): Map<string, TestVersionIdentity> {
  const result = new Map<string, TestVersionIdentity>();
  const blobs = entries.filter(e => e.type === 'blob');
  const treeByPath = new Map<string, string>();
  for (const e of entries) {
    if (e.type === 'tree') treeByPath.set(e.path, e.hash);
  }

  for (const { uuid, relPath } of tests) {
    const dirPrefix = `${relPath}/`;
    const own = blobs.filter(b => b.path.startsWith(dirPrefix));
    if (own.length === 0) continue;

    const sourceHash = hashLines(
      own
        .map(b => ({ path: b.path.slice(dirPrefix.length), hash: b.hash }))
        .filter(l => isBuildInput(l.path)),
    );

    const prefixes = sharedInputPrefixes(relPath);
    const sharedHash = hashLines(
      blobs.filter(b => prefixes.some(p => matchesPrefix(b.path, p))),
    );

    result.set(uuid, {
      fingerprint: fingerprintOf(uuid, sourceHash, sharedHash),
      source_hash: sourceHash,
      shared_hash: sharedHash,
      test_tree: treeByPath.get(relPath) ?? null,
      commit: commit.hash,
      commit_date: commit.date,
      provenance: 'upstream',
    });
  }
  return result;
}

/** First bytes of ELF, PE/MZ and Mach-O (thin and fat) executables. */
const BINARY_MAGICS: readonly number[][] = [
  [0x7f, 0x45, 0x4c, 0x46],
  [0x4d, 0x5a],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
];

/** True when the file starts with a compiled-executable magic (reads 4 bytes). */
function hasBinaryMagic(fullPath: string): boolean {
  const buf = Buffer.alloc(4);
  let n = 0;
  const fd = fs.openSync(fullPath, 'r');
  try {
    n = fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  return BINARY_MAGICS.some(m => n >= m.length && m.every((b, i) => buf[i] === b));
}

function isDiskGenerated(
  relPosix: string,
  uuid: string,
  generated: Set<string>,
  fullPath: string,
): boolean {
  if (generated.has(relPosix)) return true;
  if (relPosix === 'build' || relPosix.startsWith('build/')) return true;
  const ext = extOf(relPosix);
  if (DISK_BINARY_EXT.includes(ext)) return true;
  if (!relPosix.includes('/')) {
    if (DISK_GENERATED_NAMES.includes(relPosix)) return true;
    // Extensionless orchestrator / stage binaries: `<uuid>` or `<uuid>-<stage>`
    if (relPosix === uuid || (relPosix.startsWith(`${uuid}-`) && ext === '')) return true;
  }
  // Compiled output under any name (source-built validators, stage binaries)
  return hasBinaryMagic(fullPath);
}

function walkFiles(root: string, rel: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkFiles(root, relPath, out);
    else if (entry.isFile()) out.push(relPath);
  }
}

/**
 * Identity of a test folder on disk (custom tests, no git). Hashes the same
 * build inputs as the tree variant minus anything a build can leave behind,
 * so the value is the same before and after building.
 */
export function identityFromDisk(
  testDir: string,
  uuid: string,
  /**
   * Paths relative to `testDir`, '/' separators (e.g. 'validator.dat'), that
   * are not source: uploaded embed dependencies, tracked by a separate deps hash.
   */
  generatedFiles: string[] = [],
): TestVersionIdentity {
  const generated = new Set(generatedFiles.map(f => f.split(path.sep).join('/')));
  const files: string[] = [];
  walkFiles(testDir, '', files);

  const lines = files
    .filter(f => isBuildInput(f) && !isDiskGenerated(f, uuid, generated, path.join(testDir, f)))
    .map(f => ({ path: f, hash: sha256(fs.readFileSync(path.join(testDir, f))) }));

  const sourceHash = hashLines(lines);
  const sharedHash = hashLines([]);
  return {
    fingerprint: fingerprintOf(uuid, sourceHash, sharedHash),
    source_hash: sourceHash,
    shared_hash: sharedHash,
    test_tree: null,
    commit: null,
    commit_date: null,
    provenance: 'custom',
  };
}

/**
 * sha256 over the named files of a directory (name and content). Missing files
 * are skipped. Returns null when the list is empty.
 */
export function hashFiles(dir: string, filenames: string[]): string | null {
  if (filenames.length === 0) return null;
  const lines: Array<{ path: string; hash: string }> = [];
  for (const name of filenames) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) continue;
    lines.push({ path: name, hash: sha256(fs.readFileSync(full)) });
  }
  return hashLines(lines);
}
