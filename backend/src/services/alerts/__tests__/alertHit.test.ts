import { describe, it, expect } from 'vitest';
import { classifyAttribution, leftOutOfRun, projectAlertHit } from '../alertHit.js';
import { runWindow, type EvidenceItem, type RunWindow } from '../../edr/runEvidence.js';

const UUID = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';

describe('classifyAttribution', () => {
  it('attributes the first stage binary it finds', () => {
    expect(classifyAttribution([`${UUID}.exe`, `${UUID}-T1486.exe`, `${UUID}-T1003.001.exe`], UUID))
      .toEqual({ attribution: 'stage', attributed_control_id: 't1486' });
  });

  it('keeps variant suffixes', () => {
    expect(classifyAttribution([`${UUID}-T1211-cfapi.exe`], UUID).attributed_control_id).toBe('t1211-cfapi');
  });

  it('matches case-insensitively', () => {
    expect(classifyAttribution([`${UUID.toUpperCase()}-T1486.EXE`], UUID).attribution).toBe('stage');
  });

  it('treats orchestrator-only, foreign-bundle and UUID-less evidence as bundle-level', () => {
    expect(classifyAttribution([`${UUID}.exe`], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution(['aaaaaaaa-0000-0000-0000-000000000000-T1486.exe'], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution(['powershell.exe'], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution([`${UUID}-T1486.exe`], '')).toEqual({ attribution: 'bundle' });
  });
});

describe('projectAlertHit', () => {
  const base = {
    alert_id: 'a1',
    alert_title: 'ProcRansomware',
    severity: 'high',
    status: 'new',
    created_at: '2026-10-12T12:48:51Z',
    updated_at: '2026-10-12T12:48:51Z',
    mitre_techniques: ['T1486'],
    evidence_filenames: [`${UUID}-T1486.exe`],
  };

  it('projects prevention, portal and auto-resolve fields when present', () => {
    const p = projectAlertHit({
      ...base,
      prevention_action: 'blocked',
      portal_url: 'https://falcon.example/a1',
      f0rtika: { auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'enabled' },
    }, UUID);
    expect(p).toMatchObject({
      alert_id: 'a1',
      attribution: 'stage',
      attributed_control_id: 't1486',
      prevention_action: 'blocked',
      portal_url: 'https://falcon.example/a1',
      auto_resolved_at: '2026-10-12T13:02:10Z',
      resolved_at: null,
    });
  });

  it('omits optional fields that are absent and defaults strings to empty', () => {
    const p = projectAlertHit(base, UUID);
    expect(p).not.toHaveProperty('prevention_action');
    expect(p).not.toHaveProperty('portal_url');
    expect(p).not.toHaveProperty('auto_resolved_at');
    expect(p.description).toBe('');
    expect(p.mitre_techniques).toEqual(['T1486']);
  });

  describe('auto_resolved_at only reports real resolutions', () => {
    const receipt = (f0rtika: Record<string, unknown>) => projectAlertHit({ ...base, f0rtika }, UUID);

    it('omits it for a dry-run receipt (no PATCH was made)', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'dry_run' });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('omits it for an enabled receipt that carries an error', () => {
      const p = receipt({
        auto_resolved: true,
        auto_resolved_at: '2026-10-12T13:02:10Z',
        auto_resolve_mode: 'enabled',
        auto_resolve_error: 'Graph PATCH failed: 403',
      });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('omits it when the receipt has no mode', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z' });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('reports it for an enabled receipt without an error', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'enabled' });
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('treats an empty error string as no error', () => {
      const p = receipt({
        auto_resolved_at: '2026-10-12T13:02:10Z',
        auto_resolve_mode: 'enabled',
        auto_resolve_error: '',
      });
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('reads the dotted-key form of an enabled receipt', () => {
      const p = projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'enabled',
      }, UUID);
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('omits it for dotted-key dry-run and dotted-key error receipts', () => {
      expect(projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'dry_run',
      }, UUID)).not.toHaveProperty('auto_resolved_at');
      expect(projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'enabled',
        'f0rtika.auto_resolve_error': 'boom',
      }, UUID)).not.toHaveProperty('auto_resolved_at');
    });
  });
});

describe('projectAlertHit: multi-test alerts', () => {
  // Defender "A suspicious file was observed" lists leftover binaries of several tests.
  const OTHER = '26a8b54e-0000-4000-8000-000000000001';
  it('an alert naming this stage AND another test, with no per-file verdicts, is multi_test', () => {
    const p = projectAlertHit({ alert_id: 'a', prevention_action: 'blocked', evidence_filenames: [`${UUID}-T1486.exe`, `${OTHER}.exe`] }, UUID);
    expect(p.attribution).toBe('multi_test');
    expect(p.attributed_control_id).toBeUndefined();
    expect(p.prevention_action).toBeUndefined();
  });

  it('a listing that marks every file suspicious is multi_test', () => {
    const p = projectAlertHit({
      alert_id: 'a',
      evidence_filenames: [`${UUID}-t1486.exe`, `${OTHER}.exe`],
      evidence_file_verdicts: [
        { file: `${UUID}-t1486.exe`, verdict: 'suspicious', action: null },
        { file: `${OTHER}.exe`, verdict: 'suspicious', action: null },
      ],
    }, UUID);
    expect(p.attribution).toBe('multi_test');
  });

  it('is stage-attributed to the file the vendor marked malicious, with that file\'s own action', () => {
    const source = {
      alert_id: 'a',
      prevention_action: 'process_killed',
      evidence_filenames: [`${UUID}-t1486.exe`, `${OTHER}-t1572.exe`],
      evidence_file_verdicts: [
        { file: `${UUID}-t1486.exe`, verdict: 'malicious', action: null },
        { file: `${OTHER}-t1572.exe`, verdict: 'malicious', action: 'process_killed' },
      ],
    };
    const mine = projectAlertHit(source, UUID);
    expect(mine).toMatchObject({ attribution: 'stage', attributed_control_id: 't1486' });
    // The alert-wide "process killed" was the other test's file, not this one.
    expect(mine.prevention_action).toBeUndefined();
    expect(projectAlertHit(source, OTHER)).toMatchObject({ attribution: 'stage', attributed_control_id: 't1572', prevention_action: 'process_killed' });
  });

  it('a malicious orchestrator file is bundle-level', () => {
    const p = projectAlertHit({
      alert_id: 'a',
      evidence_filenames: [`${UUID}.exe`, `${OTHER}.exe`],
      evidence_file_verdicts: [{ file: `${UUID}.exe`, verdict: 'malicious', action: 'blocked' }, { file: `${OTHER}.exe`, verdict: 'suspicious', action: null }],
    }, UUID);
    expect(p).toMatchObject({ attribution: 'bundle', prevention_action: 'blocked' });
  });

  it('the same stage binary alone stays stage-attributed', () => {
    const p = projectAlertHit({ alert_id: 'a', evidence_filenames: [`${UUID}-T1486.exe`, `${UUID}.exe`, 'powershell.exe'] }, UUID);
    expect(p).toMatchObject({ attribution: 'stage', attributed_control_id: 't1486' });
  });
});

// The action an alert shows under a stage (Nov 2026): the stage's own, as the
// verdict uses.
describe('projectAlertHit stage action', () => {
  const lumma = (extra: Record<string, unknown> = {}) => ({
    alert_id: 'a',
    prevention_action: 'process_killed',
    created_at: '2026-11-04T12:56:19Z',
    last_activity_at: '2026-11-04T12:55:36Z',
    evidence_filenames: [`${UUID}-t1204.002.exe`, `${UUID}-t1055.003.exe`],
    evidence_file_verdicts: [
      { file: `${UUID}-t1204.002.exe`, verdict: 'malicious', action: 'blocked' },
      { file: `${UUID}-t1055.003.exe`, verdict: 'malicious', action: 'process_killed' },
    ],
    evidence_child_actions: [],
    ...extra,
  });

  it('shows the attributed stage\'s own action, not the alert-wide one', () => {
    expect(projectAlertHit(lumma(), UUID)).toMatchObject({ attribution: 'stage', attributed_control_id: 't1204.002', prevention_action: 'blocked' });
  });

  it('shows no action when the stage\'s own file was not acted on', () => {
    const p = projectAlertHit(lumma({ evidence_file_verdicts: [{ file: `${UUID}-t1204.002.exe`, verdict: 'malicious', action: null }, { file: `${UUID}-t1055.003.exe`, verdict: 'malicious', action: 'process_killed' }] }), UUID);
    expect(p.prevention_action).toBeUndefined();
  });

  it('a killed process the stage started is its action', () => {
    const p = projectAlertHit(lumma({
      evidence_filenames: ['cmd.exe', `${UUID}-t1204.002.exe`],
      evidence_file_verdicts: [{ file: 'cmd.exe', verdict: 'malicious', action: 'process_killed' }],
      evidence_child_actions: [{ parent: `${UUID}-t1204.002.exe`, action: 'process_killed' }],
    }), UUID);
    expect(p).toMatchObject({ attributed_control_id: 't1204.002', prevention_action: 'process_killed' });
  });

  it('an alert synced before per-item actions keeps the alert-wide action', () => {
    const { evidence_child_actions: _drop, ...old } = lumma();
    expect(projectAlertHit(old, UUID).prevention_action).toBe('process_killed');
  });

  it('carries no time-based flag: the exit code decides whether an action stopped the stage', () => {
    expect(projectAlertHit(lumma(), UUID)).not.toHaveProperty('acted_after_run');
  });
});

// Alert evidence belongs to a run (Nov 2026): with a run window the projection
// reads the alert's in-run evidence (edr/runEvidence.ts) and lists every stage
// it names, each with its own action.
describe('projectAlertHit with a run window', () => {
  const U = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const W = runWindow('2026-11-25T00:46:47Z', '2026-11-25T00:47:56Z') as RunWindow;
  const NOV_19 = '2026-11-19T09:06:46Z';
  const stage1 = `${U}-t1518.001.exe`;
  const stage3 = `${U}-t1047.exe`;
  const stage5 = `${U}-t1136.001.exe`;
  const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
    file: stage1,
    path: 'c:\\f0',
    parent: `${U}.exe`,
    parent_path: 'c:\\f0',
    kind: 'process',
    verdict: 'suspicious',
    action: null,
    started_at: '2026-11-25T00:47:26Z',
    added_at: '2026-11-25T00:49:10Z',
    ...over,
  });
  const earlier = (over: Partial<EvidenceItem> = {}) => item({ started_at: NOV_19, added_at: '2026-11-19T09:08:00Z', ...over });
  // Live shape: open since Nov 19 (stage 3 then), stages 1 and 5 in this run.
  // The alert-wide fields mix both runs, as the sync stores them.
  const anomalous = (items: EvidenceItem[] = [
    earlier({ file: stage3, verdict: 'malicious', action: 'quarantined' }),
    item({ file: stage1, verdict: 'malicious', action: 'process_killed' }),
    item({ file: 'net.exe', path: 'c:\\windows\\system32', parent: stage5, parent_path: 'c:\\f0' }),
  ], extra: Record<string, unknown> = {}) => ({
    alert_id: 'a',
    alert_title: 'Anomalous account lookups',
    prevention_action: 'quarantined',
    evidence_filenames: [stage3, `${U}.exe`, stage1, 'net.exe', stage5],
    evidence_file_verdicts: [
      { file: stage3, verdict: 'malicious', action: 'quarantined' },
      { file: stage1, verdict: 'malicious', action: 'process_killed' },
      { file: 'net.exe', verdict: 'suspicious', action: null },
    ],
    evidence_child_actions: [],
    evidence_items: items,
    ...extra,
  });

  it('lists every stage the run evidence names, in order; the first is attributed_control_id', () => {
    expect(projectAlertHit(anomalous(), U, W)).toMatchObject({
      attribution: 'stage',
      attributed_control_id: 't1518.001',
      attributed_control_ids: ['t1518.001', 't1136.001'],
    });
  });

  it('gives each listed stage its own action, and none for a stage without one', () => {
    const p = projectAlertHit(anomalous(), U, W);
    expect(p.stage_actions).toEqual({ 't1518.001': 'process_killed' });
    expect(p.prevention_action).toBe('process_killed');
  });

  it('leaves out a stage the alert named only in an earlier run', () => {
    const p = projectAlertHit(anomalous(), U, W);
    expect(p.attributed_control_ids).not.toContain('t1047');
    expect(p.stage_actions).not.toHaveProperty('t1047');
  });

  it('without a window: every stage file in evidence_filenames, by name, the first attributed, as today', () => {
    const p = projectAlertHit(anomalous(), U);
    expect(p).toMatchObject({ attribution: 'stage', attributed_control_id: 't1047', attributed_control_ids: ['t1047', 't1518.001', 't1136.001'] });
    expect(projectAlertHit(anomalous(), U, null)).toEqual(p);
    // Today's own-action rule on the alert-wide per-file fields.
    expect(p.prevention_action).toBe('quarantined');
    expect(p.stage_actions).toEqual({ t1047: 'quarantined', 't1518.001': 'process_killed' });
  });

  it('with evidence_items absent or null: by name, as without a window', () => {
    const { evidence_items: _drop, ...old } = anomalous();
    const byName = projectAlertHit(old, U);
    expect(projectAlertHit(old, U, W)).toEqual(byName);
    expect(projectAlertHit({ ...old, evidence_items: null }, U, W)).toEqual(byName);
    expect(byName.attributed_control_ids).toEqual(['t1047', 't1518.001', 't1136.001']);
  });

  it('a vendor without per-item actions gets the list but no stage_actions, and keeps the alert-wide action', () => {
    const p = projectAlertHit({ alert_id: 'c', prevention_action: 'blocked', evidence_filenames: [`${U}.exe`, stage1, stage5] }, U, W);
    expect(p).toMatchObject({ attributed_control_ids: ['t1518.001', 't1136.001'], prevention_action: 'blocked' });
    expect(p).not.toHaveProperty('stage_actions');
  });

  it('no stage file: bundle-level, no attributed_control_ids', () => {
    for (const p of [
      projectAlertHit(anomalous([item({ file: `${U}.exe`, parent: 'explorer.exe' })]), U, W),
      projectAlertHit({ alert_id: 'b', evidence_filenames: [`${U}.exe`, 'powershell.exe'] }, U),
    ]) {
      expect(p.attribution).toBe('bundle');
      expect(p).not.toHaveProperty('attributed_control_id');
      expect(p).not.toHaveProperty('attributed_control_ids');
      expect(p).not.toHaveProperty('stage_actions');
    }
  });

  describe('with a run view nothing comes from the alert-wide prevention_action', () => {
    it('a bundle-level alert shows the strongest in-run action', () => {
      const p = projectAlertHit(anomalous([
        item({ file: `${U}.exe`, parent: 'explorer.exe', action: 'blocked' }),
        item({ file: 'cmd.exe', parent: `${U}.exe`, action: 'process_killed' }),
      ]), U, W);
      expect(p).toMatchObject({ attribution: 'bundle', prevention_action: 'process_killed' });
    });

    it('no in-run item carries an action: no prevention_action, though the alert has one', () => {
      const p = projectAlertHit(anomalous([
        earlier({ file: `${U}.exe`, parent: 'explorer.exe', action: 'quarantined' }),
        item({ file: `${U}.exe`, parent: 'explorer.exe' }),
      ]), U, W);
      expect(p.attribution).toBe('bundle');
      expect(p).not.toHaveProperty('prevention_action');
    });

    it('an earlier run\'s kill of this stage is not its action in this run', () => {
      const p = projectAlertHit(anomalous([
        earlier({ file: stage1, verdict: 'malicious', action: 'process_killed' }),
        item({ file: stage1, verdict: 'malicious' }),
      ]), U, W);
      expect(p).toMatchObject({ attributed_control_ids: ['t1518.001'] });
      expect(p).not.toHaveProperty('prevention_action');
      expect(p).not.toHaveProperty('stage_actions');
    });

    it('an alert naming another test only in an earlier run is single-test in this run', () => {
      const OTHER = 'a1b2c3d4-0000-4000-8000-000000000002';
      const p = projectAlertHit(anomalous([
        earlier({ file: `${OTHER}-t1055.exe`, parent: `${OTHER}.exe`, verdict: 'suspicious' }),
        item({ file: stage1, verdict: 'suspicious', action: 'blocked' }),
      ], { evidence_filenames: [`${OTHER}-t1055.exe`, `${OTHER}.exe`, stage1, `${U}.exe`], evidence_file_verdicts: [] }), U, W);
      // Without a window it names two tests and singles out neither.
      expect(projectAlertHit(anomalous([], { evidence_items: undefined, evidence_filenames: [`${OTHER}-t1055.exe`, `${OTHER}.exe`, stage1, `${U}.exe`], evidence_file_verdicts: [] }), U).attribution).toBe('multi_test');
      expect(p).toMatchObject({ attribution: 'stage', attributed_control_ids: ['t1518.001'], prevention_action: 'blocked', stage_actions: { 't1518.001': 'blocked' } });
    });
  });
});

describe('leftOutOfRun', () => {
  const U = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const W = runWindow('2026-11-25T00:46:47Z', '2026-11-25T00:47:56Z') as RunWindow;
  const inRun = { kind: 'process', verdict: null, action: null, started_at: '2026-11-25T00:47:26Z', added_at: '2026-11-25T00:49:10Z' };
  const old = { kind: 'process', verdict: null, action: null, started_at: '2026-11-19T09:06:46Z', added_at: '2026-11-19T09:08:00Z' };
  const it_ = (file: string, path: string | null, times: Record<string, unknown>, parent: string | null = null) =>
    ({ file, path, parent, parent_path: null, ...times });

  it('is true when the alert names the test only in earlier-run items', () => {
    const src = { evidence_items: [it_(`${U}-t1047.exe`, 'c:\\f0', old), it_('net.exe', 'c:\\windows\\system32', inRun, 'svchost.exe')] };
    expect(leftOutOfRun(src, U, W)).toBe(true);
  });

  it('is false when an in-run item names the test', () => {
    const src = { evidence_items: [it_(`${U}-t1047.exe`, 'c:\\f0', old), it_('net.exe', null, inRun, `${U}-t1518.001.exe`)] };
    expect(leftOutOfRun(src, U, W)).toBe(false);
  });

  it('is false when the alert never names the test (a pure technique match)', () => {
    const src = { evidence_items: [it_('lsass.exe', 'c:\\windows\\system32', old), it_('net.exe', null, inRun, 'svchost.exe')] };
    expect(leftOutOfRun(src, U, W)).toBe(false);
  });

  it('is false without a window, or without evidence_items', () => {
    const src = { evidence_items: [it_(`${U}-t1047.exe`, 'c:\\f0', old)], evidence_filenames: [`${U}-t1047.exe`] };
    expect(leftOutOfRun(src, U, null)).toBe(false);
    expect(leftOutOfRun({ evidence_filenames: [`${U}-t1047.exe`] }, U, W)).toBe(false);
    expect(leftOutOfRun({ ...src, evidence_items: null }, U, W)).toBe(false);
  });

  // Final fix wave A4: the caller can pass its own "path names the test"
  // rule (Defender: the uuid or the bundle-name token), as enrichment uses.
  describe('with a path rule passed', () => {
    const bundleFolder = (p: string) => p.toLowerCase().includes(U) || p.toLowerCase().includes('bluehammer');
    const dropped = (times: Record<string, unknown>) =>
      it_('payload.bin', 'c:\\users\\public\\bluehammersandbox', { ...times, kind: 'file', started_at: null });

    it('an in-run item under a bundle-named folder keeps the alert in the run', () => {
      const src = { evidence_items: [it_(`${U}-t1047.exe`, 'c:\\f0', old), dropped(inRun)] };
      expect(leftOutOfRun(src, U, W, bundleFolder)).toBe(false);
      // Today's uuid rule does not see the folder.
      expect(leftOutOfRun(src, U, W)).toBe(true);
    });

    it('an alert naming the test only by such a folder in an earlier run is left out', () => {
      const src = { evidence_items: [dropped(old), it_('net.exe', null, inRun, 'svchost.exe')] };
      expect(leftOutOfRun(src, U, W, bundleFolder)).toBe(true);
      expect(leftOutOfRun(src, U, W)).toBe(false);
    });

    it('is used in place of the uuid rule', () => {
      const src = { evidence_items: [it_('payload.bin', `c:\\f0\\${U}\\payload.bin`, { ...old, kind: 'file', started_at: null }), it_('net.exe', null, inRun, 'svchost.exe')] };
      expect(leftOutOfRun(src, U, W)).toBe(true);
      expect(leftOutOfRun(src, U, W, () => false)).toBe(false);
    });
  });

  it('counts a path containing the uuid as naming the test, the same as a file name', () => {
    const oldPath = { evidence_items: [it_('payload.bin', `C:\\F0\\${U.toUpperCase()}\\payload.bin`, { ...old, kind: 'file', started_at: null }), it_('net.exe', null, inRun, 'svchost.exe')] };
    expect(leftOutOfRun(oldPath, U, W)).toBe(true);
    const inRunPath = { evidence_items: [it_(`${U}-t1047.exe`, 'c:\\f0', old), it_('payload.bin', `c:\\f0\\${U}\\payload.bin`, { ...inRun, kind: 'file', started_at: null })] };
    expect(leftOutOfRun(inRunPath, U, W)).toBe(false);
  });
});
