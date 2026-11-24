import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentOS } from '../../types/agent.js';
import type { TaskTestVersion } from '../../types/testVersion.js';

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

export function getBuildDir(testUuid: string): string {
  return path.join(os.homedir(), '.projectachilles', 'builds', testUuid);
}

/**
 * Read ~/.projectachilles/builds/<uuid>/build-meta.json.
 * Returns null when absent; throws on malformed JSON (callers decide).
 */
export function readBuildMeta(testUuid: string): BuildMeta | null {
  const metaPath = path.join(getBuildDir(testUuid), 'build-meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
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

  const resolvedPath = path.join(getBuildDir(testUuid), filename);
  if (!fs.existsSync(resolvedPath)) {
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The version a task carries, from the build-meta createTasks already read.
 * `built_at` and `build_source` always (no `builtAt` in the meta: undefined).
 * `fingerprint`, `commit` and `commit_date` only when the stamp vouches for
 * this very artifact: not `modified`, and its hash for the filename equals the
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
