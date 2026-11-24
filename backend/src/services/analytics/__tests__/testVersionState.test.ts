import { describe, it, expect } from 'vitest';
import type { CurrentTestVersion } from '../../../types/testVersion.js';
import {
  documentTestUuid,
  documentVersion,
  versionStateClauses,
  RESULT_VERSION_STATES,
} from '../testVersionState.js';

const UUID_A = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_B = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_GONE = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_CUSTOM = 'd1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_PINNED = 'e1b2c3d4-e5f6-4890-abcd-ef1234567890';
const FP_A = 'fp-a-current';
const FP_B = 'fp-b-current';
const HEAD = 'head111';
const OTHER = 'other222';
// A and B are at the library commit; a custom test has no commit. PINNED stands
// for "a test whose current commit is not the one the others are at": the rule
// is per test, so its commit must never make another test's result current.
const CURRENT = new Map<string, CurrentTestVersion>([
  [UUID_A, { fingerprint: FP_A, commit: HEAD }],
  [UUID_B, { fingerprint: FP_B, commit: HEAD }],
  [UUID_CUSTOM, { fingerprint: 'fp-custom-current', commit: null }],
  [UUID_PINNED, { fingerprint: 'fp-pinned-current', commit: OTHER }],
]);

const tv = (fingerprint?: string, commit: string | null = 'abc123') => ({
  'f0rtika.test_version.built_at': '2026-11-01T00:00:00Z',
  'f0rtika.test_version.build_source': 'built',
  ...(commit ? { 'f0rtika.test_version.commit': commit } : {}),
  ...(fingerprint ? { 'f0rtika.test_version.fingerprint': fingerprint } : {}),
});

type Doc = Record<string, unknown>;

// Every kind of document results.service.ts writes, with the state it must get.
const FIXTURES: Array<{ name: string; doc: Doc; state: (typeof RESULT_VERSION_STATES)[number] }> = [
  { name: 'standalone, current', doc: { 'f0rtika.test_uuid': UUID_A, ...tv(FP_A) }, state: 'current' },
  { name: 'standalone, older', doc: { 'f0rtika.test_uuid': UUID_A, ...tv('fp-a-old') }, state: 'older' },
  { name: 'standalone, no fingerprint', doc: { 'f0rtika.test_uuid': UUID_A, ...tv() }, state: 'unknown' },
  { name: 'standalone, test not in the library', doc: { 'f0rtika.test_uuid': UUID_GONE, ...tv('fp-x') }, state: 'unknown' },
  { name: 'standalone, from before the feature', doc: { 'f0rtika.test_uuid': UUID_A }, state: 'not_recorded' },
  {
    name: 'multi-stage whole-test doc (bundle_id, plain test_uuid), older',
    doc: { 'f0rtika.test_uuid': UUID_A, 'f0rtika.bundle_id': UUID_A, ...tv('fp-a-old') },
    state: 'older',
  },
  {
    name: 'bundle control (composite test_uuid), current',
    doc: { 'f0rtika.test_uuid': `${UUID_B}::CH-IEP-003`, 'f0rtika.bundle_id': UUID_B, ...tv(FP_B) },
    state: 'current',
  },
  {
    name: 'bundle control, older',
    doc: { 'f0rtika.test_uuid': `${UUID_B}::CH-IEP-003`, 'f0rtika.bundle_id': UUID_B, ...tv('fp-b-old') },
    state: 'older',
  },
  {
    name: 'bundle control of a test no longer in the library',
    doc: { 'f0rtika.test_uuid': `${UUID_GONE}::CH-1`, 'f0rtika.bundle_id': UUID_GONE, ...tv('fp-x') },
    state: 'unknown',
  },
  {
    name: 'EDR-terminated / launch-blocked bundle doc, current',
    doc: { 'f0rtika.test_uuid': UUID_A, 'f0rtika.bundle_id': UUID_A, 'f0rtika.edr_terminated': true, ...tv(FP_A) },
    state: 'current',
  },
  // The same commit as the one synced now is the same source, whatever the
  // fingerprint says (it was computed under an earlier rule).
  {
    name: 'standalone, old-rule fingerprint at the synced commit',
    doc: { 'f0rtika.test_uuid': UUID_A, ...tv('fp-a-old-rule', HEAD) },
    state: 'current',
  },
  {
    name: 'bundle control, old-rule fingerprint at the synced commit',
    doc: { 'f0rtika.test_uuid': `${UUID_B}::CH-IEP-003`, 'f0rtika.bundle_id': UUID_B, ...tv('fp-b-old-rule', HEAD) },
    state: 'current',
  },
  {
    name: 'the synced commit but no fingerprint (stamp not trusted)',
    doc: { 'f0rtika.test_uuid': UUID_A, ...tv(undefined, HEAD) },
    state: 'unknown',
  },
  {
    name: 'the synced commit, test not in the library',
    doc: { 'f0rtika.test_uuid': UUID_GONE, ...tv('fp-x', HEAD) },
    state: 'unknown',
  },
  {
    name: "another test's current commit does not count",
    doc: { 'f0rtika.test_uuid': UUID_A, ...tv('fp-a-old', OTHER) },
    state: 'older',
  },
  {
    name: 'a test at its own commit, old-rule fingerprint',
    doc: { 'f0rtika.test_uuid': UUID_PINNED, ...tv('fp-pinned-old-rule', OTHER) },
    state: 'current',
  },
  {
    // No writer makes this document (a bundle document's test_uuid starts with its
    // bundle_id); the filter still has to read the test the way the label does.
    name: 'bundle_id of one test, test_uuid of another: the bundle_id decides',
    doc: { 'f0rtika.test_uuid': UUID_A, 'f0rtika.bundle_id': UUID_PINNED, ...tv('fp-old', HEAD) },
    state: 'older',
  },
  {
    name: 'custom test (no commit), other fingerprint',
    doc: { 'f0rtika.test_uuid': UUID_CUSTOM, ...tv('fp-custom-old', null) },
    state: 'older',
  },
  {
    name: 'custom test, a result that carries the library commit',
    doc: { 'f0rtika.test_uuid': UUID_CUSTOM, ...tv('fp-custom-old', HEAD) },
    state: 'older',
  },
];

// ---- a small evaluator for the clauses we generate (filter context) ----
function has(doc: Doc, field: string): boolean {
  return doc[field] !== undefined;
}
function matches(q: any, doc: Doc): boolean {
  if (q.match_all) return true;
  if (q.exists) return has(doc, q.exists.field);
  if (q.term) {
    const [[field, value]] = Object.entries(q.term) as Array<[string, unknown]>;
    return has(doc, field) && doc[field] === value;
  }
  if (q.terms) {
    const [[field, values]] = Object.entries(q.terms) as Array<[string, unknown[]]>;
    return has(doc, field) && values.includes(doc[field]);
  }
  if (q.bool) {
    const b = q.bool;
    if ((b.filter ?? []).some((c: any) => !matches(c, doc))) return false;
    if ((b.must ?? []).some((c: any) => !matches(c, doc))) return false;
    if ((b.must_not ?? []).some((c: any) => matches(c, doc))) return false;
    if (b.should) {
      // Elasticsearch's default differs with context; make every should say what it means.
      if (b.minimum_should_match === undefined) throw new Error('should without minimum_should_match');
      const need = b.minimum_should_match;
      if (b.should.filter((c: any) => matches(c, doc)).length < need) return false;
    }
    return true;
  }
  throw new Error(`evaluator cannot handle ${JSON.stringify(q)}`);
}
const selects = (clauses: any[], doc: Doc) => clauses.every(c => matches(c, doc));

describe('result version state: row label and filter use one rule', () => {
  it.each(FIXTURES)('$name -> $state', ({ doc, state }) => {
    expect(documentVersion(doc, CURRENT).version_state).toBe(state);
    for (const s of RESULT_VERSION_STATES) {
      expect(selects(versionStateClauses(s, CURRENT), doc)).toBe(s === state);
    }
  });

  it('agrees on an empty map: every recorded version is unknown', () => {
    const empty = new Map<string, CurrentTestVersion>();
    for (const { doc } of FIXTURES) {
      const state = documentVersion(doc, empty).version_state;
      expect(state).toBe(doc['f0rtika.test_version.built_at'] ? 'unknown' : 'not_recorded');
      for (const s of RESULT_VERSION_STATES) {
        expect(selects(versionStateClauses(s, empty), doc)).toBe(s === state);
      }
    }
  });

  it('takes the test uuid from bundle_id, else the part of test_uuid before ::', () => {
    expect(documentTestUuid({ 'f0rtika.test_uuid': `${UUID_A}::X`, 'f0rtika.bundle_id': UUID_A })).toBe(UUID_A);
    expect(documentTestUuid({ 'f0rtika.test_uuid': `${UUID_A}::X` })).toBe(UUID_A);
    expect(documentTestUuid({ 'f0rtika.test_uuid': UUID_B })).toBe(UUID_B);
    expect(documentTestUuid({})).toBe('');
  });

  it('reads nested _source as well as flattened keys', () => {
    const row = documentVersion(
      { f0rtika: { test_uuid: UUID_A, test_version: { built_at: 'T', build_source: 'uploaded', fingerprint: FP_A, commit: 'c', commit_date: 'D' } } },
      CURRENT,
    );
    expect(row).toEqual({
      test_version: { built_at: 'T', build_source: 'uploaded', fingerprint: FP_A, commit: 'c', commit_date: 'D' },
      version_state: 'current',
    });
  });

  it('omits a build_source the document lacks or does not recognise', () => {
    const base = { 'f0rtika.test_uuid': UUID_A, 'f0rtika.test_version.built_at': 'T' };
    expect(documentVersion(base, CURRENT).test_version).not.toHaveProperty('build_source');
    expect(documentVersion({ ...base, 'f0rtika.test_version.build_source': 'x' }, CURRENT).test_version).not.toHaveProperty('build_source');
    expect(documentVersion({ ...base, 'f0rtika.test_version.build_source': 'uploaded' }, CURRENT).test_version?.build_source).toBe('uploaded');
  });

  it('without a map the row carries test_version and no version_state; absent version carries neither', () => {
    expect(documentVersion({ 'f0rtika.test_uuid': UUID_A, ...tv(FP_A) }, undefined).version_state).toBeUndefined();
    expect(documentVersion({ 'f0rtika.test_uuid': UUID_A, ...tv(FP_A) }, undefined).test_version?.fingerprint).toBe(FP_A);
    expect(documentVersion({ 'f0rtika.test_uuid': UUID_A }, undefined)).toEqual({});
  });
});

describe('versionStateClauses (exact JSON)', () => {
  const FP = 'f0rtika.test_version.fingerprint';
  const BUILT = 'f0rtika.test_version.built_at';
  const COMMIT = 'f0rtika.test_version.commit';
  const small = new Map<string, CurrentTestVersion>([[UUID_A, { fingerprint: 'fp1', commit: 'c1' }]]);
  const noGit = new Map<string, CurrentTestVersion>([[UUID_A, { fingerprint: 'fp1', commit: null }]]);
  const fpIn = { terms: { [FP]: ['fp1'] } };
  const tests = (uuids: string[]) => ({
    bool: {
      should: [
        { terms: { 'f0rtika.bundle_id': uuids } },
        { bool: { filter: [{ terms: { 'f0rtika.test_uuid': uuids } }], must_not: [{ exists: { field: 'f0rtika.bundle_id' } }] } },
      ],
      minimum_should_match: 1,
    },
  });
  const testIn = tests([UUID_A]);

  it('not_recorded', () => {
    expect(versionStateClauses('not_recorded', small)).toEqual([{ bool: { must_not: [{ exists: { field: BUILT } }] } }]);
  });
  // Current = the current fingerprint, or a fingerprint of any rule at the commit the test is synced at.
  const isCurrent = {
    bool: {
      should: [fpIn, { bool: { filter: [{ exists: { field: FP } }, { term: { [COMMIT]: 'c1' } }, testIn] } }],
      minimum_should_match: 1,
    },
  };
  it('current', () => {
    expect(versionStateClauses('current', small)).toEqual([isCurrent]);
  });
  it('older', () => {
    expect(versionStateClauses('older', small)).toEqual([{ exists: { field: FP } }, { bool: { must_not: [isCurrent] } }, testIn]);
  });
  it('without a commit (no git, custom tests) only the fingerprint decides', () => {
    expect(versionStateClauses('current', noGit)).toEqual([fpIn]);
    expect(versionStateClauses('older', noGit)).toEqual([{ exists: { field: FP } }, { bool: { must_not: [fpIn] } }, testIn]);
  });
  it('one clause per commit, each limited to the tests synced at it', () => {
    const two = new Map<string, CurrentTestVersion>([
      [UUID_A, { fingerprint: 'fp1', commit: 'c1' }],
      [UUID_B, { fingerprint: 'fp2', commit: 'c1' }],
      [UUID_GONE, { fingerprint: 'fp3', commit: 'c2' }],
    ]);
    expect(versionStateClauses('current', two)).toEqual([
      {
        bool: {
          should: [
            { terms: { [FP]: ['fp1', 'fp2', 'fp3'] } },
            { bool: { filter: [{ exists: { field: FP } }, { term: { [COMMIT]: 'c1' } }, tests([UUID_A, UUID_B])] } },
            { bool: { filter: [{ exists: { field: FP } }, { term: { [COMMIT]: 'c2' } }, tests([UUID_GONE])] } },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });
  it('unknown', () => {
    expect(versionStateClauses('unknown', small)).toEqual([
      { exists: { field: BUILT } },
      {
        bool: {
          should: [
            { bool: { must_not: [{ exists: { field: FP } }] } },
            { bool: { filter: [{ exists: { field: FP } }], must_not: [testIn] } },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });
  it('current and older match nothing on an empty or missing map', () => {
    const nothing = [{ bool: { must_not: [{ match_all: {} }] } }];
    for (const m of [new Map<string, CurrentTestVersion>(), undefined]) {
      expect(versionStateClauses('current', m)).toEqual(nothing);
      expect(versionStateClauses('older', m)).toEqual(nothing);
    }
  });
});
