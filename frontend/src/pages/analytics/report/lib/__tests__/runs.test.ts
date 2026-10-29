import { describe, it, expect } from 'vitest';
import { alertStageText, firstAlert, resolveRunStage, stageForAlert, vendorName } from '../runs';
import { makeReport, makeRun, makeTest } from '../../__tests__/fixtures';
import type { ReportRun, ReportRunStage, ReportTest } from '@/services/api/reports';

/** What a big-scope payload ships for a stage: no name, techniques or tactics. */
const slim = ({ name: _n, techniques: _t, tactics: _ta, ...rest }: ReportRunStage): ReportRunStage => rest;
const slimRun = (run: ReportRun): ReportRun => ({ ...run, stages: run.stages.map(slim) });

describe('vendorName', () => {
  it('uses the products\' short names', () => {
    expect(vendorName('defender')).toBe('Defender');
    expect(vendorName('crowdstrike')).toBe('Falcon');
  });

  it('shows an unknown vendor id from a newer backend instead of throwing', () => {
    expect(vendorName('acmeedr' as never)).toBe('acmeedr');
  });
});

describe('firstAlert', () => {
  it('skips an alert whose time does not parse', () => {
    const [lsass, falcon] = makeRun().alerts;
    expect(firstAlert(makeRun({ alerts: [{ ...lsass, createdAt: '' }, falcon] }))).toBe(falcon);
    expect(firstAlert(makeRun({ alerts: [{ ...lsass, createdAt: '' }] }))).toBeNull();
  });
});

describe('stageForAlert', () => {
  const run = makeRun();

  it('matches the lowercased backend token to the stage case-insensitively', () => {
    expect(stageForAlert(run, 't1003.001')?.order).toBe(2);
    expect(stageForAlert(run, 'T1003.001')?.order).toBe(2);
  });

  it('accepts a variant suffix but not a bare prefix', () => {
    expect(stageForAlert(run, 't1486-variant')?.order).toBe(5);
    expect(stageForAlert(run, 't14860')).toBeNull();
  });

  it('returns null for a bundle-level alert, an unknown token or a stage without a controlId', () => {
    expect(stageForAlert(run, null)).toBeNull();
    expect(stageForAlert(run, 't9999')).toBeNull();
    expect(stageForAlert(makeRun({ stages: [{ ...run.stages[0], controlId: null }] }), 't1059.001')).toBeNull();
  });
});

/**
 * A 70-control bundle whose run carries only the first 60 stages (the backend's MEMBERS_CAP), as the
 * print check's 70-stage run did. Control ids keep their case; alert tokens arrive lowercased.
 */
function seventyControls(): { test: ReportTest; run: ReportRun } {
  const stages = Array.from({ length: 70 }, (_, i) => ({
    ...makeTest().stages[0], controlId: `CH-DEF-${String(i + 1).padStart(3, '0')}`, name: `Control ${i + 1}`, order: i + 1,
  }));
  const test = makeTest({ category: 'cyber-hygiene', stages });
  const run = makeRun({
    stages: stages.slice(0, 60).map((s): ReportRunStage => ({
      controlId: s.controlId, name: s.name, order: s.order, outcome: 'protected', exitCode: 126, techniques: [], tactics: [], highImpact: false,
    })),
    moreStages: 10,
  });
  return { test, run };
}

describe('stageForAlert beyond the fetched stages', () => {
  it('falls back to the test\'s stages for a control the run did not fetch', () => {
    const { test, run } = seventyControls();
    expect(stageForAlert(run, 'ch-def-069')).toBeNull();
    expect(stageForAlert(run, 'ch-def-069', test.stages)).toMatchObject({ order: 69, name: 'Control 69' });
    // A fetched stage still comes from the run.
    expect(stageForAlert(run, 'ch-def-002', test.stages)).toBe(run.stages[1]);
  });
});

describe('resolveRunStage', () => {
  const tests = [makeTest()];

  it('prefers what the run stage itself carries', () => {
    const run = makeRun();
    expect(resolveRunStage(tests, run, run.stages[1])).toEqual({
      name: 'Privileged credential access', techniques: ['T1003.001'], tactics: ['credential-access'],
    });
  });

  it('reads name, techniques and tactics from the run\'s test when the run stage omits them', () => {
    const run = slimRun(makeRun());
    expect(resolveRunStage(tests, run, run.stages[3])).toEqual({
      name: 'Pre-encryption exfiltration', techniques: ['T1567.002'], tactics: ['exfiltration'],
    });
  });

  it('looks the stage up by testKey and controlId, not by order alone', () => {
    const other = makeTest({
      testKey: 'other-test',
      stages: [{ ...makeTest().stages[1], order: 1, name: 'Wrong test', controlId: 'T1003.001' }],
    });
    const run = slimRun(makeRun());
    expect(resolveRunStage([other, makeTest()], run, run.stages[1]).name).toBe('Privileged credential access');
  });

  it('falls back to the controlId when the test is not in the report', () => {
    const run = slimRun(makeRun());
    expect(resolveRunStage([], run, run.stages[1])).toEqual({ name: 'T1003.001', techniques: [], tactics: [] });
  });

  it('falls back to "Stage N" when there is no controlId either', () => {
    const run = slimRun(makeRun({ stages: [{ ...makeRun().stages[0], controlId: null, order: 3 }] }));
    expect(resolveRunStage([], run, run.stages[0]).name).toBe('Stage 3');
  });

  it('resolves a standalone test\'s single, controlId-less stage', () => {
    const test = makeTest({ isBundle: false, stages: [{ ...makeTest().stages[0], controlId: null, name: 'Standalone check' }] });
    const run = slimRun(makeRun({ stages: [{ ...makeRun().stages[0], controlId: null }] }));
    expect(resolveRunStage([test], run, run.stages[0]).name).toBe('Standalone check');
  });
});

describe('alertStageText', () => {
  const tests = makeReport().tests;

  it('prints the stage label and its name', () => {
    expect(alertStageText(tests, makeRun(), 't1486')).toBe('S5 Encryption & recovery inhibition');
  });

  it('still names the stage when the run carries no names', () => {
    expect(alertStageText(tests, slimRun(makeRun()), 't1486')).toBe('S5 Encryption & recovery inhibition');
  });

  it('says "bundle" for an alert that names no stage', () => {
    expect(alertStageText(tests, makeRun(), null)).toBe('bundle');
    expect(alertStageText(tests, makeRun(), 't9999')).toBe('bundle');
  });

  it('labels an alert on a stage beyond the fetched 60 by the test\'s stage', () => {
    const { test, run } = seventyControls();
    expect(alertStageText([test], run, 'ch-def-069')).toBe('S69 Control 69');
  });

  it('says nothing about stages for a standalone test, never "bundle"', () => {
    const standalone = makeTest({ isBundle: false, category: 'host-hardening', stages: [{ ...makeTest().stages[0], controlId: null }] });
    const run = makeRun({ stages: [{ ...makeRun().stages[0], controlId: null }] });
    expect(alertStageText([standalone], run, null)).toBe('');
    expect(alertStageText([standalone], run, 't1059.001')).toBe('');
  });

  it('shortens a long stage name', () => {
    const long = 'A'.repeat(60);
    const run = makeRun({ stages: [{ ...makeRun().stages[0], name: long }] });
    expect(alertStageText([], run, 't1059.001')).toBe(`S1 ${'A'.repeat(33)}…`);
  });
});
