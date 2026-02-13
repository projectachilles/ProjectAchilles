import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SIGNING_DIR = path.join(os.homedir(), '.projectachilles', 'signing');
const PRIVATE_KEY_PATH = path.join(SIGNING_DIR, 'ed25519.key');
const PUBLIC_KEY_PATH = path.join(SIGNING_DIR, 'ed25519.pub');

/**
 * Ensure an Ed25519 signing keypair exists. Auto-generates on first use.
 * Private key is stored with mode 0600.
 */
export function ensureSigningKeyPair(): void {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return;
  }

  fs.mkdirSync(SIGNING_DIR, { recursive: true, mode: 0o700 });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });

  fs.writeFileSync(PRIVATE_KEY_PATH, privateDer, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicDer, { mode: 0o644 });
}

/**
 * Sign a SHA256 hex string with the Ed25519 private key.
 * Returns the signature as a hex string.
 */
export function signHash(sha256Hex: string): string {
  ensureSigningKeyPair();

  const privateKeyDer = fs.readFileSync(PRIVATE_KEY_PATH);
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
 * Returns empty string if no keypair has been generated yet.
 */
export function getPublicKeyBase64(): string {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    return '';
  }

  const publicKeyDer = fs.readFileSync(PUBLIC_KEY_PATH);
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
