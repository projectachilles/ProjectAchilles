import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// The SHA-256 fingerprint of the certificate a Windows agent binary was signed
// with. The management-tool install script pins it: on the endpoint it accepts
// a downloaded agent only when the file's hash is intact and its signer has
// exactly this certificate. A name would not do (anyone can issue themselves a
// certificate with the same name), and Windows' own "Valid" verdict would not
// either: it depends on the endpoint's trust stores, and a self-signed
// certificate that is marked as a CA is never reported Valid.

const TOOL_TIMEOUT_MS = 30_000;
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * From the output of `openssl pkcs7 -print_certs` (the signer's certificate
 * and, for a CA-issued one, its chain), the fingerprint of the signer's
 * certificate: the one that issued none of the others. 64 upper-case hex
 * characters, or null when there is not exactly one such certificate.
 */
export function pickSignerFingerprint(printCertsOutput: string): string | null {
  const certificates: crypto.X509Certificate[] = [];
  for (const pem of printCertsOutput.match(PEM_CERTIFICATE) ?? []) {
    try {
      certificates.push(new crypto.X509Certificate(pem));
    } catch {
      return null;
    }
  }
  if (certificates.length === 0) return null;

  const leaves = certificates.filter(
    (candidate) => !certificates.some((other) => other !== candidate && other.issuer === candidate.subject),
  );
  if (leaves.length !== 1) return null;
  return leaves[0].fingerprint256.replace(/:/g, '').toUpperCase();
}

/**
 * Reads the signer certificate's fingerprint from a signed PE. Null when the
 * file is not signed, the tools are missing, or the signer can't be told
 * apart: callers then offer no signature check rather than a wrong one.
 * Synchronous on purpose: it runs once per registered version.
 */
export function readSignerFingerprint(binaryPath: string): string | null {
  let workDir: string | null = null;
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-signer-'));
    const signaturePath = path.join(workDir, 'signature.pem');
    execFileSync('osslsigncode', ['extract-signature', '-pem', '-in', binaryPath, '-out', signaturePath], {
      timeout: TOOL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const printed = execFileSync('openssl', ['pkcs7', '-in', signaturePath, '-print_certs'], {
      timeout: TOOL_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return pickSignerFingerprint(String(printed));
  } catch {
    return null;
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
}
