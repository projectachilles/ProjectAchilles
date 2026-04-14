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

describe('IntegrationsSettingsService — Defender', () => {
  let service: InstanceType<typeof IntegrationsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    service = new IntegrationsSettingsService();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
    delete process.env.DEFENDER_TENANT_ID;
    delete process.env.DEFENDER_CLIENT_ID;
    delete process.env.DEFENDER_CLIENT_SECRET;
    delete process.env.DEFENDER_TENANT_LABEL;
  });

  // ── Encryption round-trip ────────────────────────────────────

  describe('encryption', () => {
    it('encrypt → decrypt round-trip through save/load', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveDefenderSettings({
        tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
        client_id: '11112222-3333-4444-5555-666677778888',
        client_secret: 'super-secret-value',
        label: 'Defender Tenant',
      });

      // Verify encrypted on disk
      const saved = JSON.parse(writtenData);
      expect(saved.defender.tenant_id).toMatch(/^enc:/);
      expect(saved.defender.client_id).toMatch(/^enc:/);
      expect(saved.defender.client_secret).toMatch(/^enc:/);
      expect(saved.defender.label).toBe('Defender Tenant'); // label not encrypted

      // Read back
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      const loaded = service.getDefenderSettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.tenant_id).toBe('aaaabbbb-cccc-dddd-eeee-ffffffffffff');
      expect(loaded!.client_id).toBe('11112222-3333-4444-5555-666677778888');
      expect(loaded!.client_secret).toBe('super-secret-value');
      expect(loaded!.label).toBe('Defender Tenant');
      expect(loaded!.configured).toBe(true);
    });

    it('does not interfere with Azure settings in same file', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Save Azure first
      service.saveAzureSettings({
        tenant_id: 'azure-tenant',
        client_id: 'azure-client',
        client_secret: 'azure-secret',
      });

      const afterAzure = writtenData;
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(afterAzure);

      // Now save Defender — should preserve Azure
      service.saveDefenderSettings({
        tenant_id: 'defender-tenant',
        client_id: 'defender-client',
        client_secret: 'defender-secret',
      });

      // Read back and verify both exist
      mockReadFileSync.mockReturnValue(writtenData);

      const azure = service.getAzureSettings();
      expect(azure!.tenant_id).toBe('azure-tenant');

      const defender = service.getDefenderSettings();
      expect(defender!.tenant_id).toBe('defender-tenant');
    });
  });

  // ── Environment variable override ─────────────────────────────

  describe('env var override', () => {
    it('returns env settings when file does not exist', () => {
      process.env.DEFENDER_TENANT_ID = 'env-tenant-id';
      process.env.DEFENDER_CLIENT_ID = 'env-client-id';
      process.env.DEFENDER_CLIENT_SECRET = 'env-secret';

      const settings = service.getDefenderSettings();
      expect(settings).not.toBeNull();
      expect(settings!.tenant_id).toBe('env-tenant-id');
      expect(settings!.configured).toBe(true);
    });

    it('returns null when env vars are incomplete', () => {
      process.env.DEFENDER_TENANT_ID = 'env-tenant-id';
      // Missing client_id and client_secret

      const settings = service.getDefenderSettings();
      expect(settings).toBeNull();
    });

    it('reads DEFENDER_TENANT_LABEL from env', () => {
      process.env.DEFENDER_TENANT_ID = 'tid';
      process.env.DEFENDER_CLIENT_ID = 'cid';
      process.env.DEFENDER_CLIENT_SECRET = 'secret';
      process.env.DEFENDER_TENANT_LABEL = 'My Defender Tenant';

      const settings = service.getDefenderSettings();
      expect(settings!.label).toBe('My Defender Tenant');
    });

    it('isEnvDefenderConfigured returns true when all env vars set', () => {
      process.env.DEFENDER_TENANT_ID = 'tid';
      process.env.DEFENDER_CLIENT_ID = 'cid';
      process.env.DEFENDER_CLIENT_SECRET = 'secret';

      expect(service.isEnvDefenderConfigured()).toBe(true);
    });

    it('isEnvDefenderConfigured returns false when env vars missing', () => {
      expect(service.isEnvDefenderConfigured()).toBe(false);
    });
  });

  // ── File settings take priority over env ──────────────────────

  describe('precedence', () => {
    it('file settings override env vars', () => {
      process.env.DEFENDER_TENANT_ID = 'env-tenant';
      process.env.DEFENDER_CLIENT_ID = 'env-client';
      process.env.DEFENDER_CLIENT_SECRET = 'env-secret';

      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveDefenderSettings({
        tenant_id: 'file-tenant',
        client_id: 'file-client',
        client_secret: 'file-secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      const settings = service.getDefenderSettings();
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
      service.saveDefenderSettings({
        tenant_id: 'original-tenant',
        client_id: 'original-client',
        client_secret: 'original-secret',
        label: 'Original',
      });

      // Mock file read for partial update
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // Partial update: only change the label
      service.saveDefenderSettings({ label: 'Updated Label' });

      // Read back the final state
      mockReadFileSync.mockReturnValue(writtenData);
      const loaded = service.getDefenderSettings();

      expect(loaded!.tenant_id).toBe('original-tenant');
      expect(loaded!.label).toBe('Updated Label');
    });
  });

  // ── isDefenderConfigured ─────────────────────────────────────

  describe('isDefenderConfigured', () => {
    it('returns true when file has all credentials', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveDefenderSettings({
        tenant_id: 'tid',
        client_id: 'cid',
        client_secret: 'secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      expect(service.isDefenderConfigured()).toBe(true);
    });

    it('returns false when not configured', () => {
      expect(service.isDefenderConfigured()).toBe(false);
    });
  });

  // ── getDefenderCredentials ───────────────────────────────────

  describe('getDefenderCredentials', () => {
    it('returns raw credentials object', () => {
      process.env.DEFENDER_TENANT_ID = 'tid-123';
      process.env.DEFENDER_CLIENT_ID = 'cid-456';
      process.env.DEFENDER_CLIENT_SECRET = 'secret-789';

      const creds = service.getDefenderCredentials();
      expect(creds).toEqual({
        tenant_id: 'tid-123',
        client_id: 'cid-456',
        client_secret: 'secret-789',
      });
    });

    it('returns null when not configured', () => {
      expect(service.getDefenderCredentials()).toBeNull();
    });
  });

  // ── Auto-resolve mode ─────────────────────────────────────────

  describe('auto_resolve_mode', () => {
    it("defaults to 'disabled' when field is missing", () => {
      process.env.DEFENDER_TENANT_ID = 'tid';
      process.env.DEFENDER_CLIENT_ID = 'cid';
      process.env.DEFENDER_CLIENT_SECRET = 'secret';

      expect(service.getAutoResolveMode()).toBe('disabled');
    });

    it("defaults to 'disabled' when Defender is not configured", () => {
      expect(service.getAutoResolveMode()).toBe('disabled');
    });

    it("persists 'dry_run' via setAutoResolveMode and reads it back", () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Initial credentials (required for setAutoResolveMode)
      service.saveDefenderSettings({
        tenant_id: 'tid',
        client_id: 'cid',
        client_secret: 'secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      service.setAutoResolveMode('dry_run');

      mockReadFileSync.mockReturnValue(writtenData);
      expect(service.getAutoResolveMode()).toBe('dry_run');
    });

    it("persists 'enabled' mode", () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveDefenderSettings({
        tenant_id: 'tid',
        client_id: 'cid',
        client_secret: 'secret',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      service.setAutoResolveMode('enabled');

      mockReadFileSync.mockReturnValue(writtenData);
      expect(service.getAutoResolveMode()).toBe('enabled');
    });

    it('throws on invalid mode string', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => { writtenData = data; });
      service.saveDefenderSettings({ tenant_id: 't', client_id: 'c', client_secret: 's' });
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // @ts-expect-error — testing runtime validation
      expect(() => service.setAutoResolveMode('bogus')).toThrow(/Invalid auto_resolve_mode/);
    });

    it('throws when setting mode before Defender is configured', () => {
      expect(() => service.setAutoResolveMode('dry_run')).toThrow(/not configured/);
    });

    it('setAutoResolveMode preserves existing credentials', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => { writtenData = data; });

      service.saveDefenderSettings({
        tenant_id: 'original-tid',
        client_id: 'original-cid',
        client_secret: 'original-secret',
        label: 'Original Tenant',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      service.setAutoResolveMode('dry_run');

      mockReadFileSync.mockReturnValue(writtenData);
      const settings = service.getDefenderSettings();
      expect(settings!.tenant_id).toBe('original-tid');
      expect(settings!.client_id).toBe('original-cid');
      expect(settings!.client_secret).toBe('original-secret');
      expect(settings!.label).toBe('Original Tenant');
      expect(settings!.auto_resolve_mode).toBe('dry_run');
    });

    it('ignores unknown mode values read from disk (forward compat)', () => {
      // Simulate a forward-compat scenario where disk has a mode string the current code doesn't know about
      const onDisk = { defender: { tenant_id: 'enc:x', client_id: 'enc:y', client_secret: 'enc:z', configured: true, auto_resolve_mode: 'future-mode-v2' } };
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(JSON.stringify(onDisk));

      // Suppress decryption console.error noise from the mock 'enc:' values
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(service.getAutoResolveMode()).toBe('disabled');
      errorSpy.mockRestore();
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('returns null on corrupt JSON', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue('not-valid-json{{{');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const settings = service.getDefenderSettings();
      expect(settings).toBeNull();

      errorSpy.mockRestore();
    });
  });
});
