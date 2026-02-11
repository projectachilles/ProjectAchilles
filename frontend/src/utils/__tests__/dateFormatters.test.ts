import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeDate, formatFullDate } from '../dateFormatters';

// Freeze time for deterministic tests
const NOW = new Date('2026-02-09T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeDate', () => {
  it('returns "today" for same day', () => {
    expect(formatRelativeDate('2026-02-09T08:00:00Z')).toBe('today');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(formatRelativeDate('2026-02-08T12:00:00Z')).toBe('yesterday');
  });

  it('returns "3d ago" for 3 days ago', () => {
    expect(formatRelativeDate('2026-02-06T12:00:00Z')).toBe('3d ago');
  });

  it('returns "6d ago" for 6 days ago (boundary before weeks)', () => {
    expect(formatRelativeDate('2026-02-03T12:00:00Z')).toBe('6d ago');
  });

  it('returns "1w ago" for 7 days ago (boundary: weeks start)', () => {
    expect(formatRelativeDate('2026-02-02T12:00:00Z')).toBe('1w ago');
  });

  it('returns "2w ago" for 14 days ago', () => {
    expect(formatRelativeDate('2026-01-26T12:00:00Z')).toBe('2w ago');
  });

  it('returns "4w ago" for 29 days ago (boundary before months)', () => {
    expect(formatRelativeDate('2026-01-11T12:00:00Z')).toBe('4w ago');
  });

  it('returns "1mo ago" for 30 days ago (boundary: months start)', () => {
    expect(formatRelativeDate('2026-01-10T12:00:00Z')).toBe('1mo ago');
  });

  it('returns "2mo ago" for 89 days ago (boundary before full date)', () => {
    expect(formatRelativeDate('2025-11-12T12:00:00Z')).toBe('2mo ago');
  });

  it('returns full date for 90 days ago', () => {
    const result = formatRelativeDate('2025-11-11T12:00:00Z');
    expect(result).toBe('Nov 11, 2025');
  });

  it('returns full date for very old dates', () => {
    const result = formatRelativeDate('2024-06-15T12:00:00Z');
    expect(result).toBe('Jun 15, 2024');
  });

  it('returns days-ago format for negative diffDays (future dates)', () => {
    // Future date: diffMs is negative → diffDays is negative → falls through < 7, < 30, < 90 checks
    // Math.floor(-20.x) → -21, which is < 7, so it matches `${diffDays}d ago`
    const result = formatRelativeDate('2026-03-01T12:00:00Z');
    expect(result).toMatch(/-\d+d ago/);
  });

  it('handles exact midnight boundary', () => {
    expect(formatRelativeDate('2026-02-09T00:00:00Z')).toBe('today');
  });
});

describe('formatFullDate', () => {
  it('formats a date with weekday, month, day, year, and time', () => {
    const result = formatFullDate('2026-02-09T12:00:00Z');
    // toLocaleDateString converts to local timezone, so just check key parts exist
    expect(result).toContain('February');
    expect(result).toContain('2026');
    expect(result).toMatch(/\d{1,2}:\d{2}/); // has a time component
  });

  it('includes weekday name', () => {
    // Feb 9 2026 is a Monday in UTC
    const result = formatFullDate('2026-02-09T18:00:00Z');
    expect(result).toContain('Monday');
  });

  it('formats a date in a different month', () => {
    const result = formatFullDate('2025-07-04T15:30:00Z');
    expect(result).toContain('July');
    expect(result).toContain('2025');
  });
});
