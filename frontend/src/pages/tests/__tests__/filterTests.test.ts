import { describe, it, expect } from 'vitest';
import type { TestMetadata } from '@/types/test';
import {
  DEFAULT_FILTERS,
  computeFacetCounts,
  filterTests,
  groupByCategory,
  type FilterContext,
} from '../filterTests';

function makeTest(overrides: Partial<TestMetadata>): TestMetadata {
  return {
    uuid: overrides.uuid ?? crypto.randomUUID(),
    name: 'test',
    techniques: [],
    isMultiStage: false,
    stages: [],
    ...overrides,
  };
}

const tests: TestMetadata[] = [
  makeTest({
    uuid: 'a',
    name: 'Alpha Wiper',
    category: 'intel-driven',
    severity: 'critical',
    createdDate: '2026-03-01',
    score: 9.1,
    techniques: ['T1485'],
    tactics: ['impact'],
    target: ['win'],
  }),
  makeTest({
    uuid: 'b',
    name: 'Beta Hygiene',
    category: 'cyber-hygiene',
    severity: 'high',
    createdDate: '2026-01-01',
    score: 7.5,
    target: ['win', 'macos'],
    threatActor: 'APT33',
  }),
  makeTest({
    uuid: 'c',
    name: 'Gamma Recon',
    category: 'intel-driven',
    severity: 'high',
    createdDate: '2026-02-01',
    techniques: ['T1595'],
    tactics: ['reconnaissance'],
  }),
];

const ctx: FilterContext = {
  favorites: new Set(['b']),
  recentUuids: ['c', 'a'],
  executedUuids: new Set(['a']),
  builtUuids: new Set(['a', 'b']),
};

describe('filterTests', () => {
  it('defaults to createdDate descending (newest first)', () => {
    const result = filterTests(tests, DEFAULT_FILTERS, ctx);
    expect(result.map((t) => t.uuid)).toEqual(['a', 'c', 'b']);
  });

  it('has-binary keeps only built tests', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, hasBinary: true }, ctx);
    expect(result.map((t) => t.uuid).sort()).toEqual(['a', 'b']);
  });

  it('has-binary is a no-op when the builds endpoint is unavailable', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, hasBinary: true }, { ...ctx, builtUuids: null });
    expect(result).toHaveLength(3);
  });

  it('not-run-yet excludes executed tests', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, notRunYet: true }, ctx);
    expect(result.map((t) => t.uuid).sort()).toEqual(['b', 'c']);
  });

  it('severity is multi-select', () => {
    const result = filterTests(
      tests,
      { ...DEFAULT_FILTERS, severities: new Set(['critical', 'high']) },
      ctx,
    );
    expect(result).toHaveLength(3);
    const onlyCritical = filterTests(
      tests,
      { ...DEFAULT_FILTERS, severities: new Set(['critical']) },
      ctx,
    );
    expect(onlyCritical.map((t) => t.uuid)).toEqual(['a']);
  });

  it('filters by tactic slug', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, tacticSlug: 'impact' }, ctx);
    expect(result.map((t) => t.uuid)).toEqual(['a']);
  });

  it('search matches name, uuid, and technique', () => {
    expect(filterTests(tests, { ...DEFAULT_FILTERS, query: 't1595' }, ctx)).toHaveLength(1);
    expect(filterTests(tests, { ...DEFAULT_FILTERS, query: 'beta' }, ctx)).toHaveLength(1);
  });

  it('favorites view narrows to favorited tests', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, view: 'favorites' }, ctx);
    expect(result.map((t) => t.uuid)).toEqual(['b']);
  });

  it('recent view preserves recency order', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, view: 'recent' }, ctx);
    expect(result.map((t) => t.uuid)).toEqual(['c', 'a']);
  });
});

describe('computeFacetCounts', () => {
  it('a facet ignores its own selection but respects others', () => {
    const counts = computeFacetCounts(
      tests,
      { ...DEFAULT_FILTERS, category: 'intel-driven', severities: new Set(['high']) },
      ctx,
    );
    // Category counts computed with category cleared, severity=high applied
    expect(counts.categories).toEqual([
      { value: 'cyber-hygiene', count: 1 },
      { value: 'intel-driven', count: 1 },
    ]);
    // Severity counts with severities cleared, category applied
    expect(counts.severities).toEqual([
      { value: 'critical', count: 1 },
      { value: 'high', count: 1 },
    ]);
    expect(counts.total).toBe(1); // both filters applied
  });
});

describe('groupByCategory', () => {
  it('groups largest-first with uncategorized as "other"', () => {
    const groups = groupByCategory([...tests, makeTest({ uuid: 'd' })]);
    expect(groups.map((g) => [g.category, g.tests.length])).toEqual([
      ['intel-driven', 2],
      ['cyber-hygiene', 1],
      ['other', 1],
    ]);
  });
});
