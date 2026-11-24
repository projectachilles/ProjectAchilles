// How the test version stored on a result document relates to the library's
// current version. One rule, written twice: documentVersion() labels a row,
// versionStateClauses() filters in Elasticsearch. The route supplies the
// current version of every test it can read (uuid -> fingerprint and library
// commit); this module does not import the browser service.
import type { estypes } from '@elastic/elasticsearch';
import type { EnrichedTestExecution } from '../../types/analytics.js';
import type { CurrentTestVersion, ResultVersionState } from '../../types/testVersion.js';
import { resultStateForTest } from '../browser/testVersionStatus.js';

export const RESULT_VERSION_STATES: readonly ResultVersionState[] = ['current', 'older', 'unknown', 'not_recorded'];

/** Above this many tests the terms clauses would approach Elasticsearch's 65,536-term limit. */
export const MAX_VERSION_FILTER_TESTS = 10_000;

type Source = Record<string, unknown>;

/** Field from _source in flattened (dot-key) or nested form. */
function field(source: Source, path: string): unknown {
  if (source[path] !== undefined) return source[path];
  let value: unknown = source;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Source)[part];
  }
  return value;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * The test a document belongs to: bundle_id when present (bundle controls and
 * multi-stage whole-test documents), else the part of test_uuid before '::'.
 * Bundle documents always carry bundle_id, so the fallback is for plain ids.
 * versionStateClauses() reads the test the same way (testsIn): a composite
 * test_uuid without a bundle_id, which no writer produces, is the one case
 * where the two differ.
 */
export function documentTestUuid(source: Source): string {
  const bundle = str(field(source, 'f0rtika.bundle_id'));
  if (bundle) return bundle;
  return (str(field(source, 'f0rtika.test_uuid')) ?? '').split('::')[0];
}

export interface DocumentVersion {
  test_version?: EnrichedTestExecution['test_version'];
  version_state?: ResultVersionState;
}

/**
 * The version recorded on a document and, when `current` is given, its state.
 * built_at is the presence marker: it is written whenever the object exists.
 */
export function documentVersion(source: Source, current: Map<string, CurrentTestVersion> | undefined): DocumentVersion {
  const builtAt = str(field(source, 'f0rtika.test_version.built_at'));
  const rawSource = str(field(source, 'f0rtika.test_version.build_source'));
  const buildSource: 'built' | 'uploaded' | undefined = rawSource === 'built' || rawSource === 'uploaded' ? rawSource : undefined;
  const test_version = builtAt
    ? {
        built_at: builtAt,
        ...(buildSource ? { build_source: buildSource } : {}),
        commit: str(field(source, 'f0rtika.test_version.commit')),
        commit_date: str(field(source, 'f0rtika.test_version.commit_date')),
        fingerprint: str(field(source, 'f0rtika.test_version.fingerprint')),
      }
    : undefined;
  if (!current) return test_version ? { test_version } : {};

  const version_state = resultStateForTest(test_version, documentTestUuid(source), current);
  return test_version ? { test_version, version_state } : { version_state };
}

/**
 * Filter clauses (filter context) selecting documents in one state; the same
 * rule as documentVersion(). A document is current when it has the test's
 * current fingerprint, or a fingerprint (of any rule) and the commit the test
 * is synced at: one clause per commit, limited to the tests synced at it.
 */
export function versionStateClauses(
  state: ResultVersionState,
  current: Map<string, CurrentTestVersion> | undefined,
): estypes.QueryDslQueryContainer[] {
  const FP = 'f0rtika.test_version.fingerprint';
  const COMMIT = 'f0rtika.test_version.commit';
  const BUILT = 'f0rtika.test_version.built_at';
  const BUNDLE = 'f0rtika.bundle_id';
  const fingerprints = [...new Set([...(current?.values() ?? [])].map((v) => v.fingerprint))];
  const uuids = [...(current?.keys() ?? [])];
  const noMatch: estypes.QueryDslQueryContainer = { bool: { must_not: [{ match_all: {} }] } };
  const fpIn: estypes.QueryDslQueryContainer = { terms: { [FP]: fingerprints } };
  // The test of a document, as documentTestUuid() reads it: bundle_id when
  // there is one, test_uuid only when there is none.
  const testsIn = (ids: string[]): estypes.QueryDslQueryContainer => ({
    bool: {
      should: [
        { terms: { [BUNDLE]: ids } },
        { bool: { filter: [{ terms: { 'f0rtika.test_uuid': ids } }], must_not: [{ exists: { field: BUNDLE } }] } },
      ],
      minimum_should_match: 1,
    },
  });
  const testIn = testsIn(uuids);
  const byCommit = new Map<string, string[]>();
  for (const [uuid, v] of current ?? []) {
    if (!v.commit) continue;
    const at = byCommit.get(v.commit);
    if (at) at.push(uuid);
    else byCommit.set(v.commit, [uuid]);
  }
  const sameCommit: estypes.QueryDslQueryContainer[] = [...byCommit].map(([commit, ids]) => ({
    bool: { filter: [{ exists: { field: FP } }, { term: { [COMMIT]: commit } }, testsIn(ids)] },
  }));
  const isCurrent: estypes.QueryDslQueryContainer =
    sameCommit.length === 0 ? fpIn : { bool: { should: [fpIn, ...sameCommit], minimum_should_match: 1 } };
  switch (state) {
    case 'not_recorded':
      return [{ bool: { must_not: [{ exists: { field: BUILT } }] } }];
    case 'current':
      return fingerprints.length === 0 ? [noMatch] : [isCurrent];
    case 'older':
      if (uuids.length === 0) return [noMatch];
      return [{ exists: { field: FP } }, { bool: { must_not: [isCurrent] } }, testIn];
    case 'unknown':
      return [
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
      ];
  }
}
