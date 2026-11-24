import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ── Mock setup ──────────────────────────────────────────────────────

const mockStatSync = vi.fn();
const mockCreateReadStream = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    statSync: mockStatSync,
    createReadStream: mockCreateReadStream,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { streamBinary } = await import('../binary.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

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
  });

  // getBinaryInfo is tested against real files in binary.service.files.test.ts.

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
