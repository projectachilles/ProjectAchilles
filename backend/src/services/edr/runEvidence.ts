// The run view of an alert's evidence. A Microsoft Defender alert is not one
// event: Defender keeps it open for days and adds the evidence of every later
// run to it, so its alert-wide file list (`evidence_filenames`, ...) mixes
// runs. The sync stores each evidence item with its times (`evidence_items`,
// Defender sync v9); this module keeps only the items of one run and gives
// them back in the shape the multi-test rules read (`EvidenceFields`), so a
// stage or test is credited only from evidence of its own run.
//
// No run view (no run window, or the alert has no per-item data: other
// vendors, alerts synced before v9, `evidence_items: null`) = today's rule,
// the alert as it is, for an alert found by its own created / updated time.
// An alert found only by its activity span (`foundBySpanOnly`) that the run
// rule cannot judge (`spanHitUnusable`) is treated as not returned; in the
// alert list and the report a span-only alert must name the test in one of its
// in-run items.

import {
  alertCredit,
  testOfFile,
  type AlertCredit,
  type AlertCreditOptions,
  type EvidenceChildAction,
  type EvidenceFields,
  type EvidenceFileVerdict,
} from './multiTestEvidence.js';

/** Names of the two time clauses of the Defender alert queries (matched_queries). */
export const ALERT_TIME_QUERY_NAME = 'alert_time';
export const ACTIVITY_SPAN_QUERY_NAME = 'activity_span';

/** Alert doc field holding the per-item evidence with its times (stored, not indexed). */
export const EVIDENCE_ITEMS_FIELD = 'evidence_items';

/** Slack on each side of a run: [run start - slack, event time + slack]. */
export const RUN_WINDOW_SLACK_MS = 60_000;

/** A file item counts up to this long after the result's event time (Defender adds file items late). */
export const FILE_ITEM_TAIL_MS = 30 * 60_000;

/** Verdict precedence when one file appears in several items. */
export const VERDICT_RANK: Record<string, number> = { malicious: 3, suspicious: 2 };

/** Normalized action precedence when one file appears in several items. */
export const ACTION_RANK: Record<string, number> = { quarantined: 3, process_killed: 2, blocked: 1 };

/** One evidence item of an alert that names a file, with its times. */
export interface EvidenceItem {
  /** Lower-case image or file name (no path). */
  file: string;
  path: string | null;
  /** Lower-case name of the parent image, or null. */
  parent: string | null;
  parent_path: string | null;
  kind: 'process' | 'file';
  /** Vendor verdict, or null. */
  verdict: string | null;
  /** Normalized prevention action (`process_killed` | `blocked` | `quarantined`), or null. */
  action: string | null;
  /** When the process started (process items), or null. */
  started_at: string | null;
  /** When the vendor added the item to the alert. */
  added_at: string;
}

/** A result's run window, in epoch ms; `startMs` / `endMs` include the slack. */
export interface RunWindow {
  startMs: number;
  endMs: number;
  eventTimeMs: number;
}

const timeMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || v === '') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** null when either time is missing or invalid, or the start is after the end. */
export function runWindow(runStartedAt: unknown, eventTime: unknown): RunWindow | null {
  const start = timeMs(runStartedAt);
  const end = timeMs(eventTime);
  if (start === null || end === null || start > end) return null;
  return { startMs: start - RUN_WINDOW_SLACK_MS, endMs: end + RUN_WINDOW_SLACK_MS, eventTimeMs: end };
}

/** The alert's items; null when the field is absent, null, or not an array. */
export function evidenceItems(src: Record<string, unknown>): EvidenceItem[] | null {
  const raw = src[EVIDENCE_ITEMS_FIELD];
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (i): i is EvidenceItem =>
      typeof i === 'object' && i !== null && typeof (i as EvidenceItem).file === 'string'
      && typeof (i as EvidenceItem).added_at === 'string',
  );
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * A process item by its start; a file item, or a process item with no start,
 * by when the vendor added it, from the window start to event time + 30 min.
 */
function inRun(item: EvidenceItem, window: RunWindow): boolean {
  const started = item.kind === 'process' ? timeMs(item.started_at) : null;
  if (started !== null) return started >= window.startMs && started <= window.endMs;
  const added = timeMs(item.added_at);
  return added !== null && added >= window.startMs && added <= window.eventTimeMs + FILE_ITEM_TAIL_MS;
}

const rank = (table: Record<string, number>, v: string | null) => (v ? table[v] ?? 0 : 0);

/** The view of the given items in `EvidenceFields` shape (same merge as the Defender sync). */
function viewOf(items: EvidenceItem[]): EvidenceFields {
  const names = new Set<string>();
  const paths = new Set<string>();
  const verdicts = new Map<string, EvidenceFileVerdict>();
  const children: EvidenceChildAction[] = [];
  const childKeys = new Set<string>();
  for (const item of items) {
    const parent = str(item.parent);
    for (const n of [item.file, parent]) if (n) names.add(n);
    for (const p of [str(item.path), str(item.parent_path)]) if (p) paths.add(p);
    const action = str(item.action);
    const verdict = str(item.verdict);
    if (verdict) {
      const prev = verdicts.get(item.file);
      verdicts.set(item.file, {
        file: item.file,
        verdict: prev && rank(VERDICT_RANK, prev.verdict) >= rank(VERDICT_RANK, verdict) ? prev.verdict : verdict,
        action: prev && rank(ACTION_RANK, prev.action) >= rank(ACTION_RANK, action) ? prev.action : action,
      });
    }
    if (item.kind === 'process' && parent && action) {
      const key = `${parent}|${action}`;
      if (!childKeys.has(key)) {
        childKeys.add(key);
        children.push({ parent, action });
      }
    }
  }
  return {
    evidence_filenames: [...names],
    evidence_filepaths: [...paths],
    evidence_file_verdicts: [...verdicts.values()],
    evidence_child_actions: children,
  };
}

/** The alert's items of the run; null = no run view. */
function runItems(src: Record<string, unknown>, window: RunWindow | null): EvidenceItem[] | null {
  if (!window) return null;
  const items = evidenceItems(src);
  return items ? items.filter((i) => inRun(i, window)) : null;
}

/** The alert's evidence restricted to the run, in EvidenceFields shape; null = no run view. */
export function runEvidence(src: Record<string, unknown>, window: RunWindow | null): EvidenceFields | null {
  const items = runItems(src, window);
  return items ? viewOf(items) : null;
}

/** The distinct actions of the given items, in item order. */
const actionsOf = (items: EvidenceItem[]): string[] =>
  [...new Set(items.map((i) => str(i.action)).filter((a): a is string => a !== null))];

/**
 * The distinct actions of the alert's in-run items (any file, any kind), in
 * item order; null = no run view. With a run view this replaces the
 * alert-wide `prevention_action`, which has no time and mixes runs.
 */
export function runActions(src: Record<string, unknown>, window: RunWindow | null): string[] | null {
  const items = runItems(src, window);
  return items ? actionsOf(items) : null;
}

export interface RunCreditOptions extends AlertCreditOptions {
  /** Test-level credit only: a path that names the test also counts. */
  pathNamesTest?: (path: string) => boolean;
}

const viewStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * `alertCredit` on the run view: the alert counts only when the view still
 * matches what the query matched on (a name `mine` selects or, with
 * `pathNamesTest`, a path naming the test). Without a run view it is
 * `alertCredit` on the alert as it is.
 * With a run view the actions are never null (null means "the alert-wide
 * action", which mixes runs): where `alertCredit` would give null (a
 * single-test alert without `ownActionsOnly`) they are the distinct actions
 * of all the alert's in-run items.
 */
export function alertCreditForRun(
  src: Record<string, unknown>,
  window: RunWindow | null,
  mine: (file: string) => boolean,
  options: RunCreditOptions = {},
): AlertCredit {
  const items = runItems(src, window);
  if (!items) return alertCredit(src, mine, options);
  const view = viewOf(items);
  const { pathNamesTest, ...creditOptions } = options;
  const named = viewStrings(view.evidence_filenames).some(mine)
    || (!!pathNamesTest && viewStrings(view.evidence_filepaths).some(pathNamesTest));
  if (!named) return { counts: false, actions: [] };
  const credit = alertCredit(view, mine, creditOptions);
  if (credit.actions !== null) return credit;
  return { counts: credit.counts, actions: actionsOf(items) };
}

const namesTest = (items: EvidenceItem[], uuid: string, pathNamesTest?: (path: string) => boolean): boolean => {
  const id = uuid.toLowerCase();
  return items.some((i) =>
    [i.file, str(i.parent)].some((n) => !!n && testOfFile(n) === id)
    || (!!pathNamesTest && [str(i.path), str(i.parent_path)].some((p) => !!p && pathNamesTest(p))));
};

/** The alert names test `uuid` in its whole history but not in this run. False without a run view. */
export function isOtherRunAlert(
  src: Record<string, unknown>,
  window: RunWindow | null,
  uuid: string,
  pathNamesTest?: (path: string) => boolean,
): boolean {
  if (!window || !uuid) return false;
  const items = evidenceItems(src);
  if (!items) return false;
  return namesTest(items, uuid, pathNamesTest) && !namesTest(items.filter((i) => inRun(i, window)), uuid, pathNamesTest);
}

/** The alert has an item list, the run has a window, and no item of any file is inside the run. */
export function holdsNothingOfRun(src: Record<string, unknown>, window: RunWindow | null): boolean {
  if (!window) return false;
  const items = evidenceItems(src);
  return !!items && !items.some((i) => inRun(i, window));
}

/** True when the hit's matched_queries is an array that has 'activity_span' and not 'alert_time'. */
export function foundBySpanOnly(hit: { matched_queries?: unknown } | null | undefined): boolean {
  const named = hit?.matched_queries;
  return Array.isArray(named) && named.includes(ACTIVITY_SPAN_QUERY_NAME) && !named.includes(ALERT_TIME_QUERY_NAME);
}

/** A span-only hit the run rule cannot judge: no run window, or the alert has no item list. */
export function spanHitUnusable(src: Record<string, unknown>, window: RunWindow | null): boolean {
  return !window || evidenceItems(src) === null;
}

/** One of the alert's in-run items names test `uuid` (by file or parent name, or by path with pathNamesTest). False without a run view. */
export function namesTestInRun(
  src: Record<string, unknown>,
  window: RunWindow | null,
  uuid: string,
  pathNamesTest?: (path: string) => boolean,
): boolean {
  if (!window || !uuid) return false;
  const items = evidenceItems(src);
  return !!items && namesTest(items.filter((i) => inRun(i, window)), uuid, pathNamesTest);
}
