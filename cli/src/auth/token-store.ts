/**
 * Token persistence — stores CLI auth tokens in ~/.achilles/auth.json.
 * Tokens are stored as plain JSON (file permissions 0600 restrict access).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { AUTH_FILE, CONFIG_DIR, TOKEN_REFRESH_MARGIN_MS } from '../config/constants.js';

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  user_id: string;
  org_id: string;
  role?: string;
  issued_at: string;
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadTokens(): StoredTokens | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const raw = readFileSync(AUTH_FILE, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE);
  }
}

export function isTokenExpired(tokens: StoredTokens): boolean {
  const expiresAt = new Date(tokens.expires_at).getTime();
  return Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

export function getAccessToken(): string | null {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (isTokenExpired(tokens)) return null;
  return tokens.access_token;
}

export function getUserInfo(): { userId: string; orgId: string; role?: string } | null {
  const tokens = loadTokens();
  if (!tokens) return null;
  return { userId: tokens.user_id, orgId: tokens.org_id, role: tokens.role };
}
