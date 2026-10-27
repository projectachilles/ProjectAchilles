import { describe, it, expect } from 'vitest';
import { NOT_EDR_TERMINATED } from '../../analytics/enrichment-eligibility.js';
import { scopeRequest, testsRequest } from '../reportQueries.js';

type Any = Record<string, any>;

describe('scopeRequest and EDR-killed runs', () => {
  const body = scopeRequest([]) as Any;

  it('technique aggregation ignores kill docs', () => {
    expect(body.aggs.techniques.filter).toBe(NOT_EDR_TERMINATED);
    expect(body.aggs.techniques.aggs.by_technique.terms.field).toBe('f0rtika.techniques');
  });

  it('tactics count ignores kill docs', () => {
    expect(body.aggs.tactics.filter).toBe(NOT_EDR_TERMINATED);
    expect(body.aggs.tactics.aggs.distinct.cardinality).toEqual({ field: 'f0rtika.tactics' });
  });

  it('outcomes, hosts, actors and run counts still include kill docs', () => {
    for (const name of ['outcomes', 'runs', 'hosts', 'actors', 'tests']) {
      expect(JSON.stringify(body.aggs[name])).not.toContain('edr_terminated');
    }
    expect(JSON.stringify(body.query)).not.toContain('edr_terminated');
  });
});

describe('testsRequest and EDR-killed runs', () => {
  const tests = (testsRequest([]) as Any).aggs.tests;

  it('decides bundle-ness from control docs, not the newest doc', () => {
    expect(tests.aggs.controls).toEqual({ filter: { term: { 'f0rtika.is_bundle_control': true } } });
  });

  it('reads test metadata from the newest doc that is not a kill doc', () => {
    expect(tests.aggs.real_meta.filter).toBe(NOT_EDR_TERMINATED);
    expect(tests.aggs.real_meta.aggs.meta).toEqual(tests.aggs.meta);
  });
});
