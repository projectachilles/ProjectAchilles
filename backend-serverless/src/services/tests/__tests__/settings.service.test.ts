import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────
// Must be before dynamic import of the service under test.

const mockBlobReadText = vi.fn<(key: string) => Promise<string | null>>();
const mockBlobWrite = vi.fn<(key: string, data: string | Buffer) => Promise<string>>();
const mockBlobDelete = vi.fn<(key: string) => Promise<void>>();
const mockBlobList = vi.fn<(prefix: string) => Promise<{ key: string; url: string; size: number }[]>>();
const mockBlobUrl = vi.fn<(key: string) => Promise<string | null>>();

vi.mock('../../storage.js', () => ({
  blobReadText: mockBlobReadText,
  blobWrite: mockBlobWrite,
  blobDelete: mockBlobDelete,
  blobList: mockBlobList,
  blobUrl: mockBlobUrl,
  blobRead: vi.fn().mockResolvedValue(null),
  blobHead: vi.fn().mockResolvedValue(null),
  blobExists: vi.fn().mockResolvedValue(false),
}));

const { TestsSettingsService } = await import('../settings.js');

// ── Helpers ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'settings/tests.json';
const ACTIVE_CERT_KEY = 'certs/active-cert.txt';

function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1700000000000',
    label: 'Test Cert',
    source: 'uploaded',
    subject: { commonName: 'Test CN', organization: 'Test Org', country: 'US' },
    password: 'enc:aabbcc:ddeeff:112233',
    createdAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '',
    fingerprint: 'AA:BB:CC:DD',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TestsSettingsService', () => {
  let service: InstanceType<typeof TestsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-1234';
    service = new TestsSettingsService();
    // Defaults: no blobs exist
    mockBlobReadText.mockResolvedValue(null);
    mockBlobWrite.mockResolvedValue('https://blob.example.com/mock');
    mockBlobDelete.mockResolvedValue(undefined);
    mockBlobList.mockResolvedValue([]);
    mockBlobUrl.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  // ── Group 1: Platform Settings ─────────────────────────────

  describe('getPlatformSettings', () => {
    it('returns defaults when settings blob is missing', async () => {
      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('reads stored settings from blob', async () => {
      mockBlobReadText.mockResolvedValue(
        JSON.stringify({ platform: { os: 'linux', arch: 'arm64' } }),
      );

      const settings = await service.getPlatformSettings();

      expect(settings).toEqual({ os: 'linux', arch: 'arm64' });
    });

    it('handles corrupt JSON gracefully', async () => {
      mockBlobReadText.mockResolvedValue('not-valid-json{{{');

      const settings = await service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('returns defaults when platform key is absent', async () => {
      mockBlobReadText.mockResolvedValue(JSON.stringify({ otherKey: true }));

      const settings = await service.getPlatformSettings();

      expect(settings).toEqual({ os: 'windows', arch: 'amd64' });
    });
  });

  describe('savePlatformSettings', () => {
    it('writes settings and preserves existing fields', async () => {
      mockBlobReadText.mockResolvedValue(JSON.stringify({ custom: 'field' }));

      await service.savePlatformSettings({ os: 'linux', arch: 'amd64' });

      expect(mockBlobWrite).toHaveBeenCalledWith(
        SETTINGS_KEY,
        expect.stringContaining('"custom"'),
      );
      const written = JSON.parse(mockBlobWrite.mock.calls[0][1] as string);
      expect(written.platform).toEqual({ os: 'linux', arch: 'amd64' });
      expect(written.custom).toBe('field');
    });

    it('throws for invalid OS/arch combo (darwin/386)', async () => {
      await expect(
        service.savePlatformSettings({ os: 'darwin', arch: '386' }),
      ).rejects.toThrow('Invalid platform combination: darwin/386');
    });
  });

  // ── Group 2: Encryption ────────────────────────────────────

  describe('encryption', () => {
    it('throws when ENCRYPTION_SECRET is less than 16 chars', async () => {
      process.env.ENCRYPTION_SECRET = 'short';

      // uploadCertificate calls encrypt() which calls getEncryptionKey() which throws
      await expect(
        service.uploadCertificate(Buffer.from('fake-pfx'), 'password'),
      ).rejects.toThrow('ENCRYPTION_SECRET must be at least 16 characters');
    });

    it('throws when ENCRYPTION_SECRET is not set', async () => {
      delete process.env.ENCRYPTION_SECRET;

      await expect(
        service.uploadCertificate(Buffer.from('fake-pfx'), 'password'),
      ).rejects.toThrow('ENCRYPTION_SECRET environment variable is required');
    });

    it('encrypt then decrypt round-trip returns original text', async () => {
      // Upload a cert to exercise encrypt, then read password to exercise decrypt
      const pfxBuffer = Buffer.from('fake-pfx-data');
      const password = 'my-secret-password';

      let writtenMeta: string | null = null;
      mockBlobWrite.mockImplementation(async (key: string, data: string | Buffer) => {
        if (key.endsWith('cert-meta.json')) {
          writtenMeta = data as string;
        }
        return 'https://blob.example.com/mock';
      });

      await service.uploadCertificate(pfxBuffer, password);

      expect(writtenMeta).not.toBeNull();
      const meta = JSON.parse(writtenMeta!);
      expect(meta.password).toMatch(/^enc:/);

      // Now read the password back
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return writtenMeta;
        return null;
      });

      const decrypted = await service.getCertificatePassword(meta.id);
      expect(decrypted).toBe('my-secret-password');
    });

    it('getCertificatePassword returns null on decryption failure', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ password: 'enc:invalidhex:badtag:badhex' });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const password = await service.getCertificatePassword(certId);
      expect(password).toBeNull();
    });

    it('getCertificatePassword returns plain text when not enc: prefixed', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ password: 'plaintext-password' });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const password = await service.getCertificatePassword(certId);
      expect(password).toBe('plaintext-password');
    });
  });

  // ── Group 3: Certificate Listing ───────────────────────────

  describe('listCertificates', () => {
    it('returns certs from blob subdirectories matching cert-\\d+', async () => {
      const meta = makeMetadata();
      mockBlobList.mockResolvedValue([
        { key: 'certs/cert-1700000000000/cert-meta.json', url: 'https://blob.example.com/1', size: 100 },
        { key: 'certs/cert-1700000000000/cert.pfx', url: 'https://blob.example.com/2', size: 2000 },
        { key: 'certs/cert-1700000001000/cert-meta.json', url: 'https://blob.example.com/3', size: 100 },
        { key: 'certs/cert-1700000001000/cert.pfx', url: 'https://blob.example.com/4', size: 2000 },
      ]);
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const result = await service.listCertificates();

      expect(result.certificates).toHaveLength(2);
    });

    it('skips dirs without cert-meta.json', async () => {
      mockBlobList.mockResolvedValue([
        { key: 'certs/cert-1700000000000/cert.pfx', url: 'https://blob.example.com/1', size: 2000 },
      ]);
      mockBlobReadText.mockResolvedValue(null);

      const result = await service.listCertificates();

      expect(result.certificates).toHaveLength(0);
    });

    it('returns empty list when no certs exist', async () => {
      mockBlobList.mockResolvedValue([]);

      const result = await service.listCertificates();

      expect(result.certificates).toHaveLength(0);
      expect(result.activeCertId).toBeNull();
    });

    it('includes activeCertId when active cert is set', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockBlobList.mockResolvedValue([
        { key: `certs/${certId}/cert-meta.json`, url: 'https://blob.example.com/1', size: 100 },
      ]);
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key === ACTIVE_CERT_KEY) return certId;
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const result = await service.listCertificates();

      expect(result.activeCertId).toBe(certId);
    });
  });

  // ── Group 4: getCertificateInfo ────────────────────────────

  describe('getCertificateInfo', () => {
    it('returns info for a specific cert ID', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const info = await service.getCertificateInfo(certId);

      expect(info.exists).toBe(true);
      expect(info.id).toBe(certId);
      expect(info.label).toBe('Test Cert');
      expect(info.source).toBe('uploaded');
      expect(info.subject).toEqual({ commonName: 'Test CN', organization: 'Test Org', country: 'US' });
    });

    it('returns exists: false when no certs and no active cert', async () => {
      mockBlobReadText.mockResolvedValue(null);

      const info = await service.getCertificateInfo();

      expect(info.exists).toBe(false);
      expect(info.id).toBe('');
    });

    it('returns exists: false when metadata is missing', async () => {
      mockBlobReadText.mockResolvedValue(null);

      const info = await service.getCertificateInfo('cert-1700000000000');

      expect(info.exists).toBe(false);
      expect(info.id).toBe('cert-1700000000000');
    });
  });

  // ── Group 5: Active Certificate ────────────────────────────

  describe('getActiveCertificateId', () => {
    it('reads active ID from blob', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key === ACTIVE_CERT_KEY) return certId;
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      expect(await service.getActiveCertificateId()).toBe(certId);
    });

    it('returns null when active-cert blob is missing', async () => {
      mockBlobReadText.mockResolvedValue(null);

      expect(await service.getActiveCertificateId()).toBeNull();
    });

    it('auto-cleans stale ID when cert metadata was deleted', async () => {
      const staleId = 'cert-1700000000000';
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key === ACTIVE_CERT_KEY) return staleId;
        // cert-meta.json is missing
        return null;
      });

      const result = await service.getActiveCertificateId();

      expect(result).toBeNull();
      expect(mockBlobDelete).toHaveBeenCalledWith(ACTIVE_CERT_KEY);
    });
  });

  describe('setActiveCertificateId', () => {
    it('writes cert ID to blob', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      await service.setActiveCertificateId(certId);

      expect(mockBlobWrite).toHaveBeenCalledWith(ACTIVE_CERT_KEY, certId);
    });

    it('throws for invalid ID format', async () => {
      await expect(service.setActiveCertificateId('bad-id')).rejects.toThrow('Invalid certificate ID format');
    });

    it('throws for nonexistent cert', async () => {
      mockBlobReadText.mockResolvedValue(null);

      await expect(service.setActiveCertificateId('cert-1700000000000')).rejects.toThrow('Certificate not found');
    });
  });

  // ── Group 6: Upload Certificate ────────────────────────────

  describe('uploadCertificate', () => {
    const pfxBuffer = Buffer.from('fake-pfx-data');
    const password = 'test-password';

    it('saves PFX and writes metadata on success', async () => {
      const result = await service.uploadCertificate(pfxBuffer, password, 'Uploaded Cert');

      expect(result.exists).toBe(true);
      expect(result.source).toBe('uploaded');
      expect(result.label).toBe('Uploaded Cert');

      // Check PFX was written
      const pfxWriteCall = mockBlobWrite.mock.calls.find(
        (call) => (call[0] as string).endsWith('cert.pfx'),
      );
      expect(pfxWriteCall).toBeDefined();
    });

    it('enforces max 5 certificates limit', async () => {
      mockBlobList.mockResolvedValue([
        { key: 'certs/cert-1/cert-meta.json', url: '', size: 0 },
        { key: 'certs/cert-2/cert-meta.json', url: '', size: 0 },
        { key: 'certs/cert-3/cert-meta.json', url: '', size: 0 },
        { key: 'certs/cert-4/cert-meta.json', url: '', size: 0 },
        { key: 'certs/cert-5/cert-meta.json', url: '', size: 0 },
      ]);

      await expect(
        service.uploadCertificate(pfxBuffer, password),
      ).rejects.toThrow('Maximum of 5 certificates reached');
    });

    it('auto-activates when no active cert exists', async () => {
      // No active cert
      mockBlobReadText.mockResolvedValue(null);

      await service.uploadCertificate(pfxBuffer, password);

      const activeWriteCall = mockBlobWrite.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_KEY,
      );
      expect(activeWriteCall).toBeDefined();
      expect(activeWriteCall![1]).toMatch(/^cert-\d+$/);
    });

    it('stores encrypted password with enc: prefix', async () => {
      let writtenMeta = '';
      mockBlobWrite.mockImplementation(async (key: string, data: string | Buffer) => {
        if (key.endsWith('cert-meta.json')) {
          writtenMeta = data as string;
        }
        return 'https://blob.example.com/mock';
      });

      await service.uploadCertificate(pfxBuffer, password);

      const meta = JSON.parse(writtenMeta);
      expect(meta.password).toMatch(/^enc:/);
    });
  });

  // ── Group 7: Certificate Operations ────────────────────────

  describe('updateCertificateLabel', () => {
    it('updates label in metadata', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId, label: 'Old Label' });

      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      const result = await service.updateCertificateLabel(certId, 'New Label');

      expect(result.label).toBe('New Label');
      const writeCall = mockBlobWrite.mock.calls.find(
        (call) => (call[0] as string).endsWith('cert-meta.json'),
      );
      const written = JSON.parse(writeCall![1] as string);
      expect(written.label).toBe('New Label');
    });

    it('throws for invalid certificate ID format', async () => {
      await expect(service.updateCertificateLabel('bad-format', 'Label')).rejects.toThrow(
        'Invalid certificate ID format',
      );
    });

    it('throws when cert not found', async () => {
      mockBlobReadText.mockResolvedValue(null);

      await expect(service.updateCertificateLabel('cert-1700000000000', 'Label')).rejects.toThrow(
        'Certificate not found',
      );
    });
  });

  describe('deleteCertificate', () => {
    it('removes all blobs in the cert directory', async () => {
      const certId = 'cert-1700000000000';
      mockBlobList.mockImplementation(async (prefix: string) => {
        if (prefix.includes(certId)) {
          return [
            { key: `certs/${certId}/cert-meta.json`, url: '', size: 100 },
            { key: `certs/${certId}/cert.pfx`, url: '', size: 2000 },
          ];
        }
        return [];
      });
      // No active cert
      mockBlobReadText.mockResolvedValue(null);

      await service.deleteCertificate(certId);

      expect(mockBlobDelete).toHaveBeenCalledWith(`certs/${certId}/cert-meta.json`);
      expect(mockBlobDelete).toHaveBeenCalledWith(`certs/${certId}/cert.pfx`);
    });

    it('clears active-cert when deleting active cert', async () => {
      const certId = 'cert-1700000000000';
      const meta = makeMetadata({ id: certId });

      mockBlobList.mockResolvedValue([
        { key: `certs/${certId}/cert-meta.json`, url: '', size: 100 },
      ]);
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key === ACTIVE_CERT_KEY) return certId;
        if (key.endsWith('cert-meta.json')) return JSON.stringify(meta);
        return null;
      });

      await service.deleteCertificate(certId);

      expect(mockBlobDelete).toHaveBeenCalledWith(ACTIVE_CERT_KEY);
    });

    it('does not clear active-cert when deleting non-active cert', async () => {
      const certId = 'cert-1700000000000';
      const activeId = 'cert-9999999999999';
      const activeMeta = makeMetadata({ id: activeId });

      mockBlobList.mockResolvedValue([
        { key: `certs/${certId}/cert-meta.json`, url: '', size: 100 },
      ]);
      mockBlobReadText.mockImplementation(async (key: string) => {
        if (key === ACTIVE_CERT_KEY) return activeId;
        if (key.includes(activeId) && key.endsWith('cert-meta.json')) return JSON.stringify(activeMeta);
        return null;
      });

      await service.deleteCertificate(certId);

      const activeCertDelete = mockBlobDelete.mock.calls.find(
        (call) => call[0] === ACTIVE_CERT_KEY,
      );
      expect(activeCertDelete).toBeUndefined();
    });

    it('throws for invalid ID format', async () => {
      await expect(service.deleteCertificate('not-valid')).rejects.toThrow('Invalid certificate ID format');
    });
  });
});
