import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

const created: Array<{ id: number; close: ReturnType<typeof vi.fn> }> = [];
vi.mock('../client.js', () => ({
  createEsClient: vi.fn(() => {
    const client = { id: created.length + 1, close: vi.fn(async () => undefined) };
    created.push(client);
    return client;
  }),
}));

const { getSharedEsClient, CLOSE_GRACE_MS, __resetSharedEsClientForTests } = await import('../sharedClient.js');

const base: AnalyticsSettings = {
  connectionType: 'cloud', cloudId: 'c:id', apiKey: 'key-1', indexPattern: 'achilles-results-*', configured: true,
};

beforeEach(() => {
  created.length = 0;
  __resetSharedEsClientForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('getSharedEsClient', () => {
  it('returns one kept-open client for the same settings, even read again from disk', () => {
    const a = getSharedEsClient(base);
    const b = getSharedEsClient({ ...base });
    expect(b).toBe(a);
    expect(created).toHaveLength(1);
  });

  it('builds a new client when the settings change, and closes the old one after a grace period', async () => {
    vi.useFakeTimers();
    const first = getSharedEsClient(base);
    const second = getSharedEsClient({ ...base, apiKey: 'key-2' });
    expect(second).not.toBe(first);
    // Requests already running on the old client get time to finish.
    expect(created[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(created[1].close).not.toHaveBeenCalled();
  });

  it('a close failure on the old client is swallowed', async () => {
    vi.useFakeTimers();
    getSharedEsClient(base);
    created[0].close.mockRejectedValueOnce(new Error('already closed'));
    getSharedEsClient({ ...base, node: 'https://other:9200' });
    await expect(vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS)).resolves.not.toThrow();
  });
});
