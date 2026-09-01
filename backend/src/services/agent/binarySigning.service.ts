/**
 * Authenticode / ad-hoc signing for agent binaries.
 *
 * Extracted so the build path and the upload path sign identically. They differ
 * only in how strict they are about failure: a build falls back to an unsigned
 * binary (signing is incidental to compiling), whereas an upload whose whole
 * purpose is "sign this with that certificate" must fail loudly instead of
 * silently producing something the fleet's WDAC policy will reject.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SIGN_TIMEOUT_MS = 120_000;

export interface SigningCertificate {
  pfxPath: string;
  password: string;
}

export interface SigningResult {
  signed: boolean;
  /** Subject line reported by `osslsigncode verify`, when it could be read. */
  signerSubject: string | null;
}

/** Thrown when signing was requested and could not be completed. */
export class SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningError';
  }
}

/**
 * True when the PE already carries an Authenticode signature.
 *
 * `osslsigncode verify` exits non-zero both for "no signature" and for "signature
 * present but untrusted" — an untrusted chain is the normal case for a
 * self-signed tenant certificate — so the exit code alone cannot answer this.
 * The output text can.
 */
/**
 * The only definitive "this PE is unsigned" marker osslsigncode emits.
 */
const UNSIGNED_MARKER = /No signature found/i;

/**
 * Markers that appear when a signature IS present, whether or not the chain
 * verifies. Taken from real osslsigncode 2.x output for a self-signed
 * certificate, which prints "Signature verification: failed" and
 * "Number of verified signatures: 1" while exiting non-zero.
 */
const SIGNED_MARKERS =
  /Signature Index:|Signer's certificate|Number of verified signatures|Signature verification/i;

export async function hasWindowsSignature(binaryPath: string): Promise<boolean> {
  let out: string;
  try {
    const { stdout, stderr } = await execFileAsync('osslsigncode', ['verify', binaryPath], {
      timeout: SIGN_TIMEOUT_MS,
    });
    out = `${stdout}${stderr}`;
  } catch (err) {
    out = `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`;
  }

  if (UNSIGNED_MARKER.test(out)) return false;
  return SIGNED_MARKERS.test(out);
}

/** Reads the signer subject from a signed PE, or null if it cannot be determined. */
export async function readWindowsSigner(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('osslsigncode', ['verify', binaryPath], {
      timeout: SIGN_TIMEOUT_MS,
    });
    return extractSubject(stdout);
  } catch (err) {
    const out = `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`;
    return extractSubject(out);
  }
}

function extractSubject(output: string): string | null {
  // osslsigncode prints e.g. "\tSubject: /C=XX/O=Acme/CN=Acme Code Signing"
  const match = output.match(/^\s*Subject\s*:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Sign a Windows PE with the given PFX, replacing any signature already on it.
 *
 * Re-signing rather than nesting is deliberate: the tenant's certificate is the
 * one their endpoints are configured to trust, so an upstream CI signature has
 * no value on that fleet and leaving both attached only invites confusion about
 * which one is being enforced.
 *
 * @throws SigningError when osslsigncode is unavailable or signing fails.
 */
export async function signWindowsBinary(
  binaryPath: string,
  cert: SigningCertificate,
): Promise<SigningResult> {
  const dir = path.dirname(binaryPath);
  const signedPath = `${binaryPath}.signed`;
  // Password goes via a file, never argv — /proc/<pid>/cmdline is world-readable.
  const passFile = path.join(dir, `.tmp-pass-${process.pid}-${Date.now()}`);

  try {
    if (await hasWindowsSignature(binaryPath)) {
      // `sign` on an already-signed PE appends rather than replaces, so strip first.
      const strippedPath = `${binaryPath}.stripped`;
      try {
        await execFileAsync('osslsigncode', ['remove-signature', '-in', binaryPath, '-out', strippedPath], {
          timeout: SIGN_TIMEOUT_MS,
        });
        fs.renameSync(strippedPath, binaryPath);
      } finally {
        if (fs.existsSync(strippedPath)) fs.unlinkSync(strippedPath);
      }
    }

    fs.writeFileSync(passFile, cert.password, { mode: 0o600 });
    await execFileAsync(
      'osslsigncode',
      ['sign', '-pkcs12', cert.pfxPath, '-readpass', passFile, '-in', binaryPath, '-out', signedPath],
      { timeout: SIGN_TIMEOUT_MS },
    );
    fs.renameSync(signedPath, binaryPath);
  } catch (err) {
    if (fs.existsSync(signedPath)) fs.unlinkSync(signedPath);
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message)) {
      throw new SigningError(
        'osslsigncode is not installed on this server, so uploaded binaries cannot be signed here.',
      );
    }
    throw new SigningError(`Authenticode signing failed: ${message}`);
  } finally {
    if (fs.existsSync(passFile)) fs.unlinkSync(passFile);
  }

  // Confirm the signature actually landed rather than trusting the exit code.
  if (!(await hasWindowsSignature(binaryPath))) {
    throw new SigningError('osslsigncode reported success but the binary carries no signature.');
  }

  return { signed: true, signerSubject: await readWindowsSigner(binaryPath) };
}

/**
 * Apply an ad-hoc signature to a macOS binary, matching the build path.
 * Ad-hoc signing needs no certificate — it satisfies Gatekeeper's requirement
 * that arm64 binaries carry *a* signature.
 *
 * @throws SigningError when rcodesign is unavailable or signing fails.
 */
export async function signDarwinBinaryAdHoc(binaryPath: string): Promise<SigningResult> {
  try {
    await execFileAsync('rcodesign', ['sign', '--code-signature-flags', 'adhoc', binaryPath], {
      timeout: SIGN_TIMEOUT_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message)) {
      throw new SigningError(
        'rcodesign is not installed on this server, so macOS binaries cannot be signed here.',
      );
    }
    throw new SigningError(`macOS ad-hoc signing failed: ${message}`);
  }
  return { signed: true, signerSubject: 'ad-hoc' };
}
