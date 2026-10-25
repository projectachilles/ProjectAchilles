import { describe, it, expect } from 'vitest';
import { cellVerdict, type VerdictInput } from '../verdict.js';
import { SOURCE_FIELDS, type EdrDocs } from '../edr.js';
import { EDR_VENDORS } from '../vendors.js';
import { classifyStage } from '../../reports/stageOutcome.js';

const stage = (control_id: string, exit_code: number, skipped = false) =>
  ({ control_id, exit_code, skipped, techniques: [control_id], compliant: exit_code === 126 });

const edr = (docs: Record<string, Record<string, unknown>> = {}, status: EdrDocs['status'] = 'ok'): EdrDocs =>
  ({ status, docs: new Map(Object.entries(docs)) });

const doc = (exit: number, f: Record<string, unknown> = {}) => ({ event: { ERROR: exit }, f0rtika: { is_bundle_control: true, category: 'intel-driven', ...f } });

const base = (o: Partial<VerdictInput>): VerdictInput => ({
  taskId: 't1', exitCode: 101, error: null, stderrTail: null, category: 'intel-driven', controls: null, edr: edr(), ...o,
});

describe('cellVerdict: the real RGA runs', () => {
  it('CPC-Cesar × Kothamine: 101, 999, skipped + Defender prevented → Prevented, not Error', () => {
    const v = cellVerdict(base({
      exitCode: 999,
      controls: [stage('T1105', 101), stage('T1572', 999), stage('T1005', 0, true)],
      edr: edr({ 't1::T1105': doc(101, { defender_detected: true, defender_stage_detected: true, defender_prevented: true, defender_prevention_action: 'process_killed' }) }),
    }));
    expect(v.state).toBe('prevented');
    expect(v.reason).toBe('Defender prevented it (process killed) during stage 1 (T1105). Stage 2 (T1572) reported a test error (999, prerequisites not met). Stage 3 (T1005) skipped.');
    expect(v.edr).toBe('Defender: prevented (process killed)');
    expect(v.stages.map((s) => `${s.label}:${s.exit_code}:${s.outcome}`)).toEqual([
      'Stage 1 (T1105):101:prevented', 'Stage 2 (T1572):999:inconclusive', 'Stage 3 (T1005):0:skipped',
    ]);
  });

  it('CPC-Cesar × RedSun: 101, 101, 999, skipped + Defender alert → Detected', () => {
    const v = cellVerdict(base({
      exitCode: 1,
      controls: [stage('T1211', 101), stage('T1006', 101), stage('T1574', 999), stage('T1559.001', 0, true)],
      edr: edr({ 't1::T1211': doc(101, { defender_detected: true, defender_stage_detected: true }) }),
    }));
    expect(v.state).toBe('detected');
    expect(v.reason).toBe('Defender raised an alert; nothing was blocked. Stage 3 (T1574) reported a test error (999, prerequisites not met). Stage 4 (T1559.001) skipped.');
    expect(v.edr).toBe('Defender: alert raised');
  });

  it('RG-PF12U5Q9: every stage 101 and no alert → Unprotected', () => {
    const v = cellVerdict(base({
      controls: [stage('T1105', 101), stage('T1572', 101), stage('T1005', 101)],
      edr: edr({ 't1::T1105': doc(101), 't1::T1572': doc(101), 't1::T1005': doc(101) }),
    }));
    expect(v.state).toBe('unprotected');
    expect(v.reason).toBe('3 of 3 stages ran without being blocked. No EDR alert matched.');
    expect(v.edr).toBeNull();
  });
});

describe('cellVerdict: rules', () => {
  it('a blocked stage wins over everything: Protected, naming the stage', () => {
    const v = cellVerdict(base({
      controls: [stage('T1105', 101), stage('T1572', 126), stage('T1005', 0, true)],
      edr: edr({ 't1::T1105': doc(101, { defender_detected: true }) }),
    }));
    expect(v.state).toBe('protected');
    expect(v.reason).toBe('Blocked at stage 2 (T1572), exit 126. Stage 3 (T1005) skipped.');
  });

  it('single-binary test: doc keyed by task id', () => {
    expect(cellVerdict(base({ exitCode: 126 })).reason).toBe('Blocked, exit 126.');
    const p = cellVerdict(base({ edr: edr({ t1: { event: { ERROR: 101 }, f0rtika: { crowdstrike_detected: true, crowdstrike_stage_detected: true, crowdstrike_prevention_action: 'quarantined' } } }) }));
    expect(p.state).toBe('prevented');
    expect(p.reason).toBe('CrowdStrike prevented it (quarantined).');
    const u = cellVerdict(base({}));
    expect(u.reason).toBe('Ran without being blocked (exit 101). No EDR alert matched.');
  });

  it('single-binary error: names the exit code and adds the agent error or the last stderr line', () => {
    const v = cellVerdict(base({ exitCode: 999, stderrTail: 'x\nfailed to open policy\n' }));
    expect(v.state).toBe('error');
    expect(v.reason).toBe('Exit 999: test error, prerequisites not met. failed to open policy');
    expect(cellVerdict(base({ exitCode: 1, error: 'binary not found' })).reason).toBe('Exit 1: test error. binary not found');
  });

  it('all stages inconclusive and no EDR signal → Error', () => {
    const v = cellVerdict(base({ exitCode: 999, controls: [stage('T1', 999), stage('T2', 0, true)] }));
    expect(v.state).toBe('error');
    expect(v.reason).toBe('Stage 1 (T1) reported a test error (999, prerequisites not met). Stage 2 (T2) skipped.');
  });

  it('EDR unavailable: falls back to exit codes and says so', () => {
    const v = cellVerdict(base({ controls: [stage('T1', 101)], edr: edr({}, 'unavailable') }));
    expect(v.state).toBe('unprotected');
    expect(v.reason).toBe('1 of 1 stage ran without being blocked. EDR results unavailable.');
    expect(v.edr).toBe('unavailable');
  });

  it('EDR not configured: no EDR sentence at all', () => {
    expect(cellVerdict(base({ edr: edr({}, 'not_configured') })).reason).toBe('Ran without being blocked (exit 101).');
  });

  it('kill_failed is detection, not prevention', () => {
    const v = cellVerdict(base({ edr: edr({ t1: { event: { ERROR: 101 }, f0rtika: { defender_detected: true, defender_stage_detected: true, defender_prevention_action: 'kill_failed' } } }) }));
    expect(v.state).toBe('detected');
  });

  it('both vendors prevent: both named', () => {
    const v = cellVerdict(base({ edr: edr({ t1: { event: { ERROR: 101 }, f0rtika: { defender_prevented: true, defender_prevention_action: 'blocked', crowdstrike_prevented: true } } }) }));
    expect(v.reason).toBe('Defender and CrowdStrike prevented it (blocked).');
    expect(v.edr).toBe('Defender: prevented (blocked); CrowdStrike: prevented');
  });

  it('cyber-hygiene bundle: verdict from the task exit code, reason counts compliant controls, no EDR', () => {
    const controls = [stage('CH-1', 126), stage('CH-2', 126), stage('CH-3', 101), stage('CH-4', 0, true)];
    const v = cellVerdict(base({ category: 'cyber-hygiene', exitCode: 101, controls }));
    expect(v.state).toBe('unprotected');
    expect(v.reason).toBe('2 of 3 controls compliant; 1 not.');
    expect(v.stages).toEqual([]);
    expect(v.stagesText).toBe('2 of 3 controls compliant');
    expect(cellVerdict(base({ category: 'cyber-hygiene', exitCode: 126, controls: controls.slice(0, 2) })).reason).toBe('2 of 2 controls compliant.');
  });

  it('stagesText for the CSV', () => {
    const v = cellVerdict(base({ exitCode: 999, controls: [stage('T1105', 101), stage('T1572', 999), stage('T1005', 0, true)] }));
    expect(v.stagesText).toBe('1:101 2:999 3:skip');
    expect(cellVerdict(base({})).stagesText).toBe('');
  });
});

describe('cellVerdict: every EDR vendor counts, like Analytics', () => {
  it('SentinelOne prevention and detection are named', () => {
    const p = cellVerdict(base({ edr: edr({ t1: { event: { ERROR: 101 }, f0rtika: { sentinelone_detected: true, sentinelone_stage_detected: true, sentinelone_prevented: true, sentinelone_prevention_action: 'process_killed' } } }) }));
    expect(p.state).toBe('prevented');
    expect(p.reason).toBe('SentinelOne prevented it (process killed).');
    const d = cellVerdict(base({ controls: [stage('T1105', 101)], edr: edr({ 't1::T1105': doc(101, { sentinelone_stage_detected: true }) }) }));
    expect(d.state).toBe('detected');
  });

  it('the fetched fields cover every vendor the verdict reads', () => {
    for (const { key } of EDR_VENDORS) {
      for (const f of ['detected', 'stage_detected', 'prevented', 'prevention_action']) {
        expect(SOURCE_FIELDS).toContain(`f0rtika.${key}_${f}`);
      }
    }
  });

  it.each(EDR_VENDORS.map((v) => v.key))('%s: same outcome as classifyStage (Analytics) for prevented and detected stages', (key) => {
    const cases: Array<Record<string, unknown>> = [
      { [`${key}_prevented`]: true },
      { [`${key}_stage_detected`]: true, [`${key}_prevention_action`]: 'quarantined' },
      { [`${key}_stage_detected`]: true },
    ];
    for (const flags of cases) {
      const src = doc(101, flags);
      const v = cellVerdict(base({ controls: [stage('T1', 101)], edr: edr({ 't1::T1': src }) }));
      expect(v.stages[0].outcome, JSON.stringify(flags)).toBe(classifyStage(src));
      expect(v.state, JSON.stringify(flags)).toBe(classifyStage(src));
    }
  });
});
