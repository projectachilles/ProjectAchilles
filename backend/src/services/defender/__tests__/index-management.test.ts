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
const mockIndicesExists = vi.fn();
const mockPutMapping = vi.fn();

vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    indices: {
      create: mockIndicesCreate,
      exists: mockIndicesExists,
      putMapping: mockPutMapping,
    },
    cat: { indices: mockCatIndices },
  }),
}));

const {
  createDefenderIndex,
  listDefenderIndices,
  ensureDefenderIndexMappings,
  DEFENDER_INDEX,
  DEFENDER_INDEX_MAPPING,
} = await import('../index-management.js');

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

  describe('DEFENDER_INDEX_MAPPING', () => {
    it('includes f0rtika sub-object with correlation + auto-resolve fields', () => {
      const props = DEFENDER_INDEX_MAPPING.mappings.properties as Record<string, any>;
      expect(props.f0rtika).toBeDefined();
      expect(props.f0rtika.properties.achilles_correlated.type).toBe('boolean');
      expect(props.f0rtika.properties.achilles_test_uuid.type).toBe('keyword');
      expect(props.f0rtika.properties.achilles_matched_at.type).toBe('date');
      expect(props.f0rtika.properties.auto_resolved.type).toBe('boolean');
      expect(props.f0rtika.properties.auto_resolved_at.type).toBe('date');
      expect(props.f0rtika.properties.auto_resolve_mode.type).toBe('keyword');
      expect(props.f0rtika.properties.auto_resolve_error.type).toBe('keyword');
    });
  });

  describe('ensureDefenderIndexMappings', () => {
    it('calls putMapping when the index exists', async () => {
      mockIndicesExists.mockResolvedValueOnce(true);
      mockPutMapping.mockResolvedValueOnce({ acknowledged: true });

      await ensureDefenderIndexMappings();

      expect(mockPutMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          index: DEFENDER_INDEX,
          properties: expect.any(Object),
        }),
      );
    });

    it('skips putMapping when the index does not exist', async () => {
      mockIndicesExists.mockResolvedValueOnce(false);

      await ensureDefenderIndexMappings();

      expect(mockPutMapping).not.toHaveBeenCalled();
    });

    it('no-ops when Elasticsearch is not configured', async () => {
      mockGetSettings.mockReturnValue({ configured: false });

      await ensureDefenderIndexMappings();

      expect(mockIndicesExists).not.toHaveBeenCalled();
      expect(mockPutMapping).not.toHaveBeenCalled();
    });

    it('swallows transient errors without throwing', async () => {
      mockIndicesExists.mockRejectedValueOnce(new Error('cluster transient'));

      await expect(ensureDefenderIndexMappings()).resolves.toBeUndefined();
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
