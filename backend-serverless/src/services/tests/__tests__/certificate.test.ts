import { describe, it, expect, beforeAll } from 'vitest';
import type { GeneratedCertificate } from '../certificate.js';
import { validateSubject, generateCertificate, parsePfxCertificate } from '../certificate.js';

// RSA-4096 key generation takes 2-8s in pure JS.
// Generate once and reuse across tests to keep the suite fast.
let fixture: GeneratedCertificate;

beforeAll(async () => {
  fixture = await generateCertificate(
    { commonName: 'Test Corp', organization: 'Test Organization', country: 'US' },
    'test-password-123',
  );
}, 30_000);

// ── validateSubject ────────────────────────────────────────────────

describe('validateSubject', () => {
  it('accepts valid subject fields', () => {
    expect(() => validateSubject({
      commonName: 'Microsoft Windows',
      organization: "O'Reilly & Associates, Inc.",
      country: 'US',
    })).not.toThrow();
  });

  it('accepts hyphens, dots, commas, parens', () => {
    expect(() => validateSubject({
      commonName: 'My-Cert.v2',
      organization: 'Acme (Holdings), Ltd.',
      country: 'GB',
    })).not.toThrow();
  });

  it('rejects commonName with angle brackets', () => {
    expect(() => validateSubject({
      commonName: '<script>alert(1)</script>',
      organization: 'Test',
      country: 'US',
    })).toThrow('commonName contains invalid characters');
  });

  it('rejects organization with slashes', () => {
    expect(() => validateSubject({
      commonName: 'Test',
      organization: 'A/B Corp',
      country: 'US',
    })).toThrow('organization contains invalid characters');
  });

  it('rejects country with dollar sign', () => {
    expect(() => validateSubject({
      commonName: 'Test',
      organization: 'Org',
      country: '$USD',
    })).toThrow('country contains invalid characters');
  });

  it('rejects empty commonName', () => {
    expect(() => validateSubject({
      commonName: '',
      organization: 'Org',
      country: 'US',
    })).toThrow('commonName contains invalid characters');
  });
});

// ── generateCertificate ────────────────────────────────────────────

describe('generateCertificate', () => {
  it('produces a valid PFX buffer (ASN.1 SEQUENCE header byte)', () => {
    expect(fixture.pfxBuffer).toBeInstanceOf(Buffer);
    expect(fixture.pfxBuffer.length).toBeGreaterThan(1000);
    expect(fixture.pfxBuffer[0]).toBe(0x30); // ASN.1 SEQUENCE
  });

  it('returns correct fingerprint format (colon-separated uppercase hex)', () => {
    expect(fixture.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('returns expiry approximately 5 years in the future', () => {
    const expiry = new Date(fixture.expiresAt);
    const now = new Date();
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(1820);
    expect(diffDays).toBeLessThan(1830);
  });

  it('returns the subject as provided', () => {
    expect(fixture.subject).toEqual({
      commonName: 'Test Corp',
      organization: 'Test Organization',
      country: 'US',
    });
  });

  it('uses provided password', () => {
    expect(fixture.password).toBe('test-password-123');
  });

  it('generates random password when not provided', async () => {
    const result = await generateCertificate(
      { commonName: 'Random Pass', organization: 'Org', country: 'US' },
    );
    expect(result.password).toBeTruthy();
    expect(result.password.length).toBeGreaterThan(20);
    expect(result.password).not.toBe('test-password-123');
  }, 30_000);
});

// ── parsePfxCertificate ────────────────────────────────────────────

describe('parsePfxCertificate', () => {
  it('round-trips: generate then parse returns matching metadata', () => {
    const parsed = parsePfxCertificate(fixture.pfxBuffer, fixture.password);

    expect(parsed.fingerprint).toBe(fixture.fingerprint);
    expect(parsed.expiresAt).toBe(fixture.expiresAt);
    expect(parsed.subject).toEqual(fixture.subject);
  });

  it('throws on wrong password', () => {
    expect(() => parsePfxCertificate(fixture.pfxBuffer, 'wrong-password'))
      .toThrow();
  });

  it('throws on invalid buffer', () => {
    expect(() => parsePfxCertificate(Buffer.from('not-a-pfx'), 'test'))
      .toThrow();
  });
});
