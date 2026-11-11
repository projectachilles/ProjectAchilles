import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  useAnalyticsFilters,
  ALL_TIME_FROM,
  getDateRangeFilter,
  parseUrlParams,
  serializeToUrlParams,
  filtersFromSearchParams,
  toApiParams,
} from '../useAnalyticsFilters';

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

// The date range is remembered in sessionStorage; start every test clean
beforeEach(() => sessionStorage.clear());

describe('useAnalyticsFilters', () => {
  describe('initialization', () => {
    it('has correct default state', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      expect(result.current.filters.org).toBeNull();
      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });
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

    it('ignores a legacy ?severities= param', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper: wrapperWithParams('severities=high&result=protected') });

      expect(result.current.filters.result).toBe('protected');
      expect(result.current.filters).not.toHaveProperty('severities');
      expect(result.current.activeFilterCount).toBe(1);
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
      expect(params.from).toBe('now-30d');
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
        result.current.setDateRange({ preset: '7d' });
        result.current.setResult('protected');
        result.current.setHostnames(['h1']);
      });

      act(() => result.current.clearAllFilters());

      expect(result.current.filters.org).toBeNull();
      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });
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
      expect(params.from).toBe('now-30d');
      expect(params.result).toBeUndefined();
      expect(params.hostnames).toBeUndefined();
    });

    it('non-default date range appears in serialized output', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });

      act(() => result.current.setDateRange({ preset: '7d' }));

      const params = result.current.getApiParams();
      expect(params.from).toBe('now-7d');
    });
  });

  describe('shared time range', () => {
    it('remembers a date range change for the tab session', () => {
      const first = renderHook(() => useAnalyticsFilters(), { wrapper });
      act(() => first.result.current.setDateRange({ preset: '7d' }));
      first.unmount();

      // A later visit with no date in the URL opens on the remembered range
      const second = renderHook(() => useAnalyticsFilters(), { wrapper });
      expect(second.result.current.filters.dateRange).toEqual({ preset: '7d' });
    });

    it('opens on a range remembered from the Dashboard', () => {
      sessionStorage.setItem('achilles.timeRange', JSON.stringify({ preset: 'all' }));
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper });
      expect(result.current.filters.dateRange).toEqual({ preset: 'all' });
    });

    it('lets a range in the URL win and become the remembered one', () => {
      sessionStorage.setItem('achilles.timeRange', JSON.stringify({ preset: 'all' }));
      const first = renderHook(() => useAnalyticsFilters(), { wrapper: wrapperWithParams('date=90d') });
      expect(first.result.current.filters.dateRange).toEqual({ preset: '90d' });
      first.unmount();

      const second = renderHook(() => useAnalyticsFilters(), { wrapper });
      expect(second.result.current.filters.dateRange).toEqual({ preset: '90d' });
    });

    it('ignores an unknown preset in the URL', () => {
      const { result } = renderHook(() => useAnalyticsFilters(), { wrapper: wrapperWithParams('date=14d') });
      expect(result.current.filters.dateRange).toEqual({ preset: '30d' });
    });
  });
});

describe('report helpers', () => {
  it('sends an explicit lower bound for "All time" (the backend defaults to 7 days without one)', () => {
    expect(ALL_TIME_FROM).toBe('2000-01-01T00:00:00.000Z');
    expect(getDateRangeFilter({ preset: 'all' })).toEqual({ from: ALL_TIME_FROM });
  });

  it('keeps relative presets and custom ranges unchanged', () => {
    expect(getDateRangeFilter({ preset: '30d' })).toEqual({ from: 'now-30d' });
    expect(getDateRangeFilter({ preset: 'custom', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }))
      .toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
    expect(getDateRangeFilter({ preset: 'bogus' })).toEqual({ from: 'now-30d' });
  });

  it('round-trips filter state through URL params', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('date=all&result=unprotected&hostnames=H1,H2&tags=lockbit'));
    expect(filters.dateRange).toEqual({ preset: 'all' });
    expect(filters.hostnames).toEqual(['H1', 'H2']);
    expect(filtersFromSearchParams(new URLSearchParams(serializeToUrlParams(filters)))).toEqual(filters);
  });

  it('defaults to the tab defaults for an empty query', () => {
    expect(filtersFromSearchParams(new URLSearchParams('')).dateRange).toEqual({ preset: '30d' });
  });

  it('builds the same API params the tab sends', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('date=all&result=unprotected&hostnames=H1,H2'));
    expect(toApiParams(filters)).toEqual({ org: undefined, from: ALL_TIME_FROM, result: 'unprotected', hostnames: 'H1,H2' });
  });

  it('keeps a name holding a comma whole through the URL and the API params', () => {
    const name = 'The Gentlemen: GPO-Driven, Living-off-the-Land Intrusion';
    const filters = { ...filtersFromSearchParams(new URLSearchParams('')), bundleNames: [name, 'Other'] };
    const url = new URLSearchParams(serializeToUrlParams(filters));
    expect(filtersFromSearchParams(url).bundleNames).toEqual([name, 'Other']);
    expect(toApiParams(filters).bundleNames).toBe('The Gentlemen: GPO-Driven\\, Living-off-the-Land Intrusion,Other');
  });

  it('ignores unknown result values', () => {
    expect(parseUrlParams(new URLSearchParams('result=maybe')).result).toBeUndefined();
  });
});
