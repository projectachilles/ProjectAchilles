import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { ALERT_HOST_DAYS, resolveVendorHostScope } from '../vendor-host-scope.js';
import { SENTINELONE_POSTURE_INDEX } from '../../sentinelone/index-management.js';
import { SOPHOS_INDEX } from '../../sophos/index-management.js';

const mockSearch = vi.fn();
const client = { search: mockSearch } as unknown as Client;
const NOW = Date.parse('2026-11-07T12:00:00.000Z');

const terms = (keys: string[]) => ({ hits: { hits: [] }, aggregations: { hosts: { buckets: keys.map((key) => ({ key, doc_count: 1 })) } } });
const sources = (docs: unknown[]) => ({ hits: { hits: docs.map((_source) => ({ _source })) } });
const notFound = Object.assign(new Error('index_not_found_exception'), { meta: { statusCode: 404 } });

beforeEach(() => mockSearch.mockReset());

describe('resolveVendorHostScope', () => {
  it('SentinelOne: its agent inventory', async () => {
    mockSearch.mockResolvedValueOnce(terms(['WS-01', 'WS-02']));
    const scope = await resolveVendorHostScope(client, 'sentinelone', 'achilles-sentinelone', NOW);
    expect(scope).toEqual({ source: 'inventory', hostnames: ['WS-01', 'WS-02'] });
    const req = mockSearch.mock.calls[0][0];
    expect(req.index).toBe(SENTINELONE_POSTURE_INDEX);
    expect(req.query).toEqual({ term: { doc_type: 'agent' } });
    expect(req.aggs.hosts.terms.field).toBe('computer_name');
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('Sophos: its endpoint inventory, read from _source', async () => {
    mockSearch.mockResolvedValueOnce(sources([{ endpoint: { hostname: 'ws-03' } }, { endpoint: {} }, {}]));
    const scope = await resolveVendorHostScope(client, 'sophos', SOPHOS_INDEX, NOW);
    expect(scope).toEqual({ source: 'inventory', hostnames: ['ws-03'] });
    const req = mockSearch.mock.calls[0][0];
    expect(req.index).toBe(SOPHOS_INDEX);
    expect(req.query).toEqual({ term: { doc_type: 'endpoint_health' } });
    expect(req._source).toEqual(['endpoint.hostname']);
  });

  it('CrowdStrike and Defender (no stored inventory): hosts with one of their alerts in the last 90 days', async () => {
    for (const [vendor, index] of [['crowdstrike', 'achilles-crowdstrike'], ['defender', 'achilles-defender']] as const) {
      mockSearch.mockReset();
      mockSearch.mockResolvedValueOnce(terms(['WS-04.corp.example']));
      const scope = await resolveVendorHostScope(client, vendor, index, NOW);
      expect(scope).toEqual({ source: 'alerts', hostnames: ['WS-04.corp.example'] });
      expect(mockSearch).toHaveBeenCalledTimes(1);
      const req = mockSearch.mock.calls[0][0];
      expect(req.index).toBe(index);
      expect(req.size).toBe(0);
      expect(req.query.bool.filter).toEqual([
        { term: { doc_type: 'alert' } },
        { range: { created_at: { gte: new Date(NOW - ALERT_HOST_DAYS * 86_400_000).toISOString() } } },
      ]);
      expect(req.aggs.hosts.terms.field).toBe('evidence_hostnames.keyword');
    }
    expect(ALERT_HOST_DAYS).toBe(90);
  });

  it('an empty or missing inventory falls back to alert hosts', async () => {
    mockSearch.mockResolvedValueOnce(terms([])).mockResolvedValueOnce(terms(['WS-05']));
    expect(await resolveVendorHostScope(client, 'sentinelone', 'achilles-sentinelone', NOW))
      .toEqual({ source: 'alerts', hostnames: ['WS-05'] });

    mockSearch.mockReset();
    mockSearch.mockRejectedValueOnce(notFound).mockResolvedValueOnce(terms(['WS-06']));
    expect(await resolveVendorHostScope(client, 'sophos', SOPHOS_INDEX, NOW))
      .toEqual({ source: 'alerts', hostnames: ['WS-06'] });
  });

  it('no inventory and no alerts: no scope (the tab counts every host and says so)', async () => {
    mockSearch.mockRejectedValueOnce(notFound);
    expect(await resolveVendorHostScope(client, 'crowdstrike', 'achilles-crowdstrike', NOW)).toBeUndefined();
  });

  it('any other error is not mistaken for "no hosts"', async () => {
    mockSearch.mockRejectedValueOnce(Object.assign(new Error('boom'), { meta: { statusCode: 500 } }));
    await expect(resolveVendorHostScope(client, 'sentinelone', 'achilles-sentinelone', NOW)).rejects.toThrow('boom');
  });
});
