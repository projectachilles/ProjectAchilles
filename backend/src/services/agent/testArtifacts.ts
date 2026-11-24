import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentOS } from '../../types/agent.js';
import type { TaskTestVersion } from '../../types/testVersion.js';
import { embedsLeftOutFiles } from '../browser/testVersionStatus.js';

export type ArtifactFailure = {
      ok: false;
      reason: 'not built' | `no ${AgentOS} binary` | 'binary missing on server';
      /** Filename that was expected on disk (reason 'binary missing on server'). */
      filename?: string;
      /** OSes the build recorded (reason 'no <os> binary'); empty for legacy builds. */
      built?: string[];
    };

export type ArtifactResolution =
  | { ok: true; binaryName: string; sha256: string; size: number }
  | ArtifactFailure;

/** Result of an existence-only check (no hashing). */
export type ArtifactExistence = { ok: true; binaryName: string } | ArtifactFailure;

/* eslint-disable @typescript-eslint/no-explicit-any */
type BuildMeta = any;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function buildsRoot(): string {
  return path.resolve(os.homedir(), '.projectachilles', 'builds');
}

/** A name that is one path segment: no separator, not `.` or `..`, not empty. */
function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

/**
 * `name` directly inside `dir`, or null when it is not a plain name or the
 * result is anywhere else. The resolved value is returned (not the join), and
 * checked with path.relative: the file system layer keeps the boundary itself
 * and does not depend on every caller having validated its input.
 */
function childOf(dir: string, name: string): string | null {
  if (!isPlainName(name)) return null;
  const resolved = path.resolve(dir, name);
  const rel = path.relative(dir, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || rel !== name) return null;
  return resolved;
}

/**
 * ~/.projectachilles/builds/<testUuid>, or null when the id is not one folder
 * name (`..`, a path, an absolute path). An id such as `x/../<uuid>` is
 * refused too: it would reach a real build under an id no test has.
 */
export function getBuildDir(testUuid: string): string | null {
  return childOf(buildsRoot(), testUuid);
}

/**
 * Read ~/.projectachilles/builds/<uuid>/build-meta.json.
 * Returns null when absent (or when the id names no build folder); throws on
 * malformed JSON (callers decide).
 */
export function readBuildMeta(testUuid: string): BuildMeta | null {
  const dir = getBuildDir(testUuid);
  if (!dir) return null;
  const metaPath = path.join(dir, 'build-meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * The file names a build record offers to agents: `filename`, the older
 * `binary_name`, and each `binaries[os].filename`. A record that names none
 * (written before the name was recorded) offers the two names a build can
 * have, `<uuid>` and `<uuid>.exe`. Names that are not plain file names, or
 * that start with a dot, are left out.
 *
 * A build folder also holds the record itself, the build marker, signing
 * leftovers and uploaded embed files; none of those is a test binary, so the
 * download route serves only what this lists.
 */
export function servableBinaryNames(meta: unknown, testUuid: string): string[] {
  if (!isRecord(meta)) return [];
  const names = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && isPlainName(value) && !value.startsWith('.')) names.add(value);
  };
  add(meta.filename);
  add(meta.binary_name);
  if (isRecord(meta.binaries)) {
    for (const entry of Object.values(meta.binaries)) {
      if (isRecord(entry)) add(entry.filename);
    }
  }
  if (names.size === 0) {
    add(testUuid);
    add(`${testUuid}.exe`);
  }
  return [...names];
}

/**
 * Resolve the test binary for one agent OS. A cross-platform build records a
 * per-OS `binaries` map; older builds only have a single `filename` /
 * `binary_name`. Shared by createTasks and campaign preflight so they cannot
 * disagree about what is dispatchable.
 *
 * `opts.fallbackFilename` is the legacy last resort when a single-binary
 * build-meta records no filename (createTasks passes the request's
 * binary_name). `opts.meta` lets a caller that already read build-meta avoid a
 * second read.
 */
export function resolveTestArtifact(
  testUuid: string,
  agentOs: AgentOS | string,
  opts?: { fallbackFilename?: string; meta?: BuildMeta; hash?: true },
): ArtifactResolution;
/** `hash: false` checks existence only: no file read, no sha256/size. */
export function resolveTestArtifact(
  testUuid: string,
  agentOs: AgentOS | string,
  opts: { fallbackFilename?: string; meta?: BuildMeta; hash: false },
): ArtifactExistence;
export function resolveTestArtifact(
  testUuid: string,
  agentOs: AgentOS | string,
  opts: { fallbackFilename?: string; meta?: BuildMeta; hash?: boolean } = {},
): ArtifactResolution | ArtifactExistence {
  const fallbackFilename = opts.fallbackFilename;
  const buildDir = getBuildDir(testUuid);
  if (!buildDir) return { ok: false, reason: 'not built' };
  let meta: BuildMeta | null;
  try {
    meta = opts.meta ?? readBuildMeta(testUuid);
  } catch {
    return { ok: false, reason: 'not built' };
  }
  if (!meta) return { ok: false, reason: 'not built' };

  const hasOsMap = meta.binaries && typeof meta.binaries === 'object';
  const legacyFilename: string | undefined =
    meta.binary_name ?? meta.filename ?? fallbackFilename;
  const filename: string | undefined = hasOsMap
    ? meta.binaries[agentOs]?.filename
    : legacyFilename;

  if (!filename) {
    return {
      ok: false,
      reason: `no ${agentOs} binary` as `no ${AgentOS} binary`,
      built: hasOsMap ? Object.keys(meta.binaries) : [],
    };
  }

  // Inside the build folder only: the name comes from the record, or from the
  // request for a record that names none.
  const resolvedPath = childOf(buildDir, filename);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, reason: 'binary missing on server', filename };
  }
  if (opts.hash === false) return { ok: true, binaryName: filename };
  const buffer = fs.readFileSync(resolvedPath);
  return {
    ok: true,
    binaryName: filename,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    size: fs.statSync(resolvedPath).size,
  };
}

/**
 * The version a task carries, from the build-meta createTasks already read.
 * `built_at` and `build_source` always (no `builtAt` in the meta: undefined).
 * `fingerprint`, `commit` and `commit_date` only when the stamp vouches for
 * this very artifact: not `modified`, no embedded file the fingerprint leaves
 * out, and its hash for the filename equals the
 * sha256 of the binary that is being shipped. Never writes null keys. The meta
 * is JSON from disk, so a malformed stamp counts as absent.
 */
export function taskTestVersion(
  meta: unknown,
  artifact: { name: string; sha256: string },
): TaskTestVersion | undefined {
  if (!isRecord(meta) || typeof meta.builtAt !== 'string' || meta.builtAt === '') return undefined;
  const result: TaskTestVersion = {
    built_at: meta.builtAt,
    build_source: meta.source === 'uploaded' ? 'uploaded' : 'built',
  };
  const v = meta.version;
  if (
    !isRecord(v)
    || typeof v.fingerprint !== 'string'
    || v.modified !== false
    || embedsLeftOutFiles(v)
    || !isRecord(v.binaries)
    || v.binaries[artifact.name] !== artifact.sha256
  ) {
    return result;
  }
  result.fingerprint = v.fingerprint;
  if (typeof v.commit === 'string') result.commit = v.commit;
  if (typeof v.commit_date === 'string') result.commit_date = v.commit_date;
  return result;
}
