import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isChunkLoadError,
  isChunkReloadPending,
  reloadOnceForChunkError,
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
