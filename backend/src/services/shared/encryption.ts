/**
 * Shared AES-256-GCM encryption utilities.
 * Used by analytics, integrations, and tests settings services.
 * Key derived from ENCRYPTION_SECRET via HKDF-SHA256.
 */

import * as crypto from 'crypto';

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

/** Decrypt a string encrypted by `encrypt()`. Verifies the GCM auth tag. */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
