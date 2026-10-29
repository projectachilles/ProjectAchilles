import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('../index-management.js', () => ({ SOPHOS_INDEX: 'achilles-sophos' }));

const { transformAlert, transformSiemEvent, parseLegacyCleanup, transformGraphqlDetection } = await import('../normalize.js');
const {
  sophosDocId,
  hostWindowClauses,
  alertLookupWindows,
  siemLookupWindows,
  xdrLookupWindows,
  findCandidates,
  addPollDocs,
  planAlertWrites,
  planSiemWrites,
  planXdrWrites,
} = await import('../merge.js');
type SophosAlertDoc = import('../normalize.js').SophosAlertDoc;

const dir = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx = (n: string) => JSON.parse(readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8')) as Record<string, any>;

const ALERT_ID = 'a5ded91c-6575-435c-a6b4-64b94f9048ff';
const EVENT_ID = 'e1111111-1111-4111-8111-111111111111';
const CLEANUP_ID = 'e3333333-3333-4333-8333-333333333333';

const alert = (extra: Record<string, unknown> = {}) => transformAlert({ ...fx('common-alert'), ...extra });
const event = (extra: Record<string, unknown> = {}) => transformSiemEvent({ ...fx('siem-core-detection-ml'), ...extra })!;
const cleanup = (extra: Record<string, unknown> = {}) => parseLegacyCleanup({ ...fx('siem-threat-cleanedup'), ...extra })!;
const found = (...docs: SophosAlertDoc[]) => new Map(docs.map((d) => [sophosDocId(d), d]));

describe('sophosDocId', () => {
  it('is deterministic per source', () => {
    expect(sophosDocId(alert())).toBe(`alert-${ALERT_ID}`);
    expect(sophosDocId(event())).toBe(`siem-${EVENT_ID}`);
    expect(sophosDocId({ source_type: 'xdr_detection', alert_id: 'alert:1' })).toBe('xdr-alert:1');
  });
});

describe('hostWindowClauses', () => {
  it('merges overlapping windows per host and keeps other hosts / disjoint windows apart', () => {
    const clauses = hostWindowClauses([
      { host: 'A', from: 0, to: 100 },
      { host: 'A', from: 50, to: 200 },
      { host: 'A', from: 1000, to: 1100 },
      { host: 'B', from: 0, to: 100 },
    ]);
    expect(clauses).toHaveLength(3);
    expect(clauses[0]).toEqual({ bool: { filter: [
      { term: { 'evidence_hostnames.keyword': 'A' } },
      { range: { created_at: { gte: new Date(0).toISOString(), lte: new Date(200).toISOString() } } },
    ] } });
  });

  it('alert windows are ±2 min around raisedAt; SIEM windows widen for legacy cleanups', () => {
    const a = alert();
    expect(alertLookupWindows([a])).toEqual([{ host: 'WIN-LAB01', from: Date.parse(a.created_at!) - 120_000, to: Date.parse(a.created_at!) + 120_000 }]);
    const c = cleanup();
    const w = siemLookupWindows([event()], [c]);
    expect(w).toContainEqual({ host: 'WIN-LAB01', from: Date.parse(c.when!) - 15 * 60_000, to: Date.parse(c.when!) + 120_000 });
    expect(siemLookupWindows([event({ when: null, created_at: null })], [])).toEqual([]);
  });
});

describe('findCandidates', () => {
  it('runs one search for ids + host windows, strips f0rtika receipts and keys by _id', async () => {
    const stored = { ...alert(), f0rtika: { auto_resolved: true } };
    const search = vi.fn().mockResolvedValue({ hits: { hits: [{ _id: `alert-${ALERT_ID}`, _source: stored }] } });
    const res = await findCandidates({ search } as never, {
      ids: [`alert-${ALERT_ID}`],
      windows: [{ host: 'WIN-LAB01', from: 0, to: 1 }],
      sourceTypes: ['siem_event'],
    });
    expect(search).toHaveBeenCalledTimes(1);
    const q = search.mock.calls[0][0];
    expect(q.index).toBe('achilles-sophos');
    expect(q.query.bool.filter).toEqual([{ term: { doc_type: 'alert' } }]);
    expect(q.query.bool.should[0]).toEqual({ ids: { values: [`alert-${ALERT_ID}`] } });
    expect(q.query.bool.should[1].bool.filter).toEqual([{ terms: { source_type: ['siem_event'] } }]);
    expect(q.query.bool.minimum_should_match).toBe(1);
    expect(res.get(`alert-${ALERT_ID}`)).toBeDefined();
    expect('f0rtika' in (res.get(`alert-${ALERT_ID}`) as object)).toBe(false);
  });

  it('does not search when there is nothing to look up', async () => {
    const search = vi.fn();
    expect((await findCandidates({ search } as never, { windows: [], sourceTypes: ['alert'] })).size).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('addPollDocs', () => {
  it("adds only this poll's docs with the same id or on a window's host and time", () => {
    const a = alert();
    const other = alert({ id: 'b0000000-0000-4000-8000-000000000009', managedAgent: { name: 'ELSEWHERE' } });
    const late = alert({ id: 'b0000000-0000-4000-8000-000000000008', raisedAt: '2026-10-28T12:00:00.000Z' });
    const poll = found(a, other, late);
    const into = new Map();
    addPollDocs(into, poll, [], alertLookupWindows([event()]));
    expect([...into.keys()]).toEqual([`alert-${ALERT_ID}`]);
    const byId = new Map();
    addPollDocs(byId, poll, [sophosDocId(late)], []);
    expect([...byId.keys()]).toEqual([sophosDocId(late)]);
  });
});

describe('planAlertWrites (b: a new alert absorbs earlier siem_event rows)', () => {
  it('merges a matching siem_event row into the alert and deletes the row once the alert is written', () => {
    const plan = planAlertWrites([alert()], found(event()));
    expect([...plan.upserts.keys()]).toEqual([`alert-${ALERT_ID}`]);
    const doc = plan.upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.merged_siem_event_ids).toEqual([EVENT_ID]);
    expect(doc.prevention_action).toBe('quarantined');
    expect(doc.origin).toBe('ML_MALWARE_DETECTION');
    expect(plan.deletes).toEqual(new Map([[`siem-${EVENT_ID}`, `alert-${ALERT_ID}`]]));
    expect(plan.merged).toBe(1);
  });

  it('leaves a siem_event row that does not match (other host)', () => {
    const plan = planAlertWrites([alert()], found(event({ location: 'other-host' })));
    expect(plan.deletes.size).toBe(0);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.merged_siem_event_ids).toBeUndefined();
  });

  it('keeps SIEM evidence merged in an earlier poll when the alert is re-fetched', () => {
    const stored = { ...alert(), prevention_action: 'quarantined' as const, origin: 'ML_MALWARE_DETECTION', merged_siem_event_ids: [EVENT_ID], evidence_filepaths: ['c:\\x\\y.exe'] };
    const plan = planAlertWrites([alert({ status: 'acknowledged' })], found(stored));
    const doc = plan.upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.status).toBe('acknowledged');
    expect(doc.prevention_action).toBe('quarantined');
    expect(doc.origin).toBe('ML_MALWARE_DETECTION');
    expect(doc.merged_siem_event_ids).toEqual([EVENT_ID]);
    expect(doc.evidence_filepaths).toContain('c:\\x\\y.exe');
    expect(plan.merged).toBe(0);
  });

  it('carries the cleanup ids a siem_event row had absorbed into the alert', () => {
    const row = { ...event(), merged_siem_event_ids: [CLEANUP_ID] };
    const doc = planAlertWrites([alert()], found(row)).upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.merged_siem_event_ids).toEqual(expect.arrayContaining([EVENT_ID, CLEANUP_ID]));
  });
});

describe('planSiemWrites (a: SIEM event → alert, c: legacy cleanup)', () => {
  it('merges a core event into a stored alert and deletes any row of that event', () => {
    const plan = planSiemWrites([event()], [], found(alert()));
    expect([...plan.upserts.keys()]).toEqual([`alert-${ALERT_ID}`]);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.merged_siem_event_ids).toEqual([EVENT_ID]);
    expect(plan.deletes).toEqual(new Map([[`siem-${EVENT_ID}`, `alert-${ALERT_ID}`]]));
    expect(plan.merged).toBe(1);
  });

  it('writes an unmatched event as its own siem_event row', () => {
    const plan = planSiemWrites([event()], [], found(alert({ managedAgent: { name: 'OTHER' } })));
    expect([...plan.upserts.keys()]).toEqual([`siem-${EVENT_ID}`]);
    expect(plan.upserts.get(`siem-${EVENT_ID}`)!.source_type).toBe('siem_event');
    expect(plan.deletes.size).toBe(0);
    expect(plan.merged).toBe(0);
  });

  it('picks the closest alert in time when two match', () => {
    const far = alert({ id: 'b0000000-0000-4000-8000-000000000001', raisedAt: '2026-10-28T10:01:50.000Z' });
    const near = alert({ id: 'b0000000-0000-4000-8000-000000000002', raisedAt: '2026-10-28T10:00:02.000Z' });
    const plan = planSiemWrites([event()], [], found(far, near));
    expect([...plan.upserts.keys()]).toEqual(['alert-b0000000-0000-4000-8000-000000000002']);
  });

  it('merges a legacy cleanup into the matching alert (prevention) and drops one with no match', () => {
    const plan = planSiemWrites([], [cleanup(), cleanup({ id: 'e9', location: 'nowhere' })], found(alert()));
    const doc = plan.upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.prevention_action).toBe('blocked');
    expect(doc.merged_siem_event_ids).toEqual([CLEANUP_ID]);
    expect(plan.upserts.size).toBe(1);
    expect(plan.merged).toBe(1);
    expect(plan.dropped).toBe(1);
  });

  it('merges a legacy cleanup into a siem_event row when there is no alert', () => {
    const plan = planSiemWrites([], [cleanup()], found(event()));
    expect(plan.upserts.get(`siem-${EVENT_ID}`)!.merged_siem_event_ids).toEqual([CLEANUP_ID]);
  });

  it('in one batch, the event merges into the alert and the cleanup follows it there', () => {
    const plan = planSiemWrites([event()], [cleanup()], found(alert()));
    expect([...plan.upserts.keys()]).toEqual([`alert-${ALERT_ID}`]);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.merged_siem_event_ids).toEqual([EVENT_ID, CLEANUP_ID]);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.prevention_action).toBe('quarantined');
  });

  it('a re-fetched event that is still unmatched keeps cleanup evidence merged into its row earlier', () => {
    const stored = { ...event(), merged_siem_event_ids: [CLEANUP_ID], evidence_filepaths: [...event().evidence_filepaths, 'c:\\other.exe'] };
    const plan = planSiemWrites([event()], [], found(stored));
    expect(plan.upserts.get(`siem-${EVENT_ID}`)!.merged_siem_event_ids).toEqual([CLEANUP_ID]);
    expect(plan.upserts.get(`siem-${EVENT_ID}`)!.evidence_filepaths).toContain('c:\\other.exe');
  });
});

describe('Achilles correlation receipts survive a merge (I1)', () => {
  const CORRELATION = {
    achilles_correlated: true,
    achilles_test_uuid: 'b1b1b1b1-0000-4000-8000-000000000001',
    achilles_matched_at: '2026-10-28T10:05:00.000Z',
  };
  const KILL = { achilles_agent_kill_task_id: 'task-1', achilles_agent_kill_matched_at: '2026-10-28T10:06:00.000Z' };
  const RESOLVE = { auto_resolved: true, auto_resolved_at: '2026-10-28T10:07:00.000Z', auto_resolve_mode: 'enabled', auto_resolve_dry_run_at: '2026-10-28T10:07:00.000Z' };

  it('findCandidates keeps the docs stripped but reports each stored correlation receipt by _id', async () => {
    const search = vi.fn().mockResolvedValue({ hits: { hits: [
      { _id: `siem-${EVENT_ID}`, _source: { ...event(), f0rtika: { ...CORRELATION, ...KILL, ...RESOLVE } } },
      { _id: `alert-${ALERT_ID}`, _source: { ...alert() } },
    ] } });
    const receipts = new Map();
    const res = await findCandidates({ search } as never, { windows: [{ host: 'WIN-LAB01', from: 0, to: 1 }], sourceTypes: ['siem_event'], receipts });
    expect('f0rtika' in (res.get(`siem-${EVENT_ID}`) as object)).toBe(false);
    expect(receipts.get(`siem-${EVENT_ID}`)).toEqual({ ...CORRELATION, ...KILL });
    expect(receipts.has(`alert-${ALERT_ID}`)).toBe(false);
  });

  it('(b) an alert absorbing a correlated siem_event row takes over its correlation and agent-kill link, never its auto-resolve receipts', () => {
    const receipts = new Map([[`siem-${EVENT_ID}`, { ...CORRELATION, ...KILL }]]);
    const plan = planAlertWrites([alert()], found(event()), receipts);
    const doc = plan.upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.f0rtika).toEqual({ ...CORRELATION, ...KILL });
    expect(plan.deletes.get(`siem-${EVENT_ID}`)).toBe(`alert-${ALERT_ID}`);
  });

  it('(b) never overwrites the absorbing alert\'s own receipts', () => {
    const own = { achilles_correlated: true, achilles_test_uuid: 'own-test', achilles_matched_at: '2026-10-28T09:00:00.000Z' };
    const receipts = new Map<string, Record<string, unknown>>([
      [`siem-${EVENT_ID}`, { ...CORRELATION, ...KILL }],
      [`alert-${ALERT_ID}`, own],
    ]);
    const doc = planAlertWrites([alert()], found(alert(), event()), receipts).upserts.get(`alert-${ALERT_ID}`)!;
    // Correlation stays the alert's own; only the missing agent-kill link is carried.
    expect(doc.f0rtika).toEqual(KILL);
  });

  it('(b) an uncorrelated row carries nothing', () => {
    const doc = planAlertWrites([alert()], found(event()), new Map()).upserts.get(`alert-${ALERT_ID}`)!;
    expect(doc.f0rtika).toBeUndefined();
  });

  it('(a) a SIEM event merging into a stored alert carries the correlation of its own earlier row', () => {
    const receipts = new Map([[`siem-${EVENT_ID}`, { ...CORRELATION }]]);
    const plan = planSiemWrites([event()], [], found(alert(), event()), receipts);
    expect([...plan.upserts.keys()]).toEqual([`alert-${ALERT_ID}`]);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.f0rtika).toEqual(CORRELATION);
    expect(plan.deletes.get(`siem-${EVENT_ID}`)).toBe(`alert-${ALERT_ID}`);
  });

  it('a re-fetched alert keeps a receipt carried earlier in the same plan', () => {
    const receipts = new Map([[`siem-${EVENT_ID}`, { ...CORRELATION }]]);
    // The same alert twice in one page: the second copy must not drop what the first absorbed.
    const plan = planAlertWrites([alert(), alert({ status: 'acknowledged' })], found(event()), receipts);
    expect(plan.upserts.get(`alert-${ALERT_ID}`)!.f0rtika).toEqual(CORRELATION);
  });
});

// ---------------------------------------------------------------- SIEM events <-> XDR detections

// Live pilot (one Sophos block of C:\F0\tailcat.exe on one host): an XDR
// detection plus a SIEM CorePuaDetection and CorePuaClean, seconds apart.
const xdr = (extra: Partial<SophosAlertDoc> = {}): SophosAlertDoc => ({ ...transformGraphqlDetection(fx('graphql-detection-blocked-live')), ...extra });
const pua = (n: 'clean' | 'detection', extra: Record<string, unknown> = {}) => transformSiemEvent({ ...fx(`siem-pua-${n}-live`), ...extra })!;
const XDR_ID = sophosDocId(xdr());
const CLEAN_ID = 'siem-00000000-0000-4000-8000-000000000032';
const DETECTION_ID = 'siem-00000000-0000-4000-8000-00000000002e';
const shift = (doc: SophosAlertDoc, ms: number) => new Date(Date.parse(doc.created_at!) + ms).toISOString();
/** A Common Alert for the same Tailcat block (none was raised live; used for precedence). */
const tailcatAlert = () => transformAlert({
  id: 'c0000000-0000-4000-8000-000000000001', type: 'Event::Endpoint::CorePuaDetection', severity: 'medium', category: 'pua',
  description: "PUA detected: 'Tailcat' at 'C:\\F0\\tailcat.exe'", raisedAt: '2026-10-29T19:05:50.000Z',
  managedAgent: { id: 'ep', name: 'host-004' },
});
const RECEIPT = { achilles_correlated: true, achilles_test_uuid: 'c37d6a01-3934-4e72-9cb1-3dae284b937b', achilles_matched_at: '2026-10-29T19:10:00.000Z' };

describe('xdrLookupWindows / siemLookupWindows (SIEM <-> XDR window)', () => {
  it('looks ±5 min around an XDR detection and around a SIEM event', () => {
    const x = xdr();
    expect(xdrLookupWindows([x])).toEqual([{ host: 'HOST-004', from: Date.parse(x.created_at!) - 300_000, to: Date.parse(x.created_at!) + 300_000 }]);
    const e = pua('clean');
    expect(siemLookupWindows([e], [])).toEqual([{ host: 'HOST-004', from: Date.parse(e.created_at!) - 300_000, to: Date.parse(e.created_at!) + 300_000 }]);
    expect(xdrLookupWindows([xdr({ created_at: null })])).toEqual([]);
  });
});

describe('planXdrWrites (an XDR detection absorbs earlier siem_event rows)', () => {
  it('folds both live SIEM rows of the block into the XDR row and deletes them once it is written', () => {
    const plan = planXdrWrites([xdr()], found(pua('detection'), pua('clean')));
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
    const doc = plan.upserts.get(XDR_ID)!;
    expect(doc).toMatchObject({ source_type: 'xdr_detection', alert_title: 'Tailcat: File activity blocked (C:\\F0\\tailcat.exe)', prevention_action: 'quarantined' });
    expect(doc.merged_siem_event_ids).toEqual(['00000000-0000-4000-8000-00000000002e', '00000000-0000-4000-8000-000000000032']);
    expect(plan.deletes).toEqual(new Map([[DETECTION_ID, XDR_ID], [CLEAN_ID, XDR_ID]]));
    expect(plan.merged).toBe(2);
  });

  it('leaves a row from another host, another file or outside the window', () => {
    const rows = found(
      pua('clean', { location: 'host-006' }),
      pua('clean', { id: 'f1', core_remedy_items: { items: [{ type: 'file', result: 'SUCCESS', descriptor: 'C:\\F0\\other.exe' }] }, name: "PUA cleaned up: 'Other' at 'C:\\F0\\other.exe'" }),
      pua('detection', { when: shift(xdr(), 5 * 60_000 + 1_000) }),
    );
    const plan = planXdrWrites([xdr()], rows);
    expect(plan.deletes.size).toBe(0);
    expect(plan.merged).toBe(0);
    expect(plan.upserts.get(XDR_ID)!.merged_siem_event_ids).toBeUndefined();
    expect(plan.upserts.get(XDR_ID)!.prevention_action).toBe('blocked');
  });

  it('a Common Alert match keeps priority: a row an alert matches is left for the alert', () => {
    const plan = planXdrWrites([xdr()], found(tailcatAlert(), pua('clean')));
    expect(plan.deletes.size).toBe(0);
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
  });

  it('never merges two XDR detections: the closest one in time takes the row, the other is untouched', () => {
    const near = xdr();
    const far = xdr({ alert_id: 'alert://cleanup-1', alert_title: 'Cleanup succeeded: File cleanup result: Success (C:\\F0\\tailcat.exe)', created_at: shift(xdr(), 4 * 60_000) });
    const plan = planXdrWrites([far, near], found(pua('detection'), xdr({ alert_id: 'alert://stored-other' })));
    expect(new Set(plan.upserts.keys())).toEqual(new Set([sophosDocId(far), XDR_ID]));
    expect(plan.upserts.get(XDR_ID)!.merged_siem_event_ids).toEqual(['00000000-0000-4000-8000-00000000002e']);
    expect(plan.upserts.get(sophosDocId(far))!.merged_siem_event_ids).toBeUndefined();
    expect([...plan.deletes.keys()]).toEqual([DETECTION_ID]);
  });

  it('a re-read XDR detection keeps the SIEM evidence folded into it earlier', () => {
    const stored = { ...xdr(), prevention_action: 'quarantined' as const, merged_siem_event_ids: ['00000000-0000-4000-8000-000000000032'] };
    const plan = planXdrWrites([xdr({ status: 'resolved' })], found(stored));
    const doc = plan.upserts.get(XDR_ID)!;
    expect(doc.status).toBe('resolved');
    expect(doc.prevention_action).toBe('quarantined');
    expect(doc.merged_siem_event_ids).toEqual(['00000000-0000-4000-8000-000000000032']);
    expect(plan.merged).toBe(0);
  });

  it("takes over an absorbed row's correlation receipt, never over the XDR's own, and never auto-resolve receipts", () => {
    const rowReceipts = new Map([[CLEAN_ID, { ...RECEIPT }]]);
    expect(planXdrWrites([xdr()], found(pua('clean')), rowReceipts).upserts.get(XDR_ID)!.f0rtika).toEqual(RECEIPT);

    const own = { achilles_correlated: true, achilles_test_uuid: 'own', achilles_matched_at: '2026-10-29T19:08:00.000Z' };
    const both = new Map<string, Record<string, unknown>>([[CLEAN_ID, { ...RECEIPT }], [XDR_ID, own]]);
    expect(planXdrWrites([xdr()], found(xdr(), pua('clean')), both).upserts.get(XDR_ID)!.f0rtika).toBeUndefined();
  });
});

describe('planSiemWrites (a SIEM event folds into a stored XDR detection)', () => {
  it('merges the live clean event into the XDR row and deletes any row of that event', () => {
    const plan = planSiemWrites([pua('clean')], [], found(xdr()));
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
    expect(plan.upserts.get(XDR_ID)).toMatchObject({ source_type: 'xdr_detection', prevention_action: 'quarantined', merged_siem_event_ids: ['00000000-0000-4000-8000-000000000032'] });
    expect(plan.deletes).toEqual(new Map([[CLEAN_ID, XDR_ID]]));
    expect(plan.merged).toBe(1);
  });

  it('the widest live gap (+125 s after the XDR detection) still merges', () => {
    const plan = planSiemWrites([pua('clean', { when: shift(xdr(), 125_000) })], [], found(xdr()));
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
  });

  it('a Common Alert match keeps priority over an XDR match', () => {
    const a = tailcatAlert();
    const plan = planSiemWrites([pua('detection')], [], found(xdr(), a));
    expect([...plan.upserts.keys()]).toEqual([sophosDocId(a)]);
    expect(plan.deletes.get(DETECTION_ID)).toBe(sophosDocId(a));
  });

  it('picks the closest XDR detection in time when two match', () => {
    const far = xdr({ alert_id: 'alert://cleanup-1', created_at: shift(xdr(), -4 * 60_000) });
    const plan = planSiemWrites([pua('detection')], [], found(far, xdr()));
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
  });

  it('stays its own row when no XDR detection matches (other host / other file / outside the window)', () => {
    for (const target of [
      xdr({ evidence_hostnames: ['HOST-006'] }),
      xdr({ evidence_filepaths: ['c:\\f0\\other.exe'] }),
      xdr({ created_at: shift(pua('clean'), -6 * 60_000) }),
    ]) {
      const plan = planSiemWrites([pua('clean')], [], found(target));
      expect([...plan.upserts.keys()]).toEqual([CLEAN_ID]);
      expect(plan.deletes.size).toBe(0);
    }
  });

  it('carries the correlation of the event\'s own earlier row into the XDR detection', () => {
    const receipts = new Map([[CLEAN_ID, { ...RECEIPT }]]);
    const plan = planSiemWrites([pua('clean')], [], found(xdr(), pua('clean')), receipts);
    expect([...plan.upserts.keys()]).toEqual([XDR_ID]);
    expect(plan.upserts.get(XDR_ID)!.f0rtika).toEqual(RECEIPT);
    expect(plan.deletes.get(CLEAN_ID)).toBe(XDR_ID);
  });

  it('a legacy cleanup still never merges into an XDR detection', () => {
    const c = parseLegacyCleanup({ id: 'lc', type: 'Event::Endpoint::Threat::CleanedUp', location: 'host-004', name: "Threat 'Tailcat' cleaned up at 'C:\\F0\\tailcat.exe'", when: shift(xdr(), 60_000) })!;
    const plan = planSiemWrites([], [c], found(xdr()));
    expect(plan.upserts.size).toBe(0);
    expect(plan.dropped).toBe(1);
  });
});
