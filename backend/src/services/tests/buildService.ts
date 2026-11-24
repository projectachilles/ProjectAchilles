// Build service: Go cross-compilation, build_all.sh execution, osslsigncode signing

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BuildArtifact, BuildInfo, BuildJob, BuildMetadata, EmbedDependency, PlatformSettings } from '../../types/tests.js';
import type { TestsSettingsService } from './settings.js';
import { BuildJobs } from './buildJobs.js';
import { describeCommandFailure } from '../shared/commandFailure.js';
import { buildSubprocessEnv } from './buildEnv.js';
import { writePrivateTempFile } from './privateTempFile.js';
import type { PrivateTempFile } from './privateTempFile.js';
import { isUsableSourceRoot } from '../browser/repositoryRoot.js';
import { hashFiles, isBuildInput } from '../browser/versionIdentity.js';
import { sanitizeGitError } from '../browser/gitSyncService.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { BuildVersionStamp, TestVersionIdentity } from '../../types/testVersion.js';

const execFileAsync = promisify(execFile);

/** Where a build learns which source version it is compiling. */
export interface BuildVersionSource {
  /** Identity of the test as it is on disk now, plus whether its build inputs differ from HEAD. */
  current(uuid: string): Promise<{ identity: TestVersionIdentity; modified: boolean } | null>;
}

/** Thrown when a build command fails — carries the stderr output for the user */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/**
 * Thrown when a build finds that its marker no longer holds its token
 * (another build of the test took it over, or it was removed): the build
 * stops there, before its next step and before it writes into the build
 * directory. The route answers 409.
 */
export class BuildSupersededError extends BuildError {
  constructor() {
    super('Build was superseded by another build of this test');
    this.name = 'BuildSupersededError';
  }
}

// Heavy build subprocesses (go build/mod, build_all.sh) are CPU-bound and, on a
// small shared instance, can starve the Node event loop — slowing the Render
// /api/health check until the platform recycles the instance mid-build. Run
// them at a lower scheduling priority via `nice` so the API and health check
// keep the CPU they need. Opt-in via BUILD_NICE (a niceness level like "15",
// set in render.yaml); unset or "off" disables it, so local dev and the test
// suite (which mocks execFile) are unaffected. `nice` is POSIX; skip on Windows.
const BUILD_NICE = process.env.BUILD_NICE;
function withNice(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (!BUILD_NICE || BUILD_NICE === 'off' || process.platform === 'win32') return { cmd, args };
  return { cmd: 'nice', args: ['-n', BUILD_NICE, cmd, ...args] };
}

/** Run execFileAsync and convert failures into BuildError with stderr (or stdout) context */
async function runBuildCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<void> {
  const exec = withNice(cmd, args);
  try {
    await execFileAsync(exec.cmd, exec.args, opts);
  } catch (err: unknown) {
    // Report the logical command, not the `nice` wrapper, so failures read clearly.
    throw new BuildError(describeCommandFailure(cmd, args, err));
  }
}

// Build concurrency limiter (size 1). A build is CPU- and memory-heavy; two
// running at once (different test UUIDs) double the pressure on a single small
// instance and can trip the health check into a restart. When the slot is free
// the build starts synchronously (so its job shows "running" at once); a second
// build queues and starts when the slot frees. Scoped per BuildService instance
// — production has one, so this serializes process-wide; tests get a fresh slot.
class BuildSlot {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.locked) {
      this.locked = true;
      return this.exec(fn);
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => { this.exec(fn).then(resolve, reject); });
    });
  }

  private async exec<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next waiter (lock stays held) so no new
      // caller can slip in between; only release the lock when the queue drains.
      const next = this.queue.shift();
      if (next) next();
      else this.locked = false;
    }
  }
}

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const BUILDS_DIR = path.join(SETTINGS_DIR, 'builds');

const KNOWN_CATEGORIES = ['cyber-hygiene', 'intel-driven', 'mitre-top10', 'phase-aligned'];

/**
 * Determine whether an embedded binary is compiled from Go source by build_all.sh.
 * Uses four heuristics in order:
 *  1. Direct match — foo.exe → foo.go
 *  2. Hyphen-to-underscore — validator-defender.exe → validator_defender.go
 *  3. UUID-prefix stage — <uuid>-T1486.exe(.gz) → stage-T1486.go  (or prefix match)
 *  4. Fallback — parse build_all.sh for literal `go build -o <filename>`
 */
function isSourceBuiltBinary(
  filename: string,
  testUuid: string,
  goFileSet: Set<string>,
  buildScript: string | null,
): boolean {
  if (!buildScript) return false;

  // Strip known binary + compression extensions (handles compound like .exe.gz)
  const base = filename
    .replace(/\.(gz|xz|bz2|zip)$/i, '')    // compression suffix first
    .replace(/\.(exe|dll|bin|so|dylib)$/i, ''); // then binary extension

  // 1. Direct match: foo.exe → foo.go
  if (goFileSet.has(`${base}.go`)) return true;

  // 2. Hyphen-to-underscore: validator-defender.exe → validator_defender.go
  const underscored = base.replace(/-/g, '_');
  if (underscored !== base && goFileSet.has(`${underscored}.go`)) return true;

  // 3. UUID-prefix stage: <uuid>-suffix.exe → strip UUID, match source
  const uuidPrefix = `${testUuid}-`;
  if (filename.startsWith(uuidPrefix)) {
    const suffix = base.slice(uuidPrefix.length);
    if (goFileSet.has(`${suffix}.go`)) return true;
    if (goFileSet.has(`stage-${suffix}.go`)) return true;
    // Prefix match for numbered stages: <uuid>-stage1.exe → stage1-defense-evasion.go
    for (const goFile of goFileSet) {
      if (goFile.startsWith(`${suffix}-`)) return true;
    }
  }

  // 4. Fallback: parse build_all.sh for literal `go build -o <filename>`
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buildPattern = new RegExp(`go\\s+build\\b.*-o\\s+(?:["'])?${escaped}(?:["'])?(?:\\s|$)`, 'm');
  if (buildPattern.test(buildScript)) return true;

  // 5. Build-created directory: `//go:embed generated` has no individual
  // uploadable filename, so a script that creates the directory owns it and
  // must generate its contents before compilation.
  const directoryPattern = new RegExp(`\\bmkdir\\s+(?:-p\\s+)?(?:["'])?${escaped}(?:["'])?(?:\\s|$)`, 'm');
  if (directoryPattern.test(buildScript)) return true;

  return false;
}

const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const BUILD_TIMEOUT = 300_000; // 5 minutes
const SIGN_TIMEOUT = 60_000;

/**
 * A build's marker file in BUILDS_DIR/<uuid>, so every process (each HTTP
 * worker has its own BuildService and in-memory jobs) sees that the test is
 * building. Uploads and deletes hold the same marker while they write
 * (withTestFolderLock). The build refreshes it before every step (one
 * subprocess, at most BUILD_TIMEOUT or SIGN_TIMEOUT), so a marker older than
 * both together was left by a process that died mid-build, or by a build
 * whose step overran its timeout (the timeout signals only the direct child,
 * so a step can outlive it), or by a build that waited longer than that on
 * a version read, which has no timeout (the one before the first step, or
 * the stamp's second identity read after the last one). A stale marker is
 * taken over, and the build that owned it stops at its next check
 * (BuildSupersededError) without touching the new owner's marker (see
 * BuildMarkerHandle).
 */
const BUILD_MARKER = '.building';
const BUILD_MARKER_STALE_MS = BUILD_TIMEOUT + SIGN_TIMEOUT;
/**
 * A takeover claim (see takeOverStaleMarker) older than this was left by a
 * process that stopped inside the takeover, a few synchronous file calls.
 */
const TAKEOVER_CLAIM_STALE_MS = 30_000;
/** Claims tried per stale marker before giving up (each one left by a stopped process). */
const TAKEOVER_CLAIM_ATTEMPTS = 5;
const BUILD_IN_PROGRESS = 'Build in progress for this test';

/**
 * The marker a build (or an upload or delete) holds. The file carries the
 * same random token; refresh, release and the version stamp act only while it
 * still does, so a build whose marker another build took over can't touch the
 * other build's marker; the build itself stops at its next refresh.
 */
export interface BuildMarkerHandle {
  path: string;
  token: string;
}

/**
 * ours: the marker holds this handle's token; foreign: it was read and holds
 * something else; gone: there is none; unreadable: reading it failed with an
 * error other than ENOENT (EMFILE, EIO...), so ownership is unknown.
 */
type MarkerState = 'ours' | 'foreign' | 'gone' | 'unreadable';

/** What a void of build-meta.json hands the put-back (see voidPreviousStamp). */
interface VoidedMeta {
  /** build-meta.json as it was before the void. */
  raw: string;
  /**
   * For a meta with no version stamp: the artifact's SHA-256 taken just
   * before the void. null when there was no artifact, when it can't be hashed,
   * and on the build_all.sh path (which never puts the meta back). A stamped
   * meta is proven by its stamp instead, so this stays null for it.
   */
  hashBefore: string | null;
}

/** What a build reads before compiling, for its stamp. */
interface VersionBefore {
  identity: TestVersionIdentity;
  modified: boolean;
  /** Uploaded embed dependencies present before the build (presentUploadedDependencies). */
  uploadedDeps: string[];
}

export class BuildService {
  private settingsService: TestsSettingsService;
  private testSourcePaths: string[];
  private jobs = new BuildJobs<BuildInfo>();
  private buildSlot = new BuildSlot();
  /** Handles whose marker was found taken over (warned once). */
  private lostMarkers = new WeakSet<BuildMarkerHandle>();
  /** Handles whose marker could not be read during a refresh (warned once). */
  private unreadableMarkers = new WeakSet<BuildMarkerHandle>();

  private versionSource?: BuildVersionSource;

  constructor(
    settingsService: TestsSettingsService,
    testSourcePaths: string[] | string,
    versionSource?: BuildVersionSource,
  ) {
    this.settingsService = settingsService;
    this.versionSource = versionSource;
    this.testSourcePaths = typeof testSourcePaths === 'string'
      ? [testSourcePaths]
      : testSourcePaths;
  }

  /**
   * Start the build for `uuid`, or join it if one is already running.
   * The returned promise settles with buildAndSign's result; getBuildJob()
   * exposes the same build's status for callers that don't wait.
   */
  startBuild(uuid: string): { job: BuildJob; promise: Promise<BuildInfo> } {
    // jobs.run dedupes by uuid (joins an in-flight build for the same test);
    // the build slot serializes distinct builds process-wide. The job is marked
    // running immediately, so polling works even while a build waits its turn.
    return this.jobs.run(uuid, () => this.buildSlot.run(async () => {
      try {
        return await this.buildAndSign(uuid);
      } catch (err) {
        // A background build has no request to fail, so the error middleware
        // never sees it; log here so the host keeps a record of every failure.
        // Constant format string: console.error treats the first argument as
        // printf-style, so the id must never be interpolated into it.
        console.error('Build failed for %s: %s', uuid, err instanceof Error ? err.message : String(err));
        throw err;
      }
    }));
  }

  /** Latest build job for `uuid` since this process started, if any. */
  getBuildJob(uuid: string): BuildJob | undefined {
    return this.jobs.get(uuid);
  }

  isBuilding(uuid: string): boolean {
    return this.jobs.isRunning(uuid);
  }

  /**
   * Whether `uuid` is building in this process or in any other process that
   * shares BUILDS_DIR (a fresh build marker). The routes' fast pre-check for
   * writes into a test's folder and build directory (those writes then hold
   * the marker themselves, withTestFolderLock); a job's status stays per
   * process (getBuildJob).
   */
  isBuildingAnywhere(uuid: string): boolean {
    return this.isBuilding(uuid) || this.buildMarkerIsFresh(this.buildMarkerPath(uuid));
  }

  private buildMarkerPath(uuid: string): string {
    return path.join(this.safeBuildDir(uuid), BUILD_MARKER);
  }

  private buildMarkerIsFresh(marker: string): boolean {
    try {
      return Date.now() - fs.statSync(marker).mtimeMs < BUILD_MARKER_STALE_MS;
    } catch {
      return false; // no marker
    }
  }

  private buildMarkerContent(token: string): string {
    return JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token });
  }

  /** Create `file` only if it does not exist (`wx`); false when it does. */
  private createExclusive(file: string, content: string): boolean {
    try {
      fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  /** The marker's content, or null when there is none; other read errors throw. */
  private readMarker(marker: string): string | null {
    try {
      return fs.readFileSync(marker, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Whether the marker still holds this handle's token (see MarkerState). */
  private markerState(handle: BuildMarkerHandle): MarkerState {
    let content: string | null;
    try {
      content = this.readMarker(handle.path);
    } catch {
      return 'unreadable';
    }
    if (content === null) return 'gone';
    try {
      const parsed = JSON.parse(content) as { token?: unknown } | null;
      return parsed?.token === handle.token ? 'ours' : 'foreign';
    } catch {
      return 'foreign';
    }
  }

  /** Log, once per handle, that its marker is no longer this build's. */
  private markerLost(handle: BuildMarkerHandle, uuid: string): void {
    if (this.lostMarkers.has(handle)) return;
    this.lostMarkers.add(handle);
    console.warn('Build of %s lost its build marker to another build or a removal: from now on it records no version and leaves the marker alone', uuid);
  }

  /** True while `handle` still holds its marker; otherwise warns (once) and returns false. */
  private ownsMarker(handle: BuildMarkerHandle, uuid: string): boolean {
    if (this.markerState(handle) === 'ours') return true;
    this.markerLost(handle, uuid);
    return false;
  }

  /**
   * Create the build marker atomically (`wx`), or refuse (409) while another
   * process's marker is fresh. A stale one is taken over (takeOverStaleMarker).
   */
  private acquireBuildMarker(uuid: string): BuildMarkerHandle {
    const handle: BuildMarkerHandle = {
      path: path.join(this.ensureBuildDir(uuid), BUILD_MARKER),
      token: crypto.randomBytes(16).toString('hex'),
    };
    const content = this.buildMarkerContent(handle.token);
    if (this.createExclusive(handle.path, content)) return handle;
    if (this.buildMarkerIsFresh(handle.path)) {
      throw new AppError(BUILD_IN_PROGRESS, 409);
    }
    this.takeOverStaleMarker(uuid, handle, content);
    return handle;
  }

  /**
   * Replace a stale marker with `handle`'s, or refuse (409). The takeovers of
   * one stale marker are serialized by a claim file named after its content
   * (created with `wx`), and the claimant checks again, under the claim, that
   * the marker is still that stale one: two processes that both judged it
   * stale can't both take it over. The new marker is written to a temp file,
   * renamed over the old one (atomic) and read back.
   */
  private takeOverStaleMarker(uuid: string, handle: BuildMarkerHandle, content: string): void {
    const dir = path.dirname(handle.path);
    const seen = this.readMarker(handle.path);
    if (seen === null) {
      // Released since it was judged stale: create it like a fresh one.
      if (this.createExclusive(handle.path, content)) return;
      throw new AppError(BUILD_IN_PROGRESS, 409);
    }
    const generation = crypto.createHash('sha256').update(seen).digest('hex').slice(0, 16);
    const claim = this.claimTakeover(dir, generation, handle.token);
    try {
      // Its owner may have refreshed or released it, or another process
      // taken it over, since it was judged stale.
      if (this.readMarker(handle.path) !== seen || this.buildMarkerIsFresh(handle.path)) {
        throw new AppError(BUILD_IN_PROGRESS, 409);
      }
      const tmp = path.join(dir, `${BUILD_MARKER}.${handle.token}.tmp`);
      fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
      try {
        fs.renameSync(tmp, handle.path);
      } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        throw err;
      }
      if (this.markerState(handle) !== 'ours') throw new AppError(BUILD_IN_PROGRESS, 409);
      console.warn('Replacing a stale build marker for %s: its build stopped, or a build step overran its timeout', uuid);
      // The marker no longer holds `seen`, so every claim on it is void now:
      // drop any a process that stopped inside a takeover left behind.
      for (let attempt = 0; attempt < TAKEOVER_CLAIM_ATTEMPTS; attempt++) {
        const other = this.takeoverClaimPath(dir, generation, attempt);
        if (other !== claim) {
          try { fs.unlinkSync(other); } catch { /* none */ }
        }
      }
    } finally {
      try { fs.unlinkSync(claim); } catch { /* already gone */ }
    }
  }

  private takeoverClaimPath(dir: string, generation: string, attempt: number): string {
    return path.join(dir, `${BUILD_MARKER}.takeover-${generation}-${attempt}`);
  }

  /**
   * Create the claim to take over the marker whose content hashes to
   * `generation`, or refuse (409) while another process holds it. A claim
   * older than TAKEOVER_CLAIM_STALE_MS was left by a process that stopped
   * inside a takeover; the next name is tried instead (never removed here,
   * so two processes can't both remove it and both claim).
   */
  private claimTakeover(dir: string, generation: string, token: string): string {
    for (let attempt = 0; attempt < TAKEOVER_CLAIM_ATTEMPTS; attempt++) {
      const claim = this.takeoverClaimPath(dir, generation, attempt);
      if (this.createExclusive(claim, token)) return claim;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(claim).mtimeMs;
      } catch { /* just released: that takeover ran */ }
      if (!(age >= TAKEOVER_CLAIM_STALE_MS)) throw new AppError(BUILD_IN_PROGRESS, 409);
    }
    throw new AppError(BUILD_IN_PROGRESS, 409);
  }

  /**
   * Keep the marker fresh before a build step and before the build writes its
   * outputs. When the marker no longer holds this build's token (another
   * build took it over, or it was removed), the build stops here with
   * BuildSupersededError: it never rewrites the other build's marker, and the
   * error is its report (no separate warning). Touches the file, then reads it
   * again: a takeover that landed between the check and the touch stops the
   * build here too (the touch only freshened the new owner's marker). A
   * marker that can't be read (EMFILE, EIO...) proves nothing either way: one
   * warning, and the build goes on; the next step and the stamp check it
   * again (the stamp is refused unless the marker reads as ours). A failed
   * touch never fails the build.
   */
  private refreshBuildMarker(handle: BuildMarkerHandle, uuid: string): void {
    this.assertNotSuperseded(handle, uuid);
    try {
      const now = new Date();
      fs.utimesSync(handle.path, now, now);
    } catch { /* the next step refreshes it again */ }
    this.assertNotSuperseded(handle, uuid);
  }

  /** Throw BuildSupersededError when the marker was read and is another build's, or is gone. */
  private assertNotSuperseded(handle: BuildMarkerHandle, uuid: string): void {
    const state = this.markerState(handle);
    if (state === 'foreign' || state === 'gone') {
      // Release then leaves the marker alone without a warning of its own.
      this.lostMarkers.add(handle);
      throw new BuildSupersededError();
    }
    if (state === 'unreadable' && !this.unreadableMarkers.has(handle)) {
      this.unreadableMarkers.add(handle);
      console.warn('Build of %s could not read its build marker; the build goes on and checks it again at its next step', uuid);
    }
  }

  /**
   * Remove the marker if it still holds this handle's token; another build's
   * marker is left in place (with the one warning, unless `quiet`). A marker
   * already gone is fine: deleteBuild removes the whole build directory.
   */
  private releaseBuildMarker(handle: BuildMarkerHandle, uuid: string, opts: { quiet?: boolean } = {}): void {
    const state = this.markerState(handle);
    if (state === 'ours') {
      try { fs.unlinkSync(handle.path); } catch { /* already gone */ }
    } else if (state === 'foreign' && !opts.quiet) {
      this.markerLost(handle, uuid);
    }
  }

  /**
   * Run `fn` while holding the test's build marker, the one a build holds, so
   * a build in any process can't start while `fn` writes into the test's
   * folder or build directory. Refused with the running-build 409 while this
   * process builds the test or another process's marker is fresh; a stale
   * marker is taken over. Released when `fn` returns or throws; quietly when
   * `fn` removed it. `fn` must be synchronous (the marker is released as soon
   * as it returns); the three callers (saveUploadedFile, uploadBinary,
   * deleteBuild) are.
   */
  withTestFolderLock<T>(uuid: string, fn: () => T): T {
    if (this.isBuilding(uuid)) throw new AppError(BUILD_IN_PROGRESS, 409);
    const handle = this.acquireBuildMarker(uuid);
    try {
      return fn();
    } finally {
      // Quiet: a synchronous `fn` can't see its fresh marker taken over, so
      // another token here is a build that started after deleteBuild.
      this.releaseBuildMarker(handle, uuid, { quiet: true });
    }
  }

  /**
   * Locate the test directory for a UUID across all source paths.
   *
   * Defense in depth: every public entry point already validates the UUID
   * against UUID_REGEX (which forbids `..`, `/`, `\`, and NUL by
   * construction), but here we additionally canonicalise the candidate
   * path and verify it stays within the basePath root. This protects
   * against:
   *   1. future regressions where UUID validation is loosened
   *   2. symlink redirection if testSourcePaths ever contains a symlinked dir
   *   3. CodeQL `js/path-injection` flow analysis, which doesn't recognise
   *      regex validation as a sufficient sanitiser. The pattern below
   *      (path.resolve → path.relative boundary check → return resolved)
   *      IS recognised — that's why the candidate is rebuilt as `resolved`
   *      and `resolved` is what flows downstream, not the raw join result.
   */
  private findTestDir(uuid: string): string | null {
    for (const basePath of this.testSourcePaths) {
      const root = path.resolve(basePath);
      // A Git-synced root that is a link is refused (see repositoryRoot.ts).
      if (!isUsableSourceRoot(root)) continue;

      // Verify a candidate path stays inside `root`. Returns the canonical
      // form (path.resolve output) when safe, null otherwise. Returning the
      // resolved form is what CodeQL's js/path-injection query treats as a
      // sanitised value flowing forward.
      const safeResolve = (candidate: string): string | null => {
        const resolved = path.resolve(candidate);
        const rel = path.relative(root, resolved);
        // Empty rel means candidate IS the root (not a subpath); leading `..`
        // means it escaped; isAbsolute catches Windows drive switches.
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return resolved;
      };

      // Try category/<uuid> first
      for (const cat of KNOWN_CATEGORIES) {
        const safe = safeResolve(path.join(basePath, cat, uuid));
        if (safe && fs.existsSync(safe) && fs.statSync(safe).isDirectory()) {
          return safe;
        }
      }
      // Try flat <uuid>
      const safeFlat = safeResolve(path.join(basePath, uuid));
      if (safeFlat && fs.existsSync(safeFlat) && fs.statSync(safeFlat).isDirectory()) {
        return safeFlat;
      }
    }
    return null;
  }

  /**
   * Resolve the per-build directory for `uuid` and verify it stays
   * inside BUILDS_DIR. UUID is already validated by UUID_REGEX at the
   * route layer, but CodeQL's flow analysis treats the regex as an
   * insufficient sanitiser. The path.resolve → path.relative pattern
   * here (same as findTestDir / safeBinaryPath) IS recognised, and
   * returning the resolved canonical form is what makes downstream
   * fs calls flow-safe.
   *
   * Throws if the candidate escapes BUILDS_DIR — UUID_REGEX makes
   * this unreachable in practice; the throw exists so callers don't
   * have to handle a null path everywhere.
   */
  private safeBuildDir(uuid: string): string {
    const root = path.resolve(BUILDS_DIR);
    const resolved = path.resolve(root, uuid);
    const rel = path.relative(root, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BuildError(`Invalid build uuid: ${uuid}`);
    }
    return resolved;
  }

  private ensureBuildDir(uuid: string): string {
    const dir = this.safeBuildDir(uuid);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private metaPath(uuid: string): string {
    return path.join(this.safeBuildDir(uuid), 'build-meta.json');
  }

  /** Extract GOOS from a //go:build or // +build directive in a Go file */
  private detectBuildTagOS(filePath: string): PlatformSettings['os'] | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Only scan the first ~20 lines (build tags must appear before package clause)
      const lines = content.split('\n').slice(0, 20);
      const validOS: PlatformSettings['os'][] = ['windows', 'linux', 'darwin'];

      for (const line of lines) {
        const trimmed = line.trim();
        // New-style: //go:build linux
        const newMatch = trimmed.match(/^\/\/go:build\s+(\w+)/);
        if (newMatch && validOS.includes(newMatch[1] as PlatformSettings['os'])) {
          return newMatch[1] as PlatformSettings['os'];
        }
        // Legacy-style: // +build linux
        const legacyMatch = trimmed.match(/^\/\/\s*\+build\s+(\w+)/);
        if (legacyMatch && validOS.includes(legacyMatch[1] as PlatformSettings['os'])) {
          return legacyMatch[1] as PlatformSettings['os'];
        }
      }
    } catch {
      // File read error — fall through
    }
    return null;
  }

  /**
   * Synthesize LOG_DIR/ARTIFACT_DIR if a .go file references LOG_DIR but no
   * file declares it. Returns the injected file path, or null if nothing was
   * needed.
   *
   * Why: tests that ship the shared `test_logger.go` without the platform
   * companion (`test_logger_<os>.go`) reference LOG_DIR but don't declare it,
   * so `go build .` fails with `undefined: LOG_DIR`. Rather than patch every
   * affected test source-side, we synthesize the declaration at build time
   * with the same constants the agent itself uses (C:\F0 on Windows,
   * /tmp/F0 on POSIX) — see f0_library/CLAUDE.md "Cross-Platform Test
   * Development". The caller MUST clean up the returned path in `finally`.
   *
   * Issue #202: mitre-top10 `b8e4c9d2-7f3a-4e1b-8c5d-2a3b4c5d6e02` build
   * failed with `./test_logger.go:1221:30: undefined: LOG_DIR`.
   */
  private injectLogDirIfMissing(testDir: string, targetOs: PlatformSettings['os']): string | null {
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));

    let referenced = false;
    let declared = false;
    for (const f of goFiles) {
      const content = fs.readFileSync(path.join(testDir, f), 'utf8');
      if (!referenced && /\bLOG_DIR\b/.test(content)) referenced = true;
      // Match a LOG_DIR declaration at the start of a line. The optional
      // `const `/`var ` prefix covers the single-line form
      // (`const LOG_DIR = …`); making it optional also matches a member of a
      // grouped, parenthesised block (`const ( … \n  LOG_DIR = … \n )`) where
      // the member line carries no keyword. The trailing `[^=\n]*=` requires
      // an assignment on that line, so a bare reference like
      // `filepath.Join(LOG_DIR, …)` (which never begins a line with LOG_DIR)
      // is not misread as a declaration — keeping the issue #202 fix intact.
      if (!declared && /^\s*(const\s+|var\s+)?LOG_DIR\b[^=\n]*=/m.test(content)) declared = true;
      if (referenced && declared) break;
    }

    if (!referenced || declared) return null;

    // Match the agent's platform-specific fallback paths (agent/internal/config).
    const logDir = targetOs === 'windows' ? 'C:\\F0' : '/tmp/F0';
    const artifactDir = targetOs === 'windows'
      ? 'c:\\Users\\fortika-test'
      : targetOs === 'darwin'
        ? '/Users/fortika-test'
        : '/home/fortika-test';

    // Filename must NOT start with `_` or `.` — `go build` ignores those
    // by spec (see `go help build` / cmd/go), so an underscore-prefixed
    // file is silently skipped and the LOG_DIR symbol stays undefined.
    // The leading `achilles_` prefix is unique enough to make the file
    // recognisable as auto-generated; cleanup in `finally` is the
    // primary safeguard against leaving the file behind.
    const injectedPath = path.join(testDir, 'achilles_log_dir.go');
    // Use Go raw strings (backticks) so backslashes in Windows paths are
    // taken literally without escaping.
    const goSource = `// Code generated by ProjectAchilles buildService. DO NOT EDIT.
// Removed automatically after \`go build\`. See injectLogDirIfMissing in
// backend/src/services/tests/buildService.ts and issue #202 for context.
package main

const LOG_DIR = \`${logDir}\`
const ARTIFACT_DIR = \`${artifactDir}\`
`;
    fs.writeFileSync(injectedPath, goSource);
    return injectedPath;
  }

  /** Resolve the target OS for a test: build tags take precedence over global setting */
  private resolveTargetOS(testDir: string, uuid: string): PlatformSettings['os'] {
    // 1. Check the main <uuid>.go file first
    const mainFile = path.join(testDir, `${uuid}.go`);
    if (fs.existsSync(mainFile)) {
      const os = this.detectBuildTagOS(mainFile);
      if (os) return os;
    }

    // 2. Check other .go files in the test directory. Collect ALL detected
    //    OSes rather than taking the first: a dual-platform test (untagged
    //    main file plus e.g. test_logger_linux.go + test_logger_windows.go)
    //    would otherwise resolve to whichever filename readdir returns first
    //    — alphabetically `*_linux.go` before `*_windows.go` — and silently
    //    build the wrong-OS binary (observed: Linux binary shipped to a
    //    Windows agent). On conflicting tags, fall back to the global
    //    platform setting instead of guessing.
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go') && f !== `${uuid}.go`);
    const detected = new Set<PlatformSettings['os']>();
    for (const goFile of goFiles) {
      const os = this.detectBuildTagOS(path.join(testDir, goFile));
      if (os) detected.add(os);
    }
    if (detected.size === 1) return [...detected][0];

    // 3. Fall back to global platform setting (no tags, or conflicting tags)
    return this.settingsService.getPlatformSettings().os;
  }

  /**
   * Resolve the FULL set of target OSes for a test. Unlike resolveTargetOS
   * (which collapses a dual-platform test to a single primary), this returns
   * every OS the test's build tags indicate — so a cross-platform build_all.sh
   * run can record a per-OS artifact for each. Falls back to the global
   * platform setting when no build tags are present.
   */
  private resolveTargetOSes(testDir: string, uuid: string): PlatformSettings['os'][] {
    // basename() strips any path separators — a path-injection sanitizer CodeQL
    // recognizes. For a UUID_REGEX-valid uuid this is a no-op.
    const safeUuid = path.basename(uuid);
    const detected = new Set<PlatformSettings['os']>();
    const mainFile = path.join(testDir, `${safeUuid}.go`);
    if (fs.existsSync(mainFile)) {
      const os = this.detectBuildTagOS(mainFile);
      if (os) detected.add(os);
    }
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go') && f !== `${safeUuid}.go`);
    for (const goFile of goFiles) {
      const os = this.detectBuildTagOS(path.join(testDir, goFile));
      if (os) detected.add(os);
    }
    if (detected.size > 0) return [...detected];
    return [this.settingsService.getPlatformSettings().os];
  }

  /** Output filename convention: Windows binaries carry `.exe`, others bare. */
  private osBinaryFilename(uuid: string, targetOs: PlatformSettings['os']): string {
    return targetOs === 'windows' ? `${uuid}.exe` : uuid;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Resolve a binary path inside BUILDS_DIR/<uuid>/ and verify it stays
   * within that directory. `meta.filename` comes from JSON on disk
   * written by buildAndSign — trusted in normal operation, but a
   * defensive boundary check rules out path traversal if the build
   * metadata is ever tampered with.
   *
   * Uses the same path.resolve → path.relative pattern as findTestDir,
   * which CodeQL's js/path-injection query recognises as a sanitiser.
   * Returning the resolved value (not the raw join result) is what
   * makes the data flow recognised as safe downstream.
   */
  private safeBinaryPath(uuid: string, filename: string): string | null {
    const root = path.resolve(BUILDS_DIR, uuid);
    const resolved = path.resolve(root, filename);
    const rel = path.relative(root, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return resolved;
  }

  /**
   * Resolve `parts` under `root` and verify the result stays strictly inside
   * it. Used for the build_all.sh output lookup, whose paths contain the test
   * UUID: UUID_REGEX already rules out traversal, but CodeQL's
   * js/path-injection query doesn't accept a regex as a sanitiser.
   *
   * Uses the same path.resolve → path.relative pattern as findTestDir and
   * safeBinaryPath, which CodeQL recognises. Returning the resolved value
   * (not the raw join result) is what makes the data flow recognised as safe
   * downstream, so callers must use it for every fs call. null for the root
   * itself or anything outside it (`..`, an absolute part).
   */
  private resolveInside(root: string, ...parts: string[]): string | null {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...parts);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return resolved;
  }

  getBuildInfo(uuid: string): BuildInfo {
    const metaFile = this.metaPath(uuid);
    if (!fs.existsSync(metaFile)) {
      return { exists: false };
    }
    try {
      const meta: BuildMetadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const binaryPath = this.safeBinaryPath(uuid, meta.filename);
      if (!binaryPath || !fs.existsSync(binaryPath)) {
        return { exists: false };
      }
      return {
        exists: true,
        platform: meta.platform,
        signed: meta.signed,
        fileSize: meta.fileSize,
        builtAt: meta.builtAt,
        filename: meta.filename,
        source: meta.source,
        ...(meta.version ? { version: meta.version } : {}),
      };
    } catch {
      return { exists: false };
    }
  }

  getDetectedPlatform(uuid: string): PlatformSettings | null {
    const testDir = this.findTestDir(uuid);
    if (!testDir) return null;
    const globalPlatform = this.settingsService.getPlatformSettings();
    return {
      os: this.resolveTargetOS(testDir, uuid),
      arch: globalPlatform.arch,
    };
  }

  getBinaryPath(uuid: string): string | null {
    const metaFile = this.metaPath(uuid);
    if (!fs.existsSync(metaFile)) return null;
    try {
      const meta: BuildMetadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const binaryPath = this.safeBinaryPath(uuid, meta.filename);
      if (!binaryPath) return null;
      return fs.existsSync(binaryPath) ? binaryPath : null;
    } catch {
      return null;
    }
  }

  /**
   * List the UUIDs of every test that currently has a binary — built from
   * source or uploaded; both count. Backs the Browse tab's "Has binary"
   * filter. One directory scan plus a metadata check per entry, reusing
   * getBuildInfo() so the existence semantics stay identical.
   */
  listBuiltUuids(): string[] {
    if (!fs.existsSync(BUILDS_DIR)) return [];
    try {
      return fs.readdirSync(BUILDS_DIR)
        .filter(entry => UUID_REGEX.test(entry))
        .filter(uuid => this.getBuildInfo(uuid).exists);
    } catch {
      return [];
    }
  }

  /**
   * Remove the build directory (marker included) under the test folder lock;
   * 409 while a build runs. The directory is first renamed to
   * `<uuid>.deleting-<random>` (atomic, same parent), then removed: a build or
   * upload that starts once the marker has moved away gets a new, empty
   * directory the removal never touches. listBuiltUuids only lists names that
   * are a UUID, so a renamed directory is never a build; one a crash left
   * behind is removed by the next delete of that test.
   */
  deleteBuild(uuid: string): void {
    const buildDir = this.safeBuildDir(uuid);
    this.removeDeletingLeftovers(uuid);
    if (!fs.existsSync(buildDir)) return;
    this.withTestFolderLock(uuid, () => {
      const doomed = `${buildDir}.deleting-${crypto.randomBytes(8).toString('hex')}`;
      fs.renameSync(buildDir, doomed);
      fs.rmSync(doomed, { recursive: true, force: true });
    });
  }

  /** Remove `<uuid>.deleting-*` directories an interrupted delete left in BUILDS_DIR. */
  private removeDeletingLeftovers(uuid: string): void {
    const root = path.dirname(this.safeBuildDir(uuid));
    const prefix = `${path.basename(this.safeBuildDir(uuid))}.deleting-`;
    try {
      for (const entry of fs.readdirSync(root)) {
        if (typeof entry === 'string' && entry.startsWith(prefix) && /^[0-9a-f]+$/.test(entry.slice(prefix.length))) {
          fs.rmSync(path.join(root, entry), { recursive: true, force: true });
        }
      }
    } catch { /* no BUILDS_DIR yet, or nothing to remove */ }
  }

  getEmbedDependencies(uuid: string): EmbedDependency[] {
    const testDir = this.findTestDir(uuid);
    if (!testDir) return [];

    const deps: EmbedDependency[] = [];
    const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));
    const goFileSet = new Set(goFiles);
    // Only a comment that STARTS with //go:embed is a directive (Go's own
    // rule). A prose comment that mentions it is not a dependency.
    const embedRegex = /^[ \t]*\/\/go:embed[ \t]+(\S+)/gm;

    // Read build_all.sh content for source-built detection
    const buildScriptPath = path.join(testDir, 'build_all.sh');
    const buildScript = fs.existsSync(buildScriptPath)
      ? fs.readFileSync(buildScriptPath, 'utf8')
      : null;

    for (const goFile of goFiles) {
      const content = fs.readFileSync(path.join(testDir, goFile), 'utf8');
      let match;
      while ((match = embedRegex.exec(content)) !== null) {
        const filename = match[1];
        // Skip .go and .ps1 files — those are source that build_all.sh handles
        // A .ps1 normally counts through the source fingerprint; one the fingerprint
        // leaves out by name must be covered here, or nothing would notice it change.
        if (filename.endsWith('.go') || (filename.endsWith('.ps1') && isBuildInput(filename))) continue;
        const exists = fs.existsSync(path.join(testDir, filename));
        const sourceBuilt = isSourceBuiltBinary(filename, uuid, goFileSet, buildScript);
        deps.push({ filename, sourceFile: goFile, exists, sourceBuilt });
      }
    }

    return deps;
  }

  /**
   * Every embed dependency name of a test (relative to its folder), whether
   * it exists yet or not and whether build_all.sh makes it or it is
   * uploaded: none of them is source of the test's content fingerprint.
   */
  embedDependencyNames(uuid: string): string[] {
    return this.getEmbedDependencies(uuid).map(d => d.filename);
  }

  /** Hash of the embed dependencies on disk that are (or are not) built from source; null when none. */
  private embedDependenciesHash(uuid: string, sourceBuilt: boolean): string | null {
    const testDir = this.findTestDir(uuid);
    if (!testDir) return null;
    const names = this.getEmbedDependencies(uuid)
      .filter(d => d.exists && d.sourceBuilt === sourceBuilt)
      .map(d => d.filename);
    return hashFiles(testDir, names);
  }

  /**
   * Hash of the embed dependencies that are on disk and not built from source
   * (uploaded payloads, and anything else no source-built rule matches; the
   * build stamps it after the build, see stampVersion). null when the test has
   * none.
   */
  currentDepsHash(uuid: string): string | null {
    return this.embedDependenciesHash(uuid, false);
  }

  /** Names of the embed dependencies currentDepsHash covers that are on disk now. */
  private presentUploadedDependencies(uuid: string): string[] {
    return this.getEmbedDependencies(uuid)
      .filter(d => d.exists && !d.sourceBuilt)
      .map(d => d.filename);
  }

  /**
   * Hash of the embed dependencies that are on disk and built by build_all.sh
   * (files and folders, including anything the test author put in a folder
   * the script creates). They are in neither the content fingerprint nor
   * currentDepsHash. null when the test has none.
   */
  currentOutputsHash(uuid: string): string | null {
    return this.embedDependenciesHash(uuid, true);
  }

  /** Write an uploaded embed dependency into the test folder, under the test folder lock (409 while a build runs). */
  saveUploadedFile(uuid: string, filename: string, buffer: Buffer): void {
    const testDir = this.findTestDir(uuid);
    if (!testDir) {
      throw new Error('Test directory not found');
    }

    // Path traversal protection: only allow bare filenames
    const baseName = path.basename(filename);
    if (baseName !== filename || filename.includes('..')) {
      throw new Error('Invalid filename');
    }

    this.withTestFolderLock(uuid, () => {
      // M8: Only allow known embed dependency filenames to prevent arbitrary file writes
      const deps = this.getEmbedDependencies(uuid);
      const dep = deps.find(d => d.filename === baseName);
      if (!dep) {
        throw new Error(`Filename '${baseName}' is not a known embed dependency for this test`);
      }

      // Reject uploads for source-built dependencies — these are compiled by build_all.sh
      if (dep.sourceBuilt) {
        throw new Error(`Cannot upload '${baseName}': this binary is built from source by build_all.sh`);
      }

      fs.writeFileSync(path.join(testDir, baseName), buffer);
    });
  }

  /** Store an uploaded test binary and its metadata, under the test folder lock (409 while a build runs). */
  uploadBinary(uuid: string, buffer: Buffer): BuildInfo {
    if (!UUID_REGEX.test(uuid)) {
      throw new Error('Invalid UUID format');
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('Empty file');
    }

    // Windows PE header check: first two bytes must be "MZ" (0x4D 0x5A)
    if (buffer.length < 2 || buffer[0] !== 0x4D || buffer[1] !== 0x5A) {
      throw new Error('File does not appear to be a valid Windows executable (missing MZ header)');
    }

    return this.withTestFolderLock(uuid, () => this.writeUploadedBinary(uuid, buffer));
  }

  private writeUploadedBinary(uuid: string, buffer: Buffer): BuildInfo {
    const platform = this.settingsService.getPlatformSettings();
    const safeUuid = path.basename(uuid);
    const filename = platform.os === 'windows'
      ? `${safeUuid}.exe`
      : safeUuid;
    const buildDir = this.ensureBuildDir(uuid);
    const outputPath = path.join(buildDir, filename);

    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed: false,
      fileSize: buffer.length,
      filename,
      source: 'uploaded',
    };
    // The meta (no version stamp) first: a crash before the binary write
    // then leaves "uploaded" beside the old bytes, never the old stamp beside
    // the new ones.
    // Atomic (temp + rename): a task created on another worker reads the old
    // meta or the new one, never an empty file.
    this.writeFileAtomic(this.metaPath(uuid), JSON.stringify(meta, null, 2));
    fs.writeFileSync(outputPath, buffer);

    return {
      exists: true,
      platform: meta.platform,
      signed: meta.signed,
      fileSize: meta.fileSize,
      builtAt: meta.builtAt,
      filename: meta.filename,
      source: 'uploaded',
    };
  }

  async buildAndSign(uuid: string): Promise<BuildInfo> {
    if (!UUID_REGEX.test(uuid)) {
      throw new Error('Invalid UUID format');
    }

    // 1. Find test directory
    const testDir = this.findTestDir(uuid);
    if (!testDir) {
      throw new Error('Test directory not found');
    }

    // Before anything is read for the stamp or written to the test folder.
    const marker = this.acquireBuildMarker(uuid);
    try {
      return await this.runBuild(uuid, testDir, marker);
    } finally {
      this.releaseBuildMarker(marker, uuid);
    }
  }

  private async runBuild(uuid: string, testDir: string, marker: BuildMarkerHandle): Promise<BuildInfo> {
    // Read the version identity BEFORE compiling: the build compiles the
    // working tree as it is now, and a sync could change it mid-build. A
    // failure here only costs the stamp, never the build.
    let versionBefore: VersionBefore | null = null;
    if (this.versionSource) {
      try {
        const current = await this.versionSource.current(uuid);
        if (current) {
          versionBefore = { ...current, uploadedDeps: this.presentUploadedDependencies(uuid) };
        } else {
          console.warn('Build of %s will not record its version: no version available for this test', uuid);
        }
      } catch (err) {
        versionBefore = null;
        console.warn('Build of %s will not record its version: %s', uuid,
          sanitizeGitError(err instanceof Error ? err.message : String(err), process.env.GITHUB_TOKEN));
      }
    }

    // 2. Resolve platform: auto-detect OS from build tags, arch from global setting
    const globalPlatform = this.settingsService.getPlatformSettings();
    const platform: PlatformSettings = {
      os: this.resolveTargetOS(testDir, uuid),
      arch: globalPlatform.arch,
    };
    // Full target OS set — a build_all.sh run emits one artifact per OS, and we
    // record each so dispatch can match it to the agent's OS.
    const targetOSes = this.resolveTargetOSes(testDir, uuid);

    // 3. Determine output filename (primary artifact, for back-compat meta fields)
    // basename: UUID_REGEX already rules out separators; this keeps the
    // filename provably inside buildDir for the path checks too.
    const safeUuid = path.basename(uuid);
    const filename = platform.os === 'windows' ? `${safeUuid}.exe` : safeUuid;

    // Per-OS artifacts collected during the build (populated for build_all.sh
    // cross-platform builds). The primary OS entry is added at meta-write time.
    const extraBinaries: Partial<Record<PlatformSettings['os'], BuildArtifact>> = {};

    // 4. Ensure build output directory
    const buildDir = this.ensureBuildDir(uuid);
    const outputPath = path.join(buildDir, filename);

    // 5. Build environment
    // An allowlist, never the backend's own environment: build_all.sh and the
    // Go toolchain must not inherit the backend's secrets (see buildEnv.ts).
    const env: Record<string, string | undefined> = {
      ...buildSubprocessEnv(),
      GOOS: platform.os,
      GOARCH: platform.arch,
      CGO_ENABLED: '0',
    };

    // 6. Build
    const buildAllPath = path.join(testDir, 'build_all.sh');
    const hasBuildScript = fs.existsSync(buildAllPath);

    // `go mod tidy` (run by the build below or by a test's build_all.sh) can
    // rewrite a test's own go.mod and create a go.sum. Keep the originals so
    // the synced clone is left exactly as found: a dirty tree would read as
    // modified source on the next build.
    const goModPath = path.join(testDir, 'go.mod');
    const goSumPath = path.join(testDir, 'go.sum');
    const hadGoMod = fs.existsSync(goModPath);
    let original: { goMod: Buffer; goSum: Buffer | null } | null = null;
    if (hadGoMod) {
      try {
        original = {
          goMod: fs.readFileSync(goModPath),
          goSum: fs.existsSync(goSumPath) ? fs.readFileSync(goSumPath) : null,
        };
      } catch (err) {
        console.warn('Could not snapshot go.mod/go.sum for %s; they will not be restored:', uuid, err);
      }
    }

    try {
      // Before the first write into the test folder or the build directory
      // (patched script, password file, LOG_DIR file): the version read
      // above is not bounded by a step timeout.
      this.refreshBuildMarker(marker, uuid);
      if (hasBuildScript) {
        // Determine if the test is in a categorized subdirectory (tests_source/<category>/<uuid>/).
        // Some build_all.sh scripts hardcode TEST_DIR="tests_source/<uuid>" (flat layout) and use
        // ../../ to navigate back to repo root. For categorized tests (3 levels deep instead of 2),
        // we patch the script to fix paths before executing from the repo root.
        const containingSource = this.testSourcePaths.find(sp => testDir.startsWith(sp + path.sep)) || this.testSourcePaths[0];
        const repoRoot = path.dirname(containingSource);
        const relFromTestsSource = path.relative(containingSource, testDir);
        const pathParts = relFromTestsSource.split(path.sep);
        const isCategorized = pathParts.length === 2; // e.g., "intel-driven/<uuid>"

        let patchedScript: string | null = null;
        let buildCwd: string;
        let buildArgs: string[];

        if (isCategorized) {
          const category = pathParts[0];
          const scriptContent = fs.readFileSync(buildAllPath, 'utf-8');
          const needsPatching = scriptContent.includes(`TEST_DIR="tests_source/\${TEST_UUID}"`)
            || scriptContent.includes(`TEST_DIR="tests_source/$TEST_UUID"`);

          if (needsPatching) {
            // Patch the script: fix TEST_DIR and adjust relative paths for 3-level depth
            let patched = scriptContent;
            // 1. Insert category into TEST_DIR
            patched = patched.replace(
              /TEST_DIR="tests_source\//g,
              `TEST_DIR="tests_source/${category}/`,
            );
            // 2. Fix ../../ path references (2-level → 3-level back-navigation)
            //    Negative lookbehind: don't expand paths that are already ../../../
            patched = patched.replace(
              /(?<!\.\.\/)\.\.\/\.\.\//g,
              '../../../',
            );
            // 3. Fix standalone `cd ../..` (no trailing slash) at end of line
            patched = patched.replace(
              /cd \.\.\/\.\.$/gm,
              'cd ../../..',
            );

            patchedScript = path.join(buildDir, '.build-patched.sh');
            fs.writeFileSync(patchedScript, patched, { mode: 0o755 });
            buildCwd = repoRoot;
            buildArgs = [patchedScript];
          } else {
            // Script uses SCRIPT_DIR pattern (self-contained paths) — run from repo root as-is
            buildCwd = repoRoot;
            buildArgs = [path.relative(repoRoot, buildAllPath)];
          }
        } else {
          buildCwd = testDir;
          buildArgs = ['build_all.sh'];
        }

        // Pass active signing cert to build_all.sh so it can sign inner binaries
        // (e.g., multi-binary bundles sign validators before embedding). Set it
        // whenever Windows is a TARGET OS — not only the primary — so a
        // cross-platform build (primary resolved to Linux) still signs the
        // Windows orchestrator it emits, rather than shipping it unsigned.
        // The password file is outside the build folder (the agent download
        // route serves from there) and lives for the whole script run.
        let innerPassFile: PrivateTempFile | null = null;
        if (targetOSes.includes('windows')) {
          const activeCert = this.settingsService.getActiveCertPfxPath();
          if (activeCert) {
            env.F0_SIGN_CERT_PATH = activeCert.pfxPath;
            innerPassFile = writePrivateTempFile(activeCert.password);
            env.F0_SIGN_CERT_PASS_FILE = innerPassFile.path;
          }
        }

        try {
          this.refreshBuildMarker(marker, uuid);
          await runBuildCommand('bash', buildArgs, {
            cwd: buildCwd,
            env,
            timeout: BUILD_TIMEOUT,
          });
        } finally {
          // Clean up patched build script
          if (patchedScript && fs.existsSync(patchedScript)) {
            try { fs.unlinkSync(patchedScript); } catch { /* ignore */ }
          }
          // Clean up inner cert password file
          innerPassFile?.remove();
        }

        // The script may have outlived its timeout: a build superseded while
        // it ran must not copy its outputs over the other build's.
        this.refreshBuildMarker(marker, uuid);

        // Locate output binary — check repo-root build dir (build_all.sh output location) too
        const candidates = [
          this.resolveInside(repoRoot, 'build', uuid, filename),
          this.resolveInside(testDir, 'build', uuid, filename),
          this.resolveInside(testDir, filename),
        ];
        let found = false;
        // The first write that replaces the previous artifact: its meta is voided first.
        let stampVoided = false;
        const voidStampOnce = (): void => {
          if (!stampVoided) this.voidPreviousStamp(uuid);
          stampVoided = true;
        };
        for (const candidate of candidates) {
          if (candidate && fs.existsSync(candidate)) {
            voidStampOnce();
            fs.copyFileSync(candidate, outputPath);
            found = true;
            break;
          }
        }
        if (!found) {
          // Try to find any file in build/<uuid>/ under repo root or testDir
          for (const base of [repoRoot, testDir]) {
            const buildSubdir = this.resolveInside(base, 'build', uuid);
            if (buildSubdir && fs.existsSync(buildSubdir)) {
              const files = fs.readdirSync(buildSubdir);
              const first = files.length > 0 ? this.resolveInside(buildSubdir, files[0]) : null;
              if (first) {
                voidStampOnce();
                fs.copyFileSync(first, outputPath);
                found = true;
                break;
              }
            }
          }
        }
        if (!found) {
          throw new Error('build_all.sh completed but output binary not found');
        }

        // Collect the SIBLING-OS artifacts build_all.sh produced (every target OS
        // other than the primary) so dispatch can serve each agent its own binary.
        // Without this, a Windows agent would receive the Linux orchestrator (no
        // `.exe`) and fail to launch it. The primary OS is recorded at meta-write.
        for (const siblingOs of targetOSes) {
          if (siblingOs === platform.os) continue;
          // basename() strips path separators (path-injection sanitizer CodeQL
          // recognizes); no-op for the UUID_REGEX-valid uuid / `<uuid>[.exe]`.
          const safeUuid = path.basename(uuid);
          const siblingFilename = path.basename(this.osBinaryFilename(uuid, siblingOs));
          const siblingCandidates = [
            path.join(repoRoot, 'build', safeUuid, siblingFilename),
            path.join(testDir, 'build', safeUuid, siblingFilename),
            path.join(testDir, siblingFilename),
          ];
          const sourcePath = siblingCandidates.find(c => fs.existsSync(c));
          if (!sourcePath) continue; // build_all.sh didn't emit this OS — skip
          const siblingDest = path.join(buildDir, siblingFilename);
          fs.copyFileSync(sourcePath, siblingDest);
          extraBinaries[siblingOs] = {
            filename: siblingFilename,
            fileSize: fs.statSync(siblingDest).size,
            // build_all.sh signs the Windows orchestrator internally (cert passed
            // above); other OSes are unsigned. `signed` here is informational —
            // dispatch does not depend on it.
            signed: siblingOs === 'windows' && Boolean(env.F0_SIGN_CERT_PATH),
          };
        }
      } else {
        // Standard Go build
        const goFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.go'));
        if (goFiles.length === 0) {
          throw new BuildError('No Go source files found in test directory');
        }

        // Synthesize LOG_DIR/ARTIFACT_DIR if the test references LOG_DIR but
        // ships no platform-specific test_logger_<os>.go. See issue #202.
        const injectedLogDirPath = this.injectLogDirIfMissing(testDir, platform.os);

        try {
          if (!hadGoMod) {
            // Auto-init a temporary module so "go build ." works in package mode
            this.refreshBuildMarker(marker, uuid);
            await runBuildCommand('go', ['mod', 'init', 'testbuild'], {
              cwd: testDir,
              env,
              timeout: BUILD_TIMEOUT,
            });
          }

          this.refreshBuildMarker(marker, uuid);
          await runBuildCommand('go', ['mod', 'tidy'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });
          this.refreshBuildMarker(marker, uuid);
          await runBuildCommand('go', ['mod', 'download'], { cwd: testDir, env, timeout: BUILD_TIMEOUT });

          // Use package mode ("go build .") for proper GOOS/GOARCH constraint evaluation.
          // File-list mode ("go build a.go b.go") doesn't resolve cross-platform build tags
          // on transitive dependencies, causing failures for windows-only imports on Linux.
          this.refreshBuildMarker(marker, uuid);
          // go build writes the artifact in place: void the previous meta
          // first, and put it back only when the step failed and the artifact
          // provably is untouched.
          const voided = this.voidPreviousStamp(uuid, outputPath);
          try {
            await runBuildCommand('go', ['build', '-o', outputPath, '.'], {
              cwd: testDir,
              env,
              timeout: BUILD_TIMEOUT,
            });
          } catch (err) {
            if (voided !== null) this.restoreStampIfUntouched(uuid, voided, filename, outputPath, marker);
            throw err;
          }
        } finally {
          // Clean up auto-generated module files to avoid dirtying the test source tree
          if (!hadGoMod) {
            if (fs.existsSync(goModPath)) fs.unlinkSync(goModPath);
            if (fs.existsSync(goSumPath)) fs.unlinkSync(goSumPath);
          }
          // Clean up the synthesized LOG_DIR file. Cleanup runs even if the
          // build above throws, so the source tree never holds the auto-file.
          if (injectedLogDirPath && fs.existsSync(injectedLogDirPath)) {
            fs.unlinkSync(injectedLogDirPath);
          }
        }
      }
    } finally {
      // Restore a test's own go.mod / go.sum after either build path (the
      // compile already used the tidied files). A failure here is logged,
      // never allowed to fail or mask the build result.
      if (original) {
        try {
          fs.writeFileSync(goModPath, original.goMod);
          if (original.goSum) fs.writeFileSync(goSumPath, original.goSum);
          else if (fs.existsSync(goSumPath)) fs.unlinkSync(goSumPath);
        } catch (err) {
          console.warn('Could not restore go.mod/go.sum for %s:', uuid, err);
        }
      }
    }

    // 7. Sign binary (Windows via osslsigncode, darwin via rcodesign ad-hoc)
    let signed = false;
    if (platform.os === 'windows') {
      const activeCert = this.settingsService.getActiveCertPfxPath();
      if (activeCert) {
        const signedPath = outputPath + '.signed';
        // L1: Pass password via temp file to avoid /proc/PID/cmdline exposure.
        // Not in the build folder: the agent download route serves from there.
        let passFile: PrivateTempFile | null = null;
        try {
          // A superseded build stops here, before it signs anything.
          this.refreshBuildMarker(marker, uuid);
          passFile = writePrivateTempFile(activeCert.password);
          await execFileAsync('osslsigncode', [
            'sign',
            '-pkcs12', activeCert.pfxPath,
            '-readpass', passFile.path,
            '-in', outputPath,
            '-out', signedPath,
          ], { timeout: SIGN_TIMEOUT });

          // Not over the artifact of a build that superseded this one.
          this.refreshBuildMarker(marker, uuid);
          fs.renameSync(signedPath, outputPath);
          signed = true;
        } catch (err) {
          // Signing failed — continue with unsigned binary
          if (fs.existsSync(signedPath)) {
            fs.unlinkSync(signedPath);
          }
          // Superseded is not a signing failure: the build stops.
          if (err instanceof BuildSupersededError) throw err;
        } finally {
          passFile?.remove();
        }
      }
    } else if (platform.os === 'darwin') {
      try {
        this.refreshBuildMarker(marker, uuid);
        await execFileAsync('rcodesign', [
          'sign',
          '--code-signature-flags', 'adhoc',
          outputPath,
        ], { timeout: SIGN_TIMEOUT });
        signed = true;
      } catch (err) {
        // Superseded is not a signing failure: the build stops (as on Windows).
        if (err instanceof BuildSupersededError) throw err;
        // rcodesign not installed or signing failed — continue unsigned
      }
    }

    // 8. Write metadata
    const stats = fs.statSync(outputPath);
    // Per-OS artifact map: the primary (just built + signed) plus any siblings
    // collected from a build_all.sh cross-platform run. Dispatch selects the
    // entry matching each agent's OS.
    const binaries: NonNullable<BuildMetadata['binaries']> = {
      ...extraBinaries,
      [platform.os]: { filename, fileSize: stats.size, signed },
    };
    // Before the stamp hashes the outputs (go build and rcodesign wrote them in place).
    this.refreshBuildMarker(marker, uuid);
    const version = versionBefore
      ? await this.stampVersion(uuid, versionBefore, buildDir, binaries, marker)
      : undefined;
    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed,
      fileSize: stats.size,
      filename,
      binaries,
      source: 'built',
      ...(version ? { version } : {}),
    };
    // Last check: a superseded build never writes build-meta.json (the
    // stamp's own check above stays as the last line of defence).
    this.refreshBuildMarker(marker, uuid);
    // Atomic, like the void: a reader never sees a half-written meta.
    this.writeFileAtomic(this.metaPath(uuid), JSON.stringify(meta, null, 2));

    return {
      exists: true,
      platform: meta.platform,
      signed: meta.signed,
      fileSize: meta.fileSize,
      builtAt: meta.builtAt,
      filename: meta.filename,
      source: 'built',
      ...(version ? { version } : {}),
    };
  }

  /** Write `file` through a temp file in the same directory and a rename (atomic). */
  private writeFileAtomic(file: string, content: string): void {
    const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, content, { flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* not created */ }
      throw err;
    }
  }

  /**
   * Before a build first writes over the previous artifact: rewrite
   * build-meta.json without its version stamp, with `builtAt` set to now and
   * `source: 'built'` (every other field kept), also when it has no stamp (an
   * uploaded binary, or one built before test versions), so a build that
   * then fails, is superseded or dies leaves "Unknown build" dated by this
   * build, never the old record beside bytes it does not describe. A
   * successful build writes its full meta at the end. With `artifact` (the
   * go build path, whose failure may put the meta back), an unstamped meta's
   * artifact is hashed first: the proof restoreStampIfUntouched needs, since
   * there is no stamped hash. A missing artifact proves nothing, and neither
   * does one that can't be hashed (with a warning): the meta is still
   * rewritten, and a failed build never puts it back, as for a stamped meta
   * whose artifact changed. Returns the original text (and that hash, or
   * null) when the meta was rewritten, else null. Never fails the build: a
   * meta that can't be read, parsed or rewritten is left as it is, with a
   * warning (an unparseable one already reads as no build).
   */
  private voidPreviousStamp(uuid: string, artifact?: string): VoidedMeta | null {
    const metaFile = this.metaPath(uuid);
    if (!fs.existsSync(metaFile)) return null;
    try {
      const raw = fs.readFileSync(metaFile, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('build-meta.json is not an object');
      }
      const hashBefore = !('version' in parsed) && artifact !== undefined
        ? this.hashBeforeVoid(uuid, artifact)
        : null;
      const meta: Record<string, unknown> = { ...parsed };
      delete meta.version;
      // The bytes are about to change: a task created from here on must not
      // carry the previous build's time or source beside them. The put-back
      // after a failed go build restores the original text, old builtAt and
      // source included.
      meta.builtAt = new Date().toISOString();
      meta.source = 'built';
      this.writeFileAtomic(metaFile, JSON.stringify(meta, null, 2));
      return { raw, hashBefore };
    } catch (err) {
      console.warn('Build of %s could not rewrite the previous build record: %s', uuid,
        err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * The artifact's SHA-256 just before an unstamped meta is voided, for
   * restoreStampIfUntouched. null when there is no artifact (nothing to
   * prove) or it can't be read (with a warning): either way a failed build
   * then leaves the meta voided.
   */
  private hashBeforeVoid(uuid: string, artifact: string): string | null {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Build of %s could not hash the previous artifact, so a failed build keeps the rewritten build record: %s',
          uuid, err instanceof Error ? err.message : String(err));
      }
      return null;
    }
  }

  /**
   * After a failed `go build`: put the voided meta back only while this
   * build still holds its marker and the artifact provably is untouched: its
   * SHA-256 still equals the one the stamp recorded or, for a meta with no
   * stamp, the one taken just before the void (none when there was no
   * artifact, nothing to prove, or it could not be hashed, nothing proven:
   * either way the meta stays voided). go writes the output only after a
   * successful link, but this does not rely on it. A superseded build never
   * restores: the build that took over may already be writing the artifact,
   * and its own void has rewritten the meta this one would put back.
   * Anything else, or any error, leaves the meta voided; the caller rethrows
   * the build's own error.
   */
  private restoreStampIfUntouched(
    uuid: string,
    voided: VoidedMeta,
    filename: string,
    outputPath: string,
    marker: BuildMarkerHandle,
  ): void {
    if (this.markerState(marker) !== 'ours') return;
    try {
      const parsed = JSON.parse(voided.raw) as { version?: { binaries?: Record<string, unknown> } };
      // Same test as the void's: a stamped meta is proven by its stamp only.
      const expected = 'version' in parsed ? parsed.version?.binaries?.[filename] : voided.hashBefore;
      if (typeof expected !== 'string') return;
      const now = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
      if (now === expected) this.writeFileAtomic(this.metaPath(uuid), voided.raw);
    } catch {
      // Stays voided: "Unknown build" until the next build.
    }
  }

  /**
   * Final stamp: the identity read before the build plus the SHA-256 of every
   * artifact as it is now (after signing, which rewrites the file), and the
   * embed dependencies, uploaded and source-built, as the build left them
   * (build_all.sh and every cleanup step have finished; nothing after this
   * point touches the test folder). No stamp is better than a wrong one, so
   * it returns null, with a warning, when:
   *  - the identity read again now differs from the one read before the
   *    compile (library commit or fingerprint), or can't be read: the test's
   *    source changed while it was being built, e.g. a Sync moved HEAD;
   *  - an uploaded dependency that was there before the build is gone;
   *  - an artifact or dependency can't be hashed;
   *  - the build no longer holds its marker (another build took it over), so
   *    it can't prove nothing else wrote to the test folder or the artifacts.
   *    A last line of defence: the refresh right after the stamp stops such a
   *    build before it writes build-meta.json.
   *
   * deps_hash is taken here, not before the build, because a build_all.sh can
   * itself write an embedded file that is classed as uploaded (a gzipped
   * helper no source-built rule matches). Uploading a dependency, uploading a
   * binary and deleting the build hold the same marker while they write
   * (withTestFolderLock), so they are refused in every process while the
   * build runs and an uploaded dependency keeps its content through the
   * build; a file the script produced only changes when a build runs, and
   * a build rewrites the stamp. So a difference between the stamped and the
   * current hash means the file changed after the build. A dependency that was
   * there before the build and is gone now (a Sync's `git clean` removes
   * untracked files) voids the stamp: the binary embeds a file the hash can no
   * longer cover. A tracked file can only change through a Sync that moves
   * HEAD, which voids the stamp, so a tracked embed the fingerprint leaves out
   * (an excluded extension) can't change under a stamp either.
   */
  private async stampVersion(
    uuid: string,
    before: VersionBefore,
    buildDir: string,
    artifacts: NonNullable<BuildMetadata['binaries']>,
    marker: BuildMarkerHandle,
  ): Promise<BuildVersionStamp | null> {
    let after: { identity: TestVersionIdentity; modified: boolean } | null;
    try {
      after = this.versionSource ? await this.versionSource.current(uuid) : null;
    } catch {
      after = null;
    }
    if (
      !after ||
      after.identity.commit !== before.identity.commit ||
      after.identity.fingerprint !== before.identity.fingerprint
    ) {
      console.warn('Build of %s will not record its version: the test\'s source changed while it was being built', uuid);
      return null;
    }
    try {
      const present = new Set(this.getEmbedDependencies(uuid).filter(d => d.exists).map(d => d.filename));
      const removed = before.uploadedDeps.filter(name => !present.has(name));
      if (removed.length > 0) {
        console.warn('Build of %s will not record its version: embedded files removed during the build: %s',
          uuid, removed.join(', '));
        return null;
      }
      const binaries: Record<string, string> = {};
      for (const artifact of Object.values(artifacts)) {
        if (!artifact) continue;
        const bytes = fs.readFileSync(path.join(buildDir, path.basename(artifact.filename)));
        binaries[artifact.filename] = crypto.createHash('sha256').update(bytes).digest('hex');
      }
      // Last, after every hash: a build whose marker another build took over
      // can't prove nothing else wrote to the test folder or the artifacts
      // (ownsMarker logs the warning, once per build).
      if (!this.ownsMarker(marker, uuid)) return null;
      return {
        ...before.identity,
        deps_hash: this.currentDepsHash(uuid),
        outputs_hash: this.currentOutputsHash(uuid),
        modified: before.modified,
        binaries,
      };
    } catch (err) {
      console.warn('Build of %s will not record its version: could not hash its artifacts: %s',
        uuid, err instanceof Error ? err.message : String(err));
      return null;
    }
  }
}
