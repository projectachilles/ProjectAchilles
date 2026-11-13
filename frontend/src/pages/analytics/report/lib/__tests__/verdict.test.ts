import { describe, it, expect } from 'vitest';
import { buildVerdict, describeOutcomeFilters } from '../verdict';
import { counts, makeReport } from '../../__tests__/fixtures';

describe('buildVerdict', () => {
  it('opens with scope and rate, then gaps, high impact and the Defense Score', () => {
    const report = makeReport({
      techniques: [
        { id: 'T1003.001', name: 'LSASS Memory', tactic: 'Credential Access', outcomes: counts({ protected: 9, detected: 1 }), testKeys: [] },
        { id: 'T1567.002', name: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration', outcomes: counts({ unprotected: 6, detected: 1 }), testKeys: [] },
      ],
    });
    expect(buildVerdict(report)).toEqual([
      'Across 2 runs on 2 endpoints, 6 of 9 conclusive stage results were protected, prevented or detected (66%).',
      'LSASS Memory (T1003.001) was stopped or detected in 10 of 10 attempts.',
      'Exfiltration to Cloud Storage (T1567.002) got through in 6 of 7 attempts without being stopped or detected.',
      '2 exfiltration or impact stage results ran without being stopped or detected.',
      'The Defense Score for these filters is 61.5%.',
    ]);
  });

  it('adds the trend when both halves have enough results', () => {
    const report = makeReport({
      timeline: {
        lanes: [],
        buckets: [
          { start: '2026-09-20T00:00:00.000Z', lanes: [{ testKey: 'b', runs: 3, outcomes: counts({ protected: 4, unprotected: 6 }) }] },
          { start: '2026-10-10T00:00:00.000Z', lanes: [{ testKey: 'b', runs: 3, outcomes: counts({ protected: 8, unprotected: 2 }) }] },
        ],
      },
    });
    expect(buildVerdict(report)).toContain('The stage protection rate moved from 40% in the first half of the period to 80% in the second.');
  });

  it('mentions the raw score when accepted risks are excluded', () => {
    const report = makeReport({ defenseScore: { score: 61.5, rawScore: 58.2, riskAcceptedCount: 3 } });
    expect(buildVerdict(report)).toContain('The Defense Score for these filters is 61.5%, or 58.2% before excluding 3 risk-accepted executions.');
  });

  it('uses the singular for one risk-accepted execution', () => {
    const report = makeReport({ defenseScore: { score: 61.5, rawScore: 58.2, riskAcceptedCount: 1 } });
    expect(buildVerdict(report)).toContain('The Defense Score for these filters is 61.5%, or 58.2% before excluding 1 risk-accepted execution.');
  });

  it('says the Defense Score is unavailable when it failed to load', () => {
    // The backend nulls defenseScore when the enrichment fails, and lists it in meta.unavailable.
    const report = makeReport({ defenseScore: null, meta: { unavailable: ['defenseScore'] } });
    const sentences = buildVerdict(report);
    expect(sentences[sentences.length - 1]).toBe('The Defense Score is unavailable for this report.');
  });

  it('says the Defense Score is unavailable even when no stage result reached a verdict', () => {
    const report = makeReport({
      totals: { ...makeReport().totals, outcomes: counts({ inconclusive: 4 }), highImpactUnprotected: 0 },
      defenseScore: null,
      techniques: [],
      meta: { unavailable: ['defenseScore'] },
    });
    expect(buildVerdict(report)).toEqual([
      'No stage result reached a verdict in this period.',
      'The Defense Score is unavailable for this report.',
    ]);
  });

  it('says approximately how many runs when the run count is an HLL estimate', () => {
    const report = makeReport({ totals: { ...makeReport().totals, runs: 12345, runsApproximate: true } });
    expect(buildVerdict(report)[0]).toBe(
      'Across about 12,345 runs on 2 endpoints, 6 of 9 conclusive stage results were protected, prevented or detected (66%).',
    );
  });

  it('never prints 100% while some stage results got through', () => {
    const report = makeReport({ totals: { ...makeReport().totals, outcomes: counts({ protected: 299, unprotected: 1 }) } });
    expect(buildVerdict(report)[0]).toBe(
      'Across 2 runs on 2 endpoints, 299 of 300 conclusive stage results were protected, prevented or detected (99%).',
    );
  });

  it('prefixes an outcome-filtered report with a warning', () => {
    const report = makeReport({ meta: { outcomeFiltered: ['result=unprotected'], filters: { result: 'unprotected' } } });
    expect(buildVerdict(report)[0]).toBe(
      'This report includes only executions where Result is unprotected. Its rates describe that subset, not overall defensive posture.',
    );
  });

  it('handles a scope with no conclusive results', () => {
    const report = makeReport({ totals: { ...makeReport().totals, outcomes: counts({ inconclusive: 4 }), highImpactUnprotected: 0 }, defenseScore: null, techniques: [] });
    expect(buildVerdict(report)).toEqual(['No stage result reached a verdict in this period.']);
  });
});

describe('describeOutcomeFilters', () => {
  it('names the outcome filters in words', () => {
    const report = makeReport({ meta: { outcomeFiltered: ['result=unprotected', 'errorCodes=101'], filters: { result: 'unprotected', errorCodes: '101' } } });
    expect(describeOutcomeFilters(report)).toBe('Result is unprotected and Exit codes is 101');
    expect(describeOutcomeFilters(makeReport())).toBeNull();
  });
});

describe('buildVerdict: chains resting on a single stage', () => {
  const group = { count: 0, bundleNames: [] };
  const coverage = (single: number, chains = 23) => ({
    chains, chainsProtected: 20, stagesRan: 97, blocked: 28, detected: 13, through: 56, coverage: 42.27,
    singleStage: { count: single, bundleNames: ['Chain A'] }, depthNotTested: group, layered: group, noneCaught: group,
  });
  const SENTENCE = /attack chain/;

  it('says how many chains rest on a single stage, before the Defense Score', () => {
    const sentences = buildVerdict(makeReport({ stageCoverage: coverage(6) }));
    const at = sentences.indexOf('Of 23 attack chains, 6 rest on a single stage: every stage ran and only one was caught.');
    expect(at).toBeGreaterThan(-1);
    expect(sentences[at + 1]).toBe('The Defense Score for these filters is 61.5%.');
  });

  it('uses the singular for one chain', () => {
    expect(buildVerdict(makeReport({ stageCoverage: coverage(1, 1) }))).toContain('Of 1 attack chain, 1 rests on a single stage: every stage ran and only one was caught.');
  });

  it('says nothing when no chain rests on a single stage, or without stage coverage', () => {
    for (const report of [makeReport({ stageCoverage: coverage(0) }), makeReport({ stageCoverage: null }), makeReport()]) {
      expect(buildVerdict(report).some((s) => SENTENCE.test(s))).toBe(false);
    }
  });
});
