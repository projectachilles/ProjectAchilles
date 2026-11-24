import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { get: getMock } }));

const { analyticsApi } = await import('../analytics');

describe('analyticsApi.getGroupedPaginatedExecutions versionState', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { groups: [], pagination: {} } });
  });

  it('passes versionState to the paginated endpoint with the other filters', async () => {
    await analyticsApi.getGroupedPaginatedExecutions({ versionState: 'older', result: 'unprotected', page: 2 });
    expect(getMock).toHaveBeenCalledWith('/analytics/executions/paginated', {
      params: { versionState: 'older', result: 'unprotected', page: 2, grouped: true },
    });
  });
});
