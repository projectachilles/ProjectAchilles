import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase } from './database.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  EnrollmentRequest,
  EnrollmentResponse,
  EnrollmentToken,
  CreateTokenResponse,
} from '../../types/agent.js';
import { getPublicKeyBase64, ensureSigningKeyPair } from './signing.service.js';
import { recordEvent } from './events.service.js';
import { invalidateAgentCache } from './agentAuthCache.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BCRYPT_ROUNDS = 12;
const TOKEN_PREFIX = 'acht_';
const API_KEY_PREFIX = 'ak_';

// Pre-computed dummy hash so bcrypt.compare always runs at least once,
// eliminating the timing oracle that leaks whether valid tokens exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-value-for-enrollment-timing', 12);

interface TokenRow {
  id: string;
  token_hash: string;
  org_id: string;
  created_by: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  metadata: string;
  created_at: string;
}

/**
 * Generate an enrollment token for an organization.
 * Returns the plaintext token exactly once.
 */
export async function createToken(
  orgId: string,
  createdBy: string,
  ttlHours: number = 24,
  maxUses: number = 1,
  metadata: Record<string, string> = {}
): Promise<CreateTokenResponse> {
  const db = getDatabase();

  const plainToken = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, BCRYPT_ROUNDS);
  const id = crypto.randomUUID();

  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO enrollment_tokens (id, token_hash, org_id, created_by, expires_at, max_uses, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tokenHash, orgId, createdBy, expiresAt, maxUses, JSON.stringify(metadata));

  return {
    token: plainToken,
    id,
    expires_at: expiresAt,
    max_uses: maxUses,
  };
}

/**
 * Enroll an agent using an enrollment token.
 * Validates token, creates agent record, generates API key.
 */
export async function enrollAgent(request: EnrollmentRequest): Promise<EnrollmentResponse> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Find all non-expired, non-fully-used tokens
  const candidates = db.prepare(`
    SELECT * FROM enrollment_tokens
    WHERE expires_at > ? AND use_count < max_uses
  `).all(now) as TokenRow[];

  // Validate the provided token against stored hashes.
  // Always run at least one bcrypt.compare to prevent timing oracle
  // that leaks whether valid tokens exist (M4 fix).
  let matchedToken: TokenRow | null = null;
  if (candidates.length === 0) {
    await bcrypt.compare(request.token, DUMMY_HASH);
  } else {
    for (const candidate of candidates) {
      const isMatch = await bcrypt.compare(request.token, candidate.token_hash);
      if (isMatch) {
        matchedToken = candidate;
        break;
      }
    }
  }

  if (!matchedToken) {
    throw new AppError('Invalid or expired enrollment token', 401);
  }

  // Generate agent ID and API key
  const agentId = crypto.randomUUID();
  const plainApiKey = API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(plainApiKey, BCRYPT_ROUNDS);

  // Create agent record and increment token use_count in a transaction
  const insertAgent = db.prepare(`
    INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, enrolled_at, enrolled_by, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
  `);

  // M3: Atomically increment use_count only if still below max_uses (prevents TOCTOU race)
  const incrementUseCount = db.prepare(`
    UPDATE enrollment_tokens SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses
  `);

  const transaction = db.transaction(() => {
    const result = incrementUseCount.run(matchedToken!.id);
    if (result.changes === 0) {
      throw new AppError('Enrollment token no longer available', 409);
    }
    insertAgent.run(
      agentId,
      matchedToken!.org_id,
      request.hostname,
      request.os,
      request.arch,
      request.agent_version,
      apiKeyHash,
      now,
      matchedToken!.id
    );
  });

  transaction();

  recordEvent(agentId, 'enrolled', {
    hostname: request.hostname,
    os: request.os,
    arch: request.arch,
    agent_version: request.agent_version,
  });

  const serverUrl = process.env.AGENT_SERVER_URL || `http://localhost:${process.env.PORT || '3000'}`;

  // Warn if agents will receive an insecure URL — they will reject it.
  if (serverUrl.startsWith('http://') && !isLocalhostUrl(serverUrl)) {
    console.warn(
      `[enrollment] WARNING: AGENT_SERVER_URL is "${serverUrl}" (plaintext HTTP to remote host). ` +
      `Agents will reject this URL. Set AGENT_SERVER_URL to an https:// URL.`
    );
  }

  return {
    agent_id: agentId,
    agent_key: plainApiKey,
    org_id: matchedToken.org_id,
    server_url: serverUrl,
    poll_interval: 30,
    update_public_key: getPublicKeyBase64(),
  };
}

/**
 * List active (non-expired, non-fully-used) enrollment tokens for an org.
 */
export function listTokens(orgId: string): EnrollmentToken[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT * FROM enrollment_tokens
    WHERE org_id = ? AND expires_at > ? AND use_count < max_uses
    ORDER BY created_at DESC
  `).all(orgId, now) as TokenRow[];

  return rows.map((row) => ({
    id: row.id,
    org_id: row.org_id,
    token: '***', // Never return the hash or plaintext
    expires_at: row.expires_at,
    max_uses: row.max_uses,
    use_count: row.use_count,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
    created_at: row.created_at,
    created_by: row.created_by,
  }));
}

/**
 * Revoke (delete) an enrollment token.
 */
export function revokeToken(tokenId: string): void {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM enrollment_tokens WHERE id = ?').run(tokenId);

  if (result.changes === 0) {
    throw new AppError('Token not found', 404);
  }
}

// Grace period for dual-key rotation (seconds). During this window, both
// the old key and the pending (new) key authenticate successfully.
export const ROTATION_GRACE_PERIOD_SECONDS = 300; // 5 minutes

const SIGNING_KEY_PATH = path.join(os.homedir(), '.projectachilles', 'signing', 'ed25519.key');
const PENDING_KEY_SALT = 'achilles-pending-rotation-v1';

/**
 * Derive an AES-256 key from the Ed25519 signing private key.
 * Uses HMAC-SHA256 with a fixed salt to produce a 32-byte symmetric key.
 */
function derivePendingKeyEncryptionKey(): Buffer {
  ensureSigningKeyPair();
  const privateKeyDer = fs.readFileSync(SIGNING_KEY_PATH);
  return crypto.createHmac('sha256', PENDING_KEY_SALT).update(privateKeyDer).digest();
}

/**
 * Encrypt a plaintext API key for server-side storage.
 * Returns base64(iv + authTag + ciphertext).
 */
export function encryptPendingKey(plaintext: string): string {
  const key = derivePendingKeyEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a pending API key from server-side storage.
 */
export function decryptPendingKey(encryptedBase64: string): string {
  const key = derivePendingKeyEncryptionKey();
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Promote a pending key to primary. Clears pending columns and sets rotated_at.
 */
export function promotePendingKey(agentId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agents
    SET api_key_hash = pending_api_key_hash,
        pending_api_key_hash = NULL,
        pending_api_key_encrypted = NULL,
        key_rotation_initiated_at = NULL,
        api_key_rotated_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(now, now, agentId);
  invalidateAgentCache(agentId);
}

/**
 * Rotate an agent's API key using a grace-period model.
 * The new key is stored as "pending" — both old and new keys work during
 * the grace period. The agent receives the new key via its next heartbeat
 * and auto-updates. Returns the new plaintext key exactly once.
 */
export async function rotateAgentKey(agentId: string): Promise<{ agent_key: string; agent_id: string; rotated_at: string }> {
  const db = getDatabase();

  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId) as { id: string } | undefined;
  if (!agent) {
    throw new AppError('Agent not found', 404);
  }

  const plainApiKey = API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(plainApiKey, BCRYPT_ROUNDS);
  const encryptedKey = encryptPendingKey(plainApiKey);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE agents
    SET pending_api_key_hash = ?,
        pending_api_key_encrypted = ?,
        key_rotation_initiated_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(apiKeyHash, encryptedKey, now, now, agentId);

  recordEvent(agentId, 'key_rotated');

  return {
    agent_key: plainApiKey,
    agent_id: agentId,
    rotated_at: now,
  };
}

/** Check if a URL points to localhost/127.0.0.1/[::1]. */
function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
