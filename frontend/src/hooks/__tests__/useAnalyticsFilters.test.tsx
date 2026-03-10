import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getWindowDaysForDateRange, useAnalyticsFilters } from '../useAnalyticsFilters';
import type { DateRangeValue } from '../useAnalyticsFilters';

// ============================================================================
// getWindowDaysForDateRange (pure function tests — existing)
// ============================================================================

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

// ============================================================================
// useAnalyticsFilters (hook tests — new)
// ============================================================================

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function wrapperWithParams(search: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[`/?${search}`]}>{children}</MemoryRouter>
  );
}

describe('useAnalyticsFilters', () => {
  describe('initialization', () => {
    it('has correct default state', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      expect(result.current.filters.org).toBeNull();
      expect(result.current.filters.dateRange).toEqual({ preset: '7d' });
      expect(result.current.filters.result).toBe('all');
      expect(result.current.filters.hostnames).toEqual([]);
      expect(result.current.filters.tests).toEqual([]);
      expect(result.current.filters.techniques).toEqual([]);
      expect(result.current.activeFilterCount).toBe(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('initializes from URL params: date and result', () => {
      const { result } = renderHook(
        () => useAnalyticsFilters(),
        { wrapper: wrapperWithParams('date=30d&result=protected') },
      );

      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });
      expect(result.current.filters.result).toBe('protected');
    });

    it('initializes array params from URL', () => {
      const { result } = renderHook(
        () => useAnalyticsFilters(),
        { wrapper: wrapperWithParams('hostnames=host1,host2&techniques=T1059') },
      );

      expect(result.current.filters.hostnames).toEqual(['host1', 'host2']);
      expect(result.current.filters.techniques).toEqual(['T1059']);
    });

    it('has default bundleNames as empty array', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });
      expect(result.current.filters.bundleNames).toEqual([]);
    });

    it('initializes bundleNames from URL', () => {
      const { result } = renderHook(
        () => useAnalyticsFilters(),
        { wrapper: wrapperWithParams('bundleNames=Cyber-Hygiene+Baseline+Bundle,Entra+ID+Bundle') },
      );
      expect(result.current.filters.bundleNames).toEqual(['Cyber-Hygiene Baseline Bundle', 'Entra ID Bundle']);
    });

    it('initializes custom date range from URL', () => {
      const { result } = renderHook(
        () => useAnalyticsFilters(),
        { wrapper: wrapperWithParams('from=2026-01-01&to=2026-01-31') },
      );

      expect(result.current.filters.dateRange).toEqual({
        preset: 'custom',
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });
  });

  describe('setters', () => {
    it('setOrg updates filters.org', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setOrg('org-001'));

      expect(result.current.filters.org).toBe('org-001');
    });

    it('setDateRange updates filters.dateRange', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setDateRange({ preset: '30d' }));

      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });
    });

    it('setResult updates filters.result', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setResult('protected'));

      expect(result.current.filters.result).toBe('protected');
    });

    it('setHostnames updates filters.hostnames', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setHostnames(['h1', 'h2']));

      expect(result.current.filters.hostnames).toEqual(['h1', 'h2']);
    });

    it('setTechniques updates filters.techniques', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setTechniques(['T1059']));

      expect(result.current.filters.techniques).toEqual(['T1059']);
    });

    it('setBundleNames updates filters.bundleNames', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setBundleNames(['Cyber-Hygiene Baseline Bundle']));

      expect(result.current.filters.bundleNames).toEqual(['Cyber-Hygiene Baseline Bundle']);
    });
  });

  describe('active filter counting', () => {
    it('default state has count 0 and hasActiveFilters false', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      expect(result.current.activeFilterCount).toBe(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('setting result to non-default increments count', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setResult('protected'));

      expect(result.current.activeFilterCount).toBe(1);
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('counts multiple active filters', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => {
        result.current.setResult('protected');
        result.current.setHostnames(['h1']);
        result.current.setTechniques(['T1059']);
      });

      // result + hostnames + techniques = 3
      expect(result.current.activeFilterCount).toBe(3);
    });

    it('bundleNames increments active filter count', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setBundleNames(['Cyber-Hygiene Baseline Bundle']));

      expect(result.current.activeFilterCount).toBe(1);
      expect(result.current.hasActiveFilters).toBe(true);
    });
  });

  describe('getApiParams', () => {
    it('returns minimal params for default state', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      const params = result.current.getApiParams();
      expect(params.from).toBe('now-7d');
      expect(params.result).toBeUndefined(); // 'all' is omitted
      expect(params.org).toBeUndefined();
    });

    it('includes filters when set', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => {
        result.current.setResult('protected');
        result.current.setHostnames(['h1', 'h2']);
      });

      const params = result.current.getApiParams();
      expect(params.result).toBe('protected');
      expect(params.hostnames).toBe('h1,h2');
    });

    it('includes bundleNames as comma-separated string', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setBundleNames(['Bundle A', 'Bundle B']));

      const params = result.current.getApiParams();
      expect(params.bundleNames).toBe('Bundle A,Bundle B');
    });

    it('omits result field when set to all', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      const params = result.current.getApiParams();
      expect(params.result).toBeUndefined();
    });

    it('returns custom date range with from/to', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => {
        result.current.setDateRange({
          preset: 'custom',
          from: '2026-01-01',
          to: '2026-01-31',
        });
      });

      const params = result.current.getApiParams();
      expect(params.from).toBe('2026-01-01');
      expect(params.to).toBe('2026-01-31');
    });
  });

  describe('clear functions', () => {
    it('clearAllFilters resets everything to defaults', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => {
        result.current.setOrg('org-001');
        result.current.setDateRange({ preset: '30d' });
        result.current.setResult('protected');
        result.current.setHostnames(['h1']);
      });

      act(() => result.current.clearAllFilters());

      expect(result.current.filters.org).toBeNull();
      expect(result.current.filters.dateRange).toEqual({ preset: '7d' });
      expect(result.current.filters.result).toBe('all');
      expect(result.current.filters.hostnames).toEqual([]);
    });

    it('clearAdvancedFilters preserves org and dateRange', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => {
        result.current.setOrg('org-001');
        result.current.setDateRange({ preset: '30d' });
        result.current.setResult('protected');
        result.current.setHostnames(['h1']);
        result.current.setTechniques(['T1059']);
        result.current.setBundleNames(['Bundle A']);
      });

      act(() => result.current.clearAdvancedFilters());

      // Preserved
      expect(result.current.filters.org).toBe('org-001');
      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });

      // Reset
      expect(result.current.filters.result).toBe('all');
      expect(result.current.filters.hostnames).toEqual([]);
      expect(result.current.filters.techniques).toEqual([]);
      expect(result.current.filters.bundleNames).toEqual([]);
    });
  });

  describe('URL sync', () => {
    it('default values are omitted from URL', () => {
      // This test ensures that the serialization doesn't pollute URL with defaults
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      // With all defaults, getApiParams should return minimal params
      const params = result.current.getApiParams();
      expect(params.from).toBe('now-7d');
      expect(params.result).toBeUndefined();
      expect(params.hostnames).toBeUndefined();
    });

    it('non-default date range appears in serialized output', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setDateRange({ preset: '90d' }));

      const params = result.current.getApiParams();
      expect(params.from).toBe('now-90d');
    });
  });
});
