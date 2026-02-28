import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock analytics settings + client
const mockGetSettings = vi.fn();
const mockIsConfigured = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = mockGetSettings;
    isConfigured = mockIsConfigured;
  },
}));

const mockIndicesCreate = vi.fn();
const mockCatIndices = vi.fn();

vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    indices: { create: mockIndicesCreate },
    cat: { indices: mockCatIndices },
  }),
}));

const { createDefenderIndex, listDefenderIndices, DEFENDER_INDEX } = await import('../index-management.js');

describe('Defender index management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      configured: true,
      connectionType: 'node',
      node: 'http://localhost:9200',
    });
  });

  describe('createDefenderIndex', () => {
    it('creates the index successfully', async () => {
      mockIndicesCreate.mockResolvedValue({ acknowledged: true });

      const result = await createDefenderIndex();
      expect(result.created).toBe(true);
      expect(result.message).toContain(DEFENDER_INDEX);
      expect(mockIndicesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ index: DEFENDER_INDEX }),
      );
    });

    it('returns false if index already exists (400)', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400 });

      const result = await createDefenderIndex();
      expect(result.created).toBe(false);
      expect(result.message).toContain('already exists');
    });

    it('throws on ES not configured', async () => {
      mockGetSettings.mockReturnValue({ configured: false });

      await expect(createDefenderIndex()).rejects.toThrow('not configured');
    });

    it('re-throws unexpected errors', async () => {
      mockIndicesCreate.mockRejectedValue(new Error('cluster down'));

      await expect(createDefenderIndex()).rejects.toThrow('cluster down');
    });
  });

  describe('listDefenderIndices', () => {
    it('returns index info', async () => {
      mockCatIndices.mockResolvedValue([
        { index: DEFENDER_INDEX, 'docs.count': '42', 'store.size': '1024', health: 'green' },
      ]);

      const indices = await listDefenderIndices();
      expect(indices).toHaveLength(1);
      expect(indices[0].name).toBe(DEFENDER_INDEX);
      expect(indices[0].docsCount).toBe(42);
    });

    it('returns empty array on 404', async () => {
      mockCatIndices.mockRejectedValue({ statusCode: 404 });

      const indices = await listDefenderIndices();
      expect(indices).toEqual([]);
    });
  });
});
