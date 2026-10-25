import { describe, it, expect, vi } from 'vitest';
import { emptyCounts } from '../stageOutcome.js';
import { rankFindings, markAcceptedRisks, attachGuidance, FINDINGS_MAX } from '../reportFindings.js';
import type { OutcomeCounts, ReportTechnique, ReportTest } from '../../../types/reports.js';

const counts = (c: Partial<OutcomeCounts>): OutcomeCounts => ({ ...emptyCounts(), ...c });
const tech = (id: string, tactic: string | null, c: Partial<OutcomeCounts>, testKeys = ['b1']): ReportTechnique =>
  ({ id, name: `${id} name`, tactic, outcomes: counts(c), testKeys });
function makeTest(testKey: string, name: string, runs: number, stages: { controlId: string | null; name: string; techniques: string[] }[]): ReportTest {
  return {
    testKey, name, isBundle: true, category: null, subcategory: null, severity: null, score: null, target: [], complexity: null,
    threatActor: null, tags: [], description: null, runs, endpoints: 1, lastRun: null, outcomes: emptyCounts(),
    stages: stages.map((s, i) => ({ ...s, order: i + 1, tactics: [], outcomes: emptyCounts(), alerts: { defender: 0, crowdstrike: 0, sentinelone: 0 } })),
  };
}

const TESTS = [
  makeTest('b1', 'LockBit kill chain', 5, [{ controlId: 'T1567.002', name: 'Exfiltration stage', techniques: ['T1567.002'] }]),
  makeTest('b2', 'Star Blizzard chain', 9, [{ controlId: 'T1071.001', name: 'C2 stage', techniques: ['T1071.001', 'T1567.002'] }]),
];

describe('rankFindings', () => {
  it('keeps techniques below 75% with at least 3 results, weighting high-impact tactics', () => {
    const findings = rankFindings([
      tech('T1071.001', 'Command and Control', { unprotected: 9, detected: 1 }),
      tech('T1567.002', 'Exfiltration', { unprotected: 8, protected: 2 }, ['b1', 'b2']),
      tech('T1059.001', 'Execution', { unprotected: 2 }),
      tech('T1003.001', 'Credential Access', { protected: 9, unprotected: 1 }),
    ], TESTS);
    expect(findings.map((f) => [f.techniqueId, f.highImpact])).toEqual([['T1567.002', true], ['T1071.001', false]]);
  });

  it('lists the tests that exercised a technique, most runs first', () => {
    const [f] = rankFindings([tech('T1567.002', 'Exfiltration', { unprotected: 5 }, ['b1', 'b2'])], TESTS);
    expect(f).toMatchObject({ testKeys: ['b2', 'b1'], testNames: ['Star Blizzard chain', 'LockBit kill chain'], acceptedRisk: false, guidance: null });
  });

  it('breaks ties by more results, then id, and caps the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => tech(`T10${i}`, 'Execution', { unprotected: 3 + (i % 2) }));
    const findings = rankFindings(many, TESTS);
    expect(findings).toHaveLength(FINDINGS_MAX);
    expect(findings[0].techniqueId).toBe('T101');
  });
});

describe('markAcceptedRisks', () => {
  const [finding] = rankFindings([tech('T1567.002', 'Exfiltration', { unprotected: 5 }, ['b1'])], TESTS);

  it('marks a finding covered by an acceptance on a stage that exercised it', () => {
    expect(markAcceptedRisks([finding], TESTS, { 'Exfiltration stage::T1567.002': [{}] })[0].acceptedRisk).toBe(true);
    expect(markAcceptedRisks([finding], TESTS, { 'Exfiltration stage': [{}] })[0].acceptedRisk).toBe(true);
  });

  it('ignores unrelated or empty acceptances', () => {
    expect(markAcceptedRisks([finding], TESTS, { 'C2 stage::T1071.001': [{}], 'Exfiltration stage': [] })[0].acceptedRisk).toBe(false);
  });

  it('does not count a host-scoped acceptance as covering the technique', () => {
    expect(markAcceptedRisks([finding], TESTS, { 'Exfiltration stage::T1567.002': [{ scope: 'host', hostname: 'LAB-1' }] })[0].acceptedRisk).toBe(false);
  });

  it('treats a legacy entry with a hostname and no scope as host-scoped', () => {
    expect(markAcceptedRisks([finding], TESTS, { 'Exfiltration stage': [{ hostname: 'LAB-1' }] })[0].acceptedRisk).toBe(false);
  });

  it('counts a global acceptance on the only exercising stage', () => {
    expect(markAcceptedRisks([finding], TESTS, { 'Exfiltration stage': [{ scope: 'global' }] })[0].acceptedRisk).toBe(true);
  });

  it('needs a global acceptance on every exercising stage, not just one test', () => {
    const [both] = rankFindings([tech('T1567.002', 'Exfiltration', { unprotected: 5 }, ['b1', 'b2'])], TESTS);
    expect(markAcceptedRisks([both], TESTS, { 'Exfiltration stage': [{ scope: 'global' }] })[0].acceptedRisk).toBe(false);
  });

  it('marks a technique covered when every exercising stage has a global acceptance', () => {
    const [both] = rankFindings([tech('T1567.002', 'Exfiltration', { unprotected: 5 }, ['b1', 'b2'])], TESTS);
    expect(markAcceptedRisks([both], TESTS, {
      'Exfiltration stage': [{ scope: 'global' }],
      'C2 stage': [{ scope: 'global' }],
    })[0].acceptedRisk).toBe(true);
  });

  it('covers a key when at least one of its entries is global', () => {
    expect(markAcceptedRisks([finding], TESTS, {
      'Exfiltration stage': [{ scope: 'host', hostname: 'LAB-1' }, { scope: 'global' }],
    })[0].acceptedRisk).toBe(true);
  });
});

describe('attachGuidance', () => {
  const [finding] = rankFindings([tech('T1567.002', 'Exfiltration', { unprotected: 5 }, ['b1', 'b2'])], TESTS);

  it('uses the first test whose guidance has a section for the technique', () => {
    const read = vi.fn((k: string) => (k === 'b1' ? '| [T1567.002](x) — Exfil | Exfiltration | M1057 Block uploads |' : '## Free form'));
    const [f] = attachGuidance([finding], TESTS, read);
    expect(f.guidance).toEqual({ testKey: 'b1', testName: 'LockBit kill chain', excerpt: 'Exfiltration · M1057 Block uploads' });
  });

  it('falls back to a reference when guidance exists without a matching section', () => {
    const [f] = attachGuidance([finding], TESTS, () => '## Free form');
    expect(f.guidance).toEqual({ testKey: 'b2', testName: 'Star Blizzard chain', excerpt: null });
  });

  it('is null when no exercising test has guidance, and reads each test once', () => {
    const read = vi.fn(() => null);
    const [f, g] = attachGuidance([finding, finding], TESTS, read);
    expect(f.guidance).toBeNull();
    expect(g.guidance).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
