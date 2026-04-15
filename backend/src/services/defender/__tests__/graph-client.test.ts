import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { MicrosoftGraphClient, GraphPatchError } = await import('../graph-client.js');

describe('MicrosoftGraphClient', () => {
  let client: InstanceType<typeof MicrosoftGraphClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MicrosoftGraphClient('tenant-id', 'client-id', 'client-secret');
  });

  // Helper: mock a successful token response
  function mockTokenResponse() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
    });
  }

  // Helper: mock a Graph API data response
  function mockGraphResponse<T>(value: T[], nextLink?: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        value,
        ...(nextLink ? { '@odata.nextLink': nextLink } : {}),
      }),
    });
  }

  // ── Token acquisition ──────────────────────────────────────────

  describe('token caching', () => {
    it('acquires token on first request', async () => {
      mockTokenResponse();
      mockGraphResponse([{ id: 'score-1' }]);

      const scores = await client.getSecureScores(1);
      expect(scores).toHaveLength(1);

      // First call = token endpoint, second = Graph API
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain('login.microsoftonline.com');
      expect(mockFetch.mock.calls[1][0]).toContain('graph.microsoft.com');
    });

    it('reuses cached token on second request', async () => {
      mockTokenResponse();
      mockGraphResponse([{ id: 'score-1' }]);

      await client.getSecureScores(1);

      // Second request should reuse token
      mockGraphResponse([{ id: 'profile-1' }]);
      await client.getControlProfiles();

      // token + graph + graph (no second token call)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toContain('login.microsoftonline.com');
      expect(mockFetch.mock.calls[1][0]).toContain('graph.microsoft.com');
      expect(mockFetch.mock.calls[2][0]).toContain('graph.microsoft.com');
    });
  });

  // ── Token errors ───────────────────────────────────────────────

  describe('token errors', () => {
    it('throws on token acquisition failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'Invalid client secret' }),
      });

      await expect(client.getSecureScores()).rejects.toThrow('Invalid client secret');
    });
  });

  // ── OData pagination ───────────────────────────────────────────

  describe('pagination', () => {
    it('follows @odata.nextLink to fetch all pages', async () => {
      mockTokenResponse();

      // Page 1
      mockGraphResponse(
        [{ id: 'alert-1' }, { id: 'alert-2' }],
        'https://graph.microsoft.com/v1.0/security/alerts_v2?$skip=2',
      );
      // Page 2 (no nextLink = last page)
      mockGraphResponse([{ id: 'alert-3' }]);

      const alerts = await client.getAlerts();
      expect(alerts).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(3); // token + 2 pages
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
      mockGraphResponse([{ id: 'score-1' }]);

      const scores = await client.getSecureScores(1);
      expect(scores).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // token + 429 + retry
    });
  });

  // ── 401 token refresh ──────────────────────────────────────────

  describe('token refresh', () => {
    it('refreshes token on 401 and retries', async () => {
      mockTokenResponse(); // Initial token

      // First attempt: 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Token refresh
      mockTokenResponse();
      // Retry with new token: success
      mockGraphResponse([{ id: 'score-1' }]);

      const scores = await client.getSecureScores(1);
      expect(scores).toHaveLength(1);
    });
  });

  // ── Public API methods ─────────────────────────────────────────

  describe('getSecureScores', () => {
    it('sends correct URL with $top and $orderby', async () => {
      mockTokenResponse();
      mockGraphResponse([]);

      await client.getSecureScores(30);

      const graphCall = mockFetch.mock.calls[1][0] as string;
      expect(graphCall).toContain('/security/secureScores');
      expect(graphCall).toContain('%24top=30');
      expect(graphCall).toContain('%24orderby=createdDateTime+desc');
    });
  });

  describe('getControlProfiles', () => {
    it('sends correct URL', async () => {
      mockTokenResponse();
      mockGraphResponse([]);

      await client.getControlProfiles();

      const graphCall = mockFetch.mock.calls[1][0] as string;
      expect(graphCall).toContain('/security/secureScoreControlProfiles');
    });
  });

  describe('getAlerts', () => {
    it('sends correct URL with filter', async () => {
      mockTokenResponse();
      mockGraphResponse([]);

      await client.getAlerts('severity eq \'high\'', 100);

      const graphCall = mockFetch.mock.calls[1][0] as string;
      expect(graphCall).toContain('/security/alerts_v2');
      expect(graphCall).toContain('%24top=100');
      expect(graphCall).toContain('%24filter=');
    });
  });

  // ── updateAlert (Wave 3 — write pillar) ───────────────────────────

  describe('updateAlert', () => {
    const samplePatch = {
      status: 'resolved' as const,
      classification: 'informationalExpectedActivity' as const,
      determination: 'securityTesting' as const,
      comments: [{ comment: 'Achilles test — authorized activity' }],
    };

    // Helper: mock a 204 No Content PATCH success (or 200 with body).
    function mockPatchSuccess() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });
    }

    it('sends PATCH to /security/alerts_v2/{id} with bearer token and JSON body', async () => {
      mockTokenResponse();
      mockPatchSuccess();

      await client.updateAlert('alert-abc', samplePatch);

      const patchCall = mockFetch.mock.calls[1];
      expect(patchCall[0]).toBe('https://graph.microsoft.com/v1.0/security/alerts_v2/alert-abc');
      expect(patchCall[1].method).toBe('PATCH');
      expect(patchCall[1].headers.Authorization).toBe('Bearer test-token');
      expect(patchCall[1].headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(patchCall[1].body)).toEqual(samplePatch);
    });

    it('URL-encodes alert ids with special characters', async () => {
      mockTokenResponse();
      mockPatchSuccess();

      await client.updateAlert('alert/with spaces & chars', samplePatch);

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain('alert%2Fwith%20spaces%20%26%20chars');
    });

    it('throws when alertId is empty', async () => {
      await expect(client.updateAlert('', samplePatch)).rejects.toThrow('alertId is required');
      // Never reaches fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('resolves void on 2xx', async () => {
      mockTokenResponse();
      mockPatchSuccess();

      const result = await client.updateAlert('alert-1', samplePatch);
      expect(result).toBeUndefined();
    });

    it('retries on 429 honoring Retry-After', async () => {
      mockTokenResponse();

      // First attempt: 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '0' }), // 0 for fast test
        text: async () => '',
      });
      // Retry: success
      mockPatchSuccess();

      await client.updateAlert('alert-1', samplePatch);
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
      mockPatchSuccess();

      await client.updateAlert('alert-1', samplePatch);
      // token + 401 + token-refresh + retry = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('throws GraphPatchError with scope hint on 403', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => '{"error":{"code":"Forbidden","message":"Insufficient privileges"}}',
      });

      try {
        await client.updateAlert('alert-1', samplePatch);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphPatchError);
        expect((err as InstanceType<typeof GraphPatchError>).statusCode).toBe(403);
        expect((err as Error).message).toMatch(/SecurityAlert\.ReadWrite\.All/);
      }
    });

    it('throws GraphPatchError with distinct message on 404', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":{"code":"NotFound"}}',
      });

      try {
        await client.updateAlert('alert-deleted', samplePatch);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphPatchError);
        expect((err as InstanceType<typeof GraphPatchError>).statusCode).toBe(404);
        expect((err as Error).message).toContain('alert-deleted');
        expect((err as Error).message).toContain('deleted upstream');
      }
    });

    it('throws GraphPatchError on other non-2xx status', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      try {
        await client.updateAlert('alert-1', samplePatch);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphPatchError);
        expect((err as InstanceType<typeof GraphPatchError>).statusCode).toBe(500);
      }
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

      await expect(client.updateAlert('alert-1', samplePatch)).rejects.toBeInstanceOf(GraphPatchError);
    });
  });
});
