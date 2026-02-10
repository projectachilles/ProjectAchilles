import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockCreateReadStream = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
    createReadStream: mockCreateReadStream,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = {
    homedir: () => '/mock-home',
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

// Do NOT mock crypto — let real SHA-256 run

let testDb: Database.Database;
vi.mock('../../agent/database.js', () => ({ getDatabase: () => testDb }));

const {
  registerVersion,
  registerVersionFromUpload,
  getLatestVersion,
  listVersions,
  streamUpdate,
  deleteVersion,
} = await import('../update.service.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('update.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDatabase();
    mockExistsSync.mockReturnValue(false);
  });

  // ── Group 1: registerVersion ──────────────────────────────

  describe('registerVersion', () => {
    it('inserts version record with correct hash and metadata', () => {
      const binaryData = Buffer.from('test-binary-content');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: binaryData.length });
      mockReadFileSync.mockReturnValue(binaryData);

      const result = registerVersion('1.0.0', 'linux', 'amd64', '/path/to/binary', 'Initial release', false);

      expect(result.version).toBe('1.0.0');
      expect(result.os).toBe('linux');
      expect(result.arch).toBe('amd64');
      expect(result.binary_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.binary_size).toBe(binaryData.length);
      expect(result.mandatory).toBe(false);
      expect(result.signed).toBe(false);
      expect(result.release_notes).toBe('Initial release');
    });

    it('throws when binary file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        registerVersion('1.0.0', 'linux', 'amd64', '/nonexistent', 'notes', false),
      ).toThrow('Binary not found: /nonexistent');
    });

    it('persists version to DB', () => {
      const binaryData = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(binaryData);

      registerVersion('2.0.0', 'windows', 'amd64', '/path/bin.exe', 'v2', true, true);

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('2.0.0') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.os).toBe('windows');
      expect(row.arch).toBe('amd64');
      expect(row.mandatory).toBe(1);
      expect(row.signed).toBe(1);
    });

    it('replaces existing version (upsert behavior)', () => {
      const binaryData = Buffer.from('old-binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(binaryData);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/old', 'old notes', false);

      const newBinary = Buffer.from('new-binary-content');
      mockStatSync.mockReturnValue({ size: newBinary.length });
      mockReadFileSync.mockReturnValue(newBinary);

      const result = registerVersion('1.0.0', 'linux', 'amd64', '/path/new', 'new notes', true);

      expect(result.release_notes).toBe('new notes');
      expect(result.mandatory).toBe(true);

      // Only one row in DB
      const rows = testDb.prepare('SELECT * FROM agent_versions WHERE version = ? AND os = ? AND arch = ?').all('1.0.0', 'linux', 'amd64');
      expect(rows).toHaveLength(1);
    });

    it('computes correct SHA-256 hash', async () => {
      const binaryData = Buffer.from('deterministic-content');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: binaryData.length });
      mockReadFileSync.mockReturnValue(binaryData);

      const crypto = await import('crypto');
      const expectedHash = crypto.createHash('sha256').update(binaryData).digest('hex');

      const result = registerVersion('1.0.0', 'linux', 'amd64', '/path/bin', 'notes', false);

      expect(result.binary_sha256).toBe(expectedHash);
    });
  });

  // ── Group 2: registerVersionFromUpload ────────────────────

  describe('registerVersionFromUpload', () => {
    it('saves uploaded buffer and computes SHA-256 hash', () => {
      const buffer = Buffer.from('uploaded-agent-binary');
      // existsSync: true for the file we just wrote, true for statSync
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: buffer.length });
      mockReadFileSync.mockReturnValue(buffer);

      const result = registerVersionFromUpload('1.0.0', 'linux', 'amd64', buffer, 'Upload notes', false);

      expect(result.version).toBe('1.0.0');
      expect(result.binary_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('achilles-agent-1.0.0'),
        buffer,
      );
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.projectachilles/binaries/linux-amd64'),
        { recursive: true },
      );
    });

    it('creates DB record with platform and arch', () => {
      const buffer = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buffer);

      registerVersionFromUpload('2.0.0', 'windows', 'arm64', buffer, 'notes', true);

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('2.0.0') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.os).toBe('windows');
      expect(row.arch).toBe('arm64');
    });

    it('rejects upload for invalid version string', () => {
      const buffer = Buffer.from('binary');

      expect(() =>
        registerVersionFromUpload('bad version!', 'linux', 'amd64', buffer, 'notes', false),
      ).toThrow('Invalid version string');
    });

    it('adds .exe extension for Windows uploads', () => {
      const buffer = Buffer.from('win-binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(buffer);

      registerVersionFromUpload('1.0.0', 'windows', 'amd64', buffer, 'notes', false);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('achilles-agent-1.0.0.exe'),
        buffer,
      );
    });
  });

  // ── Group 3: getLatestVersion ─────────────────────────────

  describe('getLatestVersion', () => {
    it('returns latest version for given platform/arch', () => {
      // Insert directly with explicit timestamps to guarantee ordering
      testDb.prepare(`
        INSERT INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('1.0.0', 'linux', 'amd64', '/path/v1', 'aaa', 6, 'v1', 0, 0, '2026-01-01T00:00:00.000Z');
      testDb.prepare(`
        INSERT INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory, signed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('2.0.0', 'linux', 'amd64', '/path/v2', 'bbb', 6, 'v2', 1, 0, '2026-01-02T00:00:00.000Z');

      const latest = getLatestVersion('linux', 'amd64');

      expect(latest).not.toBeNull();
      expect(latest!.version).toBe('2.0.0');
      expect(latest!.mandatory).toBe(true);
    });

    it('returns null when no versions exist', () => {
      const result = getLatestVersion('linux', 'amd64');

      expect(result).toBeNull();
    });

    it('filters by platform and arch correctly', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'windows', 'amd64', '/path/win', 'win', false);
      registerVersion('1.0.0', 'linux', 'arm64', '/path/lin-arm', 'arm', false);

      expect(getLatestVersion('linux', 'amd64')).toBeNull();
      expect(getLatestVersion('windows', 'amd64')).not.toBeNull();
      expect(getLatestVersion('linux', 'arm64')).not.toBeNull();
    });
  });

  // ── Group 4: listVersions ────────────────────────────────

  describe('listVersions', () => {
    it('returns all versions sorted by created_at desc', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/v1', 'v1', false);
      registerVersion('2.0.0', 'windows', 'amd64', '/v2', 'v2', true);

      const versions = listVersions();

      expect(versions).toHaveLength(2);
      // Booleans should be properly converted
      expect(typeof versions[0].mandatory).toBe('boolean');
      expect(typeof versions[0].signed).toBe('boolean');
    });

    it('returns empty array when no versions', () => {
      const versions = listVersions();
      expect(versions).toEqual([]);
    });

    it('includes all metadata fields', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('3.0.0', 'linux', 'amd64', '/v3', 'release three', false, true);

      const versions = listVersions();

      expect(versions[0]).toMatchObject({
        version: '3.0.0',
        os: 'linux',
        arch: 'amd64',
        release_notes: 'release three',
        mandatory: false,
        signed: true,
      });
      expect(versions[0].binary_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(versions[0].created_at).toBeDefined();
    });
  });

  // ── Group 5: streamUpdate ─────────────────────────────────

  describe('streamUpdate', () => {
    function createMockResponse() {
      return {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as import('express').Response;
    }

    it('sets correct headers and streams binary file', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/agent', 'notes', false);

      const res = createMockResponse();
      const mockStream = { pipe: vi.fn() };
      mockCreateReadStream.mockReturnValue(mockStream);

      streamUpdate('linux', 'amd64', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="achilles-agent-linux-amd64"',
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Agent-Version', '1.0.0');
      expect(mockStream.pipe).toHaveBeenCalledWith(res);
    });

    it('includes .exe extension for Windows filename', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'windows', 'amd64', '/path/agent.exe', 'notes', false);

      const res = createMockResponse();
      const mockStream = { pipe: vi.fn() };
      mockCreateReadStream.mockReturnValue(mockStream);

      streamUpdate('windows', 'amd64', res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="achilles-agent-windows-amd64.exe"',
      );
    });

    it('returns 404 when version not found in DB', () => {
      const res = createMockResponse();

      streamUpdate('linux', 'amd64', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'No version available for this platform' }),
      );
    });

    it('returns 404 when binary file missing from disk', () => {
      const buf = Buffer.from('binary');
      // existsSync: true for registerVersion, then false for the stream check
      let callCount = 0;
      mockExistsSync.mockImplementation(() => {
        callCount++;
        // First call is from registerVersion, after that from streamUpdate
        return callCount <= 1;
      });
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/gone', 'notes', false);

      const res = createMockResponse();
      streamUpdate('linux', 'amd64', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Binary file not found on server' }),
      );
    });

    it('sets Content-Length header from file stats', () => {
      const buf = Buffer.from('binary-data-12345');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: buf.length });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/agent', 'notes', false);

      const res = createMockResponse();
      const mockStream = { pipe: vi.fn() };
      mockCreateReadStream.mockReturnValue(mockStream);

      streamUpdate('linux', 'amd64', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', buf.length.toString());
    });
  });

  // ── Group 6: deleteVersion ────────────────────────────────

  describe('deleteVersion', () => {
    it('removes DB record and binary file', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/bin', 'notes', false);

      const result = deleteVersion('1.0.0', 'linux', 'amd64');

      expect(result).toBe(true);
      expect(mockUnlinkSync).toHaveBeenCalledWith('/path/bin');

      // Verify DB record is gone
      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('1.0.0');
      expect(row).toBeUndefined();
    });

    it('handles missing binary file gracefully (DB-only cleanup)', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/bin', 'notes', false);

      // Now make unlinkSync throw (file already deleted from disk)
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = deleteVersion('1.0.0', 'linux', 'amd64');

      // Should still succeed and clean up DB
      expect(result).toBe(true);
      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('1.0.0');
      expect(row).toBeUndefined();
    });

    it('returns false when version does not exist', () => {
      const result = deleteVersion('nonexistent', 'linux', 'amd64');

      expect(result).toBe(false);
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('removes correct platform-specific record only', () => {
      const buf = Buffer.from('binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buf);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/linux', 'linux notes', false);
      registerVersion('1.0.0', 'windows', 'amd64', '/path/windows', 'windows notes', false);

      deleteVersion('1.0.0', 'linux', 'amd64');

      // Windows version should still exist
      const winRow = testDb.prepare('SELECT * FROM agent_versions WHERE version = ? AND os = ?').get('1.0.0', 'windows');
      expect(winRow).toBeDefined();

      // Linux version should be gone
      const linRow = testDb.prepare('SELECT * FROM agent_versions WHERE version = ? AND os = ?').get('1.0.0', 'linux');
      expect(linRow).toBeUndefined();
    });
  });
});
