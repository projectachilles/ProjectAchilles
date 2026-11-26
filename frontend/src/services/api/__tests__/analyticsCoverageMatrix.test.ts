import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { get: getMock } }));

const { analyticsApi } = await import('../analytics');

const SCOPE = { org: 'org-1', from: 'now-30d', to: 'now', hostnames: 'HOST-01' };

describe('coverage matrix client', () => {
  beforeEach(() => {
    getMock.mockReset().mockResolvedValue({ data: { rows: 'tests', hosts: [], tests: [] } });
  });

  it('asks for rows of tests with the scope', async () => {
    const res = await analyticsApi.getCoverageMatrix(SCOPE);

    expect(getMock).toHaveBeenCalledWith('/analytics/coverage-matrix', { params: { ...SCOPE, rows: 'tests' } });
    expect(res).toEqual({ rows: 'tests', hosts: [], tests: [] });
  });

  it('asks for a page of the hosts of one state of one test, as `state`', async () => {
    await analyticsApi.getCoverageMatrixHosts(SCOPE, { page: 2, pageSize: 25, test: 'a0000000-1234-4abc-8def-000000000001', state: 'unprotected' });

    expect(getMock).toHaveBeenCalledWith('/analytics/coverage-matrix', {
      params: { ...SCOPE, rows: 'hosts', page: 2, pageSize: 25, test: 'a0000000-1234-4abc-8def-000000000001', state: 'unprotected' },
    });
    // `verdict` is the executions list's filter, with other values.
    expect(getMock.mock.calls[0][1].params).not.toHaveProperty('verdict');
  });

  it('sends testUuid with the grouped executions of one pair', async () => {
    getMock.mockResolvedValue({ data: { groups: [], pagination: {} } });

    await analyticsApi.getGroupedPaginatedExecutions({ ...SCOPE, testUuid: 'a0000000-1234-4abc-8def-000000000001', page: 1, pageSize: 25 });

    expect(getMock).toHaveBeenCalledWith('/analytics/executions/paginated', {
      params: { ...SCOPE, testUuid: 'a0000000-1234-4abc-8def-000000000001', page: 1, pageSize: 25, grouped: true },
    });
  });
});
