// "One Sophos detection = one row": a blocked test usually produces a Common
// Alert AND a SIEM Core Detection event for the same thing, and they arrive in
// either order, often in different polls. This module decides what to write:
//
//  (a) SIEM core event  -> merged into a matching alert (stored or this poll's),
//                          else written as its own `siem_event` row.
//  (b) Common Alert     -> absorbs any stored `siem_event` row it matches; the
//                          row is deleted once the alert is written.
//  (c) legacy cleanup   -> (Threat::CleanedUp / CleanupFailed status update)
//                          merged into every alert / siem_event row it matches,
//                          else dropped (it is never a row of its own).
//
// The join rules themselves live in normalize.ts (siemEventMatchesAlert,
// legacyCleanupMatches); this module only finds candidates in ES (one search
// per batch, chunked only for very wide batches) and plans the writes.

import type { Client } from '@elastic/elasticsearch';
import { SOPHOS_INDEX } from './index-management.js';
import {
  SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS,
  legacyCleanupMatches,
  mergeSiemIntoAlert,
  siemEventMatchesAlert,
  type SophosAlertDoc,
  type SophosLegacyCleanup,
} from './normalize.js';

/** Same ±2 min window as normalize.ts' join rule. */
const JOIN_WINDOW_MS = 2 * 60 * 1000;
/** Host/time clauses per search; ES' default max_clause_count is far above this. */
const MAX_CLAUSES_PER_SEARCH = 500;
/** Candidates per search (ES' default index.max_result_window). */
const LOOKUP_SIZE = 10_000;

export type SophosDocMap = Map<string, SophosAlertDoc>;

export interface HostWindow { host: string; from: number; to: number }

export interface MergePlan {
  /** Docs to write (update + doc_as_upsert), keyed by ES _id. */
  upserts: SophosDocMap;
  /** siem_event rows to delete -> the _id of the doc that absorbed them (delete only if it was written). */
  deletes: Map<string, string>;
  /** SIEM events / cleanups merged into another doc. */
  merged: number;
  /** Legacy cleanups that matched nothing (dropped). */
  dropped: number;
}

/** Deterministic ES _id per Sophos source. */
export function sophosDocId(doc: Pick<SophosAlertDoc, 'source_type' | 'alert_id'>): string {
  const prefix = doc.source_type === 'alert' ? 'alert' : doc.source_type === 'siem_event' ? 'siem' : 'xdr';
  return `${prefix}-${doc.alert_id}`;
}

function union(a: string[] | undefined, b: string[] | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

function emptyPlan(): MergePlan {
  return { upserts: new Map(), deletes: new Map(), merged: 0, dropped: 0 };
}

const ms = (iso: string | null | undefined): number => Date.parse(iso ?? '');

// ---------------------------------------------------------------- candidate lookup

/** One clause per host and merged time window (overlapping windows of a host collapse). */
export function hostWindowClauses(windows: HostWindow[]): object[] {
  const byHost = new Map<string, HostWindow[]>();
  for (const w of windows) {
    if (!w.host || !Number.isFinite(w.from) || !Number.isFinite(w.to)) continue;
    byHost.set(w.host, [...(byHost.get(w.host) ?? []), w]);
  }
  const clauses: object[] = [];
  for (const [host, list] of byHost) {
    list.sort((x, y) => x.from - y.from);
    let cur = { ...list[0] };
    const flush = () => clauses.push({ bool: { filter: [
      { term: { 'evidence_hostnames.keyword': host } },
      { range: { created_at: { gte: new Date(cur.from).toISOString(), lte: new Date(cur.to).toISOString() } } },
    ] } });
    for (const w of list.slice(1)) {
      if (w.from <= cur.to) cur.to = Math.max(cur.to, w.to);
      else { flush(); cur = { ...w }; }
    }
    flush();
  }
  return clauses;
}

/** Where a stored siem_event row matching one of these alerts could be. */
export function alertLookupWindows(alerts: SophosAlertDoc[]): HostWindow[] {
  return alerts.flatMap((a) => {
    const at = ms(a.created_at);
    if (Number.isNaN(at)) return [];
    return a.evidence_hostnames.map((host) => ({ host, from: at - JOIN_WINDOW_MS, to: at + JOIN_WINDOW_MS }));
  });
}

/**
 * Where a stored doc these SIEM events / cleanups could merge into could be.
 * Cleanups match a target created within [when - 15 min, when + 2 min].
 */
export function siemLookupWindows(events: SophosAlertDoc[], cleanups: SophosLegacyCleanup[]): HostWindow[] {
  const windows: HostWindow[] = [];
  for (const e of events) {
    const at = ms(e.created_at);
    if (Number.isNaN(at)) continue;
    for (const host of e.evidence_hostnames) windows.push({ host, from: at - JOIN_WINDOW_MS, to: at + JOIN_WINDOW_MS });
  }
  for (const c of cleanups) {
    const at = ms(c.when);
    if (Number.isNaN(at) || !c.host) continue;
    windows.push({ host: c.host, from: at - SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS, to: at + JOIN_WINDOW_MS });
  }
  return windows;
}

/** A stored doc without Achilles' f0rtika.* receipts (those must never be written back by a merge). */
function storedDoc(source: Record<string, unknown>): SophosAlertDoc {
  const copy: Record<string, unknown> = { ...source };
  delete copy.f0rtika;
  return copy as unknown as SophosAlertDoc;
}

/**
 * Stored alert docs by _id plus docs of `sourceTypes` in the host/time
 * windows, keyed by _id. One search per batch (chunked past 500 windows).
 */
export async function findCandidates(
  es: Client,
  opts: { ids?: string[]; windows: HostWindow[]; sourceTypes: Array<SophosAlertDoc['source_type']> },
): Promise<SophosDocMap> {
  const out: SophosDocMap = new Map();
  const clauses = hostWindowClauses(opts.windows);
  const ids = opts.ids ?? [];
  const chunks: object[][] = [];
  for (let i = 0; i < clauses.length; i += MAX_CLAUSES_PER_SEARCH) chunks.push(clauses.slice(i, i + MAX_CLAUSES_PER_SEARCH));
  if (chunks.length === 0 && ids.length > 0) chunks.push([]);

  for (const [n, chunk] of chunks.entries()) {
    const should: object[] = [];
    if (n === 0 && ids.length > 0) should.push({ ids: { values: ids } });
    if (chunk.length > 0) {
      should.push({ bool: { filter: [{ terms: { source_type: opts.sourceTypes } }], should: chunk, minimum_should_match: 1 } });
    }
    const res = await es.search({
      index: SOPHOS_INDEX,
      size: LOOKUP_SIZE,
      query: { bool: { filter: [{ term: { doc_type: 'alert' } }], should, minimum_should_match: 1 } },
    } as never);
    const hits = (res as { hits?: { hits?: Array<{ _id?: string; _source?: Record<string, unknown> }> } }).hits?.hits ?? [];
    for (const h of hits) {
      if (h._id && h._source) out.set(h._id, storedDoc(h._source));
    }
  }
  return out;
}

/**
 * Add this poll's own docs (the freshest copies) that a batch could merge
 * with: the same _id, or a host + created_at inside one of the windows. Only
 * relevant docs are added, so a long backfill doesn't make every page scan
 * everything the poll wrote so far.
 */
export function addPollDocs(into: SophosDocMap, pollDocs: SophosDocMap, ids: string[], windows: HostWindow[]): void {
  const idSet = new Set(ids);
  const byHost = new Map<string, HostWindow[]>();
  for (const w of windows) byHost.set(w.host, [...(byHost.get(w.host) ?? []), w]);
  for (const [id, doc] of pollDocs) {
    if (idSet.has(id)) { into.set(id, doc); continue; }
    const at = ms(doc.created_at);
    if (Number.isNaN(at)) continue;
    const inWindow = doc.evidence_hostnames.some((h) => (byHost.get(h) ?? []).some((w) => at >= w.from && at <= w.to));
    if (inWindow) into.set(id, doc);
  }
}

// ---------------------------------------------------------------- planning

/**
 * Re-fetched doc: keep the SIEM evidence merged into the stored copy earlier
 * (evidence, techniques, prevention, origin / sha256, merged ids). Fields the
 * source owns (status, severity, title, dates) come from the fresh copy.
 */
function carryForward(fresh: SophosAlertDoc, stored: SophosAlertDoc | undefined): SophosAlertDoc {
  if (!stored?.merged_siem_event_ids?.length) return fresh;
  const merged = mergeSiemIntoAlert(fresh, { ...stored, alert_id: '' });
  merged.merged_siem_event_ids = union(fresh.merged_siem_event_ids, stored.merged_siem_event_ids);
  return merged;
}

/** Merge a stored / fresh siem_event row (and whatever it had absorbed) into a target. */
function absorbRow(target: SophosAlertDoc, row: SophosAlertDoc): SophosAlertDoc {
  const merged = mergeSiemIntoAlert(target, row);
  merged.merged_siem_event_ids = union(merged.merged_siem_event_ids, row.merged_siem_event_ids);
  return merged;
}

/** (b) Alerts of one page against stored siem_event rows (and their own stored copies). */
export function planAlertWrites(alerts: SophosAlertDoc[], candidates: SophosDocMap): MergePlan {
  const plan = emptyPlan();
  const consumed = new Set<string>();
  for (const alert of alerts) {
    const id = sophosDocId(alert);
    let doc = carryForward(alert, plan.upserts.get(id) ?? candidates.get(id));
    for (const [rowId, row] of candidates) {
      if (row.source_type !== 'siem_event' || consumed.has(rowId)) continue;
      if (!siemEventMatchesAlert(row, doc)) continue;
      doc = absorbRow(doc, row);
      consumed.add(rowId);
      plan.deletes.set(rowId, id);
      plan.merged++;
    }
    plan.upserts.set(id, doc);
  }
  return plan;
}

/** The candidate alert closest in time that this event matches. */
function bestAlertFor(event: SophosAlertDoc, working: SophosDocMap): string | null {
  let best: string | null = null;
  let bestDelta = Infinity;
  for (const [id, doc] of working) {
    if (doc.source_type !== 'alert' || !siemEventMatchesAlert(event, doc)) continue;
    const delta = Math.abs(ms(doc.created_at) - ms(event.created_at));
    if (delta < bestDelta) { best = id; bestDelta = delta; }
  }
  return best;
}

/** (a) + (c) One SIEM page against stored / this poll's alerts and siem_event rows. */
export function planSiemWrites(events: SophosAlertDoc[], cleanups: SophosLegacyCleanup[], candidates: SophosDocMap): MergePlan {
  const plan = emptyPlan();
  const working: SophosDocMap = new Map(candidates);
  const put = (id: string, doc: SophosAlertDoc) => { working.set(id, doc); plan.upserts.set(id, doc); };

  for (const event of events) {
    const rowId = sophosDocId(event);
    const priorRow = working.get(rowId);
    const target = bestAlertFor(event, working);
    if (target) {
      const merged = mergeSiemIntoAlert(working.get(target)!, event);
      put(target, priorRow ? absorbRow(merged, priorRow) : merged);
      // A row for this event may exist (stored by an earlier poll): it is now part of the alert.
      working.delete(rowId);
      plan.upserts.delete(rowId);
      plan.deletes.set(rowId, target);
      plan.merged++;
    } else {
      put(rowId, carryForward(event, priorRow));
    }
  }

  for (const cleanup of cleanups) {
    let hit = false;
    for (const [id, doc] of working) {
      if (doc.source_type === 'xdr_detection' || !legacyCleanupMatches(cleanup, doc)) continue;
      put(id, mergeSiemIntoAlert(doc, cleanup));
      hit = true;
    }
    if (hit) plan.merged++;
    else plan.dropped++;
  }
  return plan;
}
