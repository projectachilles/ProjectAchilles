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

// NOTE: these lists decide which fingerprints exist, so change them
// deliberately. The hash line format changes every fingerprint. An excluded
// extension, excluded name or disk exclusion changes the fingerprints of the
// tests that have such a file. A shared prefix changes those of the git tests
// whose shared files it adds or removes. Each changed fingerprint makes that
// test's stored results read `older` once. Bump FINGERPRINT_RULE_VERSION with
// any change to the lists or to the hash format.

/**
 * The rule that made a fingerprint: bump it with any change to the input
 * lists below or to the hash format, so a published state stored under an
 * older rule is dropped instead of compared (testVersions.service.ts).
 */
export const FINGERPRINT_RULE_VERSION = 2;

/** Files with these extensions inside a test folder are not build inputs. */
export const BUILD_INPUT_EXCLUDED_EXT: readonly string[] = [
  '.md', '.html', '.kql', '.yar', '.yara', '.ndjson',
];

/**
 * Detection and defence files the test library generates next to each test,
 * matched on the whole base name (case-sensitive): a lowercase UUID, `_`, then
 * `sigma_rules.yml`, `dr_rules.yaml`, `hardening.ps1`, or
 * `hardening_<word>.ps1` / `.sh` (`<word>` one or more of a-z, 0-9), e.g.
 * `<uuid>_hardening_linux.sh`. Every library file follows that form; a name
 * without the UUID prefix (`apply_hardening.ps1`, `custom_sigma_rules.yml`) is
 * a real script or configuration and stays a build input. Matched by name, not
 * by extension: `.ps1`, `.sh` and `.yml` files are real build inputs in other
 * tests (embedded scripts, build_all.sh, a test's own configuration). A test
 * that embeds one of these files is covered by the build's embedded-files hash
 * instead (getEmbedDependencies in buildService.ts), but only when the file,
 * or a folder containing it, is named as the first token of its `//go:embed`
 * line: the parser reads only that token, so one embedded through a glob
 * (`//go:embed *.ps1`) or as a later token on the line is covered by nothing.
 * A known gap.
 */
export const BUILD_INPUT_EXCLUDED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(?:sigma_rules\.yml|dr_rules\.yaml|hardening(?:_[a-z0-9]+)?\.ps1|hardening_[a-z0-9]+\.sh)$/;

/** Compiled output never counts as source when hashing a folder on disk. */
const DISK_BINARY_EXT: readonly string[] = ['.exe', '.dll', '.so', '.dylib', '.bin'];

/**
 * Files the build service can leave in a test folder (see buildService.ts):
 * - build/ (build_all.sh output), and `<uuid>` / `<uuid>-<stage>` binaries
 *   without extension (Linux/macOS orchestrator and stage binaries);
 * - go.sum: `go mod tidy` writes it when go.mod exists without one (the
 *   auto-created go.mod/go.sum are removed afterwards);
 * - achilles_log_dir.go: synthesized LOG_DIR file, removed in `finally`.
 *
 * A deliberate edit to go.sum is not detected: `go mod tidy` can create it
 * during a build, so it cannot be told apart from a generated one.
 */
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
  const base = pathInTest.slice(pathInTest.lastIndexOf('/') + 1);
  return !BUILD_INPUT_EXCLUDED_EXT.includes(extOf(pathInTest)) && !BUILD_INPUT_EXCLUDED_NAME.test(base);
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

/**
 * The tree is too large to read its versions: reading it would hold the
 * process (one thread, shared with every request) for too long. Thrown, never
 * worked through: a published tree is repository content, and its size is not
 * ours to choose.
 */
export class TreeTooLargeError extends Error {
  constructor(message = 'The repository tree is too large to read test versions from') {
    super(message);
    this.name = 'TreeTooLargeError';
  }
}

/**
 * Upper bound on the work of one identitiesFromTree() call: one unit per file
 * of a test, plus one scan of all files per distinct set of shared inputs
 * (one per category). The library today costs about 12,000; this leaves room
 * for one a hundred times its size and stops a tree built to be expensive
 * (many categories x many files) within a fraction of a second.
 */
export const MAX_IDENTITY_WORK = 5_000_000;

export function identitiesFromTree(
  entries: TreeEntry[],
  tests: TestLocation[],
  commit: { hash: string; date: string },
  opts: { maxWork?: number } = {},
): Map<string, TestVersionIdentity> {
  const maxWork = opts.maxWork ?? MAX_IDENTITY_WORK;
  let work = 0;
  const spend = (units: number): void => {
    work += units;
    if (work > maxWork) throw new TreeTooLargeError();
  };

  const result = new Map<string, TestVersionIdentity>();
  const blobs = entries.filter(e => e.type === 'blob');
  const treeByPath = new Map<string, string>();
  for (const e of entries) {
    if (e.type === 'tree') treeByPath.set(e.path, e.hash);
  }

  // The files of every test folder, in one pass over the tree: each file is
  // looked up under its ancestor folders instead of every test scanning every
  // file. A test folder inside another test's folder gets the file too, as a
  // prefix match per test did.
  const ownByRelPath = new Map<string, TreeEntry[]>();
  // Folder depth of the deepest test: no deeper ancestor of a file can be a
  // test folder, so the lookup stops there. Without the stop, a file nested
  // thousands of folders deep would cost one lookup per folder, each over a
  // longer prefix, and none of it counted against the limit.
  let maxTestDepth = 0;
  for (const { relPath } of tests) {
    if (ownByRelPath.has(relPath)) continue;
    ownByRelPath.set(relPath, []);
    maxTestDepth = Math.max(maxTestDepth, relPath.split('/').length);
  }
  for (const b of blobs) {
    let slash = -1;
    for (let depth = 1; depth <= maxTestDepth; depth++) {
      slash = b.path.indexOf('/', slash + 1);
      if (slash === -1) break;
      const own = ownByRelPath.get(b.path.slice(0, slash));
      if (own) {
        spend(1);
        own.push(b);
      }
    }
  }

  // The shared inputs are the same for every test of a category: hash each
  // distinct set once.
  const sharedHashes = new Map<string, string>();
  const sharedHashOf = (relPath: string): string => {
    const prefixes = sharedInputPrefixes(relPath);
    const key = prefixes.join('\n');
    let hash = sharedHashes.get(key);
    if (hash === undefined) {
      spend(blobs.length);
      hash = hashLines(blobs.filter(b => prefixes.some(p => matchesPrefix(b.path, p))));
      sharedHashes.set(key, hash);
    }
    return hash;
  };

  for (const { uuid, relPath } of tests) {
    const dirPrefix = `${relPath}/`;
    const own = ownByRelPath.get(relPath) ?? [];
    if (own.length === 0) continue;

    const sourceHash = hashLines(
      own
        .map(b => ({ path: b.path.slice(dirPrefix.length), hash: b.hash }))
        .filter(l => isBuildInput(l.path)),
    );
    const sharedHash = sharedHashOf(relPath);

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
  // An entry names a file, or a folder and everything under it.
  for (const name of generated) {
    if (relPosix === name || relPosix.startsWith(`${name}/`)) return true;
  }
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
   * Paths relative to `testDir`, '/' separators, that are not source: every
   * embed dependency of the test, whether it is there yet or not. A file
   * ('validator.dat', '<uuid>-T1.exe.gz') is left out itself; a folder
   * ('generated') is left out with everything under it. Uploaded ones are
   * tracked by the build's deps hash, build-made ones are build output.
   */
  generatedFiles: string[] = [],
): TestVersionIdentity {
  const generated = new Set(
    generatedFiles
      .map(f => f.split(path.sep).join('/').replace(/\/+$/, ''))
      .filter(f => f !== ''),
  );
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
 * Add the regular files at `full` to `out`: the file itself, or every regular
 * file under a folder. Links, FIFOs, devices and sockets are skipped, and so
 * is anything that can't be read.
 */
function collectRegularFiles(full: string, relPosix: string, out: Map<string, string>): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(full);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) {
    try {
      out.set(relPosix, sha256(fs.readFileSync(full)));
    } catch {
      // unreadable: contributes nothing
    }
    return;
  }
  if (!st.isDirectory()) return;
  let names: string[];
  try {
    names = fs.readdirSync(full);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    collectRegularFiles(path.join(full, name), `${relPosix}/${name}`, out);
  }
}

/**
 * sha256 over what the named entries of a directory hold (relative path and
 * content of each regular file). A name can be a file or a folder (walked
 * recursively). Only regular files that are really inside `dir` count:
 * links (the entry, a folder above it, or anything in a walked folder), FIFOs,
 * devices and names that leave `dir` are skipped, and so is a name that
 * matches nothing. Never throws. Returns null when the list is empty.
 */
export function hashFiles(dir: string, filenames: string[]): string | null {
  if (filenames.length === 0) return null;
  const files = new Map<string, string>();
  const toLines = () => hashLines([...files].map(([p, hash]) => ({ path: p, hash })));
  const root = path.resolve(dir);
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return toLines();
  }
  for (const name of filenames) {
    const full = path.resolve(root, name);
    const rel = path.relative(root, full);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    try {
      // A link anywhere between `dir` and the entry resolves somewhere else.
      if (fs.realpathSync(full) !== path.join(realRoot, rel)) continue;
    } catch {
      continue; // not there
    }
    collectRegularFiles(full, rel.split(path.sep).join('/'), files);
  }
  return toLines();
}
