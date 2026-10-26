/**
 * All SQL for pre-execution notices lives here.
 *
 * Import rule (Ruling R2): nothing under services/notices/ imports
 * services/agent/tasks.service.ts. Linked tasks are read with SQL below, and
 * tasks.service may import this module without creating an ESM cycle.
 *
 * Timestamps: every value written is a `Date.toISOString()` string (with
 * milliseconds) and every comparison uses a JS-computed ISO parameter, never
 * `datetime('now')`. The task hold compares these columns as strings.
 */
import { getDatabase } from '../agent/database.js';
import { runTag } from './window.js';
import { AGENT_KILL_WATCHDOG_ERRORS, parseSqliteUtc } from '../edr/agent-kill-evidence.js';
import type { NoticeKind, NoticeRecord, NoticeRow, NoticeScope, NoticeSourceType, NoticeState, NoticeSummary } from './types.js';

export interface NewNotice {
  id: string;
  kind: NoticeKind;
  state: NoticeState;
  sourceType: NoticeSourceType;
  scheduleIds: string[];
  scheduleId?: string | null;
  windowDate?: string | null;
  timezone: string;
  announcedAgentIds?: string[];
  dayWindowStart?: string | null;
  dayWindowEnd?: string | null;
  createdBy: string;
  createdAt: string;
  recipients: string[];
  skipReason?: string | null;
  /** Org of the tasks the notice gates (null: legacy, no org). */
  orgId: string | null;
}

/** SQL filter + params for a NoticeScope over run_notices (optionally aliased). */
function scopeFilter(scope: NoticeScope, alias = ''): { sql: string; params: string[] } {
  const col = alias ? `${alias}.org_id` : 'org_id';
  return scope.kind === 'org' ? { sql: ` AND ${col} = ?`, params: [scope.orgId] } : { sql: '', params: [] };
}

export function insertNotice(n: NewNotice): void {
  getDatabase()
    .prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, schedule_id, window_date, timezone,
        announced_agent_ids, day_window_start, day_window_end, created_by, created_at, recipients, skip_reason, org_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      n.id,
      n.kind,
      n.state,
      n.sourceType,
      JSON.stringify(n.scheduleIds),
      n.scheduleId ?? null,
      n.windowDate ?? null,
      n.timezone,
      JSON.stringify(n.announcedAgentIds ?? []),
      n.dayWindowStart ?? null,
      n.dayWindowEnd ?? null,
      n.createdBy,
      n.createdAt,
      JSON.stringify(n.recipients),
      n.skipReason ?? null,
      n.orgId,
    );
}

export function getNotice(id: string): NoticeRow | null {
  const row = getDatabase().prepare('SELECT * FROM run_notices WHERE id = ?').get(id) as NoticeRow | undefined;
  return row ?? null;
}

export function getDayNotice(scheduleId: string, windowDate: string): NoticeRow | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM run_notices WHERE kind = 'day' AND schedule_id = ? AND window_date = ?`)
    .get(scheduleId, windowDate) as NoticeRow | undefined;
  return row ?? null;
}

/** Append a schedule id to a run notice's `schedule_ids` (no-op if already listed). */
export function appendScheduleId(noticeId: string, scheduleId: string): void {
  getDatabase()
    .prepare(`
      UPDATE run_notices
      SET schedule_ids = json_insert(schedule_ids, '$[#]', ?)
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM json_each(run_notices.schedule_ids) WHERE value = ?)
    `)
    .run(scheduleId, noticeId, scheduleId);
}

export function hasPendingRunNoticeForSchedule(scheduleId: string): boolean {
  const row = getDatabase()
    .prepare(`
      SELECT 1 FROM run_notices
      WHERE kind = 'run' AND state = 'pending'
        AND EXISTS (SELECT 1 FROM json_each(run_notices.schedule_ids) WHERE value = ?)
      LIMIT 1
    `)
    .get(scheduleId);
  return row !== undefined;
}

/**
 * Atomically claim a pending notice for sending. A claim older than
 * `staleCutoffIso` (a crashed or hung sender) can be taken over.
 */
export function claimNotice(id: string, nowIso: string, staleCutoffIso: string): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE run_notices SET claim_at = ?
      WHERE id = ? AND state = 'pending' AND (claim_at IS NULL OR claim_at < ?)
    `)
    .run(nowIso, id, staleCutoffIso);
  return res.changes > 0;
}

/*
 * Claim ownership: every write after a claim is conditional on
 * `state = 'pending' AND claim_at = <the claim this sender wrote>`. A sender
 * whose claim went stale and was taken over changes nothing (0 rows), so it
 * can't clear the new owner's claim or record a late result.
 */
const OWNED = `id = ? AND state = 'pending' AND claim_at = ?`;

/** Returns false when the caller no longer owns the claim. */
export function releaseClaim(id: string, claimAt: string): boolean {
  return getDatabase().prepare(`UPDATE run_notices SET claim_at = NULL WHERE ${OWNED}`).run(id, claimAt).changes > 0;
}

export function markSkipped(id: string, claimAt: string, reason: string): boolean {
  return (
    getDatabase()
      .prepare(`UPDATE run_notices SET state = 'skipped', skip_reason = ?, claim_at = NULL WHERE ${OWNED}`)
      .run(reason, id, claimAt).changes > 0
  );
}

export function markSent(
  id: string,
  claimAt: string,
  v: {
    sentAt: string;
    recipients: string[];
    accepted: string[];
    rejected: string[];
    releaseAt: string;
    pickupDeadline: string;
    windowEnd: string;
  },
): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE run_notices
      SET state = 'sent', sent_at = ?, recipients = ?, accepted = ?, rejected = ?, attempts = attempts + 1,
          last_error = NULL, last_attempt_at = ?, release_at = ?, pickup_deadline = ?, window_end = ?, claim_at = NULL
      WHERE ${OWNED}
    `)
    .run(
      v.sentAt,
      JSON.stringify(v.recipients),
      JSON.stringify(v.accepted),
      JSON.stringify(v.rejected),
      v.sentAt,
      v.releaseAt,
      v.pickupDeadline,
      v.windowEnd,
      id,
      claimAt,
    );
  return res.changes > 0;
}

/**
 * Record a failed attempt: the recipients it went to, what the server
 * accepted/rejected, and when it finished (for the retry backoff). Returns
 * false when the caller no longer owns the claim (nothing written).
 */
export function recordSendFailure(
  id: string,
  claimAt: string,
  v: { error: string; recipients: string[]; accepted: string[]; rejected: string[]; attemptAt: string },
): boolean {
  const res = getDatabase()
    .prepare(`
      UPDATE run_notices
      SET attempts = attempts + 1, last_error = ?, recipients = ?, accepted = ?, rejected = ?,
          last_attempt_at = ?, claim_at = NULL
      WHERE ${OWNED}
    `)
    .run(
      v.error,
      JSON.stringify(v.recipients),
      JSON.stringify(v.accepted),
      JSON.stringify(v.rejected),
      v.attemptAt,
      id,
      claimAt,
    );
  return res.changes > 0;
}

/** Atomically take the once-per-notice Slack failure alert. False if already taken. */
export function claimSlackFailureAlert(id: string): boolean {
  return (
    getDatabase()
      .prepare('UPDATE run_notices SET slack_failure_alerted = 1 WHERE id = ? AND slack_failure_alerted = 0')
      .run(id).changes > 0
  );
}

export function resetSlackFailureAlert(id: string): void {
  getDatabase().prepare('UPDATE run_notices SET slack_failure_alerted = 0 WHERE id = ?').run(id);
}

export interface LinkedTaskRow {
  id: string;
  agent_id: string;
  status: string;
  payload: string;
  hostname: string | null;
  os: string | null;
  last_heartbeat: string | null;
}

/** Tasks linked to a notice, with their agent's host details. */
export function getLinkedTasks(noticeId: string): LinkedTaskRow[] {
  return getDatabase()
    .prepare(`
      SELECT t.id, t.agent_id, t.status, t.payload, a.hostname, a.os, a.last_heartbeat
      FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id
      WHERE t.notice_id = ?
      ORDER BY t.created_at ASC, t.id ASC
    `)
    .all(noticeId) as LinkedTaskRow[];
}

/**
 * Number of controls in the most recent completed run of a bundle test, or
 * null if it has never completed here. The library itself does not declare a
 * reliable count, so the last real result is the source of truth. Scoped to
 * `orgId` when given; legacy (null-org) notices look at every run.
 */
export function getLastBundleControlCount(testUuid: string, orgId: string | null): number | null {
  const row = getDatabase()
    .prepare(`
      SELECT json_array_length(result, '$.bundle_results.controls') AS n
      FROM tasks
      WHERE type = 'execute_test' AND status = 'completed'
        AND json_valid(payload) AND json_extract(payload, '$.test_uuid') = ?
        AND (? IS NULL OR org_id = ?)
        AND json_valid(result) AND json_array_length(result, '$.bundle_results.controls') > 0
      ORDER BY completed_at DESC, rowid DESC
      LIMIT 1
    `)
    .get(testUuid, orgId, orgId) as { n: number } | undefined;
  return row?.n ?? null;
}

export interface AgentHostRow {
  id: string;
  hostname: string;
  os: string;
  last_heartbeat: string | null;
}

export function getAgentHosts(agentIds: string[]): AgentHostRow[] {
  if (agentIds.length === 0) return [];
  const placeholders = agentIds.map(() => '?').join(', ');
  return getDatabase()
    .prepare(`SELECT id, hostname, os, last_heartbeat FROM agents WHERE id IN (${placeholders})`)
    .all(...agentIds) as AgentHostRow[];
}

export function getScheduleNames(scheduleIds: string[]): Map<string, string | null> {
  if (scheduleIds.length === 0) return new Map();
  const placeholders = scheduleIds.map(() => '?').join(', ');
  const rows = getDatabase()
    .prepare(`SELECT id, name FROM schedules WHERE id IN (${placeholders})`)
    .all(...scheduleIds) as Array<{ id: string; name: string | null }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Sweeps (processNotices)
// ---------------------------------------------------------------------------

/** Task states that still count as "in flight" for a notice. */
const ACTIVE_TASK_STATES = `'pending','assigned','downloading','executing'`;

export interface PendingNoticeRow {
  id: string;
  attempts: number;
  last_attempt_at: string | null;
}

/** Distinct org ids (null included) that have a pending notice. */
export function listPendingNoticeOrgIds(): Array<string | null> {
  return (
    getDatabase().prepare(`SELECT DISTINCT org_id FROM run_notices WHERE state = 'pending'`).all() as Array<{
      org_id: string | null;
    }>
  ).map((r) => r.org_id);
}

/** Pending notices, oldest first, with what the send pass needs for its backoff. */
export function listPendingNotices(): PendingNoticeRow[] {
  return getDatabase()
    .prepare(`
      SELECT id, attempts, last_attempt_at FROM run_notices
      WHERE state = 'pending' ORDER BY created_at ASC, id ASC
    `)
    .all() as PendingNoticeRow[];
}

/** Whether any task linked to the notice is still `pending` (held). */
export function hasPendingLinkedTask(noticeId: string): boolean {
  return (
    getDatabase()
      .prepare(`SELECT 1 FROM tasks WHERE notice_id = ? AND status = 'pending' LIMIT 1`)
      .get(noticeId) !== undefined
  );
}

/** Parse tasks.created_at (SQLite 'YYYY-MM-DD HH:MM:SS' UTC) or an ISO string. */
function parseSqlTime(s: string | null): number | null {
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Pending day notices matching `where`, with the created_at of their oldest still-pending task (none: absent). */
function oldestHeldTaskByDayNotice(where: string, params: unknown[]): Array<{ id: string; oldest: string }> {
  return getDatabase()
    .prepare(`
      SELECT n.id AS id, MIN(t.created_at) AS oldest
      FROM run_notices n JOIN tasks t ON t.notice_id = n.id AND t.status = 'pending'
      WHERE n.kind = 'day' AND ${where}
      GROUP BY n.id
    `)
    .all(...params) as Array<{ id: string; oldest: string }>;
}

/**
 * Bounded wait for the notices of one org (`orgId`; null matches notices with
 * no org): pending notices created at or before `createdCutoffIso` become
 * `not_delivered`. A run notice that holds no pending task (none were created,
 * or all were cancelled) is `skipped` instead: no test was held, so there is
 * nothing to alarm about. A day notice that holds no pending task is left
 * `pending` (it is harmless and waits for a later per-machine agent to link a
 * task; skipping it would expire those later tasks). A notice held by a live (non-stale) send claim is left for
 * the next pass, so a sender mid-SMTP isn't overtaken. Returns the ids moved
 * to `not_delivered`.
 */
export function markNotDelivered(
  orgId: string | null,
  createdCutoffIso: string,
  staleClaimCutoffIso: string,
  reasons: { noTasks: string; noneHeld: string },
): string[] {
  const db = getDatabase();
  // `IS ?`: also matches NULL when orgId is null.
  const due = `state = 'pending' AND org_id IS ? AND created_at <= ? AND (claim_at IS NULL OR claim_at < ?)`;
  return db.transaction(() => {
    db.prepare(`
      UPDATE run_notices
      SET state = 'skipped', claim_at = NULL,
          skip_reason = CASE WHEN EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = run_notices.id)
                             THEN ? ELSE ? END
      WHERE ${due} AND kind = 'run'
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = run_notices.id AND t.status = 'pending')
    `).run(reasons.noneHeld, reasons.noTasks, orgId, createdCutoffIso, staleClaimCutoffIso);
    // Run notices wait from their own creation; day notices from the oldest
    // task they hold (they are created at the first agent of the day and may
    // sit empty for hours). Day comparison is in JS: tasks.created_at is
    // SQLite's space-separated form, notices use ISO.
    const rows = db
      .prepare(`
        UPDATE run_notices SET state = 'not_delivered', claim_at = NULL
        WHERE ${due} AND kind = 'run'
          AND EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = run_notices.id AND t.status = 'pending')
        RETURNING id
      `)
      .all(orgId, createdCutoffIso, staleClaimCutoffIso) as Array<{ id: string }>;
    const cutoffMs = Date.parse(createdCutoffIso);
    for (const d of oldestHeldTaskByDayNotice(
      `n.state = 'pending' AND n.org_id IS ? AND (n.claim_at IS NULL OR n.claim_at < ?)`,
      [orgId, staleClaimCutoffIso],
    )) {
      const ms = parseSqlTime(d.oldest);
      if (ms === null || ms > cutoffMs) continue;
      const moved = db
        .prepare(`UPDATE run_notices SET state = 'not_delivered', claim_at = NULL WHERE id = ? AND state = 'pending'`)
        .run(d.id).changes;
      if (moved > 0) rows.push({ id: d.id });
    }
    return rows.map((r) => r.id);
  })();
}

/**
 * Expire every still-pending task linked to a `not_delivered` notice (Ruling
 * R5: on every pass, so tasks linked after the transition expire too; a later
 * per-machine agent can link to an undelivered day notice). `skipped` notices
 * never gain links: run notices are closed at creation and day notices that
 * hold nothing stay `pending` instead of being skipped.
 */
export function expireTasksOfNotDelivered(nowIso: string, resultJson: string): number {
  return getDatabase()
    .prepare(`
      UPDATE tasks SET status = 'expired', completed_at = ?, result = ?
      WHERE status = 'pending'
        AND notice_id IN (SELECT id FROM run_notices WHERE state = 'not_delivered')
    `)
    .run(nowIso, resultJson).changes;
}

/**
 * Pickup deadline: expire still-pending tasks of released notices whose
 * deadline has passed. Includes automatic retries created after the deadline,
 * which inherit the parent's notice. Picked-up tasks are untouched.
 */
export function expireTasksPastPickupDeadline(nowIso: string, resultJson: string): number {
  return getDatabase()
    .prepare(`
      UPDATE tasks SET status = 'expired', completed_at = ?, result = ?
      WHERE status = 'pending' AND notice_id IN (
        SELECT id FROM run_notices WHERE state IN ('sent','overridden') AND pickup_deadline <= ?)
    `)
    .run(nowIso, resultJson, nowIso).changes;
}

/**
 * not_delivered notices still owed their one Slack message: created since
 * `sinceIso` and with at least one linked task (an orphan notice skipped no
 * tests).
 */
export function listNotDeliveredToAlert(sinceIso: string): NoticeRow[] {
  return getDatabase()
    .prepare(`
      SELECT * FROM run_notices n
      WHERE state = 'not_delivered' AND slack_not_delivered_alerted = 0 AND created_at >= ?
        AND EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = n.id)
      ORDER BY created_at ASC
    `)
    .all(sinceIso) as NoticeRow[];
}

export function claimSlackNotDeliveredAlert(id: string): boolean {
  return (
    getDatabase()
      .prepare('UPDATE run_notices SET slack_not_delivered_alerted = 1 WHERE id = ? AND slack_not_delivered_alerted = 0')
      .run(id).changes > 0
  );
}

export function resetSlackNotDeliveredAlert(id: string): void {
  getDatabase().prepare('UPDATE run_notices SET slack_not_delivered_alerted = 0 WHERE id = ?').run(id);
}

/**
 * Released notices whose pickup deadline passed between `sinceIso` and
 * `nowIso`, Finished not yet sent, fewer than `maxAttempts` failures, at least
 * one linked task and none still in flight.
 */
export function listFinishedCandidates(nowIso: string, sinceIso: string, maxAttempts: number): NoticeRow[] {
  return getDatabase()
    .prepare(`
      SELECT * FROM run_notices n
      WHERE state IN ('sent','overridden') AND pickup_deadline <= ? AND pickup_deadline >= ?
        AND finished_sent_at IS NULL AND finished_attempts < ?
        AND EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.notice_id = n.id AND t.status IN (${ACTIVE_TASK_STATES}))
      ORDER BY created_at ASC
    `)
    .all(nowIso, sinceIso, maxAttempts) as NoticeRow[];
}

export interface TaskOutcomeRow {
  id: string;
  status: string;
  result: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  original_task_id: string | null;
  retry_count: number | null;
  created_at: string;
  /** payload.metadata.category */
  category: string | null;
  /** 1 once the result is in Elasticsearch (for a failed task: reconciled as EDR-killed). */
  es_ingested: number;
}

export function getLinkedTaskOutcomes(noticeId: string): TaskOutcomeRow[] {
  return getDatabase()
    .prepare(`
      SELECT id, status, result, assigned_at, completed_at, original_task_id, retry_count, created_at,
             json_extract(payload, '$.metadata.category') AS category, es_ingested
      FROM tasks WHERE notice_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(noticeId) as TaskOutcomeRow[];
}

/** Latest attempt per target: a failed task and its automatic retries count once. */
export function latestAttempts(rows: TaskOutcomeRow[]): TaskOutcomeRow[] {
  const byChain = new Map<string, TaskOutcomeRow>();
  for (const r of rows) {
    const key = r.original_task_id || r.id;
    const cur = byChain.get(key);
    if (!cur || (r.retry_count ?? 0) > (cur.retry_count ?? 0)) byChain.set(key, r);
  }
  return [...byChain.values()];
}

/** How long the Finished email waits for a cut-off run to be reconciled. */
const FINISHED_HOLD_MS = 15 * 60_000;

const WATCHDOG_ERRORS = new Set<string>(AGENT_KILL_WATCHDOG_ERRORS);

function resultError(result: string | null): unknown {
  if (!result) return null;
  try {
    return (JSON.parse(result) as { error?: unknown }).error;
  } catch {
    return null;
  }
}

/**
 * Should the Finished email wait? True while, with an EDR connected, a run's
 * latest attempt was cut off by a watchdog less than 15 minutes ago and the
 * EDR reconciliation pass has not yet proved (es_ingested = 1) that the EDR
 * killed it. Derived from task rows only, so it survives a restart. Tasks the
 * pass never reconciles (cyber-hygiene, never assigned) don't hold.
 */
export function finishedHoldActive(rows: TaskOutcomeRow[], now: Date, edrConfigured: boolean): boolean {
  if (!edrConfigured) return false;
  return latestAttempts(rows).some((r) => {
    if (r.status !== 'failed' || r.es_ingested !== 0 || !r.completed_at || !r.assigned_at) return false;
    if (r.category === 'cyber-hygiene') return false;
    const error = resultError(r.result);
    if (typeof error !== 'string' || !WATCHDOG_ERRORS.has(error)) return false;
    // NaN (unparseable completed_at) fails the comparison: no hold.
    return now.getTime() - parseSqliteUtc(r.completed_at) < FINISHED_HOLD_MS;
  });
}

export function markFinishedSent(id: string, atIso: string): boolean {
  return (
    getDatabase()
      .prepare('UPDATE run_notices SET finished_sent_at = ? WHERE id = ? AND finished_sent_at IS NULL')
      .run(atIso, id).changes > 0
  );
}

export function recordFinishedFailure(id: string): void {
  getDatabase()
    .prepare('UPDATE run_notices SET finished_attempts = finished_attempts + 1 WHERE id = ? AND finished_sent_at IS NULL')
    .run(id);
}

/** Release without notice. Conditional on `pending`; false if the notice already moved. */
export function overrideNotice(
  id: string,
  v: { by: string; reason: string; at: string; releaseAt: string; pickupDeadline: string; windowEnd: string },
): boolean {
  return (
    getDatabase()
      .prepare(`
        UPDATE run_notices
        SET state = 'overridden', override_by = ?, override_reason = ?, override_at = ?,
            release_at = ?, pickup_deadline = ?, window_end = ?, claim_at = NULL
        WHERE id = ? AND state = 'pending'
      `)
      .run(v.by, v.reason, v.at, v.releaseAt, v.pickupDeadline, v.windowEnd, id).changes > 0
  );
}

// ---------------------------------------------------------------------------
// Read models (status banner, notice log, Tasks UI badges)
// ---------------------------------------------------------------------------

/**
 * Pending notices in `scope` past the cutoff. A run notice counts from its own
 * creation; a day notice from its oldest still-pending task, and not at all
 * while it holds none (it is inert, not overdue).
 */
export function countPendingCreatedBefore(cutoffIso: string, scope: NoticeScope): number {
  const f = scopeFilter(scope);
  const runs = getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM run_notices WHERE state = 'pending' AND kind = 'run' AND created_at <= ?${f.sql}`)
    .get(cutoffIso, ...f.params) as { c: number };
  const cutoffMs = Date.parse(cutoffIso);
  const nf = scopeFilter(scope, 'n');
  const days = oldestHeldTaskByDayNotice(`n.state = 'pending'${nf.sql}`, nf.params).filter((d) => {
    const ms = parseSqlTime(d.oldest);
    return ms !== null && ms <= cutoffMs;
  });
  return runs.c + days.length;
}

export function countNotDeliveredSince(sinceIso: string, scope: NoticeScope): number {
  const f = scopeFilter(scope);
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM run_notices WHERE state = 'not_delivered' AND created_at >= ?${f.sql}`)
    .get(sinceIso, ...f.params) as { c: number };
  return row.c;
}

/** Notices in `scope`, newest first. */
export function listNotices(limit: number, offset: number, scope: NoticeScope, state?: NoticeState): NoticeRow[] {
  const f = scopeFilter(scope);
  const byState = state ? ' AND state = ?' : '';
  return getDatabase()
    .prepare(`SELECT * FROM run_notices WHERE 1 = 1${f.sql}${byState} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...f.params, ...(state ? [state] : []), limit, offset) as NoticeRow[];
}

/** Pending (held) tasks per notice id. */
export function countHeldTasks(noticeIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (noticeIds.length === 0) return out;
  const rows = getDatabase()
    .prepare(`SELECT notice_id, COUNT(*) AS n FROM tasks WHERE status = 'pending' AND notice_id IN (${noticeIds.map(() => '?').join(', ')}) GROUP BY notice_id`)
    .all(...noticeIds) as Array<{ notice_id: string; n: number }>;
  for (const r of rows) out.set(r.notice_id, r.n);
  return out;
}

const SUMMARY_CHUNK = 500;

/**
 * Summaries keyed by notice id; unknown ids and notices outside `scope` are
 * omitted (Ruling R21: an org caller never sees another org's notice, even
 * next to a task row it can see).
 */
export function getNoticeSummaries(ids: string[], scope: NoticeScope): Record<string, NoticeSummary> {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  const out: Record<string, NoticeSummary> = {};
  for (let i = 0; i < unique.length; i += SUMMARY_CHUNK) {
    const chunk = unique.slice(i, i + SUMMARY_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const f = scopeFilter(scope);
    const rows = getDatabase()
      .prepare(`SELECT id, state, last_error, release_at, pickup_deadline FROM run_notices WHERE id IN (${placeholders})${f.sql}`)
      .all(...chunk, ...f.params) as Array<Omit<NoticeSummary, 'run_tag'>>;
    for (const r of rows) {
      out[r.id] = {
        id: r.id,
        run_tag: runTag(r.id),
        state: r.state,
        last_error: r.last_error,
        release_at: r.release_at,
        pickup_deadline: r.pickup_deadline,
      };
    }
  }
  return out;
}

/** One notice's summary and delivery record, or null if unknown or outside `scope`. */
export function getNoticeRecord(id: string, scope: NoticeScope): NoticeRecord | null {
  const f = scopeFilter(scope);
  const r = getDatabase()
    .prepare(
      `SELECT id, state, last_error, release_at, pickup_deadline, sent_at, recipients,
              override_by, override_reason, override_at
       FROM run_notices WHERE id = ?${f.sql}`,
    )
    .get(id, ...f.params) as (Omit<NoticeRecord, 'run_tag' | 'recipients'> & { recipients: string | null }) | undefined;
  if (!r) return null;
  let recipients: string[] = [];
  try {
    const v = JSON.parse(r.recipients ?? '[]');
    if (Array.isArray(v)) recipients = v.filter((x): x is string => typeof x === 'string');
  } catch {
    recipients = [];
  }
  return {
    id: r.id,
    run_tag: runTag(r.id),
    state: r.state,
    last_error: r.last_error,
    release_at: r.release_at,
    pickup_deadline: r.pickup_deadline,
    sent_at: r.sent_at,
    recipients,
    override_by: r.override_by,
    override_reason: r.override_reason,
    override_at: r.override_at,
  };
}
