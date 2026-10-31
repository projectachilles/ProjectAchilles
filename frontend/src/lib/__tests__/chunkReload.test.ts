import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  failedChunkUrl,
  isChunkLoadError,
  isChunkReloadPending,
  reloadOnceForChunkError,
  repairCachedChunks,
  __resetChunkReloadForTests,
} from '../chunkReload';

describe('isChunkLoadError', () => {
  it('matches the dynamic-import failure messages browsers emit', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://x/assets/BrowserHomePage-a40SIwhz.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html' is not a valid JavaScript MIME type",
    ]) {
      expect(isChunkLoadError(new Error(msg))).toBe(true);
    }
  });

  it('ignores unrelated errors and falsy values', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadOnceForChunkError loop guard', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const T0 = 1_000_000;

  beforeEach(() => {
    sessionStorage.clear();
    __resetChunkReloadForTests();
    reloadSpy = vi.fn();
    // jsdom's location.reload is non-configurable; redefine for the test.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(T0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first chunk error and marks a reload as pending', () => {
    expect(isChunkReloadPending()).toBe(false);
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(isChunkReloadPending()).toBe(true);
  });

  it('allows a second reload soon after the first (one transient failure after a reload)', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    // A reload preserves sessionStorage, but not module state.
    __resetChunkReloadForTests();
    nowSpy.mockReturnValue(T0 + 3_000);
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });

  it('stops after two reloads inside the window (a genuinely broken deploy)', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    __resetChunkReloadForTests();
    nowSpy.mockReturnValue(T0 + 3_000);
    expect(reloadOnceForChunkError()).toBe(true);
    __resetChunkReloadForTests();
    nowSpy.mockReturnValue(T0 + 6_000);
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(isChunkReloadPending()).toBe(false);
  });

  it('reloads again once the earlier reloads have left the window', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    __resetChunkReloadForTests();
    nowSpy.mockReturnValue(T0 + 3_000);
    expect(reloadOnceForChunkError()).toBe(true);
    __resetChunkReloadForTests();
    nowSpy.mockReturnValue(T0 + 3_000 + 61_000);
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(3);
  });

  it('ignores a corrupt marker instead of refusing to reload', () => {
    sessionStorage.setItem('achilles:chunkReloads', 'not json');
    expect(reloadOnceForChunkError()).toBe(true);
  });
});

describe('repairCachedChunks', () => {
  const ORIGIN = window.location.origin;
  const js = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } });
  const html404 = () =>
    new Response('<html><head><title>404 Not Found</title></head></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });

  /** Browser HTTP cache (only-if-cached) and network, keyed by asset path. */
  function installFetch(cache: Record<string, () => Response>, network: Record<string, () => Response>) {
    const calls: Array<{ path: string; cache: RequestCache | undefined }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, ORIGIN).pathname;
      calls.push({ path, cache: init?.cache });
      if (init?.cache === 'only-if-cached') {
        if (cache[path]) return cache[path]();
        throw new TypeError('Failed to fetch');
      }
      if (network[path]) return network[path]();
      return html404();
    }));
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-downloads a dependency whose cached copy is a 404 page', async () => {
    const calls = installFetch(
      {
        '/assets/AgentsPage-a.js': () => js('import{t as e}from"./TagChips-b.js";import{t}from"./vendor-c.js";'),
        '/assets/TagChips-b.js': () => js('import{t}from"./plus-d.js";'),
        '/assets/plus-d.js': html404,
        '/assets/vendor-c.js': () => js('export const t=1;'),
      },
      { '/assets/plus-d.js': () => js('export const t=2;') },
    );

    const repaired = await repairCachedChunks(`${ORIGIN}/assets/AgentsPage-a.js`);

    expect(repaired).toBe(1);
    const reloads = calls.filter((c) => c.cache === 'reload').map((c) => c.path);
    expect(reloads).toEqual(['/assets/plus-d.js']);
  });

  it('leaves healthy cached chunks alone', async () => {
    const calls = installFetch(
      {
        '/assets/Page-a.js': () => js('import{t}from"./vendor-c.js";'),
        '/assets/vendor-c.js': () => js('export const t=1;'),
      },
      {},
    );

    expect(await repairCachedChunks(`${ORIGIN}/assets/Page-a.js`)).toBe(0);
    expect(calls.every((c) => c.cache === 'only-if-cached')).toBe(true);
  });

  it('ignores URLs outside this origin’s /assets/', async () => {
    const calls = installFetch({}, {});
    expect(await repairCachedChunks('https://elsewhere.example/assets/Page-a.js')).toBe(0);
    expect(await repairCachedChunks(`${ORIGIN}/api/agent/tasks`)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('extracts the failed chunk URL from browser error messages', () => {
    expect(
      failedChunkUrl(new Error('Failed to fetch dynamically imported module: https://x.io/assets/AgentsPage-BK2wcL7R.js')),
    ).toBe('https://x.io/assets/AgentsPage-BK2wcL7R.js');
    expect(failedChunkUrl(new Error('error loading dynamically imported module: https://x.io/assets/A-1.js'))).toBe(
      'https://x.io/assets/A-1.js',
    );
    expect(failedChunkUrl(new Error('Importing a module script failed.'))).toBeNull();
  });
});

describe('reloadOnceForChunkError with a same-origin chunk', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetChunkReloadForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('repairs the cache before reloading', async () => {
    const order: string[] = [];
    const reload = vi.fn(() => order.push('reload'));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
      order.push(`fetch:${init?.cache ?? 'default'}`);
      if (init?.cache === 'only-if-cached') {
        return new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      }
      return new Response('export default 1;', { status: 200, headers: { 'content-type': 'application/javascript' } });
    }));

    const err = new Error(`Failed to fetch dynamically imported module: ${window.location.origin}/assets/Page-a.js`);
    expect(reloadOnceForChunkError(err)).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['fetch:only-if-cached', 'fetch:reload', 'reload']);
  });
});
