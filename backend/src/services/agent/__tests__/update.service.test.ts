import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

// ── Mock setup ──────────────────────────────────────────────────────

// vi.hoisted lifts these fns into hoist scope so the fs mock factory below
// can reference them safely. The database mock uses importOriginal(), which
// triggers a real `import fs` chain at hoist time; without vi.hoisted these
// would be in TDZ when the fs factory runs.
const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockStatSync,
  mockUnlinkSync,
  mockCreateReadStream,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockCreateReadStream: vi.fn(),
}));

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

// Mock signing service so registerVersion doesn't try to read real key files
vi.mock('../signing.service.js', () => ({
  signHash: () => 'deadbeef'.repeat(16),
}));

let testDb: Database.Database;
vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const {
  registerVersion,
  registerVersionFromUpload,
  getLatestVersion,
  listVersions,
  streamUpdate,
  deleteVersion,
} = await import('../update.service.js');
const { EmbeddedVersionError } = await import('../binaryVersion.js');

// Registered binaries must carry the Go build-info stamp for the version they
// are registered under (see binaryVersion.ts), so fixtures include one. The
// filler keeps fixtures that must differ (e.g. old vs new binary) distinct.
const agentBinary = (version: string, filler = '') =>
  Buffer.from(`\x00MZ${filler}\x90build\t-ldflags="-s -w -X main.version=${version}"\n\x00`);

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
      const binaryData = agentBinary('1.0.0', 'test-binary-content');
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

    // registerVersion is shared by register-by-path (POST /admin/versions),
    // upload and build. It already reads the file to hash it, so the embedded
    // version check lives here and covers all three, on the final (signed) file.
    it('rejects a binary whose embedded version differs from the registered one', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 64 });
      mockReadFileSync.mockReturnValue(agentBinary('0.6.3'));

      expect(() =>
        registerVersion('0.6.4', 'windows', 'amd64', '/path/agent.exe', 'notes', false),
      ).toThrow(EmbeddedVersionError);

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('0.6.4');
      expect(row).toBeUndefined();
    });

    it('rejects a binary with no version stamp', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(Buffer.from('not stamped'));

      expect(() =>
        registerVersion('0.6.4', 'linux', 'amd64', '/path/agent', 'notes', false),
      ).toThrow(/Cannot verify this binary's version/);
    });

    it('throws when binary file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        registerVersion('1.0.0', 'linux', 'amd64', '/nonexistent', 'notes', false),
      ).toThrow('Binary not found: /nonexistent');
    });

    it('persists version to DB', () => {
      const binaryData = agentBinary('2.0.0', 'binary');
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
      const binaryData = agentBinary('1.0.0', 'old-binary');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(binaryData);

      registerVersion('1.0.0', 'linux', 'amd64', '/path/old', 'old notes', false);

      const newBinary = agentBinary('1.0.0', 'new-binary-content');
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
      const binaryData = agentBinary('1.0.0', 'deterministic-content');
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
    it('saves uploaded buffer and computes SHA-256 hash', async () => {
      const buffer = agentBinary('1.0.0');
      // existsSync: true for the file we just wrote, true for statSync
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: buffer.length });
      mockReadFileSync.mockReturnValue(buffer);

      // linux: no signing path, so this exercises storage + registration only
      const result = await registerVersionFromUpload('1.0.0', 'linux', 'amd64', buffer, 'Upload notes', false);

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

    it('creates DB record with platform and arch', async () => {
      const buffer = agentBinary('2.0.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync.mockReturnValue(buffer);

      // No certificate exists in the test environment, so signing cannot
      // succeed; this test is about the DB record, not the signature.
      await registerVersionFromUpload('2.0.0', 'windows', 'arm64', buffer, 'notes', true, {
        allowUnsigned: true,
      });

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('2.0.0') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.os).toBe('windows');
      expect(row.arch).toBe('arm64');
    });

    it('rejects upload for invalid version string', async () => {
      const buffer = Buffer.from('binary');

      await expect(
        registerVersionFromUpload('bad version!', 'linux', 'amd64', buffer, 'notes', false),
      ).rejects.toThrow('Invalid version string');
    });

    // The Sep 2026 incident: a 0.6.3 build registered as 0.6.4 put every agent
    // into an install → restart → "still 0.6.3" → install loop.
    it('rejects a binary whose embedded version differs, before writing anything', async () => {
      await expect(
        registerVersionFromUpload('0.6.4', 'linux', 'amd64', agentBinary('0.6.3'), 'notes', false),
      ).rejects.toThrow(EmbeddedVersionError);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('0.6.4');
      expect(row).toBeUndefined();
    });

    it('rejects a binary with no version stamp', async () => {
      await expect(
        registerVersionFromUpload('0.6.4', 'linux', 'amd64', Buffer.from('no build info'), 'notes', false),
      ).rejects.toThrow(/Cannot verify this binary's version/);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('adds .exe extension for Windows uploads', async () => {
      const buffer = agentBinary('1.0.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(buffer);

      await registerVersionFromUpload('1.0.0', 'windows', 'amd64', buffer, 'notes', false, {
        allowUnsigned: true,
      });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('achilles-agent-1.0.0.exe'),
        buffer,
      );
    });

    // Signing is fatal by default on this path — an upload exists so the
    // operator can attach their certificate, and silently registering an
    // unsigned binary would push something a WDAC-hardened fleet refuses to
    // execute. That silent-fallback behaviour on the *build* path is how an
    // unsigned agent release shipped unnoticed.
    it('refuses a Windows upload when no certificate is available', async () => {
      const buffer = agentBinary('3.0.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(buffer);

      await expect(
        registerVersionFromUpload('3.0.0', 'windows', 'amd64', buffer, 'notes', false),
      ).rejects.toThrow(/certificate/i);

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('3.0.0');
      expect(row).toBeUndefined();
    });

    it('registers unsigned only when explicitly allowed', async () => {
      const buffer = agentBinary('3.1.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(buffer);

      const result = await registerVersionFromUpload('3.1.0', 'windows', 'amd64', buffer, 'notes', false, {
        allowUnsigned: true,
      });

      expect(result.signed).toBe(false);
      expect(result.signer_subject).toBeNull();
    });

    // cert_id arrives from the request body. It is matched against the
    // directories that actually exist under the certs root rather than
    // sanitised, so a traversal sequence never reaches path.join.
    it('rejects a certificate id containing a traversal sequence', async () => {
      const buffer = agentBinary('3.3.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 10 });
      mockReadFileSync.mockReturnValue(buffer);

      await expect(
        registerVersionFromUpload('3.3.0', 'windows', 'amd64', buffer, 'notes', false, {
          certId: '../../../../etc/ssl',
        }),
      ).rejects.toThrow(/not found/i);

      const row = testDb.prepare('SELECT * FROM agent_versions WHERE version = ?').get('3.3.0');
      expect(row).toBeUndefined();
    });

    // Linux has no signing ecosystem equivalent, so it must not be blocked by
    // the certificate requirement.
    it('registers a Linux upload without requiring a certificate', async () => {
      const buffer = agentBinary('3.2.0');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 12 });
      mockReadFileSync.mockReturnValue(buffer);

      const result = await registerVersionFromUpload('3.2.0', 'linux', 'amd64', buffer, 'notes', false);

      expect(result.signed).toBe(false);
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
      const buf = agentBinary('1.0.0', 'binary');
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
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 6 });
      mockReadFileSync
        .mockReturnValueOnce(agentBinary('1.0.0'))
        .mockReturnValueOnce(agentBinary('2.0.0'));

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
      const buf = agentBinary('3.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary-data-12345');
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
      const buf = agentBinary('1.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary');
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
      const buf = agentBinary('1.0.0', 'binary');
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
