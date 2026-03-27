import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────
// Must be before dynamic import of the service under test.

const mockBlobReadText = vi.fn<(key: string) => Promise<string | null>>();
const mockBlobWrite = vi.fn<(key: string, data: string | Buffer) => Promise<string>>();

vi.mock('../../storage.js', () => ({
  blobReadText: mockBlobReadText,
  blobWrite: mockBlobWrite,
  blobRead: vi.fn().mockResolvedValue(null),
  blobDelete: vi.fn().mockResolvedValue(undefined),
  blobList: vi.fn().mockResolvedValue([]),
  blobUrl: vi.fn().mockResolvedValue(null),
  blobHead: vi.fn().mockResolvedValue(null),
  blobExists: vi.fn().mockResolvedValue(false),
}));

// Do NOT mock crypto — let real AES-256-GCM run for round-trip tests

const { SettingsService } = await import('../settings.js');

// ── Helpers ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'settings/analytics.json';

// ── Tests ────────────────────────────────────────────────────────────

describe('SettingsService (analytics)', () => {
  let service: InstanceType<typeof SettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    service = new SettingsService();
    mockBlobReadText.mockResolvedValue(null);
    mockBlobWrite.mockResolvedValue('https://blob.example.com/mock');
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
    delete process.env.ELASTICSEARCH_CLOUD_ID;
    delete process.env.ELASTICSEARCH_NODE;
    delete process.env.ELASTICSEARCH_API_KEY;
    delete process.env.ELASTICSEARCH_USERNAME;
    delete process.env.ELASTICSEARCH_PASSWORD;
    delete process.env.ELASTICSEARCH_INDEX_PATTERN;
  });

  // ── Group 1: Encryption Internals ─────────────────────────

  describe('encryption internals', () => {
    it('encrypt -> decrypt round-trip returns original text (real crypto)', async () => {
      // Exercise encrypt/decrypt through saveSettings -> getSettings round-trip
      const settings = {
        connectionType: 'cloud' as const,
        cloudId: 'my-cloud-id-12345',
        apiKey: 'super-secret-api-key',
        indexPattern: 'achilles-results-*',
        configured: true,
      };

      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings(settings);

      // Now read it back
      mockBlobReadText.mockResolvedValue(writtenData);

      const loaded = await service.getSettings();

      expect(loaded.cloudId).toBe('my-cloud-id-12345');
      expect(loaded.apiKey).toBe('super-secret-api-key');
    });

    it('encrypted values have enc: prefix', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'some-cloud-id',
        apiKey: 'some-api-key',
        password: 'some-password',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      const saved = JSON.parse(writtenData);
      expect(saved.cloudId).toMatch(/^enc:/);
      expect(saved.apiKey).toMatch(/^enc:/);
      expect(saved.password).toMatch(/^enc:/);
    });

    it('decrypt returns raw value if no enc: prefix (backwards compat)', async () => {
      // File has unencrypted values (pre-encryption migration)
      const rawSettings = JSON.stringify({
        connectionType: 'cloud',
        cloudId: 'plain-cloud-id',
        apiKey: 'plain-api-key',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      mockBlobReadText.mockResolvedValue(rawSettings);

      const loaded = await service.getSettings();

      expect(loaded.cloudId).toBe('plain-cloud-id');
      expect(loaded.apiKey).toBe('plain-api-key');
    });

    it('throws when ENCRYPTION_SECRET < 16 chars', async () => {
      process.env.ENCRYPTION_SECRET = 'short';

      await expect(
        service.saveSettings({
          connectionType: 'cloud',
          cloudId: 'test',
          indexPattern: 'achilles-results-*',
          configured: true,
        }),
      ).rejects.toThrow('ENCRYPTION_SECRET must be at least 32 characters');
    });

    it('throws when ENCRYPTION_SECRET not set', async () => {
      delete process.env.ENCRYPTION_SECRET;

      await expect(
        service.saveSettings({
          connectionType: 'cloud',
          cloudId: 'test-cloud',
          indexPattern: 'achilles-results-*',
          configured: true,
        }),
      ).rejects.toThrow('ENCRYPTION_SECRET environment variable is required');
    });
  });

  // ── Group 2: getSettings — Environment Variables ──────────

  describe('getSettings — environment variables', () => {
    it('returns env var config when no file exists', async () => {
      process.env.ELASTICSEARCH_CLOUD_ID = 'my-cloud:dXMtY2VudHJhbDE=';
      process.env.ELASTICSEARCH_API_KEY = 'api-key-123';

      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();

      expect(settings.configured).toBe(true);
      expect(settings.connectionType).toBe('cloud');
      expect(settings.cloudId).toBe('my-cloud:dXMtY2VudHJhbDE=');
      expect(settings.apiKey).toBe('api-key-123');
    });

    it('detects connectionType cloud when ELASTICSEARCH_CLOUD_ID is set', async () => {
      process.env.ELASTICSEARCH_CLOUD_ID = 'cloud-id';

      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();
      expect(settings.connectionType).toBe('cloud');
    });

    it('detects connectionType direct when only ELASTICSEARCH_NODE is set', async () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';

      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();
      expect(settings.connectionType).toBe('direct');
      expect(settings.node).toBe('http://localhost:9200');
    });

    it('returns configured: false when no env vars and no file', async () => {
      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();

      expect(settings.configured).toBe(false);
    });

    it('returns default indexPattern when not specified', async () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';

      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();
      expect(settings.indexPattern).toBe('achilles-results-*');
    });

    it('reads custom index pattern from env', async () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';
      process.env.ELASTICSEARCH_INDEX_PATTERN = 'custom-index-*';

      mockBlobReadText.mockResolvedValue(null);

      const settings = await service.getSettings();
      expect(settings.indexPattern).toBe('custom-index-*');
    });
  });

  // ── Group 3: getSettings — Blob Config ────────────────────

  describe('getSettings — blob config', () => {
    it('reads and decrypts settings from blob', async () => {
      // Save first to get properly encrypted data
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'test-cloud-id',
        apiKey: 'test-api-key',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      // Now read it back
      mockBlobReadText.mockResolvedValue(writtenData);

      const loaded = await service.getSettings();

      expect(loaded.configured).toBe(true);
      expect(loaded.cloudId).toBe('test-cloud-id');
      expect(loaded.apiKey).toBe('test-api-key');
    });

    it('blob settings override env vars (precedence)', async () => {
      process.env.ELASTICSEARCH_CLOUD_ID = 'env-cloud-id';
      process.env.ELASTICSEARCH_API_KEY = 'env-api-key';

      // Save blob settings
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'file-cloud-id',
        apiKey: 'file-api-key',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      mockBlobReadText.mockResolvedValue(writtenData);

      const loaded = await service.getSettings();

      expect(loaded.cloudId).toBe('file-cloud-id');
      expect(loaded.apiKey).toBe('file-api-key');
    });

    it('handles corrupt JSON gracefully (falls back to env/defaults)', async () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';

      mockBlobReadText.mockResolvedValue('not-valid-json{{{');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const settings = await service.getSettings();

      // Falls back to env settings
      expect(settings.connectionType).toBe('direct');
      expect(settings.node).toBe('http://localhost:9200');

      errorSpy.mockRestore();
    });

    it('handles corrupt JSON with no env vars (falls to defaults)', async () => {
      mockBlobReadText.mockResolvedValue('not-valid-json');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const settings = await service.getSettings();

      expect(settings.configured).toBe(false);
      expect(settings.indexPattern).toBe('achilles-results-*');

      errorSpy.mockRestore();
    });

    it('decrypts enc:-prefixed password field', async () => {
      // Save with password
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'direct',
        node: 'http://localhost:9200',
        username: 'elastic',
        password: 'secret-pass',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      mockBlobReadText.mockResolvedValue(writtenData);

      const loaded = await service.getSettings();

      expect(loaded.password).toBe('secret-pass');
    });
  });

  // ── Group 4: saveSettings ─────────────────────────────────

  describe('saveSettings', () => {
    it('writes encrypted settings to blob', async () => {
      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'my-cloud',
        apiKey: 'my-key',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      expect(mockBlobWrite).toHaveBeenCalledWith(
        SETTINGS_KEY,
        expect.any(String),
      );
    });

    it('encrypts cloudId, apiKey, and password fields', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'plain-cloud',
        apiKey: 'plain-key',
        password: 'plain-pass',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      const saved = JSON.parse(writtenData);
      expect(saved.cloudId).toMatch(/^enc:/);
      expect(saved.apiKey).toMatch(/^enc:/);
      expect(saved.password).toMatch(/^enc:/);
    });

    it('preserves non-sensitive fields unencrypted', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'direct',
        node: 'http://localhost:9200',
        indexPattern: 'custom-*',
        configured: true,
      });

      const saved = JSON.parse(writtenData);
      expect(saved.connectionType).toBe('direct');
      expect(saved.node).toBe('http://localhost:9200');
      expect(saved.indexPattern).toBe('custom-*');
      expect(saved.configured).toBe(true);
    });

    it('does not encrypt empty/undefined sensitive fields', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'direct',
        node: 'http://localhost:9200',
        cloudId: '',
        apiKey: '',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      const saved = JSON.parse(writtenData);
      // Empty strings should not be encrypted (empty is falsy)
      expect(saved.cloudId).toBe('');
      expect(saved.apiKey).toBe('');
    });
  });

  // ── Group 5: isConfigured + isEnvConfigured ───────────────

  describe('isConfigured', () => {
    it('returns true with valid cloud config from blob', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'cloud-id-here',
        apiKey: 'api-key-here',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      mockBlobReadText.mockResolvedValue(writtenData);

      expect(await service.isConfigured()).toBe(true);
    });

    it('returns true with valid env vars (direct connection)', async () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';

      mockBlobReadText.mockResolvedValue(null);

      expect(await service.isConfigured()).toBe(true);
    });

    it('returns false when not configured at all', async () => {
      mockBlobReadText.mockResolvedValue(null);

      expect(await service.isConfigured()).toBe(false);
    });

    it('returns false when cloud config missing apiKey', async () => {
      let writtenData = '';
      mockBlobWrite.mockImplementation(async (_key: string, data: string | Buffer) => {
        writtenData = data as string;
        return 'https://blob.example.com/mock';
      });

      await service.saveSettings({
        connectionType: 'cloud',
        cloudId: 'cloud-id',
        apiKey: '',
        indexPattern: 'achilles-results-*',
        configured: true,
      });

      mockBlobReadText.mockResolvedValue(writtenData);

      expect(await service.isConfigured()).toBe(false);
    });
  });

  describe('isEnvConfigured', () => {
    it('returns true when ELASTICSEARCH_CLOUD_ID is set', () => {
      process.env.ELASTICSEARCH_CLOUD_ID = 'cloud-id';

      expect(service.isEnvConfigured()).toBe(true);
    });

    it('returns true when ELASTICSEARCH_NODE is set', () => {
      process.env.ELASTICSEARCH_NODE = 'http://localhost:9200';

      expect(service.isEnvConfigured()).toBe(true);
    });

    it('returns false when no ES env vars are set', () => {
      expect(service.isEnvConfigured()).toBe(false);
    });
  });
});
