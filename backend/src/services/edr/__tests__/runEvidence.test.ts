import { describe, it, expect } from 'vitest';
import { alertCredit, isStageFile, isTestFile } from '../multiTestEvidence.js';
import {
  ACTION_RANK,
  EVIDENCE_ITEMS_FIELD,
  FILE_ITEM_TAIL_MS,
  RUN_WINDOW_SLACK_MS,
  VERDICT_RANK,
  alertCreditForRun,
  evidenceItems,
  foundBySpanOnly,
  holdsNothingOfRun,
  isOtherRunAlert,
  namesTestInRun,
  runActions,
  runEvidence,
  runWindow,
  spanHitUnusable,
  type EvidenceItem,
  type RunWindow,
} from '../runEvidence.js';

const U = 'a1b2c3d4-0000-4000-8000-00000000f001';
const OTHER = 'a1b2c3d4-0000-4000-8000-000000000002';
const RUN_START = '2026-11-25T00:46:47Z';
const EVENT_TIME = '2026-11-25T00:47:56Z';
const NOV_19 = '2026-11-19T09:06:46Z';
const W = runWindow(RUN_START, EVENT_TIME) as RunWindow;

const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  file: `${U}-t1047.exe`,
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
const fileItem = (over: Partial<EvidenceItem> = {}): EvidenceItem =>
  item({ kind: 'file', started_at: null, parent: null, parent_path: null, ...over });
const alert = (items: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ [EVIDENCE_ITEMS_FIELD]: items, ...extra });
const iso = (ms: number) => new Date(ms).toISOString();
const inView = (it: EvidenceItem): boolean =>
  (runEvidence(alert([it]), W)?.evidence_filenames as string[]).includes(it.file);

describe('constants', () => {
  it('has the exact values the plan names', () => {
    expect(EVIDENCE_ITEMS_FIELD).toBe('evidence_items');
    expect(RUN_WINDOW_SLACK_MS).toBe(60_000);
    expect(FILE_ITEM_TAIL_MS).toBe(30 * 60_000);
    expect(VERDICT_RANK).toEqual({ malicious: 3, suspicious: 2 });
    expect(ACTION_RANK).toEqual({ quarantined: 3, process_killed: 2, blocked: 1 });
  });
});

describe('runWindow', () => {
  it('opens 60 s before the run start and closes 60 s after the event time', () => {
    expect(W).toEqual({
      startMs: Date.parse(RUN_START) - 60_000,
      endMs: Date.parse(EVENT_TIME) + 60_000,
      eventTimeMs: Date.parse(EVENT_TIME),
    });
  });

  it('is null for a missing, empty or invalid time on either side', () => {
    for (const bad of [undefined, null, '', 'not a date']) {
      expect(runWindow(bad, EVENT_TIME)).toBeNull();
      expect(runWindow(RUN_START, bad)).toBeNull();
    }
  });

  it('is null when the start is after the end', () => {
    expect(runWindow(EVENT_TIME, RUN_START)).toBeNull();
  });
});

describe('evidenceItems', () => {
  it('is null when the field is absent, null or not an array', () => {
    expect(evidenceItems({})).toBeNull();
    expect(evidenceItems(alert(null))).toBeNull();
    expect(evidenceItems(alert('items'))).toBeNull();
  });

  it('keeps an empty array empty', () => {
    expect(evidenceItems(alert([]))).toEqual([]);
  });

  it('returns the stored items', () => {
    expect(evidenceItems(alert([item()]))).toEqual([item()]);
  });
});

describe('runEvidence', () => {
  it('is null without a window, and when evidence_items is absent or null', () => {
    expect(runEvidence(alert([item()]), null)).toBeNull();
    expect(runEvidence({ evidence_filenames: [`${U}-t1047.exe`] }, W)).toBeNull();
    expect(runEvidence(alert(null), W)).toBeNull();
  });

  it('gives an empty view for an alert with no items', () => {
    expect(runEvidence(alert([]), W)).toEqual({
      evidence_filenames: [], evidence_filepaths: [], evidence_file_verdicts: [], evidence_child_actions: [],
    });
  });

  it('takes a process item started inside the window, including at both edges', () => {
    expect(inView(item())).toBe(true);
    expect(inView(item({ started_at: iso(W.startMs) }))).toBe(true);
    expect(inView(item({ started_at: iso(W.endMs) }))).toBe(true);
  });

  it('leaves out a process item started 1 ms outside either edge', () => {
    expect(inView(item({ started_at: iso(W.startMs - 1) }))).toBe(false);
    expect(inView(item({ started_at: iso(W.endMs + 1) }))).toBe(false);
  });

  it('leaves out a process item from an earlier run even when Defender added it during this one', () => {
    expect(inView(item({ started_at: NOV_19, added_at: '2026-11-25T00:47:30Z' }))).toBe(false);
  });

  it('takes a file item added up to 30 min after the event time, not later, not before the window', () => {
    const tailEnd = W.eventTimeMs + FILE_ITEM_TAIL_MS;
    expect(iso(tailEnd)).toBe('2026-11-25T01:17:56.000Z');
    expect(inView(fileItem({ added_at: iso(tailEnd) }))).toBe(true);
    expect(inView(fileItem({ added_at: iso(tailEnd + 1) }))).toBe(false);
    expect(inView(fileItem({ added_at: iso(W.startMs) }))).toBe(true);
    expect(inView(fileItem({ added_at: iso(W.startMs - 1) }))).toBe(false);
  });

  it('judges a process item with no started_at by added_at, like a file item', () => {
    const tailEnd = W.eventTimeMs + FILE_ITEM_TAIL_MS;
    expect(inView(item({ started_at: null, added_at: iso(tailEnd) }))).toBe(true);
    expect(inView(item({ started_at: null, added_at: iso(tailEnd + 1) }))).toBe(false);
    expect(inView(item({ started_at: null, added_at: iso(W.startMs - 1) }))).toBe(false);
  });

  it('names each in-run file and parent once, with their paths, and nothing from other runs', () => {
    const view = runEvidence(alert([
      item({ path: `c:\\f0\\${U}-t1047.exe`, parent_path: `c:\\f0\\${U}.exe` }),
      item({ file: 'cmd.exe', path: 'c:\\windows\\system32\\cmd.exe', parent: `${U}-t1047.exe`, parent_path: `c:\\f0\\${U}-t1047.exe` }),
      item({ file: `${U}-t1003.exe`, path: `c:\\f0\\${U}-t1003.exe`, started_at: NOV_19 }),
    ]), W);
    expect(view?.evidence_filenames).toEqual([`${U}-t1047.exe`, `${U}.exe`, 'cmd.exe']);
    expect(view?.evidence_filepaths).toEqual([`c:\\f0\\${U}-t1047.exe`, `c:\\f0\\${U}.exe`, 'c:\\windows\\system32\\cmd.exe']);
  });

  it('merges the verdict and action of one file over in-run items only', () => {
    const file = `${U}-t1047.exe`;
    const view = runEvidence(alert([
      item({ verdict: 'suspicious', action: null }),
      fileItem({ verdict: 'malicious', action: 'process_killed' }),
      item({ verdict: 'malicious', action: 'quarantined', started_at: NOV_19 }),
    ]), W);
    expect(view?.evidence_file_verdicts).toEqual([{ file, verdict: 'malicious', action: 'process_killed' }]);
  });

  it('gives no per-file verdict for items without a verdict', () => {
    const view = runEvidence(alert([item({ verdict: null })]), W);
    expect(view?.evidence_file_verdicts).toEqual([]);
  });

  it('takes child actions from in-run process items with an action and a parent only', () => {
    const killed = item({ file: 'cmd.exe', parent: `${U}-t1047.exe`, action: 'process_killed' });
    expect(runEvidence(alert([killed]), W)?.evidence_child_actions)
      .toEqual([{ parent: `${U}-t1047.exe`, action: 'process_killed' }]);
    expect(runEvidence(alert([{ ...killed, started_at: NOV_19 }]), W)?.evidence_child_actions).toEqual([]);
    expect(runEvidence(alert([{ ...killed, parent: null }]), W)?.evidence_child_actions).toEqual([]);
    expect(runEvidence(alert([fileItem({ parent: `${U}-t1047.exe`, action: 'quarantined' })]), W)?.evidence_child_actions).toEqual([]);
  });

  it('lists a repeated child action once', () => {
    const killed = item({ file: 'cmd.exe', parent: `${U}-t1047.exe`, action: 'process_killed' });
    expect(runEvidence(alert([killed, killed]), W)?.evidence_child_actions).toHaveLength(1);
  });
});

describe('alertCreditForRun', () => {
  const stage1 = `${U}-t1518.001.exe`;
  const stage3 = `${U}-t1047.exe`;
  // Live shape: an alert open since Nov 19 that named stage 3 back then, and
  // in this run only a net.exe started by stage 1.
  const observed = alert([
    item({ file: stage3, parent: `${U}.exe`, started_at: NOV_19, added_at: '2026-11-19T09:08:00Z' }),
    item({ file: 'net.exe', path: 'c:\\windows\\system32', parent: stage1, started_at: '2026-11-25T00:47:30Z' }),
  ], {
    evidence_filenames: [stage3, `${U}.exe`, 'net.exe', stage1],
  });

  it('does not credit a stage the alert named only in another run', () => {
    expect(alertCreditForRun(observed, W, (f) => isStageFile(f, U, 't1047'))).toEqual({ counts: false, actions: [] });
    // Today's rule credits it from the alert-wide list.
    expect(alertCredit(observed, (f) => isStageFile(f, U, 't1047')).counts).toBe(true);
  });

  it('credits the stage that started an in-run process (named as its parent)', () => {
    expect(alertCreditForRun(observed, W, (f) => isStageFile(f, U, 't1518.001')).counts).toBe(true);
  });

  it('is alertCredit unchanged when the alert has no evidence_items, or there is no window', () => {
    const src = { evidence_filenames: [stage3, `${OTHER}.exe`], evidence_file_verdicts: [{ file: stage3, verdict: 'malicious', action: 'blocked' }], evidence_child_actions: [] };
    const mine = (f: string) => isStageFile(f, U, 't1047');
    for (const options of [{}, { ownActionsOnly: true }]) {
      expect(alertCreditForRun(src, W, mine, options)).toEqual(alertCredit(src, mine, options));
      expect(alertCreditForRun(alert(null, src), W, mine, options)).toEqual(alertCredit(alert(null, src), mine, options));
      expect(alertCreditForRun(observed, null, mine, options)).toEqual(alertCredit(observed, mine, options));
    }
  });

  it('credits an in-run path naming the test only with pathNamesTest', () => {
    const src = alert([fileItem({ file: 'payload.bin', path: `c:\\f0\\${U}` })]);
    const none = () => false;
    expect(alertCreditForRun(src, W, none).counts).toBe(false);
    expect(alertCreditForRun(src, W, none, { pathNamesTest: (p) => p.includes(U) }).counts).toBe(true);
  });

  it('treats an alert naming another test only last week as single-test for this run', () => {
    const src = alert([
      item({ file: `${OTHER}-t1055.exe`, parent: `${OTHER}.exe`, started_at: NOV_19, added_at: '2026-11-19T09:08:00Z' }),
      item({ file: stage3, verdict: 'suspicious' }),
    ], {
      evidence_filenames: [`${OTHER}-t1055.exe`, `${OTHER}.exe`, stage3, `${U}.exe`],
      evidence_file_verdicts: [
        { file: `${OTHER}-t1055.exe`, verdict: 'suspicious', action: null },
        { file: stage3, verdict: 'suspicious', action: null },
      ],
      evidence_child_actions: [],
    });
    const mine = (f: string) => isTestFile(f, U);
    expect(alertCredit(src, mine).counts).toBe(false);
    // A run view never falls back to the alert-wide action: no in-run action, none.
    expect(alertCreditForRun(src, W, mine)).toEqual({ counts: true, actions: [] });
  });

  describe('a single-test view without ownActionsOnly brings the in-run items\' actions, never null', () => {
    const mine = (f: string) => isTestFile(f, U);
    // Alert-wide fields over the whole history, as the sync stores them.
    const wide = (items: EvidenceItem[]) => alert(items, { prevention_action: 'process_killed' });

    it('a kill on an in-run item', () => {
      const src = wide([item({ verdict: 'malicious', action: 'process_killed' })]);
      expect(alertCreditForRun(src, W, mine)).toEqual({ counts: true, actions: ['process_killed'] });
    });

    it('the kill only on an earlier run\'s item, the in-run item without an action: no actions', () => {
      const src = wide([
        item({ verdict: 'malicious', action: 'process_killed', started_at: NOV_19, added_at: '2026-11-19T09:08:00Z' }),
        item({ verdict: 'suspicious', action: null }),
      ]);
      expect(alertCreditForRun(src, W, mine)).toEqual({ counts: true, actions: [] });
    });

    it('an in-run item with an action but no verdict still brings its action', () => {
      const src = wide([item({ verdict: null, action: 'blocked' })]);
      expect(runEvidence(src, W)?.evidence_file_verdicts).toEqual([]);
      expect(alertCreditForRun(src, W, mine)).toEqual({ counts: true, actions: ['blocked'] });
    });

    it('takes every in-run item\'s action, not only the ones mine selects, each once', () => {
      const src = wide([
        item({ verdict: 'malicious', action: 'process_killed' }),
        item({ file: 'net.exe', path: 'c:\\windows\\system32', parent: 'cmd.exe', verdict: 'suspicious', action: 'process_killed' }),
        fileItem({ file: 'payload.bin', verdict: 'malicious', action: 'quarantined' }),
      ]);
      expect(alertCreditForRun(src, W, mine)).toEqual({ counts: true, actions: ['process_killed', 'quarantined'] });
    });

    it('without a run view it is still actions: null (the alert-wide action)', () => {
      const src = wide([item({ verdict: 'malicious', action: 'process_killed' })]);
      expect(alertCreditForRun(src, null, mine)).toEqual({ counts: true, actions: null });
      expect(alertCreditForRun({ ...src, evidence_items: null, evidence_filenames: [`${U}-t1047.exe`] }, W, mine))
        .toEqual({ counts: true, actions: null });
    });
  });

  it('takes own actions from in-run items only', () => {
    const src = alert([
      item({ file: stage3, verdict: 'malicious', action: 'quarantined', started_at: NOV_19 }),
      item({ file: stage3, verdict: 'suspicious', action: null }),
    ]);
    expect(alertCreditForRun(src, W, (f) => isStageFile(f, U, 't1047'), { ownActionsOnly: true }))
      .toEqual({ counts: true, actions: [] });
  });
});

describe('runActions', () => {
  it('is null without a run view', () => {
    expect(runActions(alert([item({ action: 'blocked' })]), null)).toBeNull();
    expect(runActions({ prevention_action: 'blocked', evidence_filenames: [`${U}-t1047.exe`] }, W)).toBeNull();
    expect(runActions(alert(null, { prevention_action: 'blocked' }), W)).toBeNull();
  });

  it('lists each in-run item\'s action once, in item order, from any item, never the alert-wide one', () => {
    const src = alert([
      item({ file: 'cmd.exe', parent: `${U}-t1047.exe`, action: 'process_killed' }),
      fileItem({ file: 'payload.bin', action: 'quarantined' }),
      item({ action: 'process_killed' }),
      item({ action: 'blocked', started_at: NOV_19 }),
      item({ action: null }),
    ], { prevention_action: 'blocked' });
    expect(runActions(src, W)).toEqual(['process_killed', 'quarantined']);
  });

  it('is empty when no in-run item carries an action', () => {
    expect(runActions(alert([item({ action: 'quarantined', started_at: NOV_19 }), item()], { prevention_action: 'quarantined' }), W)).toEqual([]);
  });
});

describe('isOtherRunAlert', () => {
  it('is true when the alert names the test only in items from another run', () => {
    expect(isOtherRunAlert(alert([item({ started_at: NOV_19 }), item({ file: 'net.exe', parent: 'svchost.exe' })]), W, U)).toBe(true);
  });

  it('is false when one item naming the test is in the run', () => {
    expect(isOtherRunAlert(alert([item({ started_at: NOV_19 }), item()]), W, U)).toBe(false);
  });

  it('is false when the alert never names the test', () => {
    expect(isOtherRunAlert(alert([item({ file: `${OTHER}-t1055.exe`, parent: `${OTHER}.exe`, started_at: NOV_19 })]), W, U)).toBe(false);
  });

  it('is false without a window or without evidence_items', () => {
    expect(isOtherRunAlert(alert([item({ started_at: NOV_19 })]), null, U)).toBe(false);
    expect(isOtherRunAlert(alert(null, { evidence_filenames: [`${U}-t1047.exe`] }), W, U)).toBe(false);
  });

  it('counts a path naming the test with pathNamesTest', () => {
    const src = alert([
      fileItem({ file: 'payload.bin', path: `c:\\f0\\${U}`, added_at: NOV_19 }),
      fileItem({ file: 'payload.bin', path: 'c:\\temp' }),
    ]);
    expect(isOtherRunAlert(src, W, U)).toBe(false);
    expect(isOtherRunAlert(src, W, U, (p) => p.includes(U))).toBe(true);
  });
});

describe('how a hit was found', () => {
  const UUID = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const win = runWindow('2026-11-25T00:46:47.000Z', '2026-11-25T00:47:56.000Z');
  const it_ = (over: object) => ({ file: `${UUID}-t1047.exe`, path: null, parent: null, parent_path: null, kind: 'process',
    verdict: 'suspicious', action: null, started_at: '2026-11-25T00:47:10.000Z', added_at: '2026-11-25T00:49:00.000Z', ...over });

  it.each([
    [{ matched_queries: ['activity_span'] }, true],
    [{ matched_queries: ['alert_time', 'activity_span'] }, false],
    [{ matched_queries: ['alert_time'] }, false],
    [{ matched_queries: [] }, false],
    [{}, false], [null, false], [undefined, false],
    [{ matched_queries: { activity_span: 1 } }, false],
  ])('foundBySpanOnly(%j) is %s', (hit, want) => expect(foundBySpanOnly(hit as never)).toBe(want));

  it('spanHitUnusable: no window, or no item list', () => {
    expect(spanHitUnusable({ evidence_items: [it_({})] }, null)).toBe(true);
    expect(spanHitUnusable({ evidence_items: null }, win)).toBe(true);
    expect(spanHitUnusable({}, win)).toBe(true);
    expect(spanHitUnusable({ evidence_items: [] }, win)).toBe(false);
    expect(spanHitUnusable({ evidence_items: [it_({})] }, win)).toBe(false);
  });

  it('namesTestInRun: only an in-run item naming the test', () => {
    expect(namesTestInRun({ evidence_items: [it_({})] }, win, UUID)).toBe(true);
    expect(namesTestInRun({ evidence_items: [it_({ started_at: '2026-11-19T09:05:00.000Z' })] }, win, UUID)).toBe(false);
    expect(namesTestInRun({ evidence_items: [it_({ file: 'cmd.exe' })] }, win, UUID)).toBe(false);
    expect(namesTestInRun({ evidence_items: [it_({ file: 'cmd.exe', path: `c:\\f0\\${UUID}\\x.txt` })] }, win, UUID, (p) => p.includes(UUID))).toBe(true);
    expect(namesTestInRun({ evidence_items: null }, win, UUID)).toBe(false);
    expect(namesTestInRun({ evidence_items: [it_({})] }, null, UUID)).toBe(false);
    expect(namesTestInRun({ evidence_items: [it_({})] }, win, '')).toBe(false);
  });
});

describe('holdsNothingOfRun', () => {
  const UUID = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const win = runWindow('2026-11-25T00:46:47.000Z', '2026-11-25T00:47:56.000Z');
  const it_ = (over: object) => ({ file: `${UUID}-t1572.exe`, path: null, parent: null, parent_path: null, kind: 'process',
    verdict: 'malicious', action: 'process_killed', started_at: '2026-11-24T22:40:27.000Z', added_at: '2026-11-24T22:42:19.000Z', ...over });

  it('true when every item is from another run', () => expect(holdsNothingOfRun({ evidence_items: [it_({}), it_({ kind: 'file', started_at: null })] }, win)).toBe(true));
  it('true for an empty item list', () => expect(holdsNothingOfRun({ evidence_items: [] }, win)).toBe(true));
  it('false when any item is in the run, whatever file it names', () => {
    expect(holdsNothingOfRun({ evidence_items: [it_({}), it_({ file: 'net.exe', started_at: '2026-11-25T00:47:10.000Z' })] }, win)).toBe(false);
    expect(holdsNothingOfRun({ evidence_items: [it_({ kind: 'file', started_at: null, added_at: '2026-11-25T00:50:00.000Z' })] }, win)).toBe(false);
  });
  it('false without an item list or without a window', () => {
    expect(holdsNothingOfRun({ evidence_items: null }, win)).toBe(false);
    expect(holdsNothingOfRun({}, win)).toBe(false);
    expect(holdsNothingOfRun({ evidence_items: [it_({})] }, null)).toBe(false);
  });
});
