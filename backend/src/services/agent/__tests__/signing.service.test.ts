import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('signing.service', () => {
  let tempDir: string;
  let ensureSigningKeyPair: typeof import('../signing.service.js').ensureSigningKeyPair;
  let signHash: typeof import('../signing.service.js').signHash;
  let getPublicKeyBase64: typeof import('../signing.service.js').getPublicKeyBase64;

  beforeEach(async () => {
    vi.resetModules();

    // Create isolated temp dir for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-test-'));

    // Mock os.homedir to redirect key storage to temp dir
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return { ...actual, default: { ...actual, homedir: () => tempDir }, homedir: () => tempDir };
    });

    const mod = await import('../signing.service.js');
    ensureSigningKeyPair = mod.ensureSigningKeyPair;
    signHash = mod.signHash;
    getPublicKeyBase64 = mod.getPublicKeyBase64;
  });

  it('creates keypair when none exists', () => {
    ensureSigningKeyPair();

    const signingDir = path.join(tempDir, '.projectachilles', 'signing');
    expect(fs.existsSync(path.join(signingDir, 'ed25519.key'))).toBe(true);
    expect(fs.existsSync(path.join(signingDir, 'ed25519.pub'))).toBe(true);
  });

  it('is idempotent — does not overwrite existing keypair', () => {
    ensureSigningKeyPair();
    const signingDir = path.join(tempDir, '.projectachilles', 'signing');
    const firstKey = fs.readFileSync(path.join(signingDir, 'ed25519.key'));

    ensureSigningKeyPair();
    const secondKey = fs.readFileSync(path.join(signingDir, 'ed25519.key'));

    expect(firstKey.equals(secondKey)).toBe(true);
  });

  it('signHash returns valid hex string', () => {
    const testHash = crypto.createHash('sha256').update('test-binary').digest('hex');
    const sig = signHash(testHash);

    expect(sig).toMatch(/^[a-f0-9]+$/);
    // Ed25519 signature is 64 bytes = 128 hex chars
    expect(sig).toHaveLength(128);
  });

  it('signature verifies with crypto.verify', () => {
    const testHash = crypto.createHash('sha256').update('test-binary').digest('hex');
    const sig = signHash(testHash);

    // Read the public key and verify
    const signingDir = path.join(tempDir, '.projectachilles', 'signing');
    const publicKeyDer = fs.readFileSync(path.join(signingDir, 'ed25519.pub'));
    const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });

    const hashBytes = Buffer.from(testHash, 'hex');
    const sigBytes = Buffer.from(sig, 'hex');

    const valid = crypto.verify(null, hashBytes, publicKey, sigBytes);
    expect(valid).toBe(true);
  });

  it('getPublicKeyBase64 returns 44-char base64 (32 raw bytes)', () => {
    ensureSigningKeyPair();
    const b64 = getPublicKeyBase64();

    expect(b64).toHaveLength(44);
    // Decode and verify length
    const raw = Buffer.from(b64, 'base64');
    expect(raw).toHaveLength(32);
  });

  it('getPublicKeyBase64 returns empty string when no key exists', async () => {
    // Fresh module with no keypair generated
    const b64 = getPublicKeyBase64();
    // Since ensureSigningKeyPair hasn't been called and tempDir is fresh
    expect(b64).toBe('');
  });
});
