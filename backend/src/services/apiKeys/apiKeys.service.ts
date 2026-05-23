/**
 * API Keys service.
 *
 * Direct bearer credentials for programmatic API access. Keys are generated
 * once, stored as SHA-256 hashes, and looked up by hash on every authenticated
 * request. See docs/superpowers/specs/2026-05-22-api-keys-design.md.
 */

import crypto from 'crypto';
import { getDatabase } from '../agent/database.js';

export type ApiKeyScope = 'read' | 'read-write';

interface ApiKeyRow {
  id: string;
  name: string;
  token_hash: string;
  key_prefix: string;
  scope: ApiKeyScope;
  created_by: string;
  org_id: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  scope: ApiKeyScope;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface GeneratedApiKey extends ApiKeyInfo {
  /** The full key — returned ONCE at creation, never retrievable again. */
  key: string;
}

function toApiKeyInfo(row: ApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scope: row.scope,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

interface GenerateParams {
  name: string;
  scope: ApiKeyScope;
  createdBy: string;
  orgId: string | null;
  expiresAt?: string | null;
}

export function generateApiKey(params: GenerateParams): GeneratedApiKey {
  const id = crypto.randomUUID();
  // 32 random bytes encoded as hex — matches the existing token pattern used
  // by generateDeviceCode() in cli-auth.routes.ts.
  const rawKey = 'pa_' + crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  const db = getDatabase();
  db.prepare(`
    INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by, org_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.name, tokenHash, keyPrefix, params.scope,
    params.createdBy, params.orgId, params.expiresAt ?? null,
  );

  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow;
  return { ...toApiKeyInfo(row), key: rawKey };
}

export function validateApiKey(rawKey: string): ApiKeyRow | null {
  if (!rawKey.startsWith('pa_')) return null;
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const row = getDatabase()
    .prepare('SELECT * FROM api_keys WHERE token_hash = ?')
    .get(hash) as ApiKeyRow | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row;
}

export function listApiKeys(): ApiKeyInfo[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKeyRow[];
  return rows.map(toApiKeyInfo);
}

export function revokeApiKey(id: string): boolean {
  const res = getDatabase()
    .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .run(id);
  return res.changes > 0;
}

const lastTouchMs = new Map<string, number>();
const TOUCH_THROTTLE_MS = 60_000;

export function touchLastUsed(id: string): void {
  const now = Date.now();
  const prev = lastTouchMs.get(id) ?? 0;
  if (now - prev < TOUCH_THROTTLE_MS) return;
  lastTouchMs.set(id, now);
  getDatabase()
    .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
    .run(id);
}

/** Reset the throttle — for tests only. */
export function _resetTouchThrottle(): void {
  lastTouchMs.clear();
}
