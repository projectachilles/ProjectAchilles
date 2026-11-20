import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execFileSync, default: { ...actual, execFileSync } };
});

const { readSignerFingerprint, pickSignerFingerprint } = await import('../signerFingerprint.js');

// A throwaway CA and a code-signing certificate it issued (public certificates only, no keys).
const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDUzCCAjugAwIBAgIUF2lGtOldOOff7PW36sHuPzhteS8wDQYJKoZIhvcNAQEL
BQAwOTEYMBYGA1UEAwwPRml4dHVyZSBSb290IENBMRAwDgYDVQQKDAdGaXh0dXJl
MQswCQYDVQQGEwJYWDAeFw0yNjExMjAxNzM5NThaFw0zNjExMTcxNzM5NThaMDkx
GDAWBgNVBAMMD0ZpeHR1cmUgUm9vdCBDQTEQMA4GA1UECgwHRml4dHVyZTELMAkG
A1UEBhMCWFgwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCQa8rTmu0P
9JPG4TUSO23KnrKwnhf1TLApVc4ITQNc6OJ/mEdkZb8KYF/IrqN5E76b46VE1JPm
ALQcgd6op6zcQxNQCcI9n5WAZXijjpUrzy9DPllzRcDbaDnRRrImRce6CU9shM1h
XBJzK5GxhX6TnTHT0nM/cB2KDvBNmIycVDxm2FnRA8w/j1U09iI1ASKlYPbhX4CL
g9pC6chrP7aEBgTXR9pGOSs+TZUgwFSu+riWyAv0g97huifsxoxo18gwG21Do6kX
FCWSlzZoTpn1WgFjCRpp6Ftwg+uZp1zXUAvDcB45msOMSKUdtgb4v3ArVoCbSqu5
bDdPfyfD01tDAgMBAAGjUzBRMB0GA1UdDgQWBBTMghNyg4rLhg0EyqIZZ+uaxweR
4zAfBgNVHSMEGDAWgBTMghNyg4rLhg0EyqIZZ+uaxweR4zAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBAsIU9DJDzNQ3PKtYwnUZONSkzgu0n5sZ4
U5vrNQ0XyaAOXOSEepjJlXQMd4I0IkJFi7af/TbGsIWs3aas9wAs+csPEtlQHYwK
Mp2IWKGAiCmucRYyQ2iwiR635aec9tqdL7sNp9OG5H6jIO4cLzu0mI10AICYWrso
9nDbfE7onxTjYLu8C8/9D7dNkBlzHCXdv4HTDxhprG+wsAix0CigrUZDuAW3yLOM
u5zEfWM1ZB4dAQn+KivZKfiDBsUWOk4yN8F4b7fW0arW7vevVerJpmwxVpVWXl2u
j27s31pk46HIeh8gKsazPQxXD+AWstaQmFtnOvPuBoNXn54z3raM
-----END CERTIFICATE-----`;
const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIUB+uhi2mIuvDtiWfHZEeSw30NS8wwDQYJKoZIhvcNAQEL
BQAwOTEYMBYGA1UEAwwPRml4dHVyZSBSb290IENBMRAwDgYDVQQKDAdGaXh0dXJl
MQswCQYDVQQGEwJYWDAeFw0yNjExMjAxNzM5NThaFw0zNjExMTcxNzM5NThaMD4x
HTAbBgNVBAMMFEZpeHR1cmUgQ29kZSBTaWduaW5nMRAwDgYDVQQKDAdGaXh0dXJl
MQswCQYDVQQGEwJYWDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK3p
IKMi4vtEG3vlzQ+emzK30QotGN+tdJddD+ccUtnRG1Lk8vfMzF/3dD0lYS0tG1bT
K6MVD9MTG8GFSg3JMVVGUc+A++pzZWrxtxJPU64gCKjZzRjaBV639J/GmON65TrH
qDvNjmBriEp2xbx1K7e+Y164ncAD+9V6gXcVmL5hTFhIAahObaGu03m7E4Csl5M6
tKr0v2CJhlo9DI/lLjASpPg4GjkW7kOIN+7P62ZMeZi/G2ybLw3rz68yeNh72geY
Zrs1GkOw3YBSPIjxXrR2mG3C3ZNReFhyvKy6zE50PlZhGMED2c2WluiCUpRrgrXB
L0cO8Yn+SOyOe0Sa4HUCAwEAAaNyMHAwDAYDVR0TAQH/BAIwADALBgNVHQ8EBAMC
B4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMwHQYDVR0OBBYEFLa7YAjbuszZ/K3YpHyT
IfxD9hL9MB8GA1UdIwQYMBaAFMyCE3KDisuGDQTKohln65rHB5HjMA0GCSqGSIb3
DQEBCwUAA4IBAQAry1vQSohr+mLF3KX/KQxtvXjqs64bCE3IaqMSSV+EHHeUxGaJ
gYUgMelVSFv1X/QHMImh7vyvvvm2BDaGN5rZ0UsFLhW74YUZYHbfDAb2ak8wjsE2
6avTj3N5mYHFMu7vFBmfJFR7uq7dZY76/f/Ak2BWAgCbu5LPZHT2B8P6Gjw5uoqp
wGDdHbqtT2KX3IJcBSRL0l8O4LnIDDFkkU9t2GK4Fj6xfg2l7zKSWWpBjCpBDSvw
6/UBoQ/sfjlW8/F2T3FEzcL8NzKTBqX+UBUm0a06LD8F2rMY/Yp4/nYk5gXt+px6
an1u2oR7iHtyLbVRXOFvMGt6epKqIV20hyeo
-----END CERTIFICATE-----`;
const CA_FINGERPRINT = 'AD657B8F8625B2D4E83BF0E876FA1ED3A2B4F3C09CA531950F7D0843D9F7F57B';
const LEAF_FINGERPRINT = '072046470D68BA1ADEE7F93FAE2D69F409D483871BEB7098883086C58761FD3B';

/** What "openssl pkcs7 -print_certs" prints: a subject/issuer header, then each certificate. */
const printCerts = (...pems: string[]) => pems.map((p) => `subject=x\nissuer=y\n${p}\n`).join('\n');

describe('pickSignerFingerprint', () => {
  it('returns the fingerprint of a lone self-signed certificate', () => {
    expect(pickSignerFingerprint(printCerts(CA_PEM))).toBe(CA_FINGERPRINT);
  });

  it('returns the signing certificate, not the CA that issued it, in either order', () => {
    expect(pickSignerFingerprint(printCerts(CA_PEM, LEAF_PEM))).toBe(LEAF_FINGERPRINT);
    expect(pickSignerFingerprint(printCerts(LEAF_PEM, CA_PEM))).toBe(LEAF_FINGERPRINT);
  });

  it('is 64 upper-case hex characters, no separators', () => {
    expect(pickSignerFingerprint(printCerts(LEAF_PEM))).toMatch(/^[0-9A-F]{64}$/);
  });

  it('is null when there is no certificate, or text that is not one', () => {
    expect(pickSignerFingerprint('')).toBeNull();
    expect(pickSignerFingerprint('-----BEGIN CERTIFICATE-----\nnot base64 der\n-----END CERTIFICATE-----')).toBeNull();
  });

  it('is null when no single certificate stands out as the signer', () => {
    // The same self-signed certificate twice: two candidates, neither issued by the other.
    expect(pickSignerFingerprint(printCerts(CA_PEM, CA_PEM))).toBeNull();
  });
});

describe('readSignerFingerprint', () => {
  beforeEach(() => { execFileSync.mockReset(); });

  it('extracts the signature with osslsigncode and reads its certificates with openssl', () => {
    execFileSync
      .mockReturnValueOnce('Succeeded')
      .mockReturnValueOnce(printCerts(CA_PEM, LEAF_PEM));

    expect(readSignerFingerprint('/bin/agent.exe')).toBe(LEAF_FINGERPRINT);

    const [tool1, args1] = execFileSync.mock.calls[0];
    expect(tool1).toBe('osslsigncode');
    expect(args1.slice(0, 4)).toEqual(['extract-signature', '-pem', '-in', '/bin/agent.exe']);
    const [tool2, args2] = execFileSync.mock.calls[1];
    expect(tool2).toBe('openssl');
    expect(args2).toContain('-print_certs');
  });

  it('is null when the binary is not signed or a tool is missing', () => {
    execFileSync.mockImplementation(() => { throw new Error('No signature found'); });
    expect(readSignerFingerprint('/bin/agent.exe')).toBeNull();
  });
});
