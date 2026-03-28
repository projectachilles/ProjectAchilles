/**
 * Shared AES-256-GCM encryption utilities.
 * Used by analytics, integrations, and tests settings services.
 * Key derived from ENCRYPTION_SECRET via HKDF-SHA256.
 */

import * as crypto from 'crypto';
import * as os from 'os';

/** Derive a 256-bit encryption key from ENCRYPTION_SECRET using HKDF. */
export function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_SECRET environment variable is required. Generate one with: openssl rand -base64 32');
  }
  if (secret.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32');
  }
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'projectachilles-settings-v1', 'encryption', 32));
}

/**
 * Legacy key derivation methods from earlier versions.
 * Used only for migration — decrypt() falls back to these when the current
 * HKDF key fails, allowing transparent migration of old settings files.
 */
function getLegacyKeys(): Buffer[] {
  const keys: Buffer[] = [];

  // v2: SHA-256 of ENCRYPTION_SECRET (pre-HKDF, used between 62ebc2f..97c6029)
  const secret = process.env.ENCRYPTION_SECRET;
  if (secret) {
    keys.push(crypto.createHash('sha256').update(secret).digest());
  }

  // v1: SHA-256 of hostname + username (original, pre-62ebc2f)
  const machineId = os.hostname() + os.userInfo().username;
  keys.push(crypto.createHash('sha256').update(machineId).digest());

  return keys;
}

/** Attempt AES-256-GCM decryption with the given key. Returns null on failure. */
function tryDecryptWithKey(encryptedText: string, key: Buffer): string | null {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/** Encrypt a string using AES-256-GCM with a random IV. Returns `iv:authTag:ciphertext` in hex. */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string encrypted by `encrypt()`. Verifies the GCM auth tag.
 *
 * If decryption with the current HKDF key fails, falls back to legacy key
 * derivation methods (SHA-256 of ENCRYPTION_SECRET, SHA-256 of machine ID)
 * to support transparent migration of settings files from older versions.
 */
export function decrypt(encryptedText: string): string {
  // Try current key first
  const currentKey = getEncryptionKey();
  const result = tryDecryptWithKey(encryptedText, currentKey);
  if (result !== null) return result;

  // Fall back to legacy keys for migration
  for (const legacyKey of getLegacyKeys()) {
    const legacyResult = tryDecryptWithKey(encryptedText, legacyKey);
    if (legacyResult !== null) {
      console.warn('[encryption] Decrypted with legacy key — settings will be re-encrypted on next save');
      return legacyResult;
    }
  }

  // No key worked — throw the original error
  throw new Error('Unable to decrypt: authentication failed with current and legacy keys');
}
