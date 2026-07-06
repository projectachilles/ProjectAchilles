import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getChartToken, useChartTokens } from '../chartTokens';

beforeEach(() => {
  document.documentElement.className = '';
  document.documentElement.style.setProperty('--chart-cat-1', 'oklch(0.62 0.14 265)');
});

describe('getChartToken', () => {
  it('resolves a defined custom property, trimmed', () => {
    expect(getChartToken('--chart-cat-1')).toBe('oklch(0.62 0.14 265)');
  });
  it('returns empty string for an undefined property', () => {
    expect(getChartToken('--nope-not-here')).toBe('');
  });
});

describe('useChartTokens', () => {
  it('returns resolved values for the requested tokens', () => {
    const { result } = renderHook(() => useChartTokens(['--chart-cat-1']));
    expect(result.current['--chart-cat-1']).toBe('oklch(0.62 0.14 265)');
  });
  it('re-reads when the root class attribute changes', async () => {
    const { result } = renderHook(() => useChartTokens(['--chart-cat-1']));
    act(() => {
      document.documentElement.style.setProperty('--chart-cat-1', 'oklch(0.68 0.15 265)');
      document.documentElement.classList.add('dark');
    });
    // MutationObserver fires on the microtask/next tick
    await act(async () => { await Promise.resolve(); });
    expect(result.current['--chart-cat-1']).toBe('oklch(0.68 0.15 265)');
  });
});
