import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockGetSettings = vi.fn();
const mockIsConfigured = vi.fn();

vi.mock('../settings.js', () => ({
  SettingsService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getSettings = mockGetSettings;
    this.isConfigured = mockIsConfigured;
  }),
}));

const mockIndicesExists = vi.fn();
const mockIndicesCreate = vi.fn();
const mockCatIndices = vi.fn();
const mockIndex = vi.fn();

vi.mock('../client.js', () => ({
  createEsClient: vi.fn(() => ({
    indices: {
      exists: mockIndicesExists,
      create: mockIndicesCreate,
    },
    cat: {
      indices: mockCatIndices,
    },
    index: mockIndex,
  })),
}));

const { createResultsIndex, listResultsIndices, RESULTS_INDEX_MAPPING } =
  await import('../index-management.service.js');

// ── Helpers ──────────────────────────────────────────────────────────

function configuredSettings() {
  return {
    connectionType: 'direct' as const,
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'f0rtika-*',
    configured: true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('index-management.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue(configuredSettings());
  });

  // ── RESULTS_INDEX_MAPPING ──────────────────────────────────

  describe('RESULTS_INDEX_MAPPING', () => {
    it('defines routing, f0rtika, and event mapping properties', () => {
      const props = RESULTS_INDEX_MAPPING.mappings.properties;
      expect(props.routing).toBeDefined();
      expect(props.f0rtika).toBeDefined();
      expect(props.event).toBeDefined();
    });

    it('has correct types for key fields', () => {
      const f0rtika = RESULTS_INDEX_MAPPING.mappings.properties.f0rtika.properties;
      expect(f0rtika.test_uuid.type).toBe('keyword');
      expect(f0rtika.is_protected.type).toBe('boolean');
      expect(f0rtika.score.type).toBe('float');
      expect(f0rtika.techniques.type).toBe('keyword');
    });
  });

  // ── createResultsIndex ─────────────────────────────────────

  describe('createResultsIndex', () => {
    it('throws when Elasticsearch is not configured', async () => {
      mockGetSettings.mockReturnValue({ configured: false });

      await expect(createResultsIndex('test-index'))
        .rejects.toThrow('Elasticsearch is not configured');
    });

    it('returns created=false when index already exists', async () => {
      mockIndicesExists.mockResolvedValue(true);

      const result = await createResultsIndex('existing-index');

      expect(result.created).toBe(false);
      expect(result.message).toContain('already exists');
      expect(mockIndicesCreate).not.toHaveBeenCalled();
    });

    it('creates index with correct mapping when it does not exist', async () => {
      mockIndicesExists.mockResolvedValue(false);
      mockIndicesCreate.mockResolvedValue({});

      const result = await createResultsIndex('new-index');

      expect(result.created).toBe(true);
      expect(result.message).toContain('created successfully');
      expect(mockIndicesCreate).toHaveBeenCalledWith({
        index: 'new-index',
        ...RESULTS_INDEX_MAPPING,
      });
    });
  });

  // ── listResultsIndices ─────────────────────────────────────

  describe('listResultsIndices', () => {
    it('throws when Elasticsearch is not configured', async () => {
      mockGetSettings.mockReturnValue({ configured: false });

      await expect(listResultsIndices('f0rtika-*'))
        .rejects.toThrow('Elasticsearch is not configured');
    });

    it('parses and returns index info from cat.indices response', async () => {
      mockCatIndices.mockResolvedValue([
        { index: 'f0rtika-2026-01', 'docs.count': '100', 'store.size': '5000', health: 'green' },
        { index: 'f0rtika-2026-02', 'docs.count': '200', 'store.size': '8000', health: 'yellow' },
      ]);

      const result = await listResultsIndices('f0rtika-*');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'f0rtika-2026-01',
        docsCount: 100,
        storeSize: 5000,
        status: 'green',
      });
    });

    it('sorts indices alphabetically by name', async () => {
      mockCatIndices.mockResolvedValue([
        { index: 'z-index', 'docs.count': '0', 'store.size': '0', health: 'green' },
        { index: 'a-index', 'docs.count': '0', 'store.size': '0', health: 'green' },
      ]);

      const result = await listResultsIndices('*');

      expect(result[0].name).toBe('a-index');
      expect(result[1].name).toBe('z-index');
    });

    it('returns empty array on ES 404 (no matching indices)', async () => {
      const notFoundError = { statusCode: 404, message: 'index_not_found_exception' };
      mockCatIndices.mockRejectedValue(notFoundError);

      const result = await listResultsIndices('nonexistent-*');

      expect(result).toEqual([]);
    });

    it('re-throws non-404 ES errors', async () => {
      const serverError = { statusCode: 500, message: 'Internal server error' };
      mockCatIndices.mockRejectedValue(serverError);

      await expect(listResultsIndices('f0rtika-*')).rejects.toEqual(serverError);
    });

    it('falls back to dataset.size when store.size is 0 (serverless)', async () => {
      mockCatIndices.mockResolvedValue([
        {
          index: 'serverless-idx',
          'docs.count': '50',
          'store.size': '0',
          'dataset.size': '12345',
          health: 'green',
        },
      ]);

      const result = await listResultsIndices('serverless-*');

      expect(result[0].storeSize).toBe(12345);
    });

    it('handles missing fields with defaults', async () => {
      mockCatIndices.mockResolvedValue([
        { index: undefined, 'docs.count': undefined, 'store.size': undefined, health: undefined },
      ]);

      const result = await listResultsIndices('*');

      expect(result[0]).toEqual({
        name: '',
        docsCount: 0,
        storeSize: 0,
        status: 'unknown',
      });
    });

    it('returns empty array for non-array response', async () => {
      mockCatIndices.mockResolvedValue('not-an-array');

      const result = await listResultsIndices('*');

      expect(result).toEqual([]);
    });
  });
});
