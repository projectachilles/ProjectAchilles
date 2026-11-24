import { describe, it, expect } from 'vitest';
import {
  documentTestUuid,
  documentVersion,
  versionStateClauses,
  RESULT_VERSION_STATES,
} from '../testVersionState.js';

const UUID_A = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_B = 'b1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_GONE = 'c1b2c3d4-e5f6-4890-abcd-ef1234567890';
const FP_A = 'fp-a-current';
const FP_B = 'fp-b-current';
const CURRENT = new Map([[UUID_A, FP_A], [UUID_B, FP_B]]);

const tv = (fingerprint?: string) => ({
  'f0rtika.test_version.built_at': '2026-11-01T00:00:00Z',
  'f0rtika.test_version.build_source': 'built',
  'f0rtika.test_version.commit': 'abc123',
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
];

// ---- a small evaluator for the clauses we generate (filter context) ----
function has(doc: Doc, field: string): boolean {
  return doc[field] !== undefined;
}
function matches(q: any, doc: Doc): boolean {
  if (q.match_all) return true;
  if (q.exists) return has(doc, q.exists.field);
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
    const empty = new Map<string, string>();
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
  const small = new Map([[UUID_A, 'fp1']]);
  const fpIn = { terms: { [FP]: ['fp1'] } };
  const testIn = {
    bool: {
      should: [{ terms: { 'f0rtika.bundle_id': [UUID_A] } }, { terms: { 'f0rtika.test_uuid': [UUID_A] } }],
      minimum_should_match: 1,
    },
  };

  it('not_recorded', () => {
    expect(versionStateClauses('not_recorded', small)).toEqual([{ bool: { must_not: [{ exists: { field: BUILT } }] } }]);
  });
  it('current', () => {
    expect(versionStateClauses('current', small)).toEqual([fpIn]);
  });
  it('older', () => {
    expect(versionStateClauses('older', small)).toEqual([{ exists: { field: FP } }, { bool: { must_not: [fpIn] } }, testIn]);
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
    for (const m of [new Map<string, string>(), undefined]) {
      expect(versionStateClauses('current', m)).toEqual(nothing);
      expect(versionStateClauses('older', m)).toEqual(nothing);
    }
  });
});
