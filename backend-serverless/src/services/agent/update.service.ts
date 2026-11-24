import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDb } from './database.js';
import type { Response } from 'express';
import type { AgentVersion, VersionCheckResponse, AgentOS, AgentArch } from '../../types/agent.js';
import { signHash } from './signing.service.js';
import { assertEmbeddedVersionMatches } from './binaryVersion.js';

const VERSION_REGEX = /^[\w.\-]+$/;

interface VersionRow {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  binary_path: string;
  binary_sha256: string;
  binary_size: number;
  release_notes: string;
  mandatory: number;
  signed: number;
  binary_signature: string | null;
  created_at: string;
}

function toAgentVersion(row: VersionRow): AgentVersion {
  return {
    ...row,
    mandatory: row.mandatory === 1,
    signed: row.signed === 1,
    binary_signature: row.binary_signature,
  };
}

/**
 * Release notes a person typed (register by path, upload) that start like the
 * line the build service writes for a version it built ("Built from source
 * (<os>/<arch>) at <commit>", buildReleaseNotes in backend/).
 * The console reads that line back as the version's source commit, and both
 * kinds of notes share one column, so the form is reserved for the server. backend-serverless has no build service, but the same console reads its versions.
 */
export class ReservedReleaseNotesError extends Error {
  constructor() {
    super('Release notes can\'t start with "Built from source": the server writes that line for versions it builds, and the console shows it as the version\'s source commit');
    this.name = 'ReservedReleaseNotesError';
  }
}

/** Throws ReservedReleaseNotesError for typed notes in the build service's form. */
export function assertTypedReleaseNotes(releaseNotes: string | undefined): void {
  if (/^\s*built from source\b/i.test(releaseNotes ?? '')) throw new ReservedReleaseNotesError();
}

/** Rejected binary path — the admin route maps this to HTTP 400. */
export class BinaryPathError extends Error {
  constructor() {
    // Deliberately static: echoing the caller's path (or saying whether it
    // exists) turned this error into a file-existence oracle for the host.
    super('binary_path must be an existing file inside the agent binaries directory (~/.projectachilles/binaries)');
    this.name = 'BinaryPathError';
  }
}

/**
 * Resolve `binaryPath` to its real location and require it to be a regular
 * file under ~/.projectachilles/binaries. Symlinks and `..` are resolved before
 * the containment check, so neither can point outside the root.
 *
 * Registered paths are later streamed to every agent and unlinked on version
 * delete, so this is what keeps register-by-path (operator role and read-write
 * API keys, not just admins) from becoming arbitrary file read/delete.
 */
function resolveBinaryInRoot(binaryPath: string): string {
  let root: string;
  let resolved: string;
  try {
    root = fs.realpathSync(path.join(os.homedir(), '.projectachilles', 'binaries'));
    resolved = fs.realpathSync(path.resolve(binaryPath));
  } catch {
    throw new BinaryPathError();
  }
  if (!resolved.startsWith(root + path.sep) || !fs.statSync(resolved).isFile()) {
    throw new BinaryPathError();
  }
  return resolved;
}

/**
 * Register a new agent binary version.
 * Computes SHA-256 hash and file size from the binary on disk.
 */
export async function registerVersion(
  version: string,
  os: AgentOS,
  arch: AgentArch,
  binaryPath: string,
  releaseNotes: string,
  mandatory: boolean,
  signed: boolean = false,
): Promise<AgentVersion> {
  const resolvedPath = resolveBinaryInRoot(binaryPath);
  const stat = fs.statSync(resolvedPath);
  const fileBuffer = fs.readFileSync(resolvedPath);

  // Every registration path (register-by-path, upload) ends here, so this is
  // the one check that covers them all, on the final file.
  assertEmbeddedVersionMatches(version, fileBuffer);

  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Ed25519-sign the binary hash for update signature verification (M5)
  const binarySignature = signHash(sha256);

  const db = await getDb();
  await db.run(`
    INSERT OR REPLACE INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, binary_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [version, os, arch, resolvedPath, sha256, stat.size, releaseNotes, mandatory ? 1 : 0, signed ? 1 : 0, binarySignature]);

  return {
    version,
    os,
    arch,
    binary_path: resolvedPath,
    binary_sha256: sha256,
    binary_size: stat.size,
    release_notes: releaseNotes,
    mandatory,
    signed,
    binary_signature: binarySignature,
    created_at: new Date().toISOString(),
  };
}

/**
 * Get the latest version info for a given platform.
 * Returns null if no version exists for that platform.
 */
export async function getLatestVersion(os: AgentOS, arch: AgentArch): Promise<VersionCheckResponse | null> {
  const db = await getDb();
  const row = await db.get(`
    SELECT version, binary_sha256, binary_size, mandatory, binary_signature
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [os, arch]) as Pick<VersionRow, 'version' | 'binary_sha256' | 'binary_size' | 'mandatory' | 'binary_signature'> | undefined;

  if (!row) return null;

  const response: VersionCheckResponse = {
    version: row.version,
    sha256: row.binary_sha256,
    size: row.binary_size,
    mandatory: row.mandatory === 1,
  };

  if (row.binary_signature) {
    response.signature = row.binary_signature;
  }

  return response;
}

/**
 * Stream the latest agent binary for a platform to an Express response.
 * Sets appropriate headers for binary download.
 */
export async function streamUpdate(os: AgentOS, arch: AgentArch, res: Response): Promise<void> {
  const db = await getDb();
  const row = await db.get(`
    SELECT binary_path, version
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [os, arch]) as Pick<VersionRow, 'binary_path' | 'version'> | undefined;

  if (!row) {
    res.status(404).json({ success: false, error: 'No version available for this platform' });
    return;
  }

  if (!fs.existsSync(row.binary_path)) {
    res.status(404).json({ success: false, error: 'Binary file not found on server' });
    return;
  }

  const stat = fs.statSync(row.binary_path);
  const extension = os === 'windows' ? '.exe' : '';
  const filename = `achilles-agent-${os}-${arch}${extension}`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stat.size.toString());
  res.setHeader('X-Agent-Version', row.version);

  fs.createReadStream(row.binary_path).pipe(res);
}

/**
 * List all registered agent versions, newest first.
 */
export async function listVersions(): Promise<AgentVersion[]> {
  const db = await getDb();
  const rows = await db.all(`
    SELECT version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, binary_signature, created_at
    FROM agent_versions
    ORDER BY created_at DESC
  `) as unknown as VersionRow[];

  return rows.map(toAgentVersion);
}

/**
 * Register an agent version from an uploaded file buffer.
 * Writes the binary to ~/.projectachilles/binaries/{os}-{arch}/ and
 * delegates to registerVersion() for SHA-256 computation and DB insert.
 */
export async function registerVersionFromUpload(
  version: string,
  agentOs: AgentOS,
  arch: AgentArch,
  fileBuffer: Buffer,
  releaseNotes: string,
  mandatory: boolean
): Promise<AgentVersion> {
  if (!VERSION_REGEX.test(version)) {
    throw new Error('Invalid version string');
  }

  // Before anything touches disk: a binary whose embedded version differs from
  // the declared one puts every agent that installs it into an update loop.
  assertEmbeddedVersionMatches(version, fileBuffer);

  const dir = path.join(os.homedir(), '.projectachilles', 'binaries', `${agentOs}-${arch}`);
  fs.mkdirSync(dir, { recursive: true });

  const ext = agentOs === 'windows' ? '.exe' : '';
  const filename = `achilles-agent-${version}${ext}`;
  const binaryPath = path.join(dir, filename);

  fs.writeFileSync(binaryPath, fileBuffer);

  return registerVersion(version, agentOs, arch, binaryPath, releaseNotes, mandatory);
}

/**
 * Delete a registered agent version. Removes binary from disk and DB row.
 * Returns true if the version existed and was deleted.
 */
export async function deleteVersion(version: string, agentOs: AgentOS, arch: AgentArch): Promise<boolean> {
  const db = await getDb();
  const row = await db.get(`
    SELECT binary_path FROM agent_versions
    WHERE version = ? AND os = ? AND arch = ?
  `, [version, agentOs, arch]) as Pick<VersionRow, 'binary_path'> | undefined;

  if (!row) return false;

  try {
    fs.unlinkSync(row.binary_path);
  } catch {
    // Binary may already be gone from disk — continue with DB cleanup
  }

  await db.run(`
    DELETE FROM agent_versions
    WHERE version = ? AND os = ? AND arch = ?
  `, [version, agentOs, arch]);

  return true;
}
