import fs from 'fs';
import crypto from 'crypto';
import { getDatabase } from './database.js';
import type { Response } from 'express';
import type { AgentVersion, VersionCheckResponse, AgentOS, AgentArch } from '../../types/agent.js';

interface VersionRow {
  version: string;
  os: AgentOS;
  arch: AgentArch;
  binary_path: string;
  binary_sha256: string;
  binary_size: number;
  release_notes: string;
  mandatory: number;
  created_at: string;
}

function toAgentVersion(row: VersionRow): AgentVersion {
  return {
    ...row,
    mandatory: row.mandatory === 1,
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
  mandatory: boolean
): AgentVersion {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`);
  }

  const stat = fs.statSync(binaryPath);
  const fileBuffer = fs.readFileSync(binaryPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(version, os, arch, binaryPath, sha256, stat.size, releaseNotes, mandatory ? 1 : 0);

  return {
    version,
    os,
    arch,
    binary_path: binaryPath,
    binary_sha256: sha256,
    binary_size: stat.size,
    release_notes: releaseNotes,
    mandatory,
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
    SELECT version, binary_sha256, binary_size, mandatory
    FROM agent_versions
    WHERE os = ? AND arch = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(os, arch) as Pick<VersionRow, 'version' | 'binary_sha256' | 'binary_size' | 'mandatory'> | undefined;

  if (!row) return null;

  return {
    version: row.version,
    sha256: row.binary_sha256,
    size: row.binary_size,
    mandatory: row.mandatory === 1,
  };
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
    SELECT version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, created_at
    FROM agent_versions
    ORDER BY created_at DESC
  `).all() as VersionRow[];

  return rows.map(toAgentVersion);
}
