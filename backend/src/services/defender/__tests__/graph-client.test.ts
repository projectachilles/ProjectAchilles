import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { MicrosoftGraphClient } = await import('../graph-client.js');

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
});
