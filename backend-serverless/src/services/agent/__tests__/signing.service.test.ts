import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

describe('signing.service', () => {
  // Generate a real Ed25519 keypair for test env vars
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateB64 = Buffer.from(privateDer).toString('base64');
  const publicB64 = Buffer.from(publicDer).toString('base64');

  let ensureSigningKeyPair: typeof import('../signing.service.js').ensureSigningKeyPair;
  let signHash: typeof import('../signing.service.js').signHash;
  let getPublicKeyBase64: typeof import('../signing.service.js').getPublicKeyBase64;

  beforeEach(async () => {
    vi.resetModules();

    // Set env vars with the generated keys
    process.env.SIGNING_PRIVATE_KEY_B64 = privateB64;
    process.env.SIGNING_PUBLIC_KEY_B64 = publicB64;

    const mod = await import('../signing.service.js');
    ensureSigningKeyPair = mod.ensureSigningKeyPair;
    signHash = mod.signHash;
    getPublicKeyBase64 = mod.getPublicKeyBase64;
  });

  afterEach(() => {
    delete process.env.SIGNING_PRIVATE_KEY_B64;
    delete process.env.SIGNING_PUBLIC_KEY_B64;
  });

  it('ensureSigningKeyPair succeeds when env vars are set', () => {
    expect(() => ensureSigningKeyPair()).not.toThrow();
  });

  it('ensureSigningKeyPair throws when SIGNING_PRIVATE_KEY_B64 is missing', () => {
    delete process.env.SIGNING_PRIVATE_KEY_B64;
    expect(() => ensureSigningKeyPair()).toThrow('SIGNING_PRIVATE_KEY_B64');
  });

  it('ensureSigningKeyPair throws when SIGNING_PUBLIC_KEY_B64 is missing', () => {
    delete process.env.SIGNING_PUBLIC_KEY_B64;
    expect(() => ensureSigningKeyPair()).toThrow('SIGNING_PUBLIC_KEY_B64');
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

    const hashBytes = Buffer.from(testHash, 'hex');
    const sigBytes = Buffer.from(sig, 'hex');

    const valid = crypto.verify(null, hashBytes, publicKey, sigBytes);
    expect(valid).toBe(true);
  });

  it('getPublicKeyBase64 returns 44-char base64 (32 raw bytes)', () => {
    const b64 = getPublicKeyBase64();

    expect(b64).toHaveLength(44);
    const raw = Buffer.from(b64, 'base64');
    expect(raw).toHaveLength(32);
  });

  it('getPublicKeyBase64 returns empty string when no key exists', () => {
    delete process.env.SIGNING_PUBLIC_KEY_B64;
    const b64 = getPublicKeyBase64();
    expect(b64).toBe('');
  });
});
