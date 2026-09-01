import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDatabase } from './database.js';
import { TestsSettingsService } from '../tests/settings.js';
import { SigningError, signDarwinBinaryAdHoc, signWindowsBinary } from './binarySigning.service.js';
import type { Response } from 'express';
import type { AgentVersion, VersionCheckResponse, AgentOS, AgentArch } from '../../types/agent.js';
import { signHash } from './signing.service.js';

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
  binary_signature: string | null;
  created_at: string;
}

function toAgentVersion(row: VersionRow): AgentVersion {
  return {
    ...row,
    mandatory: row.mandatory === 1,
    signed: row.signed === 1,
    signer_subject: row.signer_subject ?? null,
    binary_signature: row.binary_signature,
  };
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
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`);
  }

  const stat = fs.statSync(binaryPath);
  const fileBuffer = fs.readFileSync(binaryPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Ed25519-sign the binary hash for update signature verification (M5)
  const binarySignature = signHash(sha256);

  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, binary_signature, signer_subject)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(version, os, arch, binaryPath, sha256, stat.size, releaseNotes, mandatory ? 1 : 0, signed ? 1 : 0, binarySignature, signerSubject);

  return {
    version,
    os,
    arch,
    binary_path: binaryPath,
    binary_sha256: sha256,
    binary_size: stat.size,
    release_notes: releaseNotes,
    mandatory,
    signed,
    signer_subject: signerSubject,
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

/**
 * Stream the latest agent binary for a platform to an Express response.
 * Sets appropriate headers for binary download.
 */
export function streamUpdate(os: AgentOS, arch: AgentArch, res: Response): void {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT binary_path, version
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(os, arch) as Pick<VersionRow, 'binary_path' | 'version'> | undefined;

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
export function listVersions(): AgentVersion[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, binary_signature, created_at
    FROM agent_versions
    ORDER BY created_at DESC
  `).all() as VersionRow[];

  return rows.map(toAgentVersion);
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

  const dir = path.join(os.homedir(), '.projectachilles', 'binaries', `${agentOs}-${arch}`);
  fs.mkdirSync(dir, { recursive: true });

  const ext = agentOs === 'windows' ? '.exe' : '';
  const filename = `achilles-agent-${version}${ext}`;
  const binaryPath = path.join(dir, filename);

  fs.writeFileSync(binaryPath, fileBuffer);

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
      ({ signed, signerSubject } = await signWindowsBinary(binaryPath, cert));
    } else if (agentOs === 'darwin') {
      ({ signed, signerSubject } = await signDarwinBinaryAdHoc(binaryPath));
    }
    // Linux binaries are not signed — there is no ecosystem equivalent.
  } catch (err) {
    if (!signing.allowUnsigned) {
      // Do not leave a half-processed binary behind for the next upload to
      // collide with; the caller gets the reason and can retry or opt out.
      if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath);
      throw err;
    }
    console.warn(
      `[agent upload] registering ${agentOs}/${arch} ${version} UNSIGNED: ${err instanceof Error ? err.message : err}`
    );
  }

  return registerVersion(version, agentOs, arch, binaryPath, releaseNotes, mandatory, signed, signerSubject);
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
