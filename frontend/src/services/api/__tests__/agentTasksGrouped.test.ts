import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { get: getMock } }));

const { agentApi } = await import('../agent');

describe('agentApi.listTasksGrouped', () => {
  beforeEach(() => {
    getMock.mockReset().mockResolvedValue({
      data: { data: { groups: [], total: 0, type_counts: { execute_test: 4, update_agent: 50 } } },
    });
  });

  it('sends several types as one comma-separated type param', async () => {
    await agentApi.listTasksGrouped({ types: ['update_agent', 'uninstall'], limit: 25 });
    expect(getMock).toHaveBeenCalledWith('/agent/admin/tasks/grouped', { params: { type: 'update_agent,uninstall', limit: 25 } });
  });

  it('sends no type for All, and returns the per-type counts', async () => {
    const res = await agentApi.listTasksGrouped({ limit: 25 });
    expect(getMock.mock.calls[0][1]).toEqual({ params: { limit: 25 } });
    expect(res.typeCounts).toEqual({ execute_test: 4, update_agent: 50 });
  });
});
