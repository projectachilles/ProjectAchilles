/**
 * External API key service.
 *
 * Generates ak_ prefixed keys for external integrations.
 * Keys are stored hashed (SHA-256) in ~/.projectachilles/apikeys.json.
 * Supports multiple keys with labels and creation dates.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');
const KEYS_FILE = path.join(SETTINGS_DIR, 'apikeys.json');

export interface StoredApiKey {
  id: string;
  label: string;
  hash: string;        // SHA-256 hash of the full key
  prefix: string;      // First 8 chars for display (ak_xxxx)
  created_at: string;  // ISO timestamp
}

interface KeysStore {
  keys: StoredApiKey[];
}

function ensureDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

function readStore(): KeysStore {
  ensureDir();
  if (!fs.existsSync(KEYS_FILE)) return { keys: [] };
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return { keys: [] };
  }
}

function writeStore(store: KeysStore): void {
  ensureDir();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key.
 * Returns the full key (shown once to the user) and the stored metadata.
 */
export function generateApiKey(label: string): { key: string; stored: StoredApiKey } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const key = `ak_${raw}`;
  const id = crypto.randomUUID();

  const stored: StoredApiKey = {
    id,
    label: label || 'Untitled',
    hash: hashKey(key),
    prefix: key.slice(0, 11) + '...',
    created_at: new Date().toISOString(),
  };

  const store = readStore();
  store.keys.push(stored);
  writeStore(store);

  return { key, stored };
}

/**
 * Validate an API key. Returns the stored key metadata if valid, null otherwise.
 */
export function validateApiKey(key: string): StoredApiKey | null {
  if (!key || !key.startsWith('ak_')) return null;

  const hash = hashKey(key);
  const store = readStore();
  return store.keys.find(k => k.hash === hash) ?? null;
}

/**
 * List all stored keys (metadata only — no way to recover the full key).
 */
export function listApiKeys(): StoredApiKey[] {
  return readStore().keys;
}

/**
 * Revoke (delete) an API key by ID.
 */
export function revokeApiKey(id: string): boolean {
  const store = readStore();
  const before = store.keys.length;
  store.keys = store.keys.filter(k => k.id !== id);
  if (store.keys.length === before) return false;
  writeStore(store);
  return true;
}
