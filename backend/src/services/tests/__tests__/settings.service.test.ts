import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────
// Must be before dynamic import of the service under test.

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockRenameSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockRmSync = vi.fn();
const mockChmodSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
    rmSync: mockRmSync,
    chmodSync: mockChmodSync,
    statSync: mockStatSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = {
    homedir: () => '/mock-home',
    hostname: () => 'test-host',
    userInfo: () => ({ username: 'testuser', uid: 1000, gid: 1000, shell: '/bin/bash', homedir: '/mock-home' }),
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

// Mock child_process.execFile so that promisify(execFile) returns our async mock.
// Node's execFile has a custom promisify symbol that resolves with { stdout, stderr }.
// We attach the same symbol to our mock so promisify picks it up.
import { promisify } from 'util';
const mockExecFileAsync = vi.fn<(cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>>();
const mockExecFile = vi.fn();
// Attach the custom promisify handler so `promisify(execFile)` returns mockExecFileAsync
(mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = mockExecFileAsync;

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: mockExecFile,
    default: { ...actual, execFile: mockExecFile },
  };
});

const { TestsSettingsService } = await import('../settings.js');

// ── Helpers ──────────────────────────────────────────────────────────

const SETTINGS_DIR = '/mock-home/.projectachilles';
const SETTINGS_FILE = `${SETTINGS_DIR}/tests.json`;
const CERTS_DIR = `${SETTINGS_DIR}/certs`;
const ACTIVE_CERT_FILE = `${CERTS_DIR}/active-cert.txt`;

function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1700000000000',
    label: 'Test Cert',
    source: 'generated',
    subject: { commonName: 'Test CN', organization: 'Test Org', country: 'US' },
    password: 'enc:aabbcc:ddeeff:112233',
    createdAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
    fingerprint: 'AA:BB:CC:DD',
    ...overrides,
  };
}

/** Configure execFile mock for successful OpenSSL subprocess calls. */
function setupOpenSSLSuccess() {
  mockExecFileAsync.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args.includes('-fingerprint')) {
      return { stdout: 'sha256 Fingerprint=AA:BB:CC:DD:EE:FF\n', stderr: '' };
    } else if (args.includes('-enddate')) {
      return { stdout: 'notAfter=Jan  1 00:00:00 2030 GMT\n', stderr: '' };
    } else if (args.includes('-subject')) {
      return { stdout: 'subject=CN = Test CN, O = Test Org, C = US\n', stderr: '' };
    } else if (args.includes('rand')) {
      return { stdout: 'c3VwZXJzZWNyZXRwYXNzd29yZA==\n', stderr: '' };
    } else if (args.includes('pkcs12') && args.includes('-info')) {
      return { stdout: 'MAC Iteration 1\nMAC verified OK\n', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TestsSettingsService', () => {
  let service: InstanceType<typeof TestsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-1234';
    service = new TestsSettingsService();
    // Defaults: dirs don't exist, no files
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  // ── Group 1: Platform Settings ─────────────────────────────

  describe('getPlatformSettings', () => {
    it('returns defaults when settings file is missing', () => {
      mockExistsSync.mockReturnValue(false);

      const settings = service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('reads stored settings from tests.json', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ platform: { os: 'linux', arch: 'arm64' } }),
      );

      const settings = service.getPlatformSettings();

      expect(settings).toEqual({ os: 'linux', arch: 'arm64' });
    });

    it('handles corrupt JSON gracefully', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE);
      mockReadFileSync.mockReturnValue('not-valid-json{{{');

      const settings = service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('returns defaults when platform key is absent', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE);
      mockReadFileSync.mockReturnValue(JSON.stringify({ otherKey: true }));

      const settings = service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });
  });

  describe('savePlatformSettings', () => {
    it('writes settings and preserves existing fields', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE);
      mockReadFileSync.mockReturnValue(JSON.stringify({ custom: 'field' }));

      service.savePlatformSettings({ os: 'linux', arch: 'amd64' });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        SETTINGS_FILE,
        expect.stringContaining('"custom"'),
      );
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.platform).toEqual({ os: 'linux', arch: 'amd64' });
      expect(written.custom).toBe('field');
    });

    it('throws for invalid OS/arch combo (darwin/386)', () => {
      expect(() =>
        service.savePlatformSettings({ os: 'darwin', arch: '386' }),
      ).toThrow('Invalid platform combination: darwin/386');
    });

    it('creates settings dir if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      service.savePlatformSettings({ os: 'windows', arch: 'amd64' });

      expect(mockMkdirSync).toHaveBeenCalledWith(SETTINGS_DIR, { recursive: true });
    });
  });

  // ── Group 2: Encryption ────────────────────────────────────

  describe('encryption', () => {
    it('throws when ENCRYPTION_SECRET is less than 16 chars', async () => {
      process.env.ENCRYPTION_SECRET = 'short';

      // generateCertificate calls encrypt() → getEncryptionKey() which throws.
      // getCertificatePassword swallows the error, so we test through generate.
      setupOpenSSLSuccess();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      await expect(
        service.generateCertificate({ commonName: 'Test', organization: 'Org', country: 'US' }),
      ).rejects.toThrow('ENCRYPTION_SECRET must be at least 16 characters');
    });

    it('throws when ENCRYPTION_SECRET is not set', async () => {
      delete process.env.ENCRYPTION_SECRET;

      setupOpenSSLSuccess();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      await expect(service.generateCertificate(
        { commonName: 'Test', organization: 'Org', country: 'US' },
      )).rejects.toThrow('ENCRYPTION_SECRET environment variable is required');
    });

    it('encrypt then decrypt round-trip returns original text', async () => {
      setupOpenSSLSuccess();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      let writtenMeta: string | null = null;
      let writtenDirName: string | null = null;
      mockWriteFileSync.mockImplementation((p: string, data: unknown) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) {
          writtenMeta = data as string;
          writtenDirName = p.split('/').slice(-2, -1)[0];
        }
      });

      await service.generateCertificate(
        { commonName: 'Test', organization: 'Org', country: 'US' },
      );

      expect(writtenMeta).not.toBeNull();
      const meta = JSON.parse(writtenMeta!);
      expect(meta.password).toMatch(/^enc:/);

      // Now read it back
      const certDir = writtenDirName!;
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certDir) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return writtenMeta!;
        return '';
      });

      const password = service.getCertificatePassword(certDir);
      expect(password).toBe('c3VwZXJzZWNyZXRwYXNzd29yZA==');
    });

    it('getCertificatePassword returns null on decryption failure', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ password: 'enc:invalidhex:badtag:badhex' });

      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const password = service.getCertificatePassword(certId);
      expect(password).toBeNull();
    });

    it('getCertificatePassword returns plain text when not enc: prefixed', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ password: 'plaintext-password' });

      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const password = service.getCertificatePassword(certId);
      expect(password).toBe('plaintext-password');
    });
  });

  // ── Group 3: Certificate Listing ───────────────────────────

  describe('listCertificates', () => {
    it('returns certs from subdirectories matching cert-\\d+', () => {
      const meta = makeMetadata();
      mockReaddirSync.mockReturnValue(['cert-1700000000000', 'cert-1700000001000', 'not-a-cert']);
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json') && !p.includes('not-a-cert')) return true;
        if (p === CERTS_DIR) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        // No legacy meta
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const result = service.listCertificates();

      expect(result.certificates).toHaveLength(2);
    });

    it('skips dirs without cert-meta.json', () => {
      mockReaddirSync.mockReturnValue(['cert-1700000000000']);
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return false;
        if (p === CERTS_DIR) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });

      const result = service.listCertificates();

      expect(result.certificates).toHaveLength(0);
    });

    it('returns empty list when no certs dir contents', () => {
      mockReaddirSync.mockReturnValue([]);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        return false;
      });

      const result = service.listCertificates();

      expect(result.certificates).toHaveLength(0);
      expect(result.activeCertId).toBeNull();
    });

    it('includes activeCertId when active cert is set', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockReaddirSync.mockReturnValue([certId]);
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        if (p === CERTS_DIR) return true;
        if (p === ACTIVE_CERT_FILE) return true;
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const result = service.listCertificates();

      expect(result.activeCertId).toBe(certId);
    });
  });

  // ── Group 4: getCertificateInfo ────────────────────────────

  describe('getCertificateInfo', () => {
    it('returns info for a specific cert ID', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const info = service.getCertificateInfo(certId);

      expect(info.exists).toBe(true);
      expect(info.id).toBe(certId);
      expect(info.label).toBe('Test Cert');
      expect(info.source).toBe('generated');
      expect(info.subject).toEqual({ commonName: 'Test CN', organization: 'Test Org', country: 'US' });
    });

    it('returns exists: false when no certs and no active cert', () => {
      mockExistsSync.mockReturnValue(false);

      const info = service.getCertificateInfo();

      expect(info.exists).toBe(false);
      expect(info.id).toBe('');
    });

    it('returns exists: false when metadata file is missing', () => {
      mockExistsSync.mockReturnValue(false);

      const info = service.getCertificateInfo('cert-1700000000000');

      expect(info.exists).toBe(false);
      expect(info.id).toBe('cert-1700000000000');
    });
  });

  // ── Group 5: Active Certificate ────────────────────────────

  describe('getActiveCertificateId', () => {
    it('reads active ID from active-cert.txt', () => {
      const certId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        return '';
      });

      expect(service.getActiveCertificateId()).toBe(certId);
    });

    it('returns null when active-cert.txt is missing', () => {
      mockExistsSync.mockReturnValue(false);

      expect(service.getActiveCertificateId()).toBeNull();
    });

    it('auto-cleans stale ID when cert dir was deleted', () => {
      const staleId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return staleId;
        return '';
      });

      const result = service.getActiveCertificateId();

      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalledWith(ACTIVE_CERT_FILE);
    });
  });

  describe('setActiveCertificateId', () => {
    it('writes cert ID to active-cert.txt', () => {
      const certId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });

      service.setActiveCertificateId(certId);

      expect(mockWriteFileSync).toHaveBeenCalledWith(ACTIVE_CERT_FILE, certId);
    });

    it('throws for invalid ID format', () => {
      expect(() => service.setActiveCertificateId('bad-id')).toThrow('Invalid certificate ID format');
    });

    it('throws for nonexistent cert directory', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => service.setActiveCertificateId('cert-1700000000000')).toThrow('Certificate not found');
    });
  });

  // ── Group 6: Generate Certificate ──────────────────────────

  describe('generateCertificate', () => {
    const validSubject = { commonName: 'Test Cert', organization: 'ACME Corp', country: 'US' };

    beforeEach(() => {
      setupOpenSSLSuccess();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);
    });

    it('creates all expected files on success', async () => {
      const result = await service.generateCertificate(validSubject, 'My Cert');

      expect(result.exists).toBe(true);
      expect(result.source).toBe('generated');
      expect(result.label).toBe('My Cert');
      expect(result.fingerprint).toBe('AA:BB:CC:DD:EE:FF');

      const metaWriteCall = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert-meta.json'),
      );
      expect(metaWriteCall).toBeDefined();

      // cert.cer.b64 should be written
      const b64WriteCall = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert.cer.b64'),
      );
      expect(b64WriteCall).toBeDefined();

      // Intermediate files (key.pem, cert.crt) should be deleted
      const unlinkCalls = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(unlinkCalls).toEqual(
        expect.arrayContaining([
          expect.stringContaining('key.pem'),
          expect.stringContaining('cert.crt'),
        ]),
      );
    });

    it('validates subject characters — rejects shell injection in commonName', async () => {
      await expect(
        service.generateCertificate(
          { commonName: 'Test; rm -rf /', organization: 'Org', country: 'US' },
        ),
      ).rejects.toThrow('commonName contains invalid characters');
    });

    it('validates organization characters', async () => {
      await expect(
        service.generateCertificate(
          { commonName: 'Test', organization: '$(evil)', country: 'US' },
        ),
      ).rejects.toThrow('organization contains invalid characters');
    });

    it('validates country characters', async () => {
      await expect(
        service.generateCertificate(
          { commonName: 'Test', organization: 'Org', country: 'U`S' },
        ),
      ).rejects.toThrow('country contains invalid characters');
    });

    it('enforces max 5 certificates limit', async () => {
      mockReaddirSync.mockReturnValue([
        'cert-1', 'cert-2', 'cert-3', 'cert-4', 'cert-5',
      ]);
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return true;
        if (p === CERTS_DIR) return true;
        return false;
      });

      await expect(
        service.generateCertificate(validSubject),
      ).rejects.toThrow('Maximum of 5 certificates reached');
    });

    it('auto-activates when no active cert exists', async () => {
      await service.generateCertificate(validSubject);

      const activeWriteCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_FILE,
      );
      expect(activeWriteCall).toBeDefined();
      expect(activeWriteCall![1]).toMatch(/^cert-\d+$/);
    });

    it('skips auto-activation when active cert already set', async () => {
      const existingActive = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(existingActive) && p.endsWith('cert-meta.json')) return true;
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return existingActive;
        return '';
      });

      await service.generateCertificate(validSubject);

      const activeWriteCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_FILE,
      );
      expect(activeWriteCall).toBeUndefined();
    });

    it('stores encrypted password with enc: prefix', async () => {
      await service.generateCertificate(validSubject);

      const metaWriteCall = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert-meta.json'),
      );
      const meta = JSON.parse(metaWriteCall![1] as string);
      expect(meta.password).toMatch(/^enc:/);
    });

    it('cleans up directory on OpenSSL failure', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('OpenSSL failed'));

      await expect(
        service.generateCertificate(validSubject),
      ).rejects.toThrow('OpenSSL failed');

      expect(mockRmSync).toHaveBeenCalledWith(
        expect.stringMatching(/cert-\d+$/),
        { recursive: true, force: true },
      );
    });

    it('generates unique cert-timestamp directory name', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      await service.generateCertificate(validSubject);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(`cert-${now}`),
        { recursive: true },
      );

      vi.restoreAllMocks();
    });

    it('cleans up temp pass file after PFX creation', async () => {
      await service.generateCertificate(validSubject);

      const unlinkCall = mockUnlinkSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('.tmp-pass'),
      );
      expect(unlinkCall).toBeDefined();
    });
  });

  // ── Group 7: Upload Certificate ────────────────────────────

  describe('uploadCertificate', () => {
    const pfxBuffer = Buffer.from('fake-pfx-data');
    const password = 'test-password';

    beforeEach(() => {
      setupOpenSSLSuccess();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (typeof p === 'string' && p.endsWith('.tmp-pass')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        if (p === `${CERTS_DIR}/cert-meta.json`) return false;
        return false;
      });
      mockReaddirSync.mockReturnValue([]);
    });

    it('saves PFX and writes metadata on success', async () => {
      const result = await service.uploadCertificate(pfxBuffer, password, 'Uploaded Cert');

      expect(result.exists).toBe(true);
      expect(result.source).toBe('uploaded');
      expect(result.label).toBe('Uploaded Cert');

      const pfxWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert.pfx'),
      );
      expect(pfxWrite).toBeDefined();
      expect(pfxWrite![1]).toBe(pfxBuffer);
    });

    it('enforces max 5 certificates limit', async () => {
      mockReaddirSync.mockReturnValue([
        'cert-1', 'cert-2', 'cert-3', 'cert-4', 'cert-5',
      ]);
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return true;
        if (p === CERTS_DIR) return true;
        return false;
      });

      await expect(
        service.uploadCertificate(pfxBuffer, password),
      ).rejects.toThrow('Maximum of 5 certificates reached');
    });

    it('extracts subject (CN, O, C) from OpenSSL output', async () => {
      const result = await service.uploadCertificate(pfxBuffer, password);

      expect(result.subject).toEqual({
        commonName: 'Test CN',
        organization: 'Test Org',
        country: 'US',
      });
    });

    it('cleans up directory on failure', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('Bad PFX'));

      await expect(
        service.uploadCertificate(pfxBuffer, password),
      ).rejects.toThrow('Bad PFX');

      expect(mockRmSync).toHaveBeenCalledWith(
        expect.stringMatching(/cert-\d+$/),
        { recursive: true, force: true },
      );
    });

    it('auto-activates when no active cert exists', async () => {
      await service.uploadCertificate(pfxBuffer, password);

      const activeWriteCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_FILE,
      );
      expect(activeWriteCall).toBeDefined();
    });
  });

  // ── Group 8: Certificate Operations ────────────────────────

  describe('updateCertificateLabel', () => {
    it('updates label in metadata JSON', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId, label: 'Old Label' });

      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const result = service.updateCertificateLabel(certId, 'New Label');

      expect(result.label).toBe('New Label');
      const writeCall = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert-meta.json'),
      );
      const written = JSON.parse(writeCall![1] as string);
      expect(written.label).toBe('New Label');
    });

    it('throws for invalid certificate ID format', () => {
      expect(() => service.updateCertificateLabel('bad-format', 'Label')).toThrow(
        'Invalid certificate ID format',
      );
    });

    it('throws when cert not found', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() => service.updateCertificateLabel('cert-1700000000000', 'Label')).toThrow(
        'Certificate not found',
      );
    });
  });

  describe('deleteCertificate', () => {
    it('removes cert directory via rmSync', () => {
      const certId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith(certId) && !p.endsWith('cert-meta.json')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });

      service.deleteCertificate(certId);

      expect(mockRmSync).toHaveBeenCalledWith(
        expect.stringContaining(certId),
        { recursive: true, force: true },
      );
    });

    it('clears active-cert.txt when deleting active cert', () => {
      const certId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith(certId)) return true;
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        return '';
      });

      service.deleteCertificate(certId);

      expect(mockUnlinkSync).toHaveBeenCalledWith(ACTIVE_CERT_FILE);
    });

    it('does not clear active-cert.txt when deleting non-active cert', () => {
      const certId = 'cert-1700000000000';
      const activeId = 'cert-9999999999999';
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith(certId)) return true;
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(activeId) && p.endsWith('cert-meta.json')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return activeId;
        return '';
      });

      service.deleteCertificate(certId);

      const activeCertUnlink = mockUnlinkSync.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_FILE,
      );
      expect(activeCertUnlink).toBeUndefined();
    });

    it('throws for invalid ID format', () => {
      expect(() => service.deleteCertificate('not-valid')).toThrow('Invalid certificate ID format');
    });

    it('deletes legacy flat files when no id provided', () => {
      mockExistsSync.mockReturnValue(true);

      service.deleteCertificate();

      const deletedFiles = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(deletedFiles).toEqual(
        expect.arrayContaining([
          expect.stringContaining('key.pem'),
          expect.stringContaining('cert.crt'),
          expect.stringContaining('cert.pfx'),
          expect.stringContaining('cert.cer'),
          expect.stringContaining('cert.cer.b64'),
          expect.stringContaining('cert-meta.json'),
        ]),
      );
    });
  });

  // ── Group 9: Legacy Migration ──────────────────────────────

  describe('legacy migration (via listCertificates)', () => {
    it('migrates flat files to cert-timestamp/ subdir and sets active', () => {
      const now = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      // readdirSync: initially no cert-* subdirs (migration creates one)
      mockReaddirSync.mockReturnValue([]);

      const legacyMeta = JSON.stringify({ label: 'Legacy', source: 'generated' });

      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (p === `${CERTS_DIR}/cert-meta.json`) return true;
        if (p === `${CERTS_DIR}/key.pem`) return true;
        if (p === `${CERTS_DIR}/cert.crt`) return true;
        if (p === `${CERTS_DIR}/cert.pfx`) return true;
        if (p === `${CERTS_DIR}/cert.cer`) return true;
        if (p === `${CERTS_DIR}/cert.cer.b64`) return true;
        if (typeof p === 'string' && p.includes(`cert-${now}`) && p.endsWith('cert-meta.json')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });

      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return legacyMeta;
        return '';
      });

      service.listCertificates();

      // Should have renamed files
      expect(mockRenameSync).toHaveBeenCalled();
      const renames = mockRenameSync.mock.calls.map((c) => [c[0], c[1]]);
      expect(renames).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            `${CERTS_DIR}/cert-meta.json`,
            expect.stringContaining(`cert-${now}/cert-meta.json`),
          ]),
        ]),
      );

      // Should write active-cert.txt
      const activeWrite = mockWriteFileSync.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_FILE,
      );
      expect(activeWrite).toBeDefined();
      expect(activeWrite![1]).toBe(`cert-${now}`);

      // Should patch metadata with id and source
      const metaWrite = mockWriteFileSync.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('cert-meta.json'),
      );
      expect(metaWrite).toBeDefined();
      const patched = JSON.parse(metaWrite![1] as string);
      expect(patched.id).toBe(`cert-${now}`);
      expect(patched.source).toBe('generated');

      vi.restoreAllMocks();
    });

    it('removes legacy file when subdirs already exist', () => {
      mockReaddirSync.mockReturnValue(['cert-1700000000000']);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        if (p === `${CERTS_DIR}/cert-meta.json`) return true;
        if (typeof p === 'string' && p.includes('cert-1700000000000') && p.endsWith('cert-meta.json')) return true;
        if (p === ACTIVE_CERT_FILE) return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) {
          return JSON.stringify(makeMetadata());
        }
        return '';
      });

      service.listCertificates();

      expect(mockUnlinkSync).toHaveBeenCalledWith(`${CERTS_DIR}/cert-meta.json`);
      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it('no-ops when no legacy file exists', () => {
      mockReaddirSync.mockReturnValue([]);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === CERTS_DIR) return true;
        return false;
      });

      service.listCertificates();

      expect(mockRenameSync).not.toHaveBeenCalled();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  // ── Group 10: getActiveCertPfxPath ─────────────────────────

  describe('getActiveCertPfxPath', () => {
    it('returns pfx path and password for active cert', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId, password: 'plaintext-pass' });

      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert.pfx')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      const result = service.getActiveCertPfxPath();

      expect(result).not.toBeNull();
      expect(result!.pfxPath).toContain('cert.pfx');
      expect(result!.password).toBe('plaintext-pass');
    });

    it('returns null when no active cert', () => {
      mockExistsSync.mockReturnValue(false);

      expect(service.getActiveCertPfxPath()).toBeNull();
    });

    it('returns null when pfx file missing', () => {
      const certId = 'cert-1700000000000';
      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        if (typeof p === 'string' && p.endsWith('cert.pfx')) return false;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        return '';
      });

      expect(service.getActiveCertPfxPath()).toBeNull();
    });

    it('returns null when password is unavailable', () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId, password: 'enc:bad:bad:bad' });

      mockExistsSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert-meta.json')) return true;
        if (typeof p === 'string' && p.includes(certId) && p.endsWith('cert.pfx')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === ACTIVE_CERT_FILE) return certId;
        if (typeof p === 'string' && p.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return '';
      });

      expect(service.getActiveCertPfxPath()).toBeNull();
    });
  });
});
