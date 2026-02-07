import { describe, it, expect } from 'vitest';
import { getWindowDaysForDateRange } from '../useAnalyticsFilters';
import type { DateRangeValue } from '../useAnalyticsFilters';

describe('getWindowDaysForDateRange', () => {
  describe('preset date ranges', () => {
    it('returns 7 for 7d preset', () => {
      expect(getWindowDaysForDateRange({ preset: '7d' })).toBe(7);
    });

    it('returns 7 for 14d preset', () => {
      expect(getWindowDaysForDateRange({ preset: '14d' })).toBe(7);
    });

    it('returns 7 for 30d preset', () => {
      expect(getWindowDaysForDateRange({ preset: '30d' })).toBe(7);
    });

    it('returns 30 for 90d preset', () => {
      expect(getWindowDaysForDateRange({ preset: '90d' })).toBe(30);
    });

    it('returns 30 for all preset', () => {
      expect(getWindowDaysForDateRange({ preset: 'all' })).toBe(30);
    });
  });

  describe('custom date ranges', () => {
    it('uses diff days for short custom range, minimum 7', () => {
      const range: DateRangeValue = {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-04', // 3 days
      };
      // 3 days < 7, so clamped to 7
      expect(getWindowDaysForDateRange(range)).toBe(7);
    });

    it('uses diff days for medium custom range', () => {
      const range: DateRangeValue = {
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-16', // 15 days
      };
      expect(getWindowDaysForDateRange(range)).toBe(15);
    });

    it('caps at 30 for large custom ranges', () => {
      const range: DateRangeValue = {
        preset: 'custom',
        from: '2025-01-01',
        to: '2026-01-01', // 365 days
      };
      expect(getWindowDaysForDateRange(range)).toBe(30);
    });

    it('returns 7 for custom preset without dates', () => {
      const range: DateRangeValue = { preset: 'custom' };
      // Falls through to default
      expect(getWindowDaysForDateRange(range)).toBe(7);
    });
  });

  describe('unknown presets', () => {
    it('returns 7 for unknown preset string', () => {
      expect(getWindowDaysForDateRange({ preset: 'unknown' })).toBe(7);
    });

    it('returns 7 for empty preset', () => {
      expect(getWindowDaysForDateRange({ preset: '' })).toBe(7);
    });
  });
});
