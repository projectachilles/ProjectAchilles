import type { TestMetadata } from '@/types/test';

export type SortField = 'name' | 'createdDate' | 'score' | 'severity' | 'lastModifiedDate';
export type SortDirection = 'asc' | 'desc';
export type ViewFilter = 'all' | 'favorites' | 'recent';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

export interface TestFilters {
  query: string;
  category: string | null;
  /** Multi-select severity set; empty = all. */
  severities: Set<string>;
  /** Platform/target value; null = all. */
  target: string | null;
  threatActor: string | null;
  /** MITRE tactic slug; null = all. */
  tacticSlug: string | null;
  notRunYet: boolean;
  hasBinary: boolean;
  view: ViewFilter;
  sortField: SortField;
  sortDirection: SortDirection;
}

export const DEFAULT_FILTERS: TestFilters = {
  query: '',
  category: null,
  severities: new Set(),
  target: null,
  threatActor: null,
  tacticSlug: null,
  notRunYet: false,
  hasBinary: false,
  view: 'all',
  sortField: 'createdDate',
  sortDirection: 'desc',
};

export interface FilterContext {
  favorites: Set<string>;
  /** Recent test uuids, most recent first. */
  recentUuids: string[];
  executedUuids: Set<string> | null;
  builtUuids: Set<string> | null;
}

/** Mode/view pre-filter, before facets — mirrors the legacy behavior. */
export function applyView(tests: TestMetadata[], view: ViewFilter, ctx: FilterContext): TestMetadata[] {
  if (view === 'favorites') return tests.filter((t) => ctx.favorites.has(t.uuid));
  if (view === 'recent') {
    const order = new Map(ctx.recentUuids.map((uuid, i) => [uuid, i]));
    return tests
      .filter((t) => order.has(t.uuid))
      .sort((a, b) => (order.get(a.uuid) ?? 0) - (order.get(b.uuid) ?? 0));
  }
  return tests;
}

export function filterTests(
  tests: TestMetadata[],
  filters: TestFilters,
  ctx: FilterContext,
): TestMetadata[] {
  let filtered = applyView(tests, filters.view, ctx);

  const query = filters.query.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(
      (test) =>
        (test.name || '').toLowerCase().includes(query) ||
        (test.uuid || '').toLowerCase().includes(query) ||
        (Array.isArray(test.techniques) &&
          test.techniques.some((t) => (t || '').toLowerCase().includes(query))) ||
        (test.description || '').toLowerCase().includes(query),
    );
  }

  if (filters.category) {
    filtered = filtered.filter((test) => test.category === filters.category);
  }

  if (filters.severities.size > 0) {
    filtered = filtered.filter((test) => filters.severities.has((test.severity || '').toLowerCase()));
  }

  if (filters.target) {
    filtered = filtered.filter(
      (test) => Array.isArray(test.target) && test.target.includes(filters.target as string),
    );
  }

  if (filters.threatActor) {
    filtered = filtered.filter((test) => test.threatActor === filters.threatActor);
  }

  if (filters.tacticSlug) {
    filtered = filtered.filter((test) =>
      test.tactics?.some((t) => t.toLowerCase() === filters.tacticSlug),
    );
  }

  if (filters.notRunYet && ctx.executedUuids) {
    filtered = filtered.filter((test) => !ctx.executedUuids!.has(test.uuid));
  }

  if (filters.hasBinary && ctx.builtUuids) {
    filtered = filtered.filter((test) => ctx.builtUuids!.has(test.uuid));
  }

  // Recent view keeps recency order unless the user explicitly sorts
  if (filters.view !== 'recent') {
    filtered = sortTests(filtered, filters.sortField, filters.sortDirection);
  }

  return filtered;
}

export function sortTests(
  tests: TestMetadata[],
  field: SortField,
  direction: SortDirection,
): TestMetadata[] {
  const sorted = [...tests];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = (a.name || '').localeCompare(b.name || '');
        break;
      case 'createdDate':
        cmp = (a.createdDate || '').localeCompare(b.createdDate || '');
        break;
      case 'lastModifiedDate':
        cmp = (a.lastModifiedDate || '').localeCompare(b.lastModifiedDate || '');
        break;
      case 'score':
        cmp = (a.score ?? 0) - (b.score ?? 0);
        break;
      case 'severity':
        cmp =
          (SEVERITY_ORDER[a.severity || ''] ?? 0) - (SEVERITY_ORDER[b.severity || ''] ?? 0);
        break;
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export interface TestGroup {
  category: string;
  tests: TestMetadata[];
}

/** Group by category (largest first); uncategorized tests fall into "other". */
export function groupByCategory(tests: TestMetadata[]): TestGroup[] {
  const groups = new Map<string, TestMetadata[]>();
  for (const test of tests) {
    const key = test.category || 'other';
    const list = groups.get(key);
    if (list) list.push(test);
    else groups.set(key, [test]);
  }
  return [...groups.entries()]
    .map(([category, groupTests]) => ({ category, tests: groupTests }))
    .sort((a, b) => b.tests.length - a.tests.length);
}

export interface FacetCounts {
  total: number;
  categories: Array<{ value: string; count: number }>;
  severities: Array<{ value: string; count: number }>;
  targets: Array<{ value: string; count: number }>;
  threatActors: Array<{ value: string; count: number }>;
}

/**
 * Facet counts respond to the other active filters (each facet's counts are
 * computed with its own selection removed, the standard faceted-search rule).
 */
export function computeFacetCounts(
  tests: TestMetadata[],
  filters: TestFilters,
  ctx: FilterContext,
): FacetCounts {
  const countBy = (
    source: TestMetadata[],
    extract: (t: TestMetadata) => string[] | string | undefined,
  ) => {
    const counts = new Map<string, number>();
    for (const test of source) {
      const raw = extract(test);
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  const without = (overrides: Partial<TestFilters>) =>
    filterTests(tests, { ...filters, ...overrides }, ctx);

  return {
    total: without({}).length,
    categories: countBy(without({ category: null }), (t) => t.category),
    severities: countBy(without({ severities: new Set() }), (t) =>
      (t.severity || 'info').toLowerCase(),
    ),
    targets: countBy(without({ target: null }), (t) => t.target),
    threatActors: countBy(without({ threatActor: null }), (t) => t.threatActor),
  };
}
