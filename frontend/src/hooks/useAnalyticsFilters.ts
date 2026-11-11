import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { joinFilterList, splitFilterList } from '@/lib/filterList';
import type { ExtendedFilterParams } from '@/services/api/analytics';
import {
  DEFAULT_TIME_RANGE,
  getDateRangeFilter,
  readStoredTimeRange,
  storeTimeRange,
  timeRangeFromParams,
  timeRangeToParams,
  type DateRangeValue,
} from '@/lib/timeRange';

export type { DateRangeValue };
export { ALL_TIME_FROM, getDateRangeFilter } from '@/lib/timeRange';

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
  dateRange: DEFAULT_TIME_RANGE,
  result: 'all',
  hostnames: [],
  tests: [],
  techniques: [],
  categories: [],
  threatActors: [],
  tags: [],
  errorNames: [],
  errorCodes: [],
  bundleNames: [],
};

// Parse URL params into filter state
export function parseUrlParams(searchParams: URLSearchParams): Partial<AnalyticsFilterState> {
  const result: Partial<AnalyticsFilterState> = {};

  const org = searchParams.get('org');
  if (org) result.org = org;

  const dateRange = timeRangeFromParams(searchParams);
  if (dateRange) result.dateRange = dateRange;

  const resultParam = searchParams.get('result');
  if (resultParam === 'protected' || resultParam === 'unprotected' || resultParam === 'inconclusive') {
    result.result = resultParam;
  }

  const hostnames = searchParams.get('hostnames');
  if (hostnames) result.hostnames = splitFilterList(hostnames);

  const tests = searchParams.get('tests');
  if (tests) result.tests = splitFilterList(tests);

  const techniques = searchParams.get('techniques');
  if (techniques) result.techniques = splitFilterList(techniques);

  const categories = searchParams.get('categories');
  if (categories) result.categories = splitFilterList(categories);

  const threatActors = searchParams.get('threatActors');
  if (threatActors) result.threatActors = splitFilterList(threatActors);

  const tags = searchParams.get('tags');
  if (tags) result.tags = splitFilterList(tags);

  const errorNames = searchParams.get('errorNames');
  if (errorNames) result.errorNames = splitFilterList(errorNames);

  const errorCodes = searchParams.get('errorCodes');
  if (errorCodes) result.errorCodes = splitFilterList(errorCodes);

  const bundleNames = searchParams.get('bundleNames');
  if (bundleNames) result.bundleNames = splitFilterList(bundleNames);

  return result;
}

// Serialize filter state to URL params
export function serializeToUrlParams(filters: AnalyticsFilterState): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.org) params.org = filters.org;

  // The default range stays out of the URL; every other range serializes
  Object.assign(params, timeRangeToParams(filters.dateRange));

  if (filters.result !== 'all') params.result = filters.result;
  if (filters.hostnames.length > 0) params.hostnames = joinFilterList(filters.hostnames);
  if (filters.tests.length > 0) params.tests = joinFilterList(filters.tests);
  if (filters.techniques.length > 0) params.techniques = joinFilterList(filters.techniques);
  if (filters.categories.length > 0) params.categories = joinFilterList(filters.categories);
  if (filters.threatActors.length > 0) params.threatActors = joinFilterList(filters.threatActors);
  if (filters.tags.length > 0) params.tags = joinFilterList(filters.tags);
  if (filters.errorNames.length > 0) params.errorNames = joinFilterList(filters.errorNames);
  if (filters.errorCodes.length > 0) params.errorCodes = joinFilterList(filters.errorCodes);
  if (filters.bundleNames.length > 0) params.bundleNames = joinFilterList(filters.bundleNames);

  return params;
}

/** Full filter state from URL search params, with tab defaults for anything absent. */
export function filtersFromSearchParams(searchParams: URLSearchParams): AnalyticsFilterState {
  return { ...defaultFilters, ...parseUrlParams(searchParams) };
}

/** API params for a filter state: the pure core of getApiParams(). */
export function toApiParams(filters: AnalyticsFilterState): ExtendedFilterParams {
  const params: ExtendedFilterParams = {
    org: filters.org || undefined,
    ...getDateRangeFilter(filters.dateRange),
    result: filters.result === 'all' ? undefined : filters.result,
  };
  if (filters.hostnames.length > 0) params.hostnames = joinFilterList(filters.hostnames);
  if (filters.tests.length > 0) params.tests = joinFilterList(filters.tests);
  if (filters.techniques.length > 0) params.techniques = joinFilterList(filters.techniques);
  if (filters.categories.length > 0) params.categories = joinFilterList(filters.categories);
  if (filters.threatActors.length > 0) params.threatActors = joinFilterList(filters.threatActors);
  if (filters.tags.length > 0) params.tags = joinFilterList(filters.tags);
  if (filters.errorNames.length > 0) params.errorNames = joinFilterList(filters.errorNames);
  if (filters.errorCodes.length > 0) params.errorCodes = joinFilterList(filters.errorCodes);
  if (filters.bundleNames.length > 0) params.bundleNames = joinFilterList(filters.bundleNames);
  return params;
}

export function useAnalyticsFilters(syncWithUrl = true): UseAnalyticsFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from URL params; the date range falls back to the one
  // remembered from the Dashboard or an earlier visit, then the default.
  const [filters, setFilters] = useState<AnalyticsFilterState>(() => {
    const remembered = readStoredTimeRange();
    const base = remembered ? { ...defaultFilters, dateRange: remembered } : defaultFilters;
    return syncWithUrl ? { ...base, ...parseUrlParams(searchParams) } : base;
  });

  // Share the date range with the Dashboard for the rest of the tab session
  useEffect(() => {
    storeTimeRange(filters.dateRange);
  }, [filters.dateRange]);

  const [isExpanded, setIsExpanded] = useState(false);

  // Sync URL when filters change (preserve non-filter params like 'tab')
  useEffect(() => {
    if (syncWithUrl) {
      const filterParams = serializeToUrlParams(filters);
      setSearchParams(prev => {
        // Start with existing params to preserve non-filter params like 'tab'
        const newParams = new URLSearchParams(prev);
        // Clear all filter-related params first
        // 'severities' is a removed filter; still cleared so a legacy link's param doesn't linger
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
      threatActors: [],
      tags: [],
      errorNames: [],
      errorCodes: [],
      bundleNames: [],
    }));
  }, []);

  // Convert filter state to API params
  const getApiParams = useCallback((): ExtendedFilterParams => toApiParams(filters), [filters]);

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
