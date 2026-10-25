import { describe, it, expect } from 'vitest';
import { STAGE_OUTCOMES, emptyCounts } from '../stageOutcome.js';
import { MEMBERS_CAP } from '../reportQueries.js';
import { parseScope, parseTests, parseTimeline, parseRuns, taskIdFromDocId, stageSortKey } from '../reportParsers.js';
import type { OutcomeCounts } from '../../../types/reports.js';

const BUNDLE = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
const TASK = '4c28f408-1676-40ff-a2e6-60ea5bdd6076';
const T = Date.parse('2026-10-12T12:47:49.000Z');
const agg = (c: Partial<OutcomeCounts>) => ({ buckets: Object.fromEntries(STAGE_OUTCOMES.map((k) => [k, { doc_count: c[k] ?? 0 }])) });
const counts = (c: Partial<OutcomeCounts>) => ({ ...emptyCounts(), ...c });

describe('parseScope', () => {
  const res = {
    aggregations: {
      outcomes: agg({ protected: 3, unprotected: 2, skipped: 4 }),
      runs: { value: 12_345 }, endpoints: { value: 5 }, tests: { value: 2 }, tactics: { value: 3 },
      first: { value: T }, last: { value: T + 60_000 }, high_impact: { doc_count: 1 },
      hosts: { buckets: [{ key: 'WS-FIN-014', runs: { value: 4 }, outcomes: agg({ protected: 1 }) }] },
      techniques: { buckets: [
        { key: 'T1486', tactics: { buckets: [{ key: 'impact' }] }, tests: { buckets: [{ key: BUNDLE }] }, outcomes: agg({ unprotected: 2 }) },
        { key: 'T1059.001', tactics: { buckets: [{ key: 'execution' }] }, tests: { buckets: [] }, outcomes: agg({ protected: 3 }) },
        { key: 'T9999', tactics: { buckets: [] }, tests: { buckets: [] }, outcomes: agg({}) },
      ] },
      actors: { buckets: [{ key: 'LockBit 3.0 (S1202)', runs: { value: 4 }, tests: { buckets: [{ key: BUNDLE }] }, outcomes: agg({ protected: 3 }) }] },
    },
  };
  const scope = parseScope(res);

  it('reads totals, excluding skipped stages from stage results', () => {
    expect(scope).toMatchObject({
      stageResults: 5, runs: 12_345, runsApproximate: true, endpoints: 5, tests: 2, tactics: 3, highImpactUnprotected: 1,
      firstExecution: '2026-10-12T12:47:49.000Z', lastExecution: '2026-10-12T12:48:49.000Z',
    });
    expect(scope.outcomes).toEqual(counts({ protected: 3, unprotected: 2, skipped: 4 }));
  });

  it('names techniques, resolves tactics and sorts in kill-chain order', () => {
    expect(scope.techniques.map((t) => [t.id, t.name, t.tactic])).toEqual([
      ['T1059.001', 'PowerShell', 'Execution'],
      ['T1486', 'Data Encrypted for Impact', 'Impact'],
      ['T9999', null, null],
    ]);
    expect(scope.techniques[1].testKeys).toEqual([BUNDLE]);
  });

  it('maps hosts and actors', () => {
    expect(scope.hosts).toEqual([{ hostname: 'WS-FIN-014', runs: 4, outcomes: counts({ protected: 1 }) }]);
    expect(scope.actors).toEqual([{ name: 'LockBit 3.0 (S1202)', runs: 4, testKeys: [BUNDLE], outcomes: counts({ protected: 3 }) }]);
  });

  it('survives an empty response', () => {
    expect(parseScope({})).toMatchObject({ stageResults: 0, runs: 0, firstExecution: null, techniques: [], hosts: [], hostsCapped: false });
  });

  it('flags a host list capped by the terms size', () => {
    expect(scope.hostsCapped).toBe(false);
    expect(parseScope({ aggregations: { hosts: { sum_other_doc_count: 12, buckets: [] } } }).hostsCapped).toBe(true);
  });
});

describe('technique tactic resolution', () => {
  const tacticBuckets = (keys: string[]) => ({ buckets: keys.map((key) => ({ key, doc_count: 1 })) });
  const technique = (key: string, tactics: string[]) => ({
    key, tactics: tacticBuckets(tactics), tests: { buckets: [] }, outcomes: agg({ unprotected: 1 }),
  });
  const tacticOf = (techniques: unknown[]) => Object.fromEntries(
    parseScope({ aggregations: { techniques: { buckets: techniques } } }).techniques.map((t) => [t.id, t.tactic]),
  );

  it('takes the ATT&CK tactic over doc-level ES tactics that tie on count', () => {
    expect(tacticOf([technique('T1486', ['collection', 'command-and-control', 'discovery', 'impact'])]))
      .toEqual({ T1486: 'Impact' });
  });

  it('matches ES tactics by resolved name, so defense-evasion satisfies stealth', () => {
    expect(tacticOf([technique('T1696.001', ['discovery', 'defense-evasion'])])).toEqual({ 'T1696.001': 'Defense Evasion' });
  });

  it('falls back to the first ATT&CK tactic when no ES tactic is one of them', () => {
    expect(tacticOf([technique('T1059.001', ['collection'])])).toEqual({ 'T1059.001': 'Execution' });
  });

  it('falls back to the ES tactic for a technique unknown to ATT&CK', () => {
    expect(tacticOf([technique('T9998', ['lateral-movement'])])).toEqual({ T9998: 'Lateral Movement' });
  });
});

describe('parseTests', () => {
  const stage = (controlId: string, validator: string, name: string) => ({
    key: controlId, outcomes: agg({ protected: 1 }),
    meta: { hits: { hits: [{ _source: { f0rtika: { test_name: name, control_validator: validator, techniques: [controlId], tactics: ['impact'] } } }] } },
  });
  const res = {
    aggregations: { tests: { buckets: [
      {
        key: 'standalone-uuid', runs: { value: 2 }, endpoints: { value: 1 }, last_run: { value: T }, outcomes: agg({ unprotected: 2 }),
        meta: { hits: { hits: [{ _source: { f0rtika: { test_name: 'Mimikatz', techniques: ['T1003.001'], tactics: ['credential-access'], target: 'windows-endpoint', score: '7.5', tags: ['creds'] } } }] } },
        stages: { buckets: [] },
      },
      {
        key: BUNDLE, runs: { value: 5 }, endpoints: { value: 3 }, last_run: { value: T }, outcomes: agg({ protected: 2 }),
        meta: { hits: { hits: [{ _source: { f0rtika: { is_bundle_control: true, bundle_name: 'LockBit kill chain', test_name: 'Impact', severity: 'critical' } } }] } },
        stages: { buckets: [stage('T1486', 'Stage 5', 'Impact'), stage('T1003.001', 'Stage 2', 'Credential access')] },
      },
    ] } },
  };
  const tests = parseTests(res);

  it('orders tests by runs and names bundles by bundle_name', () => {
    expect(tests.map((t) => [t.testKey, t.name, t.isBundle])).toEqual([[BUNDLE, 'LockBit kill chain', true], ['standalone-uuid', 'Mimikatz', false]]);
  });

  it('orders bundle stages by "Stage N"', () => {
    expect(tests[0].stages.map((s) => [s.order, s.controlId, s.name])).toEqual([[1, 'T1003.001', 'Credential access'], [2, 'T1486', 'Impact']]);
    expect(tests[0].stages[0].alerts).toEqual({ defender: 0, crowdstrike: 0, sentinelone: 0 });
  });

  it('synthesizes one stage for standalone tests and normalizes metadata', () => {
    const s = tests[1];
    expect(s.stages).toEqual([{
      controlId: null, name: 'Mimikatz', order: 1, techniques: ['T1003.001'], tactics: ['credential-access'],
      outcomes: counts({ unprotected: 2 }), alerts: { defender: 0, crowdstrike: 0, sentinelone: 0 },
    }]);
    expect(s).toMatchObject({ target: ['windows-endpoint'], score: 7.5, tags: ['creds'], description: null, lastRun: '2026-10-12T12:47:49.000Z' });
  });
});

describe('parseTimeline', () => {
  it('keeps lanes with documents, including the other lane', () => {
    const res = { aggregations: { timeline: { buckets: [{
      key: Date.parse('2026-10-12T04:00:00.000Z'),
      lanes: { buckets: {
        b1: { doc_count: 2, runs: { value: 1 }, outcomes: agg({ protected: 2 }) },
        b2: { doc_count: 0, runs: { value: 0 }, outcomes: agg({}) },
        __other__: { doc_count: 1, runs: { value: 1 }, outcomes: agg({ unprotected: 1 }) },
      } },
    }] } } };
    expect(parseTimeline(res, ['b1', 'b2'])).toEqual([{
      start: '2026-10-12T04:00:00.000Z',
      lanes: [
        { testKey: 'b1', runs: 1, outcomes: counts({ protected: 2 }) },
        { testKey: '__other__', runs: 1, outcomes: counts({ unprotected: 1 }) },
      ],
    }]);
  });
});

describe('parseRuns', () => {
  const member = (id: string, controlId: string, validator: string, exit: number, tactics: string[]) => ({
    _id: id,
    _source: {
      event: { ERROR: exit },
      f0rtika: { is_bundle_control: true, bundle_name: 'LockBit kill chain', control_id: controlId, control_validator: validator, test_name: `${controlId} stage`, techniques: [controlId], tactics },
    },
  });

  it('builds runs with ordered, classified stages and the task id', () => {
    const res = { aggregations: { runs: { buckets: [{
      key: `bundle::${BUNDLE}::WS-FIN-014::${T}`, doc_count: 63, completed: { value: T },
      members: { hits: { hits: [
        member(`${TASK}::T1486`, 'T1486', 'Stage 5', 101, ['impact']),
        member(`${TASK}::T1003.001`, 'T1003.001', 'Stage 2', 126, ['credential-access']),
      ] } },
    }] } } };
    const [run] = parseRuns(res);
    expect(run).toMatchObject({
      testKey: BUNDLE, testName: 'LockBit kill chain', hostname: 'WS-FIN-014', completedAt: '2026-10-12T12:47:49.000Z',
      taskId: TASK, startedAt: null, alerts: [], alertsChecked: false, moreStages: 61,
    });
    expect(run.stages.map((s) => [s.order, s.controlId, s.outcome, s.highImpact, s.exitCode])).toEqual([
      [1, 'T1003.001', 'protected', false, 126],
      [2, 'T1486', 'unprotected', true, 101],
    ]);
  });

  it('lists at most MEMBERS_CAP stages and reports the rest as moreStages', () => {
    const members = Array.from({ length: MEMBERS_CAP }, (_, i) =>
      member(`${TASK}::C${i}`, `C${i}`, `Stage ${i + 1}`, 101, ['impact']));
    const res = { aggregations: { runs: { buckets: [{
      key: `bundle::${BUNDLE}::WS-FIN-014::${T}`, doc_count: MEMBERS_CAP + 3, completed: { value: T },
      members: { hits: { hits: members } },
    }] } } };
    const [run] = parseRuns(res);
    expect(run.stages).toHaveLength(60);
    expect(run.stages[0]).toMatchObject({ order: 1, controlId: 'C0' });
    expect(run.stages[59]).toMatchObject({ order: 60, controlId: 'C59' });
    expect(run.moreStages).toBe(3);
  });

  it('names standalone runs by test_name', () => {
    const res = { aggregations: { runs: { buckets: [{
      key: `standalone::u1::H1::${T}`, doc_count: 1, completed: { value: T },
      members: { hits: { hits: [{ _id: TASK, _source: { event: { ERROR: 105 }, f0rtika: { test_name: 'Mimikatz' } } }] } },
    }] } } };
    expect(parseRuns(res)[0]).toMatchObject({ testKey: 'u1', testName: 'Mimikatz', taskId: TASK });
  });
});

describe('taskIdFromDocId', () => {
  it('extracts the task id and rejects legacy bundle::control ids', () => {
    expect(taskIdFromDocId(`${TASK}::T1486`, BUNDLE)).toBe(TASK);
    expect(taskIdFromDocId(TASK, 'u1')).toBe(TASK);
    expect(taskIdFromDocId(`${BUNDLE}::T1486`, BUNDLE)).toBeNull();
    expect(taskIdFromDocId('not-a-uuid', 'u1')).toBeNull();
  });
});

describe('stageSortKey', () => {
  it('sorts numbered stages first, then by control id', () => {
    expect(stageSortKey('Stage 3', 'T1')).toEqual([3, 'T1']);
    expect(stageSortKey('Windows Defender', 'CH-DEF-001')).toEqual([Number.MAX_SAFE_INTEGER, 'CH-DEF-001']);
  });
});
