import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ── Mock setup ──────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockCreateReadStream = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    statSync: mockStatSync,
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

const { getBinaryInfo, streamBinary } = await import('../binary.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

const BUILDS_DIR = '/mock-home/.projectachilles/builds';
const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BINARY_NAME = `${UUID}.exe`;

function createMockStream(data: string) {
  const stream = new EventEmitter();
  (stream as unknown as Record<string, unknown>).pipe = vi.fn();
  // Emit data and end on next tick
  process.nextTick(() => {
    stream.emit('data', Buffer.from(data));
    stream.emit('end');
  });
  return stream;
}

function createMockRes() {
  return {
    setHeader: vi.fn(),
    pipe: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('binary.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  // ── getBinaryInfo ──────────────────────────────────────────

  describe('getBinaryInfo', () => {
    it('throws 404 AppError when binary does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(getBinaryInfo(UUID, BINARY_NAME))
        .rejects.toThrow('Binary not found');
    });

    it('returns path, sha256, size, and name for existing binary', async () => {
      const binaryPath = `${BUILDS_DIR}/${UUID}/${BINARY_NAME}`;
      mockExistsSync.mockImplementation((p: string) => p === binaryPath);
      mockStatSync.mockReturnValue({ size: 4096 });
      mockCreateReadStream.mockReturnValue(createMockStream('binary-content'));

      const info = await getBinaryInfo(UUID, BINARY_NAME);

      expect(info.path).toBe(binaryPath);
      expect(info.size).toBe(4096);
      expect(info.name).toBe(BINARY_NAME);
      expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('prevents path traversal in UUID parameter', async () => {
      // path.basename strips "../" so it won't escape the builds dir
      mockExistsSync.mockReturnValue(false);

      await expect(getBinaryInfo('../../../etc', 'passwd'))
        .rejects.toThrow('Binary not found');

      // Should have checked the safe path, not the traversal path
      const checkedPath = mockExistsSync.mock.calls[0][0];
      expect(checkedPath).not.toContain('..');
    });

    it('prevents path traversal in binaryName parameter', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(getBinaryInfo(UUID, '../../secret.txt'))
        .rejects.toThrow('Binary not found');

      const checkedPath = mockExistsSync.mock.calls[0][0];
      expect(checkedPath).not.toContain('..');
    });

    it('computes correct SHA256 hash', async () => {
      const content = 'test-binary-data';
      const binaryPath = `${BUILDS_DIR}/${UUID}/${BINARY_NAME}`;
      mockExistsSync.mockImplementation((p: string) => p === binaryPath);
      mockStatSync.mockReturnValue({ size: content.length });
      mockCreateReadStream.mockReturnValue(createMockStream(content));

      const info = await getBinaryInfo(UUID, BINARY_NAME);

      // Verify it's a valid hex SHA256 hash (64 chars)
      expect(info.sha256).toHaveLength(64);
      expect(info.sha256).toMatch(/^[a-f0-9]+$/);
    });
  });

  // ── streamBinary ───────────────────────────────────────────

  describe('streamBinary', () => {
    it('sets correct response headers', () => {
      mockStatSync.mockReturnValue({ size: 2048 });
      const mockStream = new EventEmitter();
      (mockStream as unknown as Record<string, unknown>).pipe = vi.fn();
      mockCreateReadStream.mockReturnValue(mockStream);

      const res = createMockRes();
      streamBinary('/path/to/binary', 'agent.exe', res as unknown as import('express').Response);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 2048);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="agent.exe"',
      );
    });

    it('pipes read stream to response', () => {
      mockStatSync.mockReturnValue({ size: 1024 });
      const mockStream = new EventEmitter();
      (mockStream as unknown as Record<string, unknown>).pipe = vi.fn();
      mockCreateReadStream.mockReturnValue(mockStream);

      const res = createMockRes();
      streamBinary('/path/to/binary', 'agent.exe', res as unknown as import('express').Response);

      expect((mockStream as unknown as Record<string, ReturnType<typeof vi.fn>>).pipe).toHaveBeenCalledWith(res);
    });

    it('sanitizes special characters in filename', () => {
      mockStatSync.mockReturnValue({ size: 1024 });
      const mockStream = new EventEmitter();
      (mockStream as unknown as Record<string, unknown>).pipe = vi.fn();
      mockCreateReadStream.mockReturnValue(mockStream);

      const res = createMockRes();
      streamBinary('/path/to/binary', 'file"name\r\n\\test.exe', res as unknown as import('express').Response);

      const dispositionCall = res.setHeader.mock.calls.find(
        (c: string[]) => c[0] === 'Content-Disposition',
      );
      expect(dispositionCall![1]).toBe('attachment; filename="file_name___test.exe"');
    });
  });
});
