// Tests for the Sophos branch of IntegrationsSettingsService.
//
// The Sophos pattern mirrors the Defender pattern (encryption, env override,
// partial update, delete-while-env-set rejection) but with two differences
// worth covering:
//   - Sophos has only `client_id` + `client_secret` for credentials —
//     `tenant_id` is *discovered* via whoami, not operator-supplied.
//   - Phase 1 doesn't yet exercise `tenant_id` / `data_region` / `tier`
//     write paths, but the type allows them, so we test that round-trips
//     preserve them when present (Phase 2+ will write them).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

describe('IntegrationsSettingsService — Sophos', () => {
  let service: InstanceType<typeof IntegrationsSettingsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
    service = new IntegrationsSettingsService();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
    delete process.env.SOPHOS_CLIENT_ID;
    delete process.env.SOPHOS_CLIENT_SECRET;
    delete process.env.SOPHOS_TENANT_LABEL;
  });

  // ── Encryption ────────────────────────────────────────────────

  describe('encryption', () => {
    it('encrypts client_id and client_secret on disk, round-trips through save/load', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveSophosSettings({
        client_id: 'sophos-client-uuid',
        client_secret: 'sophos-client-secret-value',
        label: 'Acme EU01',
      });

      const saved = JSON.parse(writtenData);
      expect(saved.sophos.client_id).toMatch(/^enc:/);
      expect(saved.sophos.client_secret).toMatch(/^enc:/);
      expect(saved.sophos.label).toBe('Acme EU01'); // label not encrypted
      expect(saved.sophos.configured).toBe(true);

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      const loaded = service.getSophosSettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.client_id).toBe('sophos-client-uuid');
      expect(loaded!.client_secret).toBe('sophos-client-secret-value');
      expect(loaded!.label).toBe('Acme EU01');
      expect(loaded!.configured).toBe(true);
    });

    it('preserves discovered tenant_id / data_region / tier across partial updates', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      // Initial save with discovered fields (Phase 2+ will populate these)
      service.saveSophosSettings({
        client_id: 'cid',
        client_secret: 'csec',
        tenant_id: 'tenant-uuid-123',
        data_region: 'https://api-eu01.central.sophos.com',
        tier: 'edr',
      });

      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      // Partial update — only label changes
      service.saveSophosSettings({ label: 'Updated label' });
      mockReadFileSync.mockReturnValue(writtenData);

      const loaded = service.getSophosSettings();
      expect(loaded!.tenant_id).toBe('tenant-uuid-123');
      expect(loaded!.data_region).toBe('https://api-eu01.central.sophos.com');
      expect(loaded!.tier).toBe('edr');
      expect(loaded!.label).toBe('Updated label');
      expect(loaded!.client_id).toBe('cid'); // secret preserved
      expect(loaded!.client_secret).toBe('csec');
    });
  });

  // ── Env-var override ──────────────────────────────────────────

  describe('env-var override', () => {
    it('prefers SOPHOS_CLIENT_ID/SECRET env vars when set', () => {
      process.env.SOPHOS_CLIENT_ID = 'env-client-id';
      process.env.SOPHOS_CLIENT_SECRET = 'env-client-secret';
      process.env.SOPHOS_TENANT_LABEL = 'Env-managed';

      const loaded = service.getSophosSettings();
      expect(loaded).not.toBeNull();
      expect(loaded!.client_id).toBe('env-client-id');
      expect(loaded!.client_secret).toBe('env-client-secret');
      expect(loaded!.label).toBe('Env-managed');
      expect(loaded!.configured).toBe(true);
    });

    it('returns null when neither env vars nor file settings are present', () => {
      const loaded = service.getSophosSettings();
      expect(loaded).toBeNull();
    });

    it('reports isEnvSophosConfigured() correctly', () => {
      expect(service.isEnvSophosConfigured()).toBe(false);
      process.env.SOPHOS_CLIENT_ID = 'x';
      process.env.SOPHOS_CLIENT_SECRET = 'y';
      expect(service.isEnvSophosConfigured()).toBe(true);
    });

    it('does NOT read tenant_id / data_region / tier from env vars (only discovered via whoami)', () => {
      process.env.SOPHOS_CLIENT_ID = 'x';
      process.env.SOPHOS_CLIENT_SECRET = 'y';
      // Even if someone set these env vars they should NOT be picked up.
      process.env.SOPHOS_TENANT_ID = 'should-be-ignored';
      try {
        const loaded = service.getSophosSettings();
        expect(loaded!.tenant_id).toBeUndefined();
      } finally {
        delete process.env.SOPHOS_TENANT_ID;
      }
    });
  });

  // ── Delete ────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the sophos block from settings file', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveSophosSettings({ client_id: 'a', client_secret: 'b' });
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      service.deleteSophosSettings();

      const after = JSON.parse(writtenData);
      expect(after.sophos).toBeUndefined();
    });
  });

  // ── isConfigured ──────────────────────────────────────────────

  describe('isSophosConfigured', () => {
    it('returns false when no settings exist', () => {
      expect(service.isSophosConfigured()).toBe(false);
    });

    it('returns true when env vars are set', () => {
      process.env.SOPHOS_CLIENT_ID = 'x';
      process.env.SOPHOS_CLIENT_SECRET = 'y';
      expect(service.isSophosConfigured()).toBe(true);
    });

    it('returns true when file settings are configured', () => {
      let writtenData = '';
      mockWriteFileSync.mockImplementation((_p: string, data: string) => {
        writtenData = data;
      });

      service.saveSophosSettings({ client_id: 'a', client_secret: 'b' });
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_FILE || p === SETTINGS_DIR);
      mockReadFileSync.mockReturnValue(writtenData);

      expect(service.isSophosConfigured()).toBe(true);
    });
  });
});
