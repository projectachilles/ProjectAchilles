import crypto from 'crypto';

/**
 * Ensure Ed25519 signing keys are available via environment variables.
 * Throws if the required env vars are missing.
 *
 * Expected env vars:
 *   SIGNING_PRIVATE_KEY_B64 — base64-encoded Ed25519 private key (PKCS8 DER format)
 *   SIGNING_PUBLIC_KEY_B64  — base64-encoded Ed25519 public key (SPKI DER format)
 */
export function ensureSigningKeyPair(): void {
  if (!process.env.SIGNING_PRIVATE_KEY_B64) {
    throw new Error('SIGNING_PRIVATE_KEY_B64 environment variable is required');
  }
  if (!process.env.SIGNING_PUBLIC_KEY_B64) {
    throw new Error('SIGNING_PUBLIC_KEY_B64 environment variable is required');
  }
}

/**
 * Sign a SHA256 hex string with the Ed25519 private key.
 * Returns the signature as a hex string.
 */
export function signHash(sha256Hex: string): string {
  ensureSigningKeyPair();

  const privateKeyDer = Buffer.from(process.env.SIGNING_PRIVATE_KEY_B64!, 'base64');
  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const hashBytes = Buffer.from(sha256Hex, 'hex');
  const signature = crypto.sign(null, hashBytes, privateKey);
  return signature.toString('hex');
}

/**
 * Get the raw 32-byte Ed25519 public key as base64.
 * Returns empty string if no signing keys are configured.
 */
export function getPublicKeyBase64(): string {
  if (!process.env.SIGNING_PUBLIC_KEY_B64) {
    return '';
  }

  const publicKeyDer = Buffer.from(process.env.SIGNING_PUBLIC_KEY_B64, 'base64');
  const publicKey = crypto.createPublicKey({
    key: publicKeyDer,
    format: 'der',
    type: 'spki',
  });

  // Export raw 32-byte key (no SPKI wrapper)
  const rawKey = publicKey.export({ type: 'spki', format: 'der' });
  // Ed25519 SPKI DER is 44 bytes: 12-byte header + 32-byte key
  const raw32 = rawKey.subarray(rawKey.length - 32);
  return raw32.toString('base64');
}
