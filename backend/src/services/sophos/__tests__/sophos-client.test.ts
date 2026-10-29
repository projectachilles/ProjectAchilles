import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SophosClient,
  SophosApiError,
  SophosPermissionError,
  SophosGraphQLError,
  assertSophosHost,
  assertPathAllowed,
  assertSophosRequestAllowed,
  SOPHOS_RESOLVE_MUTATION,
} from '../sophos-client.js';
import type { SophosCredentials } from '../../../types/sophos.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SECRET = 'super-secret-client-value-0123456789';
const READ_ONLY: SophosCredentials = { client_id: 'client-id-abc', client_secret: SECRET, permission_mode: 'read_only' };
const RESPONSE: SophosCredentials = { ...READ_ONLY, permission_mode: 'response' };
const TENANT = '11111111-2222-4333-8444-555555555555';
const ALERT_ID = 'f9415c5f-e0e9-41d7-8126-1956223a66f1';
const RUN_ID = '4a9bb69a-c7f1-4a59-b912-7fe4ba70b751';
const REGION = 'https://api-eu01.central.sophos.com';
const TOKEN_URL = 'https://id.sophos.com/api/v2/oauth2/token';
const WHOAMI_URL = 'https://api.central.sophos.com/whoami/v1';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

type Route = (url: URL, init: RequestInit) => Response | undefined;
let tokenCount = 0;

/** Default Sophos responses; `override` wins when it returns a Response. */
function routeFetch(override?: Route, whoami: Record<string, unknown> = { id: TENANT, idType: 'tenant', apiHosts: { global: 'https://api.central.sophos.com', dataRegion: REGION } }) {
  mockFetch.mockImplementation(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const custom = override?.(url, init);
    if (custom) return custom;
    if (url.href === TOKEN_URL) {
      tokenCount++;
      return jsonResponse({ access_token: `tok-${tokenCount}`, token_type: 'bearer', expires_in: 3600 });
    }
    if (url.href === WHOAMI_URL) return jsonResponse(whoami);
    if (url.pathname === '/graphql') return jsonResponse({ data: { detectionUpdateResolutionInfo: { resolution_status: 'SUCCESS', reason: 'r' } } });
    if (url.pathname === '/detections/v1/queries/detections') return jsonResponse({ id: RUN_ID, status: 'finished', result: 'succeeded' }, 201);
    if (url.pathname === `/detections/v1/queries/detections/${RUN_ID}`) return jsonResponse({ id: RUN_ID, status: 'finished', result: 'succeeded' });
    if (url.pathname.endsWith('/actions')) return jsonResponse({ id: RUN_ID, alertId: ALERT_ID, action: 'acknowledge', status: 'requested' }, 201);
    return jsonResponse({ items: [], pages: {} });
  });
}

const callsTo = (pathname: string) => mockFetch.mock.calls.filter(([u]) => new URL(u).pathname === pathname);

beforeEach(() => {
  mockFetch.mockReset();
  tokenCount = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('assertSophosHost', () => {
  it.each([
    'evil.example',
    'api-eu01.central.sophos.com.evil.io',
    'api.central.sophos.com:8443',
    'http://api-eu01.central.sophos.com',
    'api-eu1.central.sophos.com',
  ])('rejects %s', (host) => {
    expect(() => assertSophosHost(host)).toThrow(/not an allowed Sophos host/);
  });

  it.each(['api-eu01.central.sophos.com', 'api-us03.central.sophos.com', 'id.sophos.com', 'api.central.sophos.com', 'api.taegis.sophos.com'])(
    'accepts %s',
    (host) => {
      expect(assertSophosHost(host)).toBe(host);
    },
  );

  it.each(['https://api-eu01.central.sophos.com.evil.io', 'https://evil.example', 'http://api-eu01.central.sophos.com', 'https://u:p@api-eu01.central.sophos.com'])(
    'refuses a whoami dataRegion of %s and never sends a request there',
    async (dataRegion) => {
      routeFetch(undefined, { id: TENANT, idType: 'tenant', apiHosts: { dataRegion } });
      const client = new SophosClient(READ_ONLY);
      await expect(client.listAlerts({})).rejects.toThrow(/data region/);
      expect(mockFetch.mock.calls.every(([u]) => ['id.sophos.com', 'api.central.sophos.com'].includes(new URL(u).hostname))).toBe(true);
    },
  );
});

describe('SophosClient', () => {
  it('caches the token until 5 minutes before expiry and re-authenticates once on 401', async () => {
    let clock = 1_000_000;
    routeFetch();
    const client = new SophosClient(READ_ONLY, { now: () => clock });

    await client.whoami();
    await client.whoami();
    expect(tokenCount).toBe(1);
    const [, tokenInit] = mockFetch.mock.calls[0];
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(tokenInit.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('token');
    expect(form.get('client_id')).toBe('client-id-abc');

    clock += (3600 - 300) * 1000 - 1;
    await client.whoami();
    expect(tokenCount).toBe(1);
    clock += 1;
    await client.whoami();
    expect(tokenCount).toBe(2);

    // One 401 → fresh token, retried once with it.
    let unauthorized = 1;
    routeFetch((url) => (url.href === WHOAMI_URL && unauthorized-- > 0 ? new Response('expired', { status: 401 }) : undefined));
    await expect(client.whoami()).resolves.toMatchObject({ id: TENANT });
    expect(tokenCount).toBe(3);
    expect(mockFetch.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer tok-3');

    // A second 401 in a row is not retried again.
    routeFetch((url) => (url.href === WHOAMI_URL ? new Response('nope', { status: 401 }) : undefined));
    const err = await client.whoami().catch((e) => e);
    expect(err).toBeInstanceOf(SophosApiError);
    expect(err.statusCode).toBe(401);
    expect(tokenCount).toBe(4);
  });

  it('never puts the client secret in an error message', async () => {
    routeFetch((url) => (url.href === TOKEN_URL ? new Response(`bad client_secret=${SECRET}`, { status: 401 }) : undefined));
    const err = await new SophosClient(READ_ONLY).whoami().catch((e) => e);
    expect(err).toBeInstanceOf(SophosApiError);
    expect(err.message).not.toContain(SECRET);
    expect(err.bodySnippet).not.toContain(SECRET);
  });

  it('whoami rejects a partner credential with a tenant-credential message', async () => {
    routeFetch(undefined, { id: TENANT, idType: 'partner', apiHosts: { global: 'https://api.central.sophos.com' } });
    const err = await new SophosClient(READ_ONLY).whoami().catch((e) => e);
    expect(err).toBeInstanceOf(SophosApiError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Use a Sophos tenant API credential (this one is a partner credential)');
  });

  it('follows pages.nextKey until absent', async () => {
    const pages: Record<string, unknown> = {
      '': { items: [{ id: 'a' }], pages: { nextKey: 'k1' } },
      k1: { items: [{ id: 'b' }], pages: { nextKey: 'k2' } },
      k2: { items: [{ id: 'c' }], pages: {} },
    };
    routeFetch((url) => (url.pathname === '/common/v1/alerts' ? jsonResponse(pages[url.searchParams.get('pageFromKey') ?? '']) : undefined));
    const client = new SophosClient(READ_ONLY);
    const seen: unknown[][] = [];
    for await (const page of client.paginateKey((key) => client.listAlerts({ pageFromKey: key, pageSize: 100, ids: [ALERT_ID, ALERT_ID] }))) seen.push(page);

    expect(seen).toEqual([[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]]);
    const alertCalls = callsTo('/common/v1/alerts');
    expect(alertCalls).toHaveLength(3);
    const [url, init] = alertCalls[1];
    const u = new URL(url);
    expect(u.origin).toBe(REGION);
    expect(u.searchParams.get('pageFromKey')).toBe('k1');
    expect(u.searchParams.get('ids')).toBe(`${ALERT_ID},${ALERT_ID}`);
    expect(init.headers['X-Tenant-ID']).toBe(TENANT);
    expect(init.headers.Authorization).toBe('Bearer tok-1');
  });

  it('stops on a repeated key', async () => {
    routeFetch((url) => (url.pathname === '/common/v1/alerts' ? jsonResponse({ items: [{ id: 'x' }], pages: { nextKey: 'k1' } }) : undefined));
    const client = new SophosClient(READ_ONLY);
    const seen: unknown[][] = [];
    for await (const page of client.paginateKey((key) => client.listAlerts({ pageFromKey: key }))) seen.push(page);
    expect(seen).toHaveLength(2);
    expect(callsTo('/common/v1/alerts')).toHaveLength(2);
  });

  it('throws on a 200 response that carries GraphQL errors', async () => {
    routeFetch((url) => (url.pathname === '/graphql' ? jsonResponse({ data: null, errors: [{ message: 'field not found' }] }) : undefined));
    const client = new SophosClient(READ_ONLY);
    const err = (await client.graphql('query Q { detectionSearch { total_results } }', {}).catch((e) => e)) as SophosGraphQLError;
    expect(err).toBeInstanceOf(SophosGraphQLError);
    expect(err.message).toContain('field not found');
    expect(err.errors).toEqual([{ message: 'field not found' }]);
    const [url, init] = callsTo('/graphql')[0];
    expect(new URL(url).origin).toBe('https://api.taegis.sophos.com');
    expect(init.headers['X-Tenant-ID']).toBe(TENANT);
  });

  it('retries 429 with backoff and gives up after 3 retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // full jitter at its ceiling: ~1 s, 2 s, 4 s
    routeFetch((url) => (url.pathname === '/siem/v1/events' ? new Response('slow down', { status: 429 }) : undefined));
    const client = new SophosClient(READ_ONLY);
    const p = client.siemEvents({ limit: 50 }).then(() => null, (e: SophosApiError) => e);

    await vi.advanceTimersByTimeAsync(900);
    expect(callsTo('/siem/v1/events')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await p;
    expect(err).toBeInstanceOf(SophosApiError);
    expect(err?.statusCode).toBe(429);
    expect(callsTo('/siem/v1/events')).toHaveLength(4);
    expect(new URL(callsTo('/siem/v1/events')[0][0]).searchParams.get('limit')).toBe('200'); // clamped to 200..1000
  });

  it('refuses every write in read_only mode', async () => {
    routeFetch();
    const client = new SophosClient(READ_ONLY);
    expect(client.permissionMode).toBe('read_only');
    await expect(client.acknowledgeAlert(ALERT_ID, 'm')).rejects.toBeInstanceOf(SophosPermissionError);
    await expect(client.resolveDetections(['alert://priv:x:1'], 'r')).rejects.toBeInstanceOf(SophosPermissionError);
    await expect(client.graphql(SOPHOS_RESOLVE_MUTATION, { in: { alert_ids: ['a'], resolution_status: 'TRUE_POSITIVE_BENIGN', reason: 'r' } }))
      .rejects.toBeInstanceOf(SophosPermissionError);
    await expect(client.graphql('mutation { detectionUpdateThreatScore(in: {}) { status } }', {})).rejects.toBeInstanceOf(SophosPermissionError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses any alert action other than acknowledge', () => {
    const path = `/common/v1/alerts/${ALERT_ID}/actions`;
    for (const action of ['cleanPua', 'cleanVirus', 'authPua', 'clearThreat', 'clearHmpa', 'sendMsgPua', 'sendMsgThreat', 'Acknowledge']) {
      expect(() => assertSophosRequestAllowed('response', { method: 'POST', path, body: { action, message: 'm' } })).toThrow(SophosPermissionError);
    }
    expect(() => assertSophosRequestAllowed('response', { method: 'POST', path, body: { action: 'acknowledge', message: 'm', extra: 1 } })).toThrow(SophosPermissionError);
    expect(() => assertSophosRequestAllowed('response', { method: 'POST', path: '/common/v1/alerts/not-a-uuid/actions', body: { action: 'acknowledge', message: 'm' } })).toThrow();
    expect(() => assertSophosRequestAllowed('read_only', { method: 'POST', path, body: { action: 'acknowledge', message: 'm' } })).toThrow(SophosPermissionError);
    expect(() => assertSophosRequestAllowed('response', { method: 'POST', path, body: { action: 'acknowledge', message: 'm' } })).not.toThrow();
  });

  it('acknowledgeAlert posts only the acknowledge action in response mode', async () => {
    routeFetch();
    const client = new SophosClient(RESPONSE);
    await expect(client.acknowledgeAlert(ALERT_ID, 'ProjectAchilles security test x on h (auto-resolve)')).resolves.toEqual({ status: 'requested' });
    const [url, init] = callsTo(`/common/v1/alerts/${ALERT_ID}/actions`)[0];
    expect(new URL(url).origin).toBe(REGION);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ action: 'acknowledge', message: 'ProjectAchilles security test x on h (auto-resolve)' });
  });

  it('resolveDetections sends only TRUE_POSITIVE_BENIGN', async () => {
    routeFetch();
    const client = new SophosClient(RESPONSE);
    await expect(client.resolveDetections(['alert://priv:x:1', 'alert://priv:x:2'], 'reason text')).resolves.toEqual({ updated: 2 });
    const body = JSON.parse(callsTo('/graphql')[0][1].body);
    expect(body.query).toBe(SOPHOS_RESOLVE_MUTATION);
    expect(body.variables).toEqual({ in: { alert_ids: ['alert://priv:x:1', 'alert://priv:x:2'], resolution_status: 'TRUE_POSITIVE_BENIGN', reason: 'reason text' } });

    for (const status of ['FALSE_POSITIVE', 'TRUE_POSITIVE_MALICIOUS', 'SUPPRESSED', 'OPEN']) {
      expect(() => assertSophosRequestAllowed('response', {
        method: 'POST', path: '/graphql', body: { query: SOPHOS_RESOLVE_MUTATION, variables: { in: { alert_ids: ['a'], resolution_status: status, reason: 'r' } } },
      })).toThrow(SophosPermissionError);
    }
    // Any other mutation document is refused even in response mode.
    expect(() => assertSophosRequestAllowed('response', {
      method: 'POST', path: '/graphql', body: { query: 'mutation { detectionUpdateThreatScore(in: {alert_ids: ["a"]}) { status } }', variables: {} },
    })).toThrow(SophosPermissionError);
    await expect(client.resolveDetections([], 'r')).rejects.toThrow(/at least one/);
    await expect(client.resolveDetections(Array.from({ length: 101 }, (_, i) => `a${i}`), 'r')).rejects.toThrow(/at most 100/);
  });

  it('has no method or path for the per-endpoint tamper-protection route', async () => {
    expect(() => assertPathAllowed('/endpoint/v1/endpoints/x/tamper-protection')).toThrow();
    expect(() => assertPathAllowed(`/endpoint/v1/endpoints/${ALERT_ID}/tamper-protection`)).toThrow();
    expect(() => assertSophosRequestAllowed('response', { method: 'GET', path: `/endpoint/v1/endpoints/${ALERT_ID}/tamper-protection` })).toThrow();

    routeFetch();
    const client = new SophosClient(RESPONSE);
    await client.whoami();
    await client.listAlerts({ from: '2026-10-01T00:00:00Z' });
    await client.getAlert(ALERT_ID);
    await client.siemEvents({ cursor: 'c' });
    await client.graphql('query { detectionSearch { total_results } }', {});
    await client.detectionsV1({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    await client.healthCheck();
    await client.healthHistory({ startDate: '2026-10-01', endDate: '2026-10-28' });
    await client.listEndpoints({});
    await client.listPolicies('threat-protection');
    await client.getPolicySettings(RUN_ID);
    await client.listScanningExclusions();
    await client.listAllowedItems();
    await client.acknowledgeAlert(ALERT_ID, 'm');
    await client.resolveDetections(['a'], 'r');
    expect(mockFetch.mock.calls.length).toBeGreaterThan(15);
    for (const [u] of mockFetch.mock.calls) expect(new URL(u).pathname).not.toMatch(/tamper-protection$/);
    expect(Object.getOwnPropertyNames(SophosClient.prototype).some((m) => /tamper/i.test(m))).toBe(false);
  });

  it('getAlert returns null on 404 and refuses a malformed id', async () => {
    routeFetch((url) => (url.pathname === `/common/v1/alerts/${ALERT_ID}` ? new Response('{}', { status: 404 }) : undefined));
    const client = new SophosClient(READ_ONLY);
    await expect(client.getAlert(ALERT_ID)).resolves.toBeNull();
    await expect(client.getAlert('../../endpoint/v1/endpoints')).rejects.toThrow(/Invalid/);
  });

  it('detectionsV1 runs, polls until finished and reads every results page', async () => {
    vi.useFakeTimers();
    let polls = 0;
    routeFetch((url) => {
      if (url.pathname === '/detections/v1/queries/detections') return jsonResponse({ id: RUN_ID, status: 'pending' }, 201);
      if (url.pathname === `/detections/v1/queries/detections/${RUN_ID}`) {
        return jsonResponse({ id: RUN_ID, status: ++polls < 3 ? 'started' : 'finished', result: polls < 3 ? undefined : 'succeeded' });
      }
      if (url.pathname.endsWith('/results')) {
        const page = Number(url.searchParams.get('page'));
        return jsonResponse({ items: page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: `d${i}` })) : [{ id: 'last' }], pages: { current: page } });
      }
      return undefined;
    });
    const client = new SophosClient(READ_ONLY);
    const p = client.detectionsV1({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    await vi.advanceTimersByTimeAsync(10_000);
    const rows = await p;
    expect(rows).toHaveLength(101);
    expect(polls).toBe(3);
    expect(JSON.parse(callsTo('/detections/v1/queries/detections')[0][1].body)).toEqual({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
  });

  it('never exceeds the configured requests per minute', async () => {
    vi.useFakeTimers();
    routeFetch();
    const client = new SophosClient(READ_ONLY, { requestsPerMinute: 2 });
    await client.whoami(); // token + whoami = 2 requests
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const third = client.whoami();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await third;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
