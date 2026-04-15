// Mirrors backend/src/services/defender/__tests__/graph-client.test.ts.
// Serverless graph-client is effectively identical in structure to docker's.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { MicrosoftGraphClient, GraphPatchError } = await import('../graph-client.js');

describe('MicrosoftGraphClient (serverless)', () => {
  let client: InstanceType<typeof MicrosoftGraphClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MicrosoftGraphClient('tenant-id', 'client-id', 'client-secret');
  });

  function mockTokenResponse() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
    });
  }

  // ── updateAlert (Wave 8.3 — write pillar mirror) ──────────────────

  describe('updateAlert', () => {
    const samplePatch = {
      status: 'resolved' as const,
      classification: 'informationalExpectedActivity' as const,
      determination: 'securityTesting' as const,
      comments: [{ comment: 'Achilles test — authorized activity' }],
    };

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
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 429,
        headers: new Headers({ 'Retry-After': '0' }),
        text: async () => '',
      });
      mockPatchSuccess();

      await client.updateAlert('alert-1', samplePatch);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('refreshes token on 401 and retries', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' });
      mockTokenResponse();
      mockPatchSuccess();

      await client.updateAlert('alert-1', samplePatch);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('throws GraphPatchError with scope hint on 403', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 403,
        text: async () => '{"error":{"code":"Forbidden"}}',
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
        ok: false, status: 404,
        text: async () => '{"error":{"code":"NotFound"}}',
      });

      try {
        await client.updateAlert('alert-deleted', samplePatch);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphPatchError);
        expect((err as InstanceType<typeof GraphPatchError>).statusCode).toBe(404);
        expect((err as Error).message).toContain('alert-deleted');
      }
    });

    it('throws GraphPatchError on other non-2xx status', async () => {
      mockTokenResponse();
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 500,
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
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
          text: async () => 'rate limited',
        });
      }

      await expect(client.updateAlert('alert-1', samplePatch)).rejects.toBeInstanceOf(GraphPatchError);
    });
  });
});
