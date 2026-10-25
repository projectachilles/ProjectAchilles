import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SentinelOneClient,
  SentinelOnePermissionError,
  SentinelOneApiError,
  normalizeSentinelOneBaseUrl,
} from '../s1-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const BASE = 'https://example-tenant.sentinelone.net';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('normalizeSentinelOneBaseUrl', () => {
  it('accepts *.sentinelone.net and strips trailing slash', () => {
    expect(normalizeSentinelOneBaseUrl('https://Example-Tenant.sentinelone.net/')).toBe(BASE);
    expect(normalizeSentinelOneBaseUrl('https://usea1-001.sentinelone.net')).toBe('https://usea1-001.sentinelone.net');
    expect(normalizeSentinelOneBaseUrl('https://agency.s1gov.net')).toBe('https://agency.s1gov.net');
  });

  it.each([
    ['http://example.sentinelone.net', /https/],
    ['https://evil.com', /sentinelone\.net/],
    ['https://sentinelone.net.evil.com', /sentinelone\.net/],
    ['https://user:pw@x.sentinelone.net', /credentials/],
    ['https://x.sentinelone.net:8443', /port/],
    ['https://x.sentinelone.net/web/api', /bare console host/],
    ['not a url', /Invalid/],
  ])('rejects %s', (url, msg) => {
    expect(() => normalizeSentinelOneBaseUrl(url)).toThrow(msg);
  });
});

describe('SentinelOneClient', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends the ApiToken header and comma-joined scope params', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: '1' }], pagination: { nextCursor: 'abc', totalItems: 5 } }));
    const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
    const res = await client.listThreats({ accountIds: ['111', '222'], limit: 10, siteIds: [] });

    expect(res).toEqual({ data: [{ id: '1' }], nextCursor: 'abc', total: 5 });
    const [url, init] = mockFetch.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${BASE}/web/api/v2.1/threats`);
    expect(u.searchParams.get('accountIds')).toBe('111,222');
    expect(u.searchParams.has('siteIds')).toBe(false);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`ApiToken ${TOKEN}`);
  });

  it('follows nextCursor until exhausted and guards against repeated cursors', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: '1' }], pagination: { nextCursor: 'c1' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: '2' }], pagination: { nextCursor: 'c1' } }));
    const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
    const pages: unknown[][] = [];
    for await (const page of client.paginate((p) => client.listCloudDetectionAlerts(p), {})) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(new URL(mockFetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('c1');
    expect(new URL(mockFetch.mock.calls[0][0]).pathname).toBe('/web/api/v2.1/cloud-detection/alerts');
  });

  it('retries on 429 honoring Retry-After', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
    const p = client.listThreats({});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ data: [], nextCursor: undefined, total: undefined });
    vi.useRealTimers();
  });

  it('throws SentinelOneApiError with a hint on 401 and never includes the token', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"errors":[{"title":"Unauthorized"}]}', { status: 401 }));
    const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
    const err = await client.listThreats({}).catch((e) => e);
    expect(err).toBeInstanceOf(SentinelOneApiError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('API token');
    expect(err.message).not.toContain(TOKEN);
  });

  describe('permission boundary', () => {
    it('read_only mode refuses mitigation without touching the network', async () => {
      const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
      await expect(client.mitigateThreats('kill', ['123'])).rejects.toBeInstanceOf(SentinelOnePermissionError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('response mode POSTs the kill body used by the XDR flow', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: { affected: 1 } }));
      const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'response' });
      await expect(client.mitigateThreats('kill', ['1234567890'])).resolves.toEqual({ affected: 1 });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE}/web/api/v2.1/threats/mitigate/kill`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ filter: { ids: ['1234567890'] }, data: {} });
    });

    it('refuses an empty, oversized or non-numeric id list before any request', async () => {
      const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'response' });
      await expect(client.mitigateThreats('kill', [])).rejects.toThrow(/at least one id/);
      await expect(client.mitigateThreats('kill', Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow(/at most 100/);
      await expect(client.mitigateThreats('kill', ['1 OR 1=1'])).rejects.toThrow(/numeric/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects anything but kill / quarantine even in response mode', async () => {
      const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'response' });
      for (const action of ['delete-everything', 'remediate', 'rollback-remediation', 'un-quarantine']) {
        await expect(client.mitigateThreats(action as never, ['1'])).rejects.toBeInstanceOf(SentinelOnePermissionError);
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it('testConnection reports success with the visible threat count', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], pagination: { totalItems: 42 } }));
    const client = new SentinelOneClient({ base_url: BASE, api_token: TOKEN, permission_mode: 'read_only' });
    const res = await client.testConnection();
    expect(res.success).toBe(true);
    expect(res.message).toContain('42');
  });
});
