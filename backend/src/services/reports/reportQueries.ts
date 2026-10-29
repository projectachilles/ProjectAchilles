// Elasticsearch request bodies for the execution report (spec §5.2, Q1–Q4).
// Pure: each returns a search body without `index`; the service adds the
// index pattern. Caps live here so the parsers and the service agree.

import { RUN_GROUP_KEY_SCRIPT, TEST_KEY_SCRIPT } from '../analytics/elasticsearch.js';
import { NOT_STAGELESS } from '../analytics/enrichment-eligibility.js';
import { HIGH_IMPACT_FILTER, OUTCOME_FILTERS } from './stageOutcome.js';
import type { TimeBucket } from '../../types/reports.js';

/** Newest runs fetched with their stage docs (log, glyphs, EDR correlation). */
export const RUNS_CAP = 500;
/** Tests fetched; the first TESTS_CAP get their own page, the rest a table row. */
export const TESTS_FETCH = 200;
export const TESTS_CAP = 40;
/** Campaign-timeline lanes; further tests merge into OTHER_LANE. */
export const LANES_CAP = 8;
/** Stage docs fetched per run. */
export const MEMBERS_CAP = 60;
/** Run-strip appendix (and run start-time lookup) only at or below this many runs. */
export const RUN_STRIP_MAX_RUNS = 25;
export const OTHER_LANE = '__other__';

const HOSTS_CAP = 100;
const TECHNIQUES_CAP = 300;
const ACTORS_CAP = 50;
const STAGES_PER_TEST = 100;
const SOURCE_FIELDS = ['f0rtika.*', 'routing.*', 'event.*'];

type Body = Record<string, unknown>;

const outcomes = () => ({ filters: { filters: OUTCOME_FILTERS } });
const runCount = () => ({ cardinality: { script: RUN_GROUP_KEY_SCRIPT, precision_threshold: 10_000 } });
/** The query every report search uses (and the partial-failure count probe). */
export const scopeQuery = (filters: unknown[]) => ({ bool: { filter: filters } });

/** Q1: totals, hosts, techniques and actors over the whole scope. */
export function scopeRequest(filters: unknown[]): Body {
  return {
    size: 0,
    query: scopeQuery(filters),
    aggs: {
      outcomes: outcomes(),
      runs: runCount(),
      endpoints: { cardinality: { field: 'routing.hostname' } },
      tests: { cardinality: { script: TEST_KEY_SCRIPT } },
      // Kill docs carry the test's tactics, but their stages are unknown.
      tactics: { filter: NOT_STAGELESS, aggs: { distinct: { cardinality: { field: 'f0rtika.tactics' } } } },
      first: { min: { field: 'routing.event_time' } },
      last: { max: { field: 'routing.event_time' } },
      high_impact: { filter: HIGH_IMPACT_FILTER },
      hosts: {
        terms: { field: 'routing.hostname', size: HOSTS_CAP },
        aggs: { outcomes: outcomes(), runs: runCount() },
      },
      // An EDR-killed run has unknown stages: it counts for its test, never for a technique.
      techniques: {
        filter: NOT_STAGELESS,
        aggs: {
          by_technique: {
            terms: { field: 'f0rtika.techniques', size: TECHNIQUES_CAP },
            aggs: {
              outcomes: outcomes(),
              tactics: { terms: { field: 'f0rtika.tactics', size: 3 } },
              tests: { terms: { script: TEST_KEY_SCRIPT, size: 50 } },
            },
          },
        },
      },
      actors: {
        terms: { field: 'f0rtika.threat_actor', size: ACTORS_CAP },
        aggs: {
          outcomes: outcomes(),
          runs: runCount(),
          tests: { terms: { script: TEST_KEY_SCRIPT, size: 20 } },
        },
      },
    },
  };
}

/** Q2: one bucket per test (bundle or standalone) with per-stage breakdowns. */
export function testsRequest(filters: unknown[]): Body {
  const meta = { top_hits: { size: 1, sort: [{ 'routing.event_time': { order: 'desc' } }], _source: SOURCE_FIELDS } };
  return {
    size: 0,
    query: scopeQuery(filters),
    aggs: {
      tests: {
        terms: { script: TEST_KEY_SCRIPT, size: TESTS_FETCH, order: { runs: 'desc' } },
        aggs: {
          runs: runCount(),
          endpoints: { cardinality: { field: 'routing.hostname' } },
          last_run: { max: { field: 'routing.event_time' } },
          outcomes: outcomes(),
          meta,
          // A bundle's newest doc can be a kill doc (no is_bundle_control,
          // stages unknown): bundle-ness comes from its control docs, and the
          // metadata from the newest real doc when there is one.
          controls: { filter: { term: { 'f0rtika.is_bundle_control': true } } },
          real_meta: { filter: NOT_STAGELESS, aggs: { meta } },
          stages: {
            terms: { field: 'f0rtika.control_id', size: STAGES_PER_TEST },
            aggs: {
              outcomes: outcomes(),
              meta: { top_hits: { size: 1, sort: [{ 'routing.event_time': { order: 'desc' } }], _source: SOURCE_FIELDS } },
            },
          },
        },
      },
    },
  };
}

/** Docs belonging to one test key: bundle controls by bundle_id, standalone docs by test_uuid. */
export function testKeyClause(testKey: string): Body {
  return {
    bool: {
      should: [{ term: { 'f0rtika.bundle_id': testKey } }, { term: { 'f0rtika.test_uuid': testKey } }],
      minimum_should_match: 1,
    },
  };
}

/** Q3: histogram with one lane per top test plus an "other" lane. Needs Q2's lane keys. */
export function timelineRequest(filters: unknown[], laneKeys: string[], bucket: TimeBucket, tz: string): Body {
  return {
    size: 0,
    query: scopeQuery(filters),
    aggs: {
      timeline: {
        date_histogram: { field: 'routing.event_time', calendar_interval: bucket, time_zone: tz, min_doc_count: 1 },
        aggs: {
          lanes: {
            filters: {
              filters: Object.fromEntries(laneKeys.map((k) => [k, testKeyClause(k)])),
              other_bucket_key: OTHER_LANE,
            },
            aggs: { outcomes: outcomes(), runs: runCount() },
          },
        },
      },
    },
  };
}

/** Q4: the newest runs with their stage docs. */
export function runsRequest(filters: unknown[]): Body {
  return {
    size: 0,
    query: scopeQuery(filters),
    aggs: {
      runs: {
        terms: { script: RUN_GROUP_KEY_SCRIPT, size: RUNS_CAP, order: { completed: 'desc' } },
        aggs: {
          completed: { max: { field: 'routing.event_time' } },
          members: {
            top_hits: {
              size: MEMBERS_CAP,
              sort: [{ 'f0rtika.control_id': { order: 'asc', unmapped_type: 'keyword' } }],
              _source: SOURCE_FIELDS,
            },
          },
        },
      },
    },
  };
}
