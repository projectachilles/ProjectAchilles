import { describe, it, expect } from 'vitest';
import { RUN_GROUP_KEY_SCRIPT, TEST_KEY_SCRIPT } from '../../analytics/elasticsearch.js';
import { HIGH_IMPACT_FILTER, OUTCOME_FILTERS } from '../stageOutcome.js';
import {
  scopeRequest, testsRequest, timelineRequest, runsRequest, testKeyClause,
  RUNS_CAP, TESTS_FETCH, MEMBERS_CAP, OTHER_LANE,
} from '../reportQueries.js';

const FILTERS = [{ term: { 'routing.oid': 'org-1' } }];
type Any = Record<string, any>;

describe('scopeRequest', () => {
  const body = scopeRequest(FILTERS) as Any;

  it('aggregates only, over the given filters', () => {
    expect(body.size).toBe(0);
    expect(body.query).toEqual({ bool: { filter: FILTERS } });
  });

  it('counts outcomes with the console rules and runs with the shared run script', () => {
    expect(body.aggs.outcomes.filters.filters).toBe(OUTCOME_FILTERS);
    expect(body.aggs.runs.cardinality).toEqual({ script: RUN_GROUP_KEY_SCRIPT, precision_threshold: 10_000 });
    expect(body.aggs.tests.cardinality.script).toBe(TEST_KEY_SCRIPT);
    expect(body.aggs.high_impact.filter).toBe(HIGH_IMPACT_FILTER);
  });

  it('breaks down hosts, techniques and actors', () => {
    expect(body.aggs.hosts.terms).toEqual({ field: 'routing.hostname', size: 100 });
    expect(body.aggs.techniques.aggs.by_technique.terms).toEqual({ field: 'f0rtika.techniques', size: 300 });
    expect(body.aggs.techniques.aggs.by_technique.aggs.tests.terms.script).toBe(TEST_KEY_SCRIPT);
    expect(body.aggs.actors.terms.field).toBe('f0rtika.threat_actor');
  });
});

describe('testsRequest', () => {
  it('groups by test key, most runs first, with per-stage breakdowns', () => {
    const tests = (testsRequest(FILTERS) as Any).aggs.tests;
    expect(tests.terms).toEqual({ script: TEST_KEY_SCRIPT, size: TESTS_FETCH, order: { runs: 'desc' } });
    expect(tests.aggs.stages.terms.field).toBe('f0rtika.control_id');
    expect(tests.aggs.stages.aggs.outcomes.filters.filters).toBe(OUTCOME_FILTERS);
    expect(tests.aggs.meta.top_hits.size).toBe(1);
  });

  it('reads test and stage metadata from the newest doc', () => {
    const tests = (testsRequest(FILTERS) as Any).aggs.tests;
    const newestFirst = [{ 'routing.event_time': { order: 'desc' } }];
    expect(tests.aggs.meta.top_hits.sort).toEqual(newestFirst);
    expect(tests.aggs.stages.aggs.meta.top_hits.sort).toEqual(newestFirst);
  });
});

describe('timelineRequest', () => {
  it('histograms by the chosen bucket in the caller time zone, with one lane per test plus other', () => {
    const tl = (timelineRequest(FILTERS, ['b1', 'b2'], 'week', 'America/Santo_Domingo') as Any).aggs.timeline;
    expect(tl.date_histogram).toEqual({
      field: 'routing.event_time', calendar_interval: 'week', time_zone: 'America/Santo_Domingo', min_doc_count: 1,
    });
    expect(Object.keys(tl.aggs.lanes.filters.filters)).toEqual(['b1', 'b2']);
    expect(tl.aggs.lanes.filters.other_bucket_key).toBe(OTHER_LANE);
    expect(tl.aggs.lanes.filters.filters.b1).toEqual(testKeyClause('b1'));
  });
});

describe('testKeyClause', () => {
  it('matches bundle docs by bundle_id and standalone docs by test_uuid', () => {
    expect(testKeyClause('k')).toEqual({
      bool: { should: [{ term: { 'f0rtika.bundle_id': 'k' } }, { term: { 'f0rtika.test_uuid': 'k' } }], minimum_should_match: 1 },
    });
  });
});

describe('runsRequest', () => {
  it('returns the newest runs with their stage docs', () => {
    const runs = (runsRequest(FILTERS) as Any).aggs.runs;
    expect(runs.terms).toEqual({ script: RUN_GROUP_KEY_SCRIPT, size: RUNS_CAP, order: { completed: 'desc' } });
    expect(runs.aggs.completed).toEqual({ max: { field: 'routing.event_time' } });
    expect(runs.aggs.members.top_hits.size).toBe(MEMBERS_CAP);
    expect(runs.aggs.members.top_hits._source).toEqual(['f0rtika.*', 'routing.*', 'event.*']);
  });
});
