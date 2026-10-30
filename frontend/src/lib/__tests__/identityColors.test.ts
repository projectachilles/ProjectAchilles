import { describe, it, expect } from 'vitest';
import { IDENTITY_PALETTE, IDENTITY_CHIP_TEXT, identityHex } from '../identityColors';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('identityColors', () => {
  it('has exactly the 8 preset keys with the spec hex values', () => {
    expect(Object.fromEntries(Object.entries(IDENTITY_PALETTE).map(([k, v]) => [k, v.hex]))).toEqual({
      violet: '#a78bfa',
      indigo: '#818cf8',
      blue: '#60a5fa',
      cyan: '#22d3ee',
      fuchsia: '#e879f9',
      pink: '#f472b6',
      orange: '#fb923c',
      silver: '#cbd5e1',
    });
  });

  it('every preset has chip-text contrast of at least 4.5', () => {
    for (const { hex } of Object.values(IDENTITY_PALETTE)) {
      expect(contrast(hex, IDENTITY_CHIP_TEXT)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('resolves hex by key, and null for none', () => {
    expect(identityHex('violet')).toBe('#a78bfa');
    expect(identityHex('none')).toBeNull();
  });
});
