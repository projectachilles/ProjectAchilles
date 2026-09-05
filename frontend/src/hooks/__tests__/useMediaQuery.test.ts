import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsDesktop } from '../useMediaQuery';

type Listener = (e: { matches: boolean }) => void;

function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    media: '',
    addEventListener: (_: 'change', cb: Listener) => listeners.add(cb),
    removeEventListener: (_: 'change', cb: Listener) => listeners.delete(cb),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
    listeners,
  };
}

describe('useMediaQuery', () => {
  afterEach(() => {
    // jsdom has no matchMedia; restore the absent state between tests
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('returns the fallback when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)', true));
    expect(result.current).toBe(true);
  });

  it('reflects the current match and updates on change', () => {
    const mm = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
    act(() => mm.fire(true));
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', () => {
    const mm = installMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(mm.listeners.size).toBe(1);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it('useIsDesktop defaults to desktop without matchMedia', () => {
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });
});
