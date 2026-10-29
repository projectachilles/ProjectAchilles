import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('../index-management.js', () => ({ SOPHOS_INDEX: 'achilles-sophos' }));

const { transformAlert, transformSiemEvent, parseLegacyCleanup } = await import('../normalize.js');
const {
  sophosDocId,
  hostWindowClauses,
  alertLookupWindows,
  siemLookupWindows,
  findCandidates,
  addPollDocs,
  planAlertWrites,
  planSiemWrites,
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
