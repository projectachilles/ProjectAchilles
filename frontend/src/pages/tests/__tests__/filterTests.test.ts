import { describe, it, expect } from 'vitest';
import type { TestMetadata } from '@/types/test';
import type { TestVersionRow, TestVersionStatus } from '@/types/testVersion';
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
    createdDate: '2026-01-01',
    score: 7.5,
    target: ['win', 'macos'],
    threatActor: 'APT33',
  }),
  makeTest({
    uuid: 'c',
    name: 'Gamma Recon',
    category: 'intel-driven',
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
      { ...DEFAULT_FILTERS, category: 'intel-driven', tacticSlug: 'impact' },
      ctx,
    );
    // Category counts computed with category cleared, tactic applied
    expect(counts.categories).toEqual([{ value: 'intel-driven', count: 1 }]);
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

describe('filterTests by version status', () => {
  const versionRows = (statuses: Record<string, TestVersionStatus>) =>
    Object.fromEntries(
      Object.entries(statuses).map(([uuid, status]) => [
        uuid,
        { status, custom: false, published: null, synced: null, built: null } as TestVersionRow,
      ]),
    );

  it('keeps only the tests with the chosen status', () => {
    const first = tests[0].uuid;
    const second = tests[1].uuid;
    const versions = versionRows({ [first]: 'rebuild_needed', [second]: 'up_to_date' });
    const result = filterTests(tests, { ...DEFAULT_FILTERS, versionStatus: 'rebuild_needed' }, { ...ctx, versions });
    expect(result.map((t) => t.uuid)).toEqual([first]);
  });

  it('ignores the filter when no versions are loaded', () => {
    const result = filterTests(tests, { ...DEFAULT_FILTERS, versionStatus: 'rebuild_needed' }, ctx);
    expect(result).toHaveLength(tests.length);
  });
});
