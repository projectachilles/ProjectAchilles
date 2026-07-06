import { describe, expect, it } from 'vitest';
import { readingTimeMinutes } from '../readingTime.js';

describe('readingTimeMinutes', () => {
  it('returns at least 1 minute for short text', () => {
    expect(readingTimeMinutes('just a few words')).toBe(1);
  });

  it('returns 1 for empty text', () => {
    expect(readingTimeMinutes('')).toBe(1);
  });

  it('computes minutes at 220 wpm, rounded', () => {
    const words660 = Array.from({ length: 660 }, () => 'word').join(' ');
    expect(readingTimeMinutes(words660)).toBe(3);
  });

  it('rounds to nearest minute', () => {
    const words550 = Array.from({ length: 550 }, () => 'word').join(' ');
    // 550 / 220 = 2.5 → rounds to 3 (Math.round half-up)
    expect(readingTimeMinutes(words550)).toBe(3);
  });
});
