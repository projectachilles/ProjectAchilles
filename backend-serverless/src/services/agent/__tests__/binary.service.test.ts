import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockBlobRead = vi.fn();
const mockBlobHead = vi.fn();
const mockBlobUrl = vi.fn();

vi.mock('../../storage.js', () => ({
  blobRead: (...args: unknown[]) => mockBlobRead(...args),
  blobHead: (...args: unknown[]) => mockBlobHead(...args),
  blobUrl: (...args: unknown[]) => mockBlobUrl(...args),
}));

const { getBinaryInfo, redirectToBinary } = await import('../binary.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BINARY_NAME = `${UUID}.exe`;

function createMockRes() {
  return {
    setHeader: vi.fn(),
    redirect: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('binary.service (Blob)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlobRead.mockResolvedValue(null);
    mockBlobUrl.mockResolvedValue(null);
  });

  // ── getBinaryInfo ──────────────────────────────────────────

  describe('getBinaryInfo', () => {
    it('throws 404 AppError when binary does not exist in Blob', async () => {
      mockBlobRead.mockResolvedValue(null);

      await expect(getBinaryInfo(UUID, BINARY_NAME))
        .rejects.toThrow('Binary not found');
    });

    it('returns url, sha256, size, and name for existing binary', async () => {
      const binaryContent = Buffer.from('binary-content');
      mockBlobRead.mockResolvedValue(binaryContent);
      mockBlobUrl.mockResolvedValue('https://blob.test/builds/uuid/file.exe');

      const info = await getBinaryInfo(UUID, BINARY_NAME);

      expect(info.url).toBe('https://blob.test/builds/uuid/file.exe');
      expect(info.size).toBe(binaryContent.length);
      expect(info.name).toBe(BINARY_NAME);
      expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('prevents path traversal in UUID parameter', async () => {
      mockBlobRead.mockResolvedValue(null);

      await expect(getBinaryInfo('../../../etc', 'passwd'))
        .rejects.toThrow('Binary not found');

      // Should have called blobRead with safe path (no ..)
      const calledKey = mockBlobRead.mock.calls[0][0];
      expect(calledKey).not.toContain('..');
    });

    it('prevents path traversal in binaryName parameter', async () => {
      mockBlobRead.mockResolvedValue(null);

      await expect(getBinaryInfo(UUID, '../../secret.txt'))
        .rejects.toThrow('Binary not found');

      const calledKey = mockBlobRead.mock.calls[0][0];
      expect(calledKey).not.toContain('..');
    });

    it('computes correct SHA256 hash', async () => {
      const content = Buffer.from('test-binary-data');
      mockBlobRead.mockResolvedValue(content);
      mockBlobUrl.mockResolvedValue('https://blob.test/key');

      const info = await getBinaryInfo(UUID, BINARY_NAME);

      // Verify it's a valid hex SHA256 hash (64 chars)
      expect(info.sha256).toHaveLength(64);
      expect(info.sha256).toMatch(/^[a-f0-9]+$/);
    });
  });

  // ── redirectToBinary ───────────────────────────────────────

  describe('redirectToBinary', () => {
    it('sets Content-Disposition and redirects to Blob URL', () => {
      const res = createMockRes();
      redirectToBinary('https://blob.test/binary', 'agent.exe', res as unknown as import('express').Response);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="agent.exe"',
      );
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://blob.test/binary');
    });

    it('sanitizes special characters in filename', () => {
      const res = createMockRes();
      redirectToBinary('https://blob.test/binary', 'file"name\r\n\\test.exe', res as unknown as import('express').Response);

      const dispositionCall = res.setHeader.mock.calls.find(
        (c: string[]) => c[0] === 'Content-Disposition',
      );
      expect(dispositionCall![1]).toBe('attachment; filename="file_name___test.exe"');
    });
  });
});
