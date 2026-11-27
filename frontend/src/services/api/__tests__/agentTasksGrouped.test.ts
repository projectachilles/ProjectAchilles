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
    expect(getMock).toHaveBeenCalledWith('/agent/admin/tasks/grouped', { params: { type: 'update_agent,uninstall', limit: 25, detail: 'summary' } });
  });

  it('sends no type for All, and returns the per-type counts', async () => {
    const res = await agentApi.listTasksGrouped({ limit: 25 });
    expect(getMock.mock.calls[0][1]).toEqual({ params: { limit: 25, detail: 'summary' } });
    expect(res.typeCounts).toEqual({ execute_test: 4, update_agent: 50 });
  });

  it('asks for light tasks: a list draws no output, and the detail panel fetches the task it shows', async () => {
    await agentApi.listTasksGrouped();
    expect(getMock.mock.calls[0][1]).toEqual({ params: { detail: 'summary' } });
  });
});

describe('agentApi.getTaskActivity', () => {
  beforeEach(() => {
    getMock.mockReset().mockResolvedValue({ data: { data: { interval: 'day', timeZone: 'UTC', buckets: [] } } });
  });

  it('sends the type pills as one comma-separated type, the search, and the time zone', async () => {
    const res = await agentApi.getTaskActivity({ types: ['update_agent', 'uninstall'], search: 'HOST-1' }, 'America/Santo_Domingo');

    expect(getMock).toHaveBeenCalledWith('/agent/admin/tasks/activity', {
      params: { tz: 'America/Santo_Domingo', type: 'update_agent,uninstall', search: 'HOST-1' },
    });
    expect(res).toEqual({ interval: 'day', timeZone: 'UTC', buckets: [] });
  });

  it('sends neither for All and an empty search', async () => {
    await agentApi.getTaskActivity({ types: [], search: '' }, 'UTC');
    expect(getMock.mock.calls[0][1]).toEqual({ params: { tz: 'UTC' } });
  });
});

describe('agentApi.listTasksGrouped with a day of the activity strip', () => {
  beforeEach(() => {
    getMock.mockReset().mockResolvedValue({ data: { data: { groups: [], total: 0 } } });
  });

  it('sends its two instants as from and to', async () => {
    await agentApi.listTasksGrouped({ from: '2026-11-26T04:00:00.000Z', to: '2026-11-27T03:59:59.999Z', limit: 25 });
    expect(getMock.mock.calls[0][1]).toEqual({
      params: { from: '2026-11-26T04:00:00.000Z', to: '2026-11-27T03:59:59.999Z', limit: 25, detail: 'summary' },
    });
  });
});
