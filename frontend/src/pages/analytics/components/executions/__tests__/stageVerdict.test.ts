import { describe, it, expect } from 'vitest';
import { stageVerdict, stageOutcomeCounts, stageVendors } from '../stageVerdict';
import type { EnrichedTestExecution } from '@/services/api/analytics';

function mk(over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution {
  return {
    is_bundle_control: true,
    category: 'intel-driven',
    error_code: 101,
    ...over,
  } as EnrichedTestExecution;
}

describe('stageVerdict', () => {
  it('protected', () => {
    expect(stageVerdict(mk({ error_code: 126 }), [])).toEqual({
      kind: 'protected',
      title: 'Stopped by endpoint protection.',
      body: 'The stage was blocked or quarantined before it could finish.',
    });
  });

  it('prevented names the vendor and action', () => {
    const v = stageVerdict(
      mk({ defender_stage_detected: true, defender_prevention_action: 'quarantined' }),
      [],
    );
    expect(v).toEqual({
      kind: 'prevented',
      title: 'Ran, then an EDR stopped it.',
      body: 'Defender reports it quarantined the file.',
    });
  });

  it('both detected, only CrowdStrike acted: names only CrowdStrike', () => {
    const v = stageVerdict(
      mk({
        defender_stage_detected: true,
        crowdstrike_stage_detected: true,
        crowdstrike_prevention_action: 'process_killed',
      }),
      [],
    );
    expect(v.kind).toBe('prevented');
    expect(v.body).toBe('CrowdStrike reports it killed the process.');
  });

  it('both detected, only Defender acted: names only Defender', () => {
    const v = stageVerdict(
      mk({
        defender_stage_detected: true,
        crowdstrike_stage_detected: true,
        defender_prevention_action: 'quarantined',
      }),
      [],
    );
    expect(v.body).toBe('Defender reports it quarantined the file.');
  });

  it('both acted: CrowdStrike precedence', () => {
    const v = stageVerdict(
      mk({
        defender_stage_detected: true,
        defender_prevention_action: 'blocked',
        crowdstrike_stage_detected: true,
        crowdstrike_prevention_action: 'process_killed',
      }),
      [],
    );
    expect(v.body).toBe('CrowdStrike reports it killed the process.');
  });

  it('inconclusive, both detected, only CrowdStrike acted', () => {
    const v = stageVerdict(
      mk({
        error_code: 999,
        error_name: 'Unexpected',
        defender_stage_detected: true,
        crowdstrike_stage_detected: true,
        crowdstrike_prevention_action: 'process_killed',
      }),
      [],
    );
    expect(v.kind).toBe('inconclusive');
    expect(v.body.endsWith('CrowdStrike reports it killed the process, which is the likely cause.')).toBe(true);
  });

  it('boolean-only prevention names the flagged vendor(s)', () => {
    expect(stageVerdict(mk({ defender_prevented: true }), []).body).toBe('Defender reports it stopped it.');
    expect(
      stageVerdict(mk({ defender_prevented: true, crowdstrike_prevented: true }), []).body,
    ).toBe('Defender and CrowdStrike report it stopped it.');
  });

  it('detected', () => {
    expect(stageVerdict(mk({ crowdstrike_stage_detected: true }), [])).toEqual({
      kind: 'detected',
      title: 'Ran to completion. An EDR alerted but did not stop it.',
      body: "CrowdStrike raised an alert naming this stage's binary; nothing was blocked.",
    });
  });

  it('unprotected', () => {
    expect(stageVerdict(mk(), [])).toEqual({
      kind: 'unprotected',
      title: 'Ran to completion with no block and no alert.',
      body: 'Nothing on the endpoint reacted to this stage.',
    });
  });

  it('exit 260 is not-run', () => {
    expect(stageVerdict(mk({ error_code: 260 }), [])).toEqual({
      kind: 'not-run',
      title: 'Stage not run: a control blocked the test binary before it ran.',
      body: "Usually an ASR prevalence rule. The technique itself was not tested, so it isn't scored as protected.",
    });
  });

  it('inconclusive without evidence', () => {
    expect(stageVerdict(mk({ error_code: 999, error_name: 'Unexpected' }), [])).toEqual({
      kind: 'inconclusive',
      title: 'Not scored: the stage ended with an error.',
      body: 'Unexpected (999) counts as neither protected nor unprotected.',
    });
  });

  it('inconclusive with EDR prevention evidence', () => {
    const v = stageVerdict(
      mk({
        error_code: 999,
        error_name: 'Unexpected',
        crowdstrike_stage_detected: true,
        crowdstrike_prevention_action: 'process_killed',
      }),
      [],
    );
    expect(v.kind).toBe('inconclusive');
    expect(v.body.endsWith('CrowdStrike reports it killed the process, which is the likely cause.')).toBe(true);
  });

  it('skipped after a protected stage', () => {
    const s1 = mk({ control_validator: 'Stage 1', error_code: 101 });
    const s2 = mk({ control_validator: 'Stage 2', error_code: 126 });
    const s3 = mk({ control_validator: 'Stage 3', error_code: 0 });
    expect(stageVerdict(s3, [s1, s2, s3])).toEqual({
      kind: 'skipped',
      title: 'Did not run.',
      body: 'The chain stopped at stage 2, where a control blocked it.',
    });
  });

  it('skipped with no earlier blocker', () => {
    const s1 = mk({ control_validator: 'Stage 1', error_code: 101 });
    const s2 = mk({ control_validator: 'Stage 2', error_code: 0 });
    expect(stageVerdict(s2, [s1, s2]).body).toBe('The chain stopped before this stage.');
  });

  it('skipped after an errored stage names that stage, not an earlier block', () => {
    const s1 = mk({ control_validator: 'Stage 1', error_code: 126 });
    const s2 = mk({ control_validator: 'Stage 2', error_code: 999 });
    const s3 = mk({ control_validator: 'Stage 3', error_code: 0 });
    const s4 = mk({ control_validator: 'Stage 4', error_code: 0 });
    const all = [s1, s2, s3, s4];
    expect(stageVerdict(s3, all).body).toBe('The chain stopped at stage 2, which ended with an error.');
    expect(stageVerdict(s4, all).body).toBe('The chain stopped at stage 2, which ended with an error.');
    expect(stageVerdict(s3, all).title).toBe('Did not run.');
  });

  it('skipped after a not-run (260) stage', () => {
    const s1 = mk({ control_validator: 'Stage 1', error_code: 126 });
    const s2 = mk({ control_validator: 'Stage 2', error_code: 260 });
    const s3 = mk({ control_validator: 'Stage 3', error_code: 0 });
    expect(stageVerdict(s3, [s1, s2, s3]).body).toBe(
      'The chain stopped at stage 2, where a control blocked the test binary before it ran.',
    );
  });

  it('skipped uses numeric stage ordering (Stage 10 after Stage 9)', () => {
    const s9 = mk({ control_validator: 'Stage 9', error_code: 105 });
    const s10 = mk({ control_validator: 'Stage 10', error_code: 0 });
    expect(stageVerdict(s10, [s9, s10]).body).toBe('The chain stopped at stage 9, where a control blocked it.');
  });

  it('skipped after a detected stage keeps the generic copy', () => {
    const s1 = mk({ control_validator: 'Stage 1', error_code: 101, defender_stage_detected: true });
    const s2 = mk({ control_validator: 'Stage 2', error_code: 0 });
    expect(stageVerdict(s2, [s1, s2]).body).toBe('The chain stopped before this stage.');
  });

  it('falls back to bundle flags when stage flags are undefined', () => {
    const v = stageVerdict(mk({ defender_detected: true }), []);
    expect(v.kind).toBe('detected');
  });
});

describe('stageOutcomeCounts', () => {
  it('counts non-zero parts in order, ignoring skipped', () => {
    const members = [
      mk({ error_code: 126 }),
      mk({ defender_stage_detected: true }),
      mk(),
      mk(),
      mk({ error_code: 999 }),
      mk({ error_code: 0 }),
    ];
    expect(stageOutcomeCounts(members)).toBe('1 protected · 1 detected · 2 unprotected · 1 inconclusive');
  });

  it('counts not run', () => {
    expect(stageOutcomeCounts([mk({ error_code: 260 }), mk({ error_code: 126 })])).toBe('1 protected · 1 not run');
  });
});

describe('stageVendors', () => {
  it('returns null with no evidence', () => {
    expect(stageVendors(mk())).toBeNull();
  });
  it('labels', () => {
    expect(stageVendors(mk({ defender_stage_detected: true }))).toEqual({ label: 'Defender', short: 'MDE' });
    expect(stageVendors(mk({ crowdstrike_detected: true }))).toEqual({ label: 'CrowdStrike', short: 'CS' });
    expect(stageVendors(mk({ defender_detected: true, crowdstrike_stage_detected: true }))).toEqual({
      label: 'Defender and CrowdStrike',
      short: 'MDE + CS',
    });
  });
  it('labels SentinelOne alone and alongside other vendors', () => {
    expect(stageVendors(mk({ sentinelone_stage_detected: true }))).toEqual({ label: 'SentinelOne', short: 'S1' });
    expect(stageVendors(mk({ sentinelone_detected: true }))).toEqual({ label: 'SentinelOne', short: 'S1' });
    expect(
      stageVendors(mk({ defender_detected: true, crowdstrike_detected: true, sentinelone_stage_detected: true }))?.short,
    ).toBe('MDE + CS + S1');
  });
});

describe('stageVerdict with SentinelOne', () => {
  it('prevented names SentinelOne and its action', () => {
    expect(
      stageVerdict(mk({ sentinelone_stage_detected: true, sentinelone_prevention_action: 'process_killed' }), []),
    ).toMatchObject({ kind: 'prevented', body: expect.stringMatching(/^SentinelOne reports it /) });
  });
  it('detected-only names SentinelOne', () => {
    expect(stageVerdict(mk({ sentinelone_stage_detected: true }), [])).toMatchObject({
      kind: 'detected',
      body: expect.stringContaining('SentinelOne'),
    });
  });
  it('boolean-only prevention names SentinelOne', () => {
    expect(stageVerdict(mk({ sentinelone_prevented: true }), []).body).toBe('SentinelOne reports it stopped it.');
  });
});
