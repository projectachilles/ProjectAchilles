// Tests for SophosCentralClient.
//
// The Sophos integration differs from Defender in one important way: the
// tenant ID and data-region base URL are discovered via `whoami` rather
// than typed in by the operator. That makes the client's bootstrap path
// — token + whoami — the most interesting thing to test. The retry
// semantics (429, 401) mirror the Defender client and are tested with
// the same structure.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { SophosCentralClient, SophosApiError } = await import('../sophos-client.js');

describe('SophosCentralClient', () => {
  let client: InstanceType<typeof SophosCentralClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SophosCentralClient('client-id', 'client-secret');
  });

  // Helpers ─────────────────────────────────────────────────────────

  function mockTokenResponse(token = 'test-token', expiresIn = 3600) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: token, expires_in: expiresIn, token_type: 'bearer' }),
    });
  }

  function mockWhoamiResponse(overrides: Partial<{ id: string; idType: string; dataRegion: string }> = {}) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: overrides.id ?? 'tenant-uuid-123',
        idType: overrides.idType ?? 'tenant',
        apiHosts: {
          dataRegion: overrides.dataRegion ?? 'https://api-eu01.central.sophos.com',
        },
      }),
    });
  }

  // ── Bootstrap (token + whoami) ────────────────────────────────────

  describe('ensureBootstrapped', () => {
    it('acquires token then calls whoami on first invocation', async () => {
      mockTokenResponse();
      mockWhoamiResponse();

      const result = await client.ensureBootstrapped();

      expect(result.tenantId).toBe('tenant-uuid-123');
      expect(result.dataRegion).toBe('https://api-eu01.central.sophos.com');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://id.sophos.com/api/v2/oauth2/token');
      expect(mockFetch.mock.calls[1][0]).toBe('https://api.central.sophos.com/whoami/v1');
    });

    it('sends client_credentials grant in the token request body', async () => {
      mockTokenResponse();
      mockWhoamiResponse();

      await client.ensureBootstrapped();

      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[1].method).toBe('POST');
      expect(tokenCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = tokenCall[1].body as string;
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('client_id=client-id');
      expect(body).toContain('client_secret=client-secret');
    });

    it('sends the Bearer token on the whoami call', async () => {
      mockTokenResponse('my-token-abc');
      mockWhoamiResponse();

      await client.ensureBootstrapped();

      const whoamiCall = mockFetch.mock.calls[1];
      expect(whoamiCall[1].headers.Authorization).toBe('Bearer my-token-abc');
    });

    it('caches the bootstrap result so the second call is a no-op', async () => {
      mockTokenResponse();
      mockWhoamiResponse();

      const first = await client.ensureBootstrapped();
      const second = await client.ensureBootstrapped();

      expect(first).toEqual(second);
      expect(mockFetch).toHaveBeenCalledTimes(2); // not 4
    });

    it('strips trailing slash from dataRegion before caching', async () => {
      mockTokenResponse();
      mockWhoamiResponse({ dataRegion: 'https://api-us01.central.sophos.com/' });

      const result = await client.ensureBootstrapped();

      expect(result.dataRegion).toBe('https://api-us01.central.sophos.com');
    });

    it('throws SophosApiError with a helpful message when the token request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"invalid_client","error_description":"Invalid client secret"}',
      });

      const err = await client.ensureBootstrapped().catch((e) => e);

      expect(err).toBeInstanceOf(SophosApiError);
      expect(err.message).toMatch(/Invalid client secret/);
      expect(err.statusCode).toBe(401);
    });

    it('throws SophosApiError when whoami fails with 403', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const err = await client.ensureBootstrapped().catch((e) => e);

      expect(err).toBeInstanceOf(SophosApiError);
      expect(err.statusCode).toBe(403);
    });

    it('rejects non-tenant idType with a clear error', async () => {
      mockTokenResponse();
      mockWhoamiResponse({ idType: 'partner' });

      await expect(client.ensureBootstrapped()).rejects.toThrow(/tenant/i);
    });
  });

  // ── Tier discovery ────────────────────────────────────────────────

  describe('testConnection', () => {
    it('returns the discovered tenant, region, and tier', async () => {
      mockTokenResponse();
      mockWhoamiResponse();

      const result = await client.testConnection();

      expect(result.tenantId).toBe('tenant-uuid-123');
      expect(result.dataRegion).toBe('https://api-eu01.central.sophos.com');
      expect(result.tier).toBe('basic'); // No EDR/XDR signal in plain whoami → defaults to basic
      expect(result.idType).toBe('tenant');
    });
  });

  // ── Retry semantics ───────────────────────────────────────────────

  describe('retry behavior', () => {
    it('honors Retry-After on 429 responses up to MAX_RETRIES', async () => {
      vi.useFakeTimers();
      try {
        mockTokenResponse();

        // Whoami returns 429 once, then succeeds
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (k: string) => (k === 'Retry-After' ? '1' : null) },
          text: async () => 'rate limited',
        });
        mockWhoamiResponse();

        const promise = client.ensureBootstrapped();
        await vi.advanceTimersByTimeAsync(1100);
        const result = await promise;

        expect(result.tenantId).toBe('tenant-uuid-123');
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes the token on a single 401 from a Bearer call', async () => {
      mockTokenResponse('old-token');
      // First whoami: 401 (token invalid)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      });
      // Token refresh
      mockTokenResponse('new-token');
      // Retry whoami: success
      mockWhoamiResponse();

      const result = await client.ensureBootstrapped();

      expect(result.tenantId).toBe('tenant-uuid-123');
      // 4 calls total: token, whoami(401), token-refresh, whoami(200)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});
