import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
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

const { IntegrationsSettingsService } = await import('../settings.js');

const SETTINGS_DIR = '/mock-home/.projectachilles';
const SETTINGS_FILE = `${SETTINGS_DIR}/integrations.json`;

// ── Tests ────────────────────────────────────────────────────────────

describe('IntegrationsSettingsService', () => {
  let service: InstanceType<typeof IntegrationsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    service = new IntegrationsSettingsService();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    delete process.env.AZURE_TENANT_LABEL;
  });

  // ── Encryption round-trip ────────────────────────────────────

  describe('encryption', () => {
    it('encrypt → decrypt round-trip through save/load', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAzureSettings({
        tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
        client_id: '11112222-3333-4444-5555-666677778888',
        client_secret: 'super-secret-value',
        label: 'Test Tenant',
      });

      // Verify encrypted on disk
      const saved = JSON.parse(writtenData);
      expect(saved.azure.tenant_id).toMatch(/^enc:/);
      expect(saved.azure.client_id).toMatch(/^enc:/);
      expect(saved.azure.client_secret).toMatch(/^enc:/);
      expect(saved.azure.label).toBe('Test Tenant'); // label not encrypted

      // Read back
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      const loaded = service.getAzureSettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.tenant_id).toBe('aaaabbbb-cccc-dddd-eeee-ffffffffffff');
      expect(loaded!.client_id).toBe('11112222-3333-4444-5555-666677778888');
      expect(loaded!.client_secret).toBe('super-secret-value');
      expect(loaded!.label).toBe('Test Tenant');
      expect(loaded!.configured).toBe(true);
    });

    it('throws when ENCRYPTION_SECRET < 16 chars', () => {
      process.env.ENCRYPTION_SECRET = 'short';
      expect(() => service.saveAzureSettings({
        tenant_id: 'x',
        client_id: 'y',
        client_secret: 'z',
      })).toThrow('ENCRYPTION_SECRET must be at least 32 characters');
    });
  });

  // ── Environment variable override ─────────────────────────────

  describe('env var override', () => {
    it('returns env settings when file does not exist', () => {
      process.env.AZURE_TENANT_ID = 'env-tenant-id';
      process.env.AZURE_CLIENT_ID = 'env-client-id';
      process.env.AZURE_CLIENT_SECRET = 'env-secret';

      const settings = service.getAzureSettings();
      expect(settings).not.toBeNull();
      expect(settings!.tenant_id).toBe('env-tenant-id');
      expect(settings!.configured).toBe(true);
    });

    it('returns null when env vars are incomplete', () => {
      process.env.AZURE_TENANT_ID = 'env-tenant-id';
      // Missing client_id and client_secret

      const settings = service.getAzureSettings();
      expect(settings).toBeNull();
    });

    it('reads AZURE_TENANT_LABEL from env', () => {
      process.env.AZURE_TENANT_ID = 'tid';
      process.env.AZURE_CLIENT_ID = 'cid';
      process.env.AZURE_CLIENT_SECRET = 'secret';
      process.env.AZURE_TENANT_LABEL = 'My Tenant';

      const settings = service.getAzureSettings();
      expect(settings!.label).toBe('My Tenant');
    });

    it('isEnvConfigured returns true when all env vars set', () => {
      process.env.AZURE_TENANT_ID = 'tid';
      process.env.AZURE_CLIENT_ID = 'cid';
      process.env.AZURE_CLIENT_SECRET = 'secret';

      expect(service.isEnvConfigured()).toBe(true);
    });

    it('isEnvConfigured returns false when env vars missing', () => {
      expect(service.isEnvConfigured()).toBe(false);
    });
  });

  // ── File settings take priority over env ──────────────────────

  describe('precedence', () => {
    it('file settings override env vars', () => {
      process.env.AZURE_TENANT_ID = 'env-tenant';
      process.env.AZURE_CLIENT_ID = 'env-client';
      process.env.AZURE_CLIENT_SECRET = 'env-secret';

      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAzureSettings({
        tenant_id: 'file-tenant',
        client_id: 'file-client',
        client_secret: 'file-secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      const settings = service.getAzureSettings();
      expect(settings!.tenant_id).toBe('file-tenant');
    });
  });

  // ── Partial update ────────────────────────────────────────────

  describe('partial update', () => {
    it('merges partial updates with existing settings', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Initial save
      service.saveAzureSettings({
        tenant_id: 'original-tenant',
        client_id: 'original-client',
        client_secret: 'original-secret',
        label: 'Original',
      });

      // Mock file read for partial update
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // Partial update: only change the label
      service.saveAzureSettings({ label: 'Updated Label' });

      // Read back the final state
      mockReadFileSync.mockReturnValue(writtenData);
      const loaded = service.getAzureSettings();

      expect(loaded!.tenant_id).toBe('original-tenant');
      expect(loaded!.label).toBe('Updated Label');
    });
  });

  // ── isAzureConfigured ─────────────────────────────────────────

  describe('isAzureConfigured', () => {
    it('returns true when file has all credentials', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveAzureSettings({
        tenant_id: 'tid',
        client_id: 'cid',
        client_secret: 'secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      expect(service.isAzureConfigured()).toBe(true);
    });

    it('returns false when not configured', () => {
      expect(service.isAzureConfigured()).toBe(false);
    });
  });

  // ── getAzureCredentials ───────────────────────────────────────

  describe('getAzureCredentials', () => {
    it('returns raw credentials object', () => {
      process.env.AZURE_TENANT_ID = 'tid-123';
      process.env.AZURE_CLIENT_ID = 'cid-456';
      process.env.AZURE_CLIENT_SECRET = 'secret-789';

      const creds = service.getAzureCredentials();
      expect(creds).toEqual({
        tenant_id: 'tid-123',
        client_id: 'cid-456',
        client_secret: 'secret-789',
      });
    });

    it('returns null when not configured', () => {
      expect(service.getAzureCredentials()).toBeNull();
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('returns null on corrupt JSON', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue('not-valid-json{{{');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const settings = service.getAzureSettings();
      expect(settings).toBeNull();

      errorSpy.mockRestore();
    });
  });
});
