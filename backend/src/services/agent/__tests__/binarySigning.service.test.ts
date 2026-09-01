import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promisify } from 'util';

const mockExecFileAsync =
  vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ stdout: string; stderr: string }>>();
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = mockExecFileAsync;

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: mockExecFile, default: { ...actual, execFile: mockExecFile } };
});

const { hasWindowsSignature, readWindowsSigner } = await import('../binarySigning.service.js');

// ── Fixtures ──────────────────────────────────────────────────────────────
//
// VERBATIM output from osslsigncode 2.14. These are captured, not written by
// hand: an earlier version of this file used invented strings that matched the
// implementation's assumptions rather than the tool's real output, so the tests
// passed while the detection was wrong. It rejected every correctly-signed
// binary in production with "reported success but the binary carries no
// signature". If osslsigncode's wording changes, these fixtures must be
// re-captured from the tool, never edited to fit the code.
//
// Both cases exit NON-ZERO, so neither can be told apart by exit status:
//   - signed with a self-signed cert → chain does not verify
//   - unsigned                       → nothing to verify

/** Signed with a self-signed code-signing certificate (the tenant-cert case). */
const SIGNED_OUTPUT = `PE checksum   : 006FD1BB

Signature Index: 0  (Primary Signature)

Message digest algorithm  : SHA256
Current message digest    : 3AA470DDFC1654E90882BDAF0A0E01015AD1F048E49984420721ABE9984072C6 
Calculated message digest : 3AA470DDFC1654E90882BDAF0A0E01015AD1F048E49984420721ABE9984072C6 

Signer's certificate:
	------------------
	Signer #0:
		Subject: CN=Acme Code Signing,O=Acme,C=DO
		Issuer : CN=Acme Code Signing,O=Acme,C=DO
		Serial : 735E9FECC92271584394A0EDE3E58D5EF5BD0BB2
		Certificate expiration date:
			notBefore : Sep  1 22:30:32 2026 GMT
			notAfter : Sep  1 22:30:32 2027 GMT

Message digest algorithm: SHA256

Authenticated attributes:
	Signing time: Sep  1 22:30:32 2026 GMT
	Microsoft Individual Code Signing purpose
	Message digest: D1E9C375BA2037CEBB3E25725B875B9884AD2FEC86C3C74CEC1C4726DFEE719E 

CAfile: /etc/ssl/certs/ca-certificates.crt
TSA's certificates file: /etc/ssl/certs/ca-certificates.crt

Timestamp is not available

Signing certificate chain verified using:
	------------------
	Signer #0:
		Subject: CN=Acme Code Signing,O=Acme,C=DO
		Issuer : CN=Acme Code Signing,O=Acme,C=DO
		Serial : 735E9FECC92271584394A0EDE3E58D5EF5BD0BB2
		Certificate expiration date:
			notBefore : Sep  1 22:30:32 2026 GMT
			notAfter : Sep  1 22:30:32 2027 GMT

	Error: self-signed certificate

PKCS7_verify error
Failed signing certificate chain retrieved from the signature:
	------------------
	Signer #0:
		Subject: CN=Acme Code Signing,O=Acme,C=DO
		Issuer : CN=Acme Code Signing,O=Acme,C=DO
		Serial : 735E9FECC92271584394A0EDE3E58D5EF5BD0BB2
		Certificate expiration date:
			notBefore : Sep  1 22:30:32 2026 GMT
			notAfter : Sep  1 22:30:32 2027 GMT

Signature verification: failed

Number of verified signatures: 1
Failed
4057E2C07B7F0000:error:10800075:PKCS7 routines:PKCS7_verify:certificate verify error:crypto/pkcs7/pk7_smime.c:298:Verify error: self-signed certificate
`;

/** No Authenticode signature present. */
const UNSIGNED_OUTPUT = `Current PE checksum   : 00000000
Calculated PE checksum: 0070788D
Warning: invalid PE checksum
Failed
No signature found
Unable to extract existing signature
`;

function execFailure(out: string): Error {
  return Object.assign(new Error('Command failed with exit code 1'), { stdout: out, stderr: '' });
}

describe('binarySigning.hasWindowsSignature', () => {
  beforeEach(() => mockExecFileAsync.mockReset());

  it('detects a signature even though the self-signed chain fails to verify', async () => {
    mockExecFileAsync.mockRejectedValueOnce(execFailure(SIGNED_OUTPUT));
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(true);
  });

  it('detects an unsigned binary', async () => {
    mockExecFileAsync.mockRejectedValueOnce(execFailure(UNSIGNED_OUTPUT));
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(false);
  });

  // "No signature found" arrives on stderr while the PE checksum lines go to
  // stdout, so reading only stdout misses it.
  it('reads the unsigned marker from stderr', async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      Object.assign(new Error('exit 1'), {
        stdout: 'Current PE checksum   : 00000000\n',
        stderr: 'No signature found\n',
      }),
    );
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(false);
  });

  it('treats a clean exit carrying signature markers as signed', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: SIGNED_OUTPUT, stderr: '' });
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(true);
  });
});

describe('binarySigning.readWindowsSigner', () => {
  beforeEach(() => mockExecFileAsync.mockReset());

  it("extracts the signer's subject from real verify output", async () => {
    mockExecFileAsync.mockRejectedValueOnce(execFailure(SIGNED_OUTPUT));
    await expect(readWindowsSigner('/tmp/agent.exe')).resolves.toBe(
      'CN=Acme Code Signing,O=Acme,C=DO',
    );
  });

  it('returns null for an unsigned binary', async () => {
    mockExecFileAsync.mockRejectedValueOnce(execFailure(UNSIGNED_OUTPUT));
    await expect(readWindowsSigner('/tmp/agent.exe')).resolves.toBeNull();
  });
});
