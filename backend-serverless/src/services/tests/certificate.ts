// Pure-JS certificate generation using node-forge (no openssl binary required)
// Used by serverless deployment where openssl CLI is unavailable.

import * as crypto from 'crypto';
import forge from 'node-forge';
import type { CertificateSubject } from '../../types/tests.js';

// ── Types ──────────────────────────────────────────────────────────

export interface GeneratedCertificate {
  pfxBuffer: Buffer;
  password: string;
  fingerprint: string;
  expiresAt: string;
  subject: CertificateSubject;
}

export interface ParsedCertificate {
  fingerprint: string;
  expiresAt: string;
  subject: CertificateSubject;
}

// ── Validation ─────────────────────────────────────────────────────

// Same regex as Docker backend — prevents injection and invalid chars
const SAFE_SUBJECT = /^[a-zA-Z0-9 .\-,&'()]+$/;

export function validateSubject(subject: CertificateSubject): void {
  if (!subject.commonName || !SAFE_SUBJECT.test(subject.commonName)) {
    throw new Error('commonName contains invalid characters');
  }
  if (!subject.organization || !SAFE_SUBJECT.test(subject.organization)) {
    throw new Error('organization contains invalid characters');
  }
  if (!subject.country || !SAFE_SUBJECT.test(subject.country)) {
    throw new Error('country contains invalid characters');
  }
}

// ── Certificate Generation ─────────────────────────────────────────

export async function generateCertificate(
  subject: CertificateSubject,
  password?: string,
): Promise<GeneratedCertificate> {
  validateSubject(subject);

  // Generate RSA-4096 keypair (async to avoid blocking event loop)
  const keypair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 4096, workers: -1 }, (err, kp) => {
      if (err) reject(err);
      else resolve(kp);
    });
  });

  // Create self-signed X.509 certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString('hex');

  // X.509 validity uses UTCTime/GeneralizedTime (second precision only).
  // Truncate milliseconds so generated expiresAt matches parsed value.
  const now = new Date();
  now.setMilliseconds(0);
  const expiry = new Date(now);
  expiry.setDate(expiry.getDate() + 1825); // 5 years, matching Docker backend

  cert.validity.notBefore = now;
  cert.validity.notAfter = expiry;

  const attrs: forge.pki.CertificateField[] = [
    { shortName: 'CN', value: subject.commonName },
    { shortName: 'O', value: subject.organization },
    { shortName: 'C', value: subject.country },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true },
    { name: 'extKeyUsage', codeSigning: true },
  ]);

  cert.sign(keypair.privateKey, forge.md.sha256.create());

  // Compute SHA-256 fingerprint from DER-encoded cert
  const fingerprint = computeFingerprint(cert);

  // Use provided password or generate a random one
  const certPassword = password || crypto.randomBytes(32).toString('base64');

  // Export as PKCS#12 (PFX)
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keypair.privateKey, [cert], certPassword, {
    algorithm: '3des',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const pfxBuffer = Buffer.from(p12Der, 'binary');

  return {
    pfxBuffer,
    password: certPassword,
    fingerprint,
    expiresAt: expiry.toISOString(),
    subject,
  };
}

// ── PFX Parsing ────────────────────────────────────────────────────

export function parsePfxCertificate(pfxBuffer: Buffer, password: string): ParsedCertificate {
  const p12Der = pfxBuffer.toString('binary');
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Extract certificate from safe bags
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const bags = certBags[forge.pki.oids.certBag];
  if (!bags || bags.length === 0) {
    throw new Error('No certificate found in PFX file');
  }

  const cert = bags[0].cert;
  if (!cert) {
    throw new Error('No certificate found in PFX file');
  }

  const fingerprint = computeFingerprint(cert);
  const expiresAt = cert.validity.notAfter.toISOString();

  // Extract subject fields
  const cnAttr = cert.subject.getField('CN');
  const orgAttr = cert.subject.getField('O');
  const countryAttr = cert.subject.getField('C');

  const subject: CertificateSubject = {
    commonName: cnAttr?.value as string || 'Unknown',
    organization: orgAttr?.value as string || 'Unknown',
    country: countryAttr?.value as string || 'XX',
  };

  return { fingerprint, expiresAt, subject };
}

// ── Helpers ────────────────────────────────────────────────────────

function computeFingerprint(cert: forge.pki.Certificate): string {
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const hash = crypto.createHash('sha256').update(Buffer.from(derBytes, 'binary')).digest('hex');
  return hash.match(/.{2}/g)!.join(':').toUpperCase();
}
