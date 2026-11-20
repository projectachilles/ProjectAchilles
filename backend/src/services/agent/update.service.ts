import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDatabase } from './database.js';
import { TestsSettingsService } from '../tests/settings.js';
import { SigningError, signDarwinBinaryAdHoc, signWindowsBinary } from './binarySigning.service.js';
import { assertEmbeddedVersionMatches } from './binaryVersion.js';
import type { Response } from 'express';
import type {
  AgentVersion,
  VersionCheckResponse,
  AgentOS,
  AgentArch,
  BinaryUnavailableReason,
  InstallReadiness,
  PlatformReadiness,
} from '../../types/agent.js';
import { signHash } from './signing.service.js';
import { readSignerFingerprint } from './signerFingerprint.js';

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
  signer_subject: string | null;
  signer_fingerprint: string | null;
  binary_signature: string | null;
  created_at: string;
}

function toAgentVersion(row: VersionRow): AgentVersion {
  return {
    ...row,
    mandatory: row.mandatory === 1,
    signed: row.signed === 1,
    signer_subject: row.signer_subject ?? null,
    signer_fingerprint: row.signer_fingerprint ?? null,
    binary_signature: row.binary_signature,
  };
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
export function registerVersion(
  version: string,
  os: AgentOS,
  arch: AgentArch,
  binaryPath: string,
  releaseNotes: string,
  mandatory: boolean,
  signed: boolean = false,
  /** Certificate subject the binary was signed with, for display and audit. */
  signerSubject: string | null = null,
): AgentVersion {
  const resolvedPath = resolveBinaryInRoot(binaryPath);
  const stat = fs.statSync(resolvedPath);
  const fileBuffer = fs.readFileSync(resolvedPath);

  // Every registration path (register-by-path, upload, build) ends here, so
  // this is the one check that covers them all, on the final (signed) file.
  assertEmbeddedVersionMatches(version, fileBuffer);

  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Ed25519-sign the binary hash for update signature verification (M5)
  const binarySignature = signHash(sha256);

  // Which certificate signed it, for the management-tool script to pin.
  const signerFingerprint = signed && os === 'windows' ? readSignerFingerprint(resolvedPath) : null;

  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, binary_signature, signer_subject, signer_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(version, os, arch, resolvedPath, sha256, stat.size, releaseNotes, mandatory ? 1 : 0, signed ? 1 : 0, binarySignature, signerSubject, signerFingerprint);

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
    signer_subject: signerSubject,
    signer_fingerprint: signerFingerprint,
    binary_signature: binarySignature,
    created_at: new Date().toISOString(),
  };
}

/**
 * Get the latest version info for a given platform.
 * Returns null if no version exists for that platform.
 */
export function getLatestVersion(os: AgentOS, arch: AgentArch): VersionCheckResponse | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT version, binary_sha256, binary_size, mandatory, binary_signature
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(os, arch) as Pick<VersionRow, 'version' | 'binary_sha256' | 'binary_size' | 'mandatory' | 'binary_signature'> | undefined;

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

export type LatestBinary =
  | { ok: true; version: string; path: string; size: number }
  | { ok: false; reason: BinaryUnavailableReason; version: string | null };

/**
 * The agent binary a download for this platform would serve: the newest
 * registered version, and only when its file is still on disk. The download
 * route and the install-readiness check both go through here, so the console
 * can never call a platform ready while its download answers 404.
 */
export function resolveLatestBinary(os: AgentOS, arch: AgentArch): LatestBinary {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT binary_path, version
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(os, arch) as Pick<VersionRow, 'binary_path' | 'version'> | undefined;

  if (!row) return { ok: false, reason: 'no version', version: null };
  if (!fs.existsSync(row.binary_path)) {
    return { ok: false, reason: 'file missing', version: row.version };
  }
  return { ok: true, version: row.version, path: row.binary_path, size: fs.statSync(row.binary_path).size };
}

/**
 * Stream the latest agent binary for a platform to an Express response.
 * Sets appropriate headers for binary download.
 */
export function streamUpdate(os: AgentOS, arch: AgentArch, res: Response): void {
  const binary = resolveLatestBinary(os, arch);

  if (!binary.ok) {
    const error = binary.reason === 'no version'
      ? 'No version available for this platform'
      : 'Binary file not found on server';
    res.status(404).json({ success: false, error });
    return;
  }

  const extension = os === 'windows' ? '.exe' : '';
  const filename = `achilles-agent-${os}-${arch}${extension}`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', binary.size.toString());
  res.setHeader('X-Agent-Version', binary.version);

  fs.createReadStream(binary.path).pipe(res);
}

/** The platforms the console offers an install command for, in that order. */
export const INSTALL_PLATFORMS: ReadonlyArray<{ os: AgentOS; arch: AgentArch }> = [
  { os: 'windows', arch: 'amd64' },
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
];

/** Whether each install command's download would succeed right now. */
export function getInstallReadiness(): InstallReadiness {
  const platforms = INSTALL_PLATFORMS.map(({ os, arch }): PlatformReadiness => {
    const binary = resolveLatestBinary(os, arch);
    return binary.ok
      ? { os, arch, ready: true, version: binary.version, reason: null }
      : { os, arch, ready: false, version: binary.version, reason: binary.reason };
  });
  return { any_ready: platforms.some((p) => p.ready), platforms };
}

/**
 * List all registered agent versions, newest first.
 */
export function listVersions(): AgentVersion[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, signer_subject, signer_fingerprint, binary_signature, created_at
    FROM agent_versions
    ORDER BY created_at DESC
  `).all() as VersionRow[];

  for (const row of rows) backfillSignerFingerprint(row);
  return rows.map(toAgentVersion);
}

/** Versions whose fingerprint could not be read in this process: not tried again until a restart. */
const unreadableSigners = new Set<string>();

/**
 * Signed Windows versions registered before the fingerprint was recorded get
 * it the first time the list is read, so existing installs need no
 * re-registration. One read per version; a failure is remembered.
 */
function backfillSignerFingerprint(row: VersionRow): void {
  if (row.signed !== 1 || row.os !== 'windows' || row.signer_fingerprint) return;
  const key = `${row.version}|${row.os}|${row.arch}|${row.binary_sha256}`;
  if (unreadableSigners.has(key) || !fs.existsSync(row.binary_path)) return;

  const fingerprint = readSignerFingerprint(row.binary_path);
  if (!fingerprint) {
    unreadableSigners.add(key);
    return;
  }
  getDatabase()
    .prepare('UPDATE agent_versions SET signer_fingerprint = ? WHERE version = ? AND os = ? AND arch = ?')
    .run(fingerprint, row.version, row.os, row.arch);
  row.signer_fingerprint = fingerprint;
}

/**
 * Register an agent version from an uploaded file buffer.
 * Writes the binary to ~/.projectachilles/binaries/{os}-{arch}/ and
 * delegates to registerVersion() for SHA-256 computation and DB insert.
 */
export interface UploadSigningOptions {
  /** Certificate to sign with. Omitted means "the active certificate". */
  certId?: string;
  /** Register the binary unsigned instead of failing when signing is impossible. */
  allowUnsigned?: boolean;
}

/**
 * Store an uploaded agent binary and register it as a distributable version,
 * signing it with a tenant certificate on the way through.
 *
 * Signing here is deliberately FATAL by default, unlike the build path. A build
 * that cannot sign still produced a working binary, so it degrades to unsigned;
 * an upload exists precisely so the operator can attach *their* certificate, and
 * silently registering an unsigned binary would push something a WDAC-hardened
 * fleet will refuse to execute. Callers that genuinely want an unsigned binary
 * must say so with `allowUnsigned`.
 *
 * This is the recommended path for a release binary: the artifact comes from a
 * tagged CI build, so its provenance is fixed, while the signature comes from
 * the tenant's own certificate, which is what their endpoints actually trust.
 * Nothing depends on which agent source happens to be deployed on this server.
 */
export async function registerVersionFromUpload(
  version: string,
  agentOs: AgentOS,
  arch: AgentArch,
  fileBuffer: Buffer,
  releaseNotes: string,
  mandatory: boolean,
  signing: UploadSigningOptions = {}
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

  // VERSION_REGEX excludes path separators, so `version` cannot traverse today.
  // Assert containment anyway: this path is later written, signed, and deleted,
  // and relaxing that regex in future should not silently turn those into
  // arbitrary-file operations.
  const binariesDir = path.resolve(dir);
  const resolvedBinary = path.resolve(binaryPath);
  if (!resolvedBinary.startsWith(binariesDir + path.sep)) {
    throw new Error('Refusing to write the binary outside the binaries directory');
  }

  fs.writeFileSync(resolvedBinary, fileBuffer);

  let signed = false;
  let signerSubject: string | null = null;

  try {
    if (agentOs === 'windows') {
      const settingsService = new TestsSettingsService();
      const cert = settingsService.getCertPfxPathById(signing.certId);
      if (!cert) {
        throw new SigningError(
          signing.certId
            ? `Certificate ${signing.certId} was not found, or its password is unavailable.`
            : 'No active code signing certificate is configured. Add one under Settings → Tests, or upload unsigned.'
        );
      }
      ({ signed, signerSubject } = await signWindowsBinary(resolvedBinary, cert));
    } else if (agentOs === 'darwin') {
      ({ signed, signerSubject } = await signDarwinBinaryAdHoc(resolvedBinary));
    }
    // Linux binaries are not signed — there is no ecosystem equivalent.
  } catch (err) {
    if (!signing.allowUnsigned) {
      // Do not leave a half-processed binary behind for the next upload to
      // collide with; the caller gets the reason and can retry or opt out.
      if (fs.existsSync(resolvedBinary)) fs.unlinkSync(resolvedBinary);
      throw err;
    }
    console.warn(
      `[agent upload] registering ${agentOs}/${arch} ${version} UNSIGNED: ${err instanceof Error ? err.message : err}`
    );
  }

  return registerVersion(version, agentOs, arch, resolvedBinary, releaseNotes, mandatory, signed, signerSubject);
}

/**
 * Delete a registered agent version. Removes binary from disk and DB row.
 * Returns true if the version existed and was deleted.
 */
export function deleteVersion(version: string, agentOs: AgentOS, arch: AgentArch): boolean {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT binary_path FROM agent_versions
    WHERE version = ? AND os = ? AND arch = ?
  `).get(version, agentOs, arch) as Pick<VersionRow, 'binary_path'> | undefined;

  if (!row) return false;

  try {
    fs.unlinkSync(row.binary_path);
  } catch {
    // Binary may already be gone from disk — continue with DB cleanup
  }

  db.prepare(`
    DELETE FROM agent_versions
    WHERE version = ? AND os = ? AND arch = ?
  `).run(version, agentOs, arch);

  return true;
}
