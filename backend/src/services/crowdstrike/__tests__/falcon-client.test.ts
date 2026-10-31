import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { FalconClient, FalconApiError, CROWDSTRIKE_REGION_BASE_URLS } = await import('../falcon-client.js');

describe('FalconClient', () => {
  let client: InstanceType<typeof FalconClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FalconClient({ region: 'us-1', client_id: 'a'.repeat(32), client_secret: 'client-secret' });
  });

  // Helper: mock a successful token response
  function mockTokenResponse() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-token', expires_in: 1799 }),
    });
  }

  // Helper: mock a Falcon API envelope response
  function mockFalconResponse<T>(resources: T[], pagination?: { after?: string; total?: number }) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        meta: { pagination: pagination ?? {} },
        resources,
        errors: [],
      }),
    });
  }

  // ── Token acquisition ──────────────────────────────────────────

  describe('token acquisition', () => {
    it('acquires token via POST /oauth2/token with form-encoded client_id/client_secret', async () => {
      mockTokenResponse();
      mockFalconResponse([{ composite_id: 'alert-1' }]);

      await client.getAlertsCombined({ limit: 1 });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.crowdstrike.com/oauth2/token');
      expect(tokenCall[1].method).toBe('POST');
      expect(tokenCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(tokenCall[1].body).toContain(`client_id=${'a'.repeat(32)}`);
      expect(tokenCall[1].body).toContain('client_secret=client-secret');
    });

    it('reuses cached token on second request', async () => {
      mockTokenResponse();
      mockFalconResponse([{ composite_id: 'alert-1' }]);

      await client.getAlertsCombined({ limit: 1 });

      // Second request should reuse token
      mockFalconResponse([{ aid: 'aid-1', score: 80 }]);
      await client.getZtaDeviceIds({ limit: 1 });

      // token + alerts + zta (no second token call)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toContain('/oauth2/token');
      expect(mockFetch.mock.calls[1][0]).toContain('/alerts/combined/alerts/v1');
      expect(mockFetch.mock.calls[2][0]).toContain('/zero-trust-assessment/queries/assessments/v1');
    });

    it('throws on token acquisition failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'Invalid client secret' }),
      });

      await expect(client.getAlertsCombined()).rejects.toThrow('Invalid client secret');
    });
  });

  // ── Region base-URL selection ──────────────────────────────────

  describe('region base URLs', () => {
    it('exposes the region map with us-1 as the commercial default', () => {
      expect(CROWDSTRIKE_REGION_BASE_URLS['us-1']).toBe('https://api.crowdstrike.com');
      expect(CROWDSTRIKE_REGION_BASE_URLS['us-2']).toBe('https://api.us-2.crowdstrike.com');
      expect(CROWDSTRIKE_REGION_BASE_URLS['eu-1']).toBe('https://api.eu-1.crowdstrike.com');
      expect(CROWDSTRIKE_REGION_BASE_URLS['us-gov-1']).toBe('https://api.laggar.gcw.crowdstrike.com');
    });

    it('uses the region-specific base URL for both token and API calls', async () => {
      const us2Client = new FalconClient({
        region: 'us-2',
        client_id: 'b'.repeat(32),
        client_secret: 'secret',
      });

      mockTokenResponse();
      mockFalconResponse([]);

      await us2Client.getAlertsCombined({ limit: 1 });

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.us-2.crowdstrike.com/oauth2/token');
      expect(mockFetch.mock.calls[1][0]).toContain('https://api.us-2.crowdstrike.com/alerts/combined/alerts/v1');
    });

    // Request-forgery guard (CodeQL js/request-forgery): the base URL is
    // resolved ONLY from the constant region map. There is no custom-URL
    // path; an unknown region throws rather than fetching a garbage host.
    it('defaults to us-1 when no region is given', async () => {
      const defaultClient = new FalconClient({
        client_id: 'c'.repeat(32),
        client_secret: 'secret',
      });

      mockTokenResponse();
      mockFalconResponse([]);

      await defaultClient.getAlertsCombined({ limit: 1 });

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.crowdstrike.com/oauth2/token');
    });

    it('throws on an unknown region instead of fetching (fail closed)', () => {
      expect(() => new FalconClient({
        // @ts-expect-error — deliberately invalid region, as could arrive from unvalidated disk/env data
        region: 'evil-region',
        client_id: 'd'.repeat(32),
        client_secret: 'secret',
      })).toThrow(/Unknown CrowdStrike region/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('every fetch target across all methods comes from the constant region map', async () => {
      // Pin the SSRF invariant end-to-end: token, alerts read, alerts write,
      // and ZTA calls must all land on map-derived hosts.
      const allowedHosts = new Set(Object.values(CROWDSTRIKE_REGION_BASE_URLS).map((u) => new URL(u).host));

      mockTokenResponse();
      mockFalconResponse([]);
      await client.getAlertsCombined({ limit: 1 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: { writes: { resources_affected: 1 } }, resources: [], errors: [] }),
      });
      await client.updateAlerts(['cid-1'], { status: 'closed' });
      mockFalconResponse([]);
      await client.getZtaDeviceIds({ limit: 1 });
      mockFalconResponse([]);
      await client.getZtaAssessments(['aid-1']);

      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4);
      for (const call of mockFetch.mock.calls) {
        const host = new URL(call[0] as string).host;
        expect(allowedHosts.has(host)).toBe(true);
      }
    });
  });

  // ── getAlertsCombined ──────────────────────────────────────────

  describe('getAlertsCombined', () => {
    it('POSTs filter/sort/limit to /alerts/combined/alerts/v1 and unwraps resources', async () => {
      mockTokenResponse();
      mockFalconResponse([{ composite_id: 'alert-1' }], { after: 'next-token', total: 42 });

      const result = await client.getAlertsCombined({
        filter: "created_timestamp:>='2026-01-01T00:00:00Z'",
        sort: 'created_timestamp|asc',
        limit: 500,
      });

      expect(result.resources).toHaveLength(1);
      expect(result.after).toBe('next-token');
      expect(result.total).toBe(42);

      const apiCall = mockFetch.mock.calls[1];
      expect(apiCall[0]).toBe('https://api.crowdstrike.com/alerts/combined/alerts/v1');
      expect(apiCall[1].method).toBe('POST');
      expect(apiCall[1].headers.Authorization).toBe('Bearer test-token');
      const body = JSON.parse(apiCall[1].body);
      expect(body.filter).toBe("created_timestamp:>='2026-01-01T00:00:00Z'");
      expect(body.sort).toBe('created_timestamp|asc');
      expect(body.limit).toBe(500);
    });

    it('passes the after token through for pagination', async () => {
      mockTokenResponse();
      mockFalconResponse([{ composite_id: 'alert-2' }], {});

      const result = await client.getAlertsCombined({ after: 'page-2-token' });

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.after).toBe('page-2-token');
      expect(result.after).toBeUndefined();
    });
  });

  // ── 429 retry ──────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('retries on 429 with Retry-After header', async () => {
      mockTokenResponse();

      // First attempt: 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '0' }), // 0s for fast test
      });
      // Retry: success
      mockFalconResponse([{ composite_id: 'alert-1' }]);

      const result = await client.getAlertsCombined({ limit: 1 });
      expect(result.resources).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // token + 429 + retry
    });

    it('stops retrying 429 after MAX_RETRIES and throws', async () => {
      mockTokenResponse();
      // 429 repeatedly — more than MAX_RETRIES=3
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
          text: async () => 'rate limited',
        });
      }

      await expect(client.getAlertsCombined()).rejects.toBeInstanceOf(FalconApiError);
    });
  });

  // ── 401 token refresh ──────────────────────────────────────────

  describe('token refresh', () => {
    // The 'stops retrying 429' test above queues 5 mockResolvedValueOnce
    // responses but the code consumes only MAX_RETRIES+1 = 4. The leftover
    // mocks survive vi.clearAllMocks() (which only resets call history, not
    // the mockResolvedValueOnce queue) and would be consumed by our tests in
    // the wrong order. mockReset() drains the queue for a clean slate.
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('invalidates the cached token on 401 and retries once', async () => {
      mockTokenResponse(); // Initial token

      // First attempt: 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Token refresh
      mockTokenResponse();
      // Retry with new token: success
      mockFalconResponse([{ composite_id: 'alert-1' }]);

      const result = await client.getAlertsCombined({ limit: 1 });
      expect(result.resources).toHaveLength(1);
      // token + 401 + token-refresh + retry = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[2][0]).toContain('/oauth2/token');
    });
  });

  // ── updateAlerts (write pillar) ─────────────────────────────────

  describe('updateAlerts', () => {
    // mockReset() drains any leftover mockResolvedValueOnce responses queued
    // by the 'stops retrying 429' test above (vi.clearAllMocks only resets
    // call history, not the once-queue).
    beforeEach(() => {
      mockFetch.mockReset();
    });

    function mockPatchSuccess(resourcesAffected: number, errors: unknown[] = []) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          meta: { writes: { resources_affected: resourcesAffected } },
          resources: [],
          errors,
        }),
      });
    }

    // v3 schema (CrowdStrike Swagger PatchEntitiesAlertsV3; FalconPy
    // update_alerts_v3): { composite_ids, action_parameters: [{ name, value }] }.
    // Top-level update_status / append_comment got HTTP 400 "failed to read and
    // parse request" from a live tenant on every alert.
    it('PATCHes /alerts/entities/alerts/v3 with composite_ids and action_parameters', async () => {
      mockTokenResponse();
      mockPatchSuccess(2);

      const result = await client.updateAlerts(['cid-1', 'cid-2'], {
        status: 'closed',
        comment: 'Achilles test abc — authorized continuous validation.',
      });

      const patchCall = mockFetch.mock.calls[1];
      expect(patchCall[0]).toBe('https://api.crowdstrike.com/alerts/entities/alerts/v3');
      expect(patchCall[1].method).toBe('PATCH');
      expect(patchCall[1].headers.Authorization).toBe('Bearer test-token');
      expect(patchCall[1].headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(patchCall[1].body)).toEqual({
        composite_ids: ['cid-1', 'cid-2'],
        action_parameters: [
          { name: 'update_status', value: 'closed' },
          { name: 'append_comment', value: 'Achilles test abc — authorized continuous validation.' },
        ],
      });

      expect(result.resourcesAffected).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('surfaces per-item errors from a 200 response envelope', async () => {
      mockTokenResponse();
      // CrowdStrike returns HTTP 200 with per-item failures in errors[] —
      // callers must inspect the envelope, not just HTTP status.
      mockPatchSuccess(1, [
        { code: 404, id: 'cid-missing', message: 'alert not found' },
      ]);

      const result = await client.updateAlerts(['cid-1', 'cid-missing'], { status: 'closed' });

      expect(result.resourcesAffected).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ id: 'cid-missing', message: 'alert not found' });
    });

    it('sends no action parameters when no update is given', async () => {
      mockTokenResponse();
      mockPatchSuccess(1);

      await client.updateAlerts(['cid-1'], {});

      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body).toEqual({ composite_ids: ['cid-1'], action_parameters: [] });
    });

    it('throws when compositeIds is empty', async () => {
      await expect(client.updateAlerts([], { status: 'closed' })).rejects.toThrow('compositeIds is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('retries on 429 honoring Retry-After', async () => {
      mockTokenResponse();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '0' }), // 0 for fast test
        text: async () => '',
      });
      mockPatchSuccess(1);

      await client.updateAlerts(['cid-1'], { status: 'closed' });
      // token + 429 + retry = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('refreshes token on 401 and retries', async () => {
      mockTokenResponse();

      // First PATCH: 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '',
      });
      // Token refresh
      mockTokenResponse();
      // Retry: success
      mockPatchSuccess(1);

      await client.updateAlerts(['cid-1'], { status: 'closed' });
      // token + 401 + token-refresh + retry = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('throws FalconApiError spelling out the Alerts: write scope on 403', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => '{"errors":[{"code":403,"message":"access denied"}]}',
      });

      try {
        await client.updateAlerts(['cid-1'], { status: 'closed' });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(FalconApiError);
        expect((err as InstanceType<typeof FalconApiError>).statusCode).toBe(403);
        expect((err as Error).message).toMatch(/Alerts: write/);
      }
    });

    it('throws FalconApiError on other non-2xx status', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      try {
        await client.updateAlerts(['cid-1'], { status: 'closed' });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(FalconApiError);
        expect((err as InstanceType<typeof FalconApiError>).statusCode).toBe(500);
      }
    });
  });

  // ── Zero Trust Assessment ───────────────────────────────────────

  describe('ZTA', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('getZtaDeviceIds GETs the score query endpoint with filter/limit/after and maps resources to AIDs', async () => {
      // getAssessmentsByScoreV1 — the only ZTA query route. `filter` is
      // required and resources are {aid, score} objects, not bare AIDs.
      mockTokenResponse();
      mockFalconResponse([{ aid: 'aid-1', score: 80 }, { aid: 'aid-2', score: 60 }], { after: 'zta-next', total: 100 });

      const result = await client.getZtaDeviceIds({ limit: 500, after: 'zta-prev' });

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain('/zero-trust-assessment/queries/assessments/v1');
      expect(new URL(url).searchParams.get('filter')).toBe('score:>=0');
      expect(url).toContain('limit=500');
      expect(url).toContain('after=zta-prev');
      expect(result.resources).toEqual(['aid-1', 'aid-2']);
      expect(result.after).toBe('zta-next');
    });

    it('getZtaAssessments GETs the entities endpoint with repeated ids params', async () => {
      mockTokenResponse();
      mockFalconResponse([
        { aid: 'aid-1', assessment: { overall: 80, os: 90, sensor_config: 70 } },
        { aid: 'aid-2', assessment: { overall: 60, os: 60, sensor_config: 60 } },
      ]);

      const result = await client.getZtaAssessments(['aid-1', 'aid-2']);

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain('/zero-trust-assessment/entities/assessments/v1');
      expect(url).toContain('ids=aid-1');
      expect(url).toContain('ids=aid-2');
      expect(result).toHaveLength(2);
      expect(result[0].assessment?.overall).toBe(80);
    });

    it('chunks getZtaAssessments at 400 ids per request', async () => {
      mockTokenResponse();
      mockFalconResponse([{ aid: 'chunk-1' }]);
      mockFalconResponse([{ aid: 'chunk-2' }]);

      const aids = Array.from({ length: 401 }, (_, i) => `aid-${i}`);
      const result = await client.getZtaAssessments(aids);

      // token + 2 entity requests
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const firstUrl = mockFetch.mock.calls[1][0] as string;
      const secondUrl = mockFetch.mock.calls[2][0] as string;
      expect(firstUrl.match(/ids=/g)).toHaveLength(400);
      expect(secondUrl.match(/ids=/g)).toHaveLength(1);
      expect(result).toHaveLength(2);
    });
  });

  // ── testConnection ──────────────────────────────────────────────

  describe('testConnection', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('returns success after token acquisition + limit:1 combined query', async () => {
      mockTokenResponse();
      mockFalconResponse([{ composite_id: 'alert-1' }]);

      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.limit).toBe(1);
    });

    it('returns the error message on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'Invalid client secret' }),
      });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid client secret');
    });
  });
});
