import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SentinelOneClient, SentinelOnePermissionError } from '../s1-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const BASE = 'https://example-tenant.sentinelone.net';
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const client = (mode: 'read_only' | 'response') => new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: mode });

describe('SentinelOneClient incident lifecycle (auto-resolve)', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POST /threats/incident sets incidentStatus only — no analyst verdict', async () => {
    mockFetch.mockResolvedValueOnce(ok({ data: { affected: 1 } }));
    await expect(client('response').updateThreatIncidentStatus(['123'], 'resolved')).resolves.toEqual({ affected: 1 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/web/api/v2.1/threats/incident`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ filter: { ids: ['123'] }, data: { incidentStatus: 'resolved' } });
    expect(JSON.stringify(body)).not.toMatch(/verdict/i);
  });

  it('POST /threats/notes and /cloud-detection/alerts/incident', async () => {
    mockFetch.mockImplementation(async () => ok({ data: { affected: 1 } }));
    await client('response').addThreatNote(['123'], 'note');
    await client('response').updateAlertIncidentStatus(['456'], 'resolved');
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/web/api/v2.1/threats/notes`);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ filter: { ids: ['123'] }, data: { text: 'note' } });
    expect(mockFetch.mock.calls[1][0]).toBe(`${BASE}/web/api/v2.1/cloud-detection/alerts/incident`);
  });

  it('refuses every incident write in read-only mode before the network', async () => {
    await expect(client('read_only').updateThreatIncidentStatus(['1'], 'resolved')).rejects.toBeInstanceOf(SentinelOnePermissionError);
    await expect(client('read_only').addThreatNote(['1'], 'x')).rejects.toBeInstanceOf(SentinelOnePermissionError);
    await expect(client('read_only').updateAlertIncidentStatus(['1'], 'resolved')).rejects.toBeInstanceOf(SentinelOnePermissionError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects non-numeric ids and empty / oversized batches', async () => {
    await expect(client('response').updateThreatIncidentStatus(['../x'], 'resolved')).rejects.toThrow(/numeric/);
    await expect(client('response').updateThreatIncidentStatus([], 'resolved')).rejects.toThrow(/at least one/);
    await expect(client('response').updateThreatIncidentStatus(Array(101).fill('1'), 'resolved')).rejects.toThrow(/at most 100/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SentinelOneClient posture reads (GET only)', () => {
  beforeEach(() => mockFetch.mockReset());

  it('reads exclusions, sites, groups, policy and agent counts with GET', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ data: [{ id: '1', type: 'path', value: 'C:\\F0' }], pagination: { nextCursor: null } }))
      .mockResolvedValueOnce(ok({ data: { sites: [{ id: '22', name: 'Prod' }] }, pagination: {} }))
      .mockResolvedValueOnce(ok({ data: [{ id: '33', inherits: true }] }))
      .mockResolvedValueOnce(ok({ data: { mitigationMode: 'protect' } }))
      .mockResolvedValueOnce(ok({ data: { total: 7 } }));
    const c = client('read_only');
    expect((await c.listExclusions({ siteIds: ['22'] })).data).toHaveLength(1);
    expect((await c.listSites({})).data[0]).toMatchObject({ id: '22' });
    expect((await c.listGroups({ siteIds: ['22'] })).data[0]).toMatchObject({ id: '33' });
    expect(await c.getPolicy('site', '22')).toEqual({ mitigationMode: 'protect' });
    expect(await c.countAgents({ infected: 'true' })).toBe(7);
    for (const [, init] of mockFetch.mock.calls) expect(init.method).toBe('GET');
    expect(mockFetch.mock.calls[3][0]).toBe(`${BASE}/web/api/v2.1/sites/22/policy`);
    expect(mockFetch.mock.calls[4][0]).toBe(`${BASE}/web/api/v2.1/agents/count?infected=true`);
  });

  it('refuses a non-numeric policy id (no path injection)', async () => {
    await expect(client('read_only').getPolicy('group', '1/../../x')).rejects.toThrow(/Invalid/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
