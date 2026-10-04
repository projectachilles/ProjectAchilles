import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = mockGetSettings;
  },
}));

const mockIndicesCreate = vi.fn();
const mockIndicesExists = vi.fn();
vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    indices: { create: mockIndicesCreate, exists: mockIndicesExists },
  }),
}));

const { ensureDefenderIndex, DEFENDER_INDEX } = await import('../index-management.js');

describe('ensureDefenderIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      configured: true,
      connectionType: 'node',
      node: 'http://localhost:9200',
    });
  });

  it('does not attempt to create an index that already exists', async () => {
    // A least-privilege API key (read/write on the index, no create_index)
    // gets a 403 from indices.create even when the index exists — ES checks
    // privileges before existence. That 403 used to abort every sync.
    mockIndicesExists.mockResolvedValueOnce(true);
    mockIndicesCreate.mockRejectedValue({ statusCode: 403 });

    await expect(ensureDefenderIndex()).resolves.toBeUndefined();
    expect(mockIndicesCreate).not.toHaveBeenCalled();
  });

  it('creates the index when it is missing', async () => {
    mockIndicesExists.mockResolvedValueOnce(false);
    mockIndicesCreate.mockResolvedValueOnce({ acknowledged: true });

    await ensureDefenderIndex();
    expect(mockIndicesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ index: DEFENDER_INDEX }),
    );
  });

  it('throws when Elasticsearch is not configured', async () => {
    mockGetSettings.mockResolvedValue({ configured: false });

    await expect(ensureDefenderIndex()).rejects.toThrow('not configured');
  });
});
