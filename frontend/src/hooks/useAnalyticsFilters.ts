import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExtendedFilterParams } from '@/services/api/analytics';

// Re-export DateRangeValue interface matching DateRangePicker
export interface DateRangeValue {
  preset: string;
  from?: string;
  to?: string;
}

/**
 * Get the appropriate rolling window size for a given date range.
 *
 * Window size mapping:
 * - 7 days or less: 7-day window (full coverage)
 * - 8-30 days: 7-day rolling window
 * - 31-90 days: 30-day rolling window
 * - Custom ranges: min(days, 30) capped at 7 minimum
 */
export function getWindowDaysForDateRange(dateRange: DateRangeValue): number {
  const windowMap: Record<string, number> = {
    '7d': 7,
    '14d': 7,
    '30d': 7,
    '90d': 30,
    'all': 30,
  };

  // Use mapped value for presets
  if (dateRange.preset && windowMap[dateRange.preset] !== undefined) {
    return windowMap[dateRange.preset];
  }

  // Handle custom date ranges
  if (dateRange.preset === 'custom' && dateRange.from && dateRange.to) {
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // Cap at 30, minimum of 7
    return Math.max(7, Math.min(diffDays, 30));
  }

  // Default for unknown presets
  return 7;
}

// Helper to convert date range value to ES format (matches DateRangePicker export)
function getDateRangeFilter(value: DateRangeValue): { from?: string; to?: string } {
  if (value.preset === 'custom' && value.from && value.to) {
    return { from: value.from, to: value.to };
  }
  if (value.preset === 'all') {
    return {};
  }
  const match = value.preset.match(/^(\d+)([dhw])$/);
  if (!match) {
    return { from: 'now-30d' };
  }
  return { from: `now-${value.preset}` };
}

export interface AnalyticsFilterState {
  // Basic filters (always visible)
  org: string | null;
  dateRange: DateRangeValue;
  result: 'all' | 'protected' | 'unprotected' | 'inconclusive';

  // Advanced filters (expandable)
  hostnames: string[];
  tests: string[];
  techniques: string[];
  categories: string[];
  severities: string[];
  threatActors: string[];
  tags: string[];
  errorNames: string[];
  errorCodes: string[];
  bundleNames: string[];
}

export interface UseAnalyticsFiltersReturn {
  // State
  filters: AnalyticsFilterState;
  isExpanded: boolean;
  hasActiveFilters: boolean;
  activeFilterCount: number;

  // Actions
  setOrg: (org: string | null) => void;
  setDateRange: (dateRange: DateRangeValue) => void;
  setResult: (result: 'all' | 'protected' | 'unprotected' | 'inconclusive') => void;
  setHostnames: (hostnames: string[]) => void;
  setTests: (tests: string[]) => void;
  setTechniques: (techniques: string[]) => void;
  setCategories: (categories: string[]) => void;
  setSeverities: (severities: string[]) => void;
  setThreatActors: (threatActors: string[]) => void;
  setTags: (tags: string[]) => void;
  setErrorNames: (errorNames: string[]) => void;
  setErrorCodes: (errorCodes: string[]) => void;
  setBundleNames: (bundleNames: string[]) => void;
  toggleExpanded: () => void;
  clearAllFilters: () => void;
  clearAdvancedFilters: () => void;

  // Computed
  getApiParams: () => ExtendedFilterParams;
}

const defaultFilters: AnalyticsFilterState = {
  org: null,
  dateRange: { preset: '30d' },
  result: 'all',
  hostnames: [],
  tests: [],
  techniques: [],
  categories: [],
  severities: [],
  threatActors: [],
  tags: [],
  errorNames: [],
  errorCodes: [],
  bundleNames: [],
};

// Parse URL params into filter state
function parseUrlParams(searchParams: URLSearchParams): Partial<AnalyticsFilterState> {
  const result: Partial<AnalyticsFilterState> = {};

  const org = searchParams.get('org');
  if (org) result.org = org;

  const datePreset = searchParams.get('date');
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');
  if (datePreset) {
    result.dateRange = { preset: datePreset };
  } else if (dateFrom && dateTo) {
    result.dateRange = { preset: 'custom', from: dateFrom, to: dateTo };
  }

  const resultParam = searchParams.get('result');
  if (resultParam === 'protected' || resultParam === 'unprotected' || resultParam === 'inconclusive') {
    result.result = resultParam;
  }

  const hostnames = searchParams.get('hostnames');
  if (hostnames) result.hostnames = hostnames.split(',');

  const tests = searchParams.get('tests');
  if (tests) result.tests = tests.split(',');

  const techniques = searchParams.get('techniques');
  if (techniques) result.techniques = techniques.split(',');

  const categories = searchParams.get('categories');
  if (categories) result.categories = categories.split(',');

  const severities = searchParams.get('severities');
  if (severities) result.severities = severities.split(',');

  const threatActors = searchParams.get('threatActors');
  if (threatActors) result.threatActors = threatActors.split(',');

  const tags = searchParams.get('tags');
  if (tags) result.tags = tags.split(',');

  const errorNames = searchParams.get('errorNames');
  if (errorNames) result.errorNames = errorNames.split(',');

  const errorCodes = searchParams.get('errorCodes');
  if (errorCodes) result.errorCodes = errorCodes.split(',');

  const bundleNames = searchParams.get('bundleNames');
  if (bundleNames) result.bundleNames = bundleNames.split(',');

  return result;
}

// Serialize filter state to URL params
function serializeToUrlParams(filters: AnalyticsFilterState): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.org) params.org = filters.org;

  if (filters.dateRange.preset === 'custom' && filters.dateRange.from && filters.dateRange.to) {
    params.from = filters.dateRange.from;
    params.to = filters.dateRange.to;
  } else if (filters.dateRange.preset && filters.dateRange.preset !== '30d') {
    params.date = filters.dateRange.preset;
  }

  if (filters.result !== 'all') params.result = filters.result;
  if (filters.hostnames.length > 0) params.hostnames = filters.hostnames.join(',');
  if (filters.tests.length > 0) params.tests = filters.tests.join(',');
  if (filters.techniques.length > 0) params.techniques = filters.techniques.join(',');
  if (filters.categories.length > 0) params.categories = filters.categories.join(',');
  if (filters.severities.length > 0) params.severities = filters.severities.join(',');
  if (filters.threatActors.length > 0) params.threatActors = filters.threatActors.join(',');
  if (filters.tags.length > 0) params.tags = filters.tags.join(',');
  if (filters.errorNames.length > 0) params.errorNames = filters.errorNames.join(',');
  if (filters.errorCodes.length > 0) params.errorCodes = filters.errorCodes.join(',');
  if (filters.bundleNames.length > 0) params.bundleNames = filters.bundleNames.join(',');

  return params;
}

export function useAnalyticsFilters(syncWithUrl = true): UseAnalyticsFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params or defaults
  const [filters, setFilters] = useState<AnalyticsFilterState>(() => {
    if (syncWithUrl) {
      return { ...defaultFilters, ...parseUrlParams(searchParams) };
    }
    return defaultFilters;
  });

  const [isExpanded, setIsExpanded] = useState(false);

  // Sync URL when filters change (preserve non-filter params like 'tab')
  useEffect(() => {
    if (syncWithUrl) {
      const filterParams = serializeToUrlParams(filters);
      setSearchParams(prev => {
        // Start with existing params to preserve non-filter params like 'tab'
        const newParams = new URLSearchParams(prev);
        // Clear all filter-related params first
        const filterKeys = ['org', 'date', 'from', 'to', 'result', 'hostnames', 'tests', 'techniques', 'categories', 'severities', 'threatActors', 'tags', 'errorNames', 'errorCodes', 'bundleNames'];
        filterKeys.forEach(key => newParams.delete(key));
        // Add back the current filter params
        Object.entries(filterParams).forEach(([key, value]) => {
          newParams.set(key, value);
        });
        return newParams;
      }, { replace: true });
    }
  }, [filters, syncWithUrl, setSearchParams]);

  // Calculate active filter count (all executions-tab filters)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.result !== 'all') count++;
    if (filters.hostnames.length > 0) count++;
    if (filters.tests.length > 0) count++;
    if (filters.techniques.length > 0) count++;
    if (filters.categories.length > 0) count++;
    if (filters.severities.length > 0) count++;
    if (filters.threatActors.length > 0) count++;
    if (filters.tags.length > 0) count++;
    if (filters.errorNames.length > 0) count++;
    if (filters.errorCodes.length > 0) count++;
    if (filters.bundleNames.length > 0) count++;
    return count;
  }, [filters]);

  const hasActiveFilters = useMemo(() => {
    return activeFilterCount > 0;
  }, [activeFilterCount]);

  // Actions
  const setOrg = useCallback((org: string | null) => {
    setFilters(prev => ({ ...prev, org }));
  }, []);

  const setDateRange = useCallback((dateRange: DateRangeValue) => {
    setFilters(prev => ({ ...prev, dateRange }));
  }, []);

  const setResult = useCallback((result: 'all' | 'protected' | 'unprotected' | 'inconclusive') => {
    setFilters(prev => ({ ...prev, result }));
  }, []);

  const setHostnames = useCallback((hostnames: string[]) => {
    setFilters(prev => ({ ...prev, hostnames }));
  }, []);

  const setTests = useCallback((tests: string[]) => {
    setFilters(prev => ({ ...prev, tests }));
  }, []);

  const setTechniques = useCallback((techniques: string[]) => {
    setFilters(prev => ({ ...prev, techniques }));
  }, []);

  const setCategories = useCallback((categories: string[]) => {
    setFilters(prev => ({ ...prev, categories }));
  }, []);

  const setSeverities = useCallback((severities: string[]) => {
    setFilters(prev => ({ ...prev, severities }));
  }, []);

  const setThreatActors = useCallback((threatActors: string[]) => {
    setFilters(prev => ({ ...prev, threatActors }));
  }, []);

  const setTags = useCallback((tags: string[]) => {
    setFilters(prev => ({ ...prev, tags }));
  }, []);

  const setErrorNames = useCallback((errorNames: string[]) => {
    setFilters(prev => ({ ...prev, errorNames }));
  }, []);

  const setErrorCodes = useCallback((errorCodes: string[]) => {
    setFilters(prev => ({ ...prev, errorCodes }));
  }, []);

  const setBundleNames = useCallback((bundleNames: string[]) => {
    setFilters(prev => ({ ...prev, bundleNames }));
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  const clearAdvancedFilters = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      result: 'all',
      hostnames: [],
      tests: [],
      techniques: [],
      categories: [],
      severities: [],
      threatActors: [],
      tags: [],
      errorNames: [],
      errorCodes: [],
      bundleNames: [],
    }));
  }, []);

  // Convert filter state to API params
  const getApiParams = useCallback((): ExtendedFilterParams => {
    const dateFilter = getDateRangeFilter(filters.dateRange);

    const params: ExtendedFilterParams = {
      org: filters.org || undefined,
      ...dateFilter,
      result: filters.result === 'all' ? undefined : filters.result,
    };

    if (filters.hostnames.length > 0) {
      params.hostnames = filters.hostnames.join(',');
    }
    if (filters.tests.length > 0) {
      params.tests = filters.tests.join(',');
    }
    if (filters.techniques.length > 0) {
      params.techniques = filters.techniques.join(',');
    }
    if (filters.categories.length > 0) {
      params.categories = filters.categories.join(',');
    }
    if (filters.severities.length > 0) {
      params.severities = filters.severities.join(',');
    }
    if (filters.threatActors.length > 0) {
      params.threatActors = filters.threatActors.join(',');
    }
    if (filters.tags.length > 0) {
      params.tags = filters.tags.join(',');
    }
    if (filters.errorNames.length > 0) {
      params.errorNames = filters.errorNames.join(',');
    }
    if (filters.errorCodes.length > 0) {
      params.errorCodes = filters.errorCodes.join(',');
    }
    if (filters.bundleNames.length > 0) {
      params.bundleNames = filters.bundleNames.join(',');
    }

    return params;
  }, [filters]);

  return {
    filters,
    isExpanded,
    hasActiveFilters,
    activeFilterCount,
    setOrg,
    setDateRange,
    setResult,
    setHostnames,
    setTests,
    setTechniques,
    setCategories,
    setSeverities,
    setThreatActors,
    setTags,
    setErrorNames,
    setErrorCodes,
    setBundleNames,
    toggleExpanded,
    clearAllFilters,
    clearAdvancedFilters,
    getApiParams,
  };
}
