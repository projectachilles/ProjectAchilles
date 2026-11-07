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
const mockIndicesPutMapping = vi.fn();
const mockIndicesGetMapping = vi.fn();
const mockCatIndices = vi.fn();
const mockIndex = vi.fn();

vi.mock('../client.js', () => ({
  createEsClient: vi.fn(() => ({
    indices: {
      exists: mockIndicesExists,
      create: mockIndicesCreate,
      putMapping: mockIndicesPutMapping,
      getMapping: mockIndicesGetMapping,
    },
    cat: {
      indices: mockCatIndices,
    },
    index: mockIndex,
  })),
}));

const { createResultsIndex, listResultsIndices, RESULTS_INDEX_MAPPING, missingMappingProperties } =
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
    mockIndicesPutMapping.mockResolvedValue({});
    mockIndicesGetMapping.mockResolvedValue({});
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

  // ── missingMappingProperties ───────────────────────────────

  describe('missingMappingProperties', () => {
    it('returns nested fields missing from the live mapping, keeping existing ones out', () => {
      const { missing, conflicts } = missingMappingProperties(
        { a: { type: 'keyword' }, obj: { properties: { x: { type: 'keyword' } } } },
        { a: { type: 'keyword' }, b: { type: 'boolean' }, obj: { properties: { x: { type: 'keyword' }, y: { type: 'date' } } } },
      );
      expect(missing).toEqual({ b: { type: 'boolean' }, obj: { properties: { y: { type: 'date' } } } });
      expect(conflicts).toEqual([]);
    });

    it('reports a type conflict and skips the field', () => {
      const { missing, conflicts } = missingMappingProperties(
        { n: { type: 'integer' }, leaf: { type: 'text' } },
        { n: { type: 'long' }, leaf: { properties: { k: { type: 'keyword' } } } },
      );
      expect(missing).toEqual({});
      expect(conflicts).toEqual(['n: integer (wanted long)', 'leaf: text (wanted object)']);
    });

    it('returns nothing when the live mapping matches', () => {
      const props = RESULTS_INDEX_MAPPING.mappings.properties;
      expect(missingMappingProperties(props, props)).toEqual({ missing: {}, conflicts: [] });
    });
  });

  // ── createResultsIndex ─────────────────────────────────────

  describe('createResultsIndex', () => {
    it('throws when Elasticsearch is not configured', async () => {
      mockGetSettings.mockReturnValue({ configured: false });

      await expect(createResultsIndex('test-index'))
        .rejects.toThrow('Elasticsearch is not configured');
    });

    it('adds the full mapping to an existing results index that has no fields yet', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });
      mockIndicesGetMapping.mockResolvedValue({ 'achilles-results-existing': { mappings: {} } });

      const result = await createResultsIndex('achilles-results-existing');

      expect(result.created).toBe(false);
      expect(result.message).toContain('mappings updated');
      expect(mockIndicesPutMapping).toHaveBeenCalledWith({
        index: 'achilles-results-existing', properties: RESULTS_INDEX_MAPPING.mappings.properties,
      });
    });

    // An install whose single results index predates the canonical mapping was
    // dynamically mapped: event.ERROR integer, defender_prevention_action text.
    // ES rejects a putMapping that changes a type (illegal_argument_exception,
    // all-or-nothing), which used to abort every result write.
    const legacyLiveMapping = {
      'achilles-results-': {
        mappings: {
          properties: {
            routing: { properties: { event_time: { type: 'date' }, oid: { type: 'keyword' }, hostname: { type: 'keyword' } } },
            event: { properties: { ERROR: { type: 'integer' } } },
            f0rtika: {
              properties: {
                test_uuid: { type: 'keyword' },
                control_description: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
                defender_prevention_action: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
              },
            },
          },
        },
      },
    };

    it('adds only missing fields to a legacy index and never re-sends conflicting ones', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });
      mockIndicesGetMapping.mockResolvedValue(legacyLiveMapping);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await createResultsIndex('achilles-results-');

      expect(result.created).toBe(false);
      expect(mockIndicesPutMapping).toHaveBeenCalledTimes(1);
      const sent = mockIndicesPutMapping.mock.calls[0][0].properties;
      // Existing fields are never re-sent, whatever their type.
      expect(sent.event.properties.ERROR).toBeUndefined();
      expect(sent.event.properties.ERROR_raw).toEqual({ type: 'keyword' });
      expect(sent.f0rtika.properties.test_uuid).toBeUndefined();
      expect(sent.f0rtika.properties.control_description).toBeUndefined();
      expect(sent.f0rtika.properties.defender_prevention_action).toBeUndefined();
      expect(sent.f0rtika.properties.compliant).toEqual({ type: 'boolean' });
      expect(sent.routing).toBeUndefined();
      // The type conflicts are reported once, not fixed.
      expect(warn.mock.calls.flat().join(' ')).toMatch(/event\.ERROR.*integer.*long/);
      warn.mockRestore();
    });

    it('skips putMapping when the existing index already has every field', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });
      mockIndicesGetMapping.mockResolvedValue({ 'achilles-results-2026.11': RESULTS_INDEX_MAPPING });

      const result = await createResultsIndex('achilles-results-2026.11');

      expect(result).toEqual({ created: false, message: 'Index "achilles-results-2026.11" already exists; mappings up to date' });
      expect(mockIndicesPutMapping).not.toHaveBeenCalled();
    });

    it('does not fail when the mapping update is rejected (the index stays writable)', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });
      mockIndicesGetMapping.mockResolvedValue({ 'achilles-results-': { mappings: {} } });
      mockIndicesPutMapping.mockRejectedValue(Object.assign(new Error('illegal_argument_exception'), { statusCode: 400 }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await createResultsIndex('achilles-results-');

      expect(result.created).toBe(false);
      expect(result.message).toContain('mapping update failed');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not fail when the live mapping cannot be read', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });
      mockIndicesGetMapping.mockRejectedValue(Object.assign(new Error('security_exception'), { statusCode: 403 }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await createResultsIndex('achilles-results-');

      expect(result.created).toBe(false);
      expect(result.message).toContain('mapping update failed');
      expect(mockIndicesPutMapping).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not update mappings on an existing non-results index', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 400, message: 'resource_already_exists_exception' });

      const result = await createResultsIndex('achilles-sophos');

      expect(result).toEqual({ created: false, message: 'Index "achilles-sophos" already exists' });
      expect(mockIndicesPutMapping).not.toHaveBeenCalled();
    });

    it('creates index with correct mapping when it does not exist', async () => {
      mockIndicesCreate.mockResolvedValue({});

      const result = await createResultsIndex('new-index');

      expect(result.created).toBe(true);
      expect(result.message).toContain('created successfully');
      expect(mockIndicesCreate).toHaveBeenCalledWith({
        index: 'new-index',
        ...RESULTS_INDEX_MAPPING,
        settings: { 'index.auto_expand_replicas': '0-1' },
      });
    });

    it('re-throws non-400 ES errors', async () => {
      mockIndicesCreate.mockRejectedValue({ statusCode: 403, message: 'security_exception' });

      await expect(createResultsIndex('test-index')).rejects.toEqual({ statusCode: 403, message: 'security_exception' });
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
