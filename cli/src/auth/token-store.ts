/**
 * Token persistence — stores CLI auth tokens in ~/.achilles/auth.json.
 * Tokens are stored as plain JSON (file permissions 0600 restrict access).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { CONFIG_DIR, TOKEN_REFRESH_MARGIN_MS } from '../config/constants.js';
import { getAuthFilePath } from '../config/store.js';

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  user_id: string;
  org_id: string;
  role?: string;
  email?: string;
  display_name?: string;
  issued_at: string;
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadTokens(): StoredTokens | null {
  const authFile = getAuthFilePath();
  if (!existsSync(authFile)) return null;
  try {
    const raw = readFileSync(authFile, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  ensureDir();
  const authFile = getAuthFilePath();
  writeFileSync(authFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(): void {
  const authFile = getAuthFilePath();
  if (existsSync(authFile)) {
    unlinkSync(authFile);
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

export function getUserInfo(): { userId: string; orgId: string; role?: string; email?: string; displayName?: string } | null {
  const tokens = loadTokens();
  if (!tokens) return null;
  return {
    userId: tokens.user_id,
    orgId: tokens.org_id,
    role: tokens.role,
    email: tokens.email,
    displayName: tokens.display_name,
  };
}
