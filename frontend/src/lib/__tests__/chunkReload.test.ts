import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError } from '../chunkReload';

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

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    // jsdom's location.reload is non-configurable; redefine for the test.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads on the first chunk error', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses a second reload within the cooldown window', () => {
    expect(reloadOnceForChunkError()).toBe(true);
    // A reload preserves sessionStorage, so the marker is still present.
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads again once the cooldown has elapsed', () => {
    const now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(now);
    expect(reloadOnceForChunkError()).toBe(true);

    nowSpy.mockReturnValue(now + 16_000); // past the 15s cooldown
    expect(reloadOnceForChunkError()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });
});
